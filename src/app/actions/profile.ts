'use server'

import { randomUUID } from 'crypto'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { profileAuditEvents, profiles, projects, usernameAliases } from '@/lib/db/schema'
import { eq, and, ne, desc, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { consumeRateLimit } from '@/lib/security/rate-limit'
import {
    normalizeProfileUpdateInput,
    pickChangedProfileFields,
    profileUpdateSchema,
    type ProfileUpdateInput,
} from '@/lib/validations/profile'
import { clearProfileCache } from '@/lib/services/profile-service'
import { runInFlightDeduped } from '@/lib/async/inflight-dedupe'
import { normalizeAndValidateFileSize, normalizeAndValidateMimeType } from '@/lib/upload/security'
import { resolvePrivacyRelationship } from '@/lib/privacy/resolver'
import { logger } from '@/lib/logger'
import { UsernamePersistenceError, getUsernameAvailability, mapUsernamePersistenceError } from '@/lib/usernames/service'

export type UpdateProfileInput = ProfileUpdateInput
export type ProfileUpdateErrorCode =
    | 'UNAUTHORIZED'
    | 'RATE_LIMITED'
    | 'VALIDATION_ERROR'
    | 'PROFILE_NOT_FOUND'
    | 'USERNAME_RATE_LIMITED'
    | 'USERNAME_HISTORY_UNAVAILABLE'
    | 'USERNAME_COOLDOWN'
    | 'USERNAME_TAKEN'
    | 'USERNAME_INVALID'
    | 'USERNAME_RESERVED'
    | 'PROFILE_CONFLICT'
    | 'PROFILE_UPDATE_FAILED'

export type UpdateProfileActionResult =
    | { success: true; updatedAt: string }
    | { success: false; error: string; errorCode: ProfileUpdateErrorCode; code?: ProfileUpdateErrorCode }

const PROFILE_UPDATE_LIMIT = 30
const PROFILE_UPDATE_WINDOW_SECONDS = 60
const USERNAME_CHANGE_LIMIT = 5
const USERNAME_CHANGE_WINDOW_SECONDS = 24 * 60 * 60
const USERNAME_CHANGE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000
const PROFILE_IMAGE_UPLOAD_MAX_FILE_BYTES = Number.parseInt(
    process.env.PROFILE_IMAGE_UPLOAD_MAX_FILE_BYTES || `${10 * 1024 * 1024}`,
    10,
)
const ALLOWED_PROFILE_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
])

type ProfileImageUploadErrorCode = 'UNAUTHORIZED' | 'VALIDATION_ERROR' | 'UPLOAD_URL_FAILED'

function profileImageExtensionFromMimeType(mimeType: string): string {
    switch (mimeType) {
        case 'image/jpeg':
            return 'jpg'
        case 'image/png':
            return 'png'
        case 'image/webp':
            return 'webp'
        case 'image/gif':
            return 'gif'
        default:
            return 'bin'
    }
}

export async function createProfileImageUploadUrlAction(input: {
    mimeType: string
    sizeBytes: number
    kind?: 'avatar' | 'banner'
}): Promise<
    | { success: true; uploadUrl: string; publicUrl: string; storagePath: string; contentType: string }
    | { success: false; error: string; errorCode: ProfileImageUploadErrorCode }
> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return { success: false, error: 'Unauthorized', errorCode: 'UNAUTHORIZED' }
    }

    let normalizedMimeType = ''
    try {
        normalizedMimeType = normalizeAndValidateMimeType(input.mimeType)
        if (!ALLOWED_PROFILE_IMAGE_MIME_TYPES.has(normalizedMimeType)) {
            return { success: false, error: 'Unsupported image type', errorCode: 'VALIDATION_ERROR' }
        }
        normalizeAndValidateFileSize(
            input.sizeBytes,
            Number.isFinite(PROFILE_IMAGE_UPLOAD_MAX_FILE_BYTES) && PROFILE_IMAGE_UPLOAD_MAX_FILE_BYTES > 0
                ? PROFILE_IMAGE_UPLOAD_MAX_FILE_BYTES
                : 10 * 1024 * 1024,
            input.kind === 'banner' ? 'Banner image' : 'Avatar image',
        )
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Invalid upload input',
            errorCode: 'VALIDATION_ERROR',
        }
    }

    const extension = profileImageExtensionFromMimeType(normalizedMimeType)
    const storagePath = `${user.id}/${Date.now()}-${randomUUID()}.${extension}`
    const admin = await createAdminClient()
    const { data, error } = await admin.storage.from('avatars').createSignedUploadUrl(storagePath, { upsert: false })
    if (error || !data?.signedUrl) {
        return {
            success: false,
            error: error?.message || 'Failed to create upload URL',
            errorCode: 'UPLOAD_URL_FAILED',
        }
    }

    const { data: { publicUrl } } = admin.storage.from('avatars').getPublicUrl(storagePath)
    return {
        success: true,
        uploadUrl: data.signedUrl,
        publicUrl,
        storagePath,
        contentType: normalizedMimeType,
    }
}

function toNullableString(value: string | undefined): string | null | undefined {
    if (value === undefined) return undefined
    const trimmed = value.trim()
    return trimmed || null
}

export async function updateProfileAction(data: UpdateProfileInput): Promise<UpdateProfileActionResult> {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return { success: false, error: 'Unauthorized', errorCode: 'UNAUTHORIZED' }
        }

        const updateRate = await consumeRateLimit(
            `profile:update:${user.id}`,
            PROFILE_UPDATE_LIMIT,
            PROFILE_UPDATE_WINDOW_SECONDS
        )
        if (!updateRate.allowed) {
            return { success: false, error: 'Too many profile updates. Please wait and try again.', errorCode: 'RATE_LIMITED' }
        }

        const result = profileUpdateSchema.safeParse(data)
        if (!result.success) {
            return { success: false, error: result.error.issues[0].message, errorCode: 'VALIDATION_ERROR' }
        }
        const validData = normalizeProfileUpdateInput(result.data)

        const current = await db.query.profiles.findFirst({
            where: eq(profiles.id, user.id),
            columns: {
                id: true,
                username: true,
                fullName: true,
                headline: true,
                bio: true,
                location: true,
                website: true,
                avatarUrl: true,
                bannerUrl: true,
                skills: true,
                interests: true,
                socialLinks: true,
                visibility: true,
                availabilityStatus: true,
                messagePrivacy: true,
                openTo: true,
                experienceLevel: true,
                hoursPerWeek: true,
                genderIdentity: true,
                pronouns: true,
                experience: true,
                education: true,
                updatedAt: true,
            },
        })
        if (!current) {
            return { success: false, error: 'Profile not found', errorCode: 'PROFILE_NOT_FOUND' }
        }

        const patch = pickChangedProfileFields(
            {
                username: current.username || undefined,
                fullName: current.fullName || undefined,
                headline: current.headline || undefined,
                bio: current.bio || undefined,
                location: current.location || undefined,
                website: current.website || undefined,
                avatarUrl: current.avatarUrl || undefined,
                bannerUrl: current.bannerUrl || undefined,
                skills: current.skills || [],
                interests: current.interests || [],
                socialLinks: current.socialLinks || {},
                visibility: current.visibility || undefined,
                availabilityStatus: current.availabilityStatus || undefined,
                messagePrivacy: current.messagePrivacy || undefined,
                openTo: current.openTo || [],
                experienceLevel: current.experienceLevel || null,
                hoursPerWeek: current.hoursPerWeek || null,
                genderIdentity: current.genderIdentity || null,
                pronouns: current.pronouns || null,
                experience: current.experience || [],
                education: current.education || [],
            },
            validData
        )

        if (Object.keys(patch).length === 0) {
            return { success: true, updatedAt: current.updatedAt.toISOString() }
        }

        if (patch.username && patch.username !== current.username) {
            const usernameRate = await consumeRateLimit(
                `profile:update:username:${user.id}`,
                USERNAME_CHANGE_LIMIT,
                USERNAME_CHANGE_WINDOW_SECONDS
            )
            if (!usernameRate.allowed) {
                return { success: false, error: 'Too many username changes. Please try again later.', errorCode: 'USERNAME_RATE_LIMITED' }
            }

            let lastUsernameChange: { createdAt: Date } | undefined
            try {
                lastUsernameChange = await db.query.profileAuditEvents.findFirst({
                    columns: { createdAt: true },
                    where: and(
                        eq(profileAuditEvents.userId, user.id),
                        eq(profileAuditEvents.eventType, 'username_changed')
                    ),
                    orderBy: [desc(profileAuditEvents.createdAt)],
                })
            } catch (auditLookupError) {
                console.error('Profile audit lookup failed; blocking username change', {
                    userId: user.id,
                    error: auditLookupError instanceof Error ? auditLookupError.message : String(auditLookupError),
                })
                return {
                    success: false,
                    error: 'Unable to verify username change history right now. Please try again shortly.',
                    errorCode: 'USERNAME_HISTORY_UNAVAILABLE',
                }
            }

            if (
                lastUsernameChange &&
                Date.now() - lastUsernameChange.createdAt.getTime() < USERNAME_CHANGE_COOLDOWN_MS
            ) {
                const retryDate = new Date(lastUsernameChange.createdAt.getTime() + USERNAME_CHANGE_COOLDOWN_MS)
                return {
                    success: false,
                    error: `Username can be changed again after ${retryDate.toLocaleDateString()}`,
                    errorCode: 'USERNAME_COOLDOWN',
                }
            }

            const availability = await getUsernameAvailability({
                username: patch.username,
                viewerId: user.id,
            })
            if (!availability.available) {
                const errorCode =
                    availability.code === 'USERNAME_RESERVED'
                        ? 'USERNAME_RESERVED'
                        : availability.code === 'USERNAME_INVALID'
                            ? 'USERNAME_INVALID'
                            : 'USERNAME_TAKEN'
                return { success: false, error: availability.message, errorCode }
            }
        }

        const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
        }
        if (patch.username !== undefined) updateData.username = toNullableString(patch.username)
        if (patch.fullName !== undefined) updateData.fullName = toNullableString(patch.fullName)
        if (patch.headline !== undefined) updateData.headline = toNullableString(patch.headline)
        if (patch.bio !== undefined) updateData.bio = toNullableString(patch.bio)
        if (patch.location !== undefined) updateData.location = toNullableString(patch.location)
        if (patch.website !== undefined) updateData.website = toNullableString(patch.website)
        if (patch.avatarUrl !== undefined) updateData.avatarUrl = toNullableString(patch.avatarUrl)
        if (patch.bannerUrl !== undefined) updateData.bannerUrl = toNullableString(patch.bannerUrl)
        if (patch.skills !== undefined) updateData.skills = patch.skills
        if (patch.interests !== undefined) updateData.interests = patch.interests
        if (patch.socialLinks !== undefined) updateData.socialLinks = patch.socialLinks
        if (patch.visibility !== undefined) updateData.visibility = patch.visibility
        if (patch.availabilityStatus !== undefined) updateData.availabilityStatus = patch.availabilityStatus
        if (patch.messagePrivacy !== undefined) updateData.messagePrivacy = patch.messagePrivacy
        if (patch.openTo !== undefined) updateData.openTo = patch.openTo
        if (patch.experienceLevel !== undefined) updateData.experienceLevel = patch.experienceLevel
        if (patch.hoursPerWeek !== undefined) updateData.hoursPerWeek = patch.hoursPerWeek
        if (patch.genderIdentity !== undefined) updateData.genderIdentity = patch.genderIdentity
        if (patch.pronouns !== undefined) updateData.pronouns = patch.pronouns
        if (patch.experience !== undefined) updateData.experience = patch.experience
        if (patch.education !== undefined) updateData.education = patch.education

        const expectedUpdatedAt = validData.expectedUpdatedAt
            ? new Date(validData.expectedUpdatedAt)
            : null
        const expectedUpdatedAtIso =
            expectedUpdatedAt && Number.isFinite(expectedUpdatedAt.getTime())
                ? expectedUpdatedAt.toISOString()
                : null

        const whereClause =
            expectedUpdatedAtIso
                ? and(
                    eq(profiles.id, user.id),
                    sql`date_trunc('milliseconds', ${profiles.updatedAt}) = date_trunc('milliseconds', ${expectedUpdatedAtIso}::timestamptz)`
                )
                : eq(profiles.id, user.id)

        const sensitiveFields: Array<{
            key: keyof ProfileUpdateInput
            eventType: string
        }> = [
            { key: 'username', eventType: 'username_changed' },
            { key: 'visibility', eventType: 'visibility_changed' },
            { key: 'website', eventType: 'website_changed' },
            { key: 'availabilityStatus', eventType: 'availability_status_changed' },
        ]
        const auditRows = sensitiveFields
            .filter((item) => patch[item.key] !== undefined)
            .map((item) => ({
                userId: user.id,
                eventType: item.eventType,
                previousValue: { value: (current as Record<string, unknown>)[item.key] ?? null },
                nextValue: { value: (patch as Record<string, unknown>)[item.key] ?? null },
                metadata: {},
            }))

        let updatedRows: Array<{ id: string; updatedAt: Date; username: string | null }> = []
        try {
            updatedRows = await db.transaction(async (tx) => {
                const rows = await tx
                    .update(profiles)
                    .set(updateData)
                    .where(whereClause)
                    .returning({ id: profiles.id, updatedAt: profiles.updatedAt, username: profiles.username })

                if (rows.length === 0) {
                    return rows
                }

                if (patch.username && patch.username !== current.username) {
                    const nextUsername = patch.username
                    const previousUsername = current.username
                    if (previousUsername && previousUsername !== nextUsername) {
                        await tx
                            .update(usernameAliases)
                            .set({
                                isPrimary: false,
                                replacedAt: new Date(),
                            })
                            .where(eq(usernameAliases.username, previousUsername))
                    }

                    const existingAlias = await tx.query.usernameAliases.findFirst({
                        where: eq(usernameAliases.username, nextUsername),
                        columns: { userId: true, isPrimary: true },
                    })

                    if (existingAlias) {
                        if (existingAlias.userId !== user.id) {
                            throw new UsernamePersistenceError('USERNAME_TAKEN', 'Username is already taken')
                        }

                        if (!existingAlias.isPrimary) {
                            await tx
                                .update(usernameAliases)
                                .set({
                                    isPrimary: true,
                                    replacedAt: null,
                                })
                                .where(
                                    and(
                                        eq(usernameAliases.username, nextUsername),
                                        eq(usernameAliases.userId, user.id),
                                    ),
                                )
                        }
                    } else {
                        await tx.insert(usernameAliases).values({
                            username: nextUsername,
                            userId: user.id,
                            isPrimary: true,
                            claimedAt: new Date(),
                            replacedAt: null,
                        })
                    }
                }

                if (auditRows.length > 0) {
                    await tx.insert(profileAuditEvents).values(auditRows)
                }

                return rows
            })
        } catch (error) {
            const usernameError = mapUsernamePersistenceError(error)
            if (usernameError.code !== 'DB_ERROR') {
                logger.metric('username.rename.result', {
                    userId: user.id,
                    success: false,
                    reason: usernameError.code,
                })
                return {
                    success: false,
                    error: usernameError.message,
                    errorCode: usernameError.code as ProfileUpdateErrorCode,
                }
            }
            throw error
        }

        if (updatedRows.length === 0) {
            if (expectedUpdatedAt) {
                return {
                    success: false,
                    error: 'Profile was updated elsewhere. Please refresh and retry.',
                    errorCode: 'PROFILE_CONFLICT',
                    code: 'PROFILE_CONFLICT',
                }
            }
            return { success: false, error: 'Profile not found', errorCode: 'PROFILE_NOT_FOUND' }
        }

        if (patch.username || patch.fullName || patch.avatarUrl) {
            try {
                const authPayload = {
                    username: patch.username ?? current.username,
                    full_name: patch.fullName ?? current.fullName,
                    avatar_url: patch.avatarUrl ?? current.avatarUrl,
                }
                const { error: authUpdateError } = await supabase.auth.updateUser({
                    data: authPayload,
                })
                if (authUpdateError) {
                    console.warn('Failed to sync auth user metadata', {
                        userId: user.id,
                        values: authPayload,
                        error: authUpdateError.message,
                    })
                }
            } catch (authUpdateError) {
                console.warn('Failed to sync auth user metadata', {
                    userId: user.id,
                    values: {
                        username: patch.username ?? current.username,
                        fullName: patch.fullName ?? current.fullName,
                        avatarUrl: patch.avatarUrl ?? current.avatarUrl,
                    },
                    error: authUpdateError instanceof Error ? authUpdateError.message : String(authUpdateError),
                })
            }
        }

        clearProfileCache(user.id)
        revalidatePath('/profile')
        if (current.username) revalidatePath(`/u/${current.username}`)
        if (patch.username) revalidatePath(`/u/${patch.username}`)

        if (patch.username && patch.username !== current.username) {
            logger.metric('username.rename.result', {
                userId: user.id,
                success: true,
                previousUsername: current.username ?? null,
                username: patch.username,
            })
        }

        return { success: true, updatedAt: updatedRows[0].updatedAt.toISOString() }
    } catch (error) {
        const usernameError = mapUsernamePersistenceError(error)
        if (usernameError.code !== 'DB_ERROR') {
            logger.metric('username.rename.result', {
                userId: 'unknown',
                success: false,
                reason: usernameError.code,
            })
            return {
                success: false,
                error: usernameError.message,
                errorCode: usernameError.code as ProfileUpdateErrorCode,
            }
        }
        console.error('Error updating profile:', error)
        return { success: false, error: 'Failed to update profile', errorCode: 'PROFILE_UPDATE_FAILED' }
    }
}

export async function updateBioAction(bio: string) {
    return updateProfileAction({ bio });
}

export async function getProfileBasic(userId: string) {
    if (!userId) return null;
    try {
        return await runInFlightDeduped(`profile:basic:${userId}`, async () => {
            const [profile] = await db
                .select({
                    id: profiles.id,
                    fullName: profiles.fullName,
                    username: profiles.username,
                    avatarUrl: profiles.avatarUrl,
                })
                .from(profiles)
                .where(eq(profiles.id, userId))
                .limit(1);

            return profile || null;
        });
    } catch (error) {
        console.error('Error fetching profile basic:', error);
        return null;
    }
}

export async function getProfileViewerOverlayAction(profileId: string) {
    if (!profileId) {
        return { success: false as const, error: 'Profile is required' };
    }

    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false as const, error: 'Not authenticated' };
        }

        const privacyRelationship = await resolvePrivacyRelationship(user.id, profileId);
        if (!privacyRelationship) {
            return { success: false as const, error: 'Profile not found' };
        }

        let mutualCount = 0;
        if (user.id !== profileId && privacyRelationship.canViewProfile) {
            try {
                const res = await supabase.rpc('get_mutual_connections', {
                    p_viewer_id: user.id,
                    p_profile_id: profileId,
                });
                mutualCount = (res.data as { count?: number } | null)?.count || 0;
            } catch {
                mutualCount = 0;
            }
        }

        return {
            success: true as const,
            privacyRelationship: {
                canViewProfile: privacyRelationship.canViewProfile,
                canSendMessage: privacyRelationship.canSendMessage,
                canSendConnectionRequest: privacyRelationship.canSendConnectionRequest,
                blockedByViewer: privacyRelationship.blockedByViewer,
                blockedByTarget: privacyRelationship.blockedByTarget,
                visibilityReason: privacyRelationship.visibilityReason,
                connectionState: privacyRelationship.connectionState,
            },
            lockedShell: !privacyRelationship.canViewProfile,
            mutualCount,
        };
    } catch (error) {
        return {
            success: false as const,
            error: error instanceof Error ? error.message : 'Failed to load profile viewer state',
        };
    }
}
