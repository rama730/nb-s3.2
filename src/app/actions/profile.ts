'use server'

import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { profileAuditEvents, profiles, projects } from '@/lib/db/schema'
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

export type UpdateProfileInput = ProfileUpdateInput

const PROFILE_UPDATE_LIMIT = 30
const PROFILE_UPDATE_WINDOW_SECONDS = 60
const USERNAME_CHANGE_LIMIT = 5
const USERNAME_CHANGE_WINDOW_SECONDS = 24 * 60 * 60
const USERNAME_CHANGE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000

function toNullableString(value: string | undefined): string | null | undefined {
    if (value === undefined) return undefined
    const trimmed = value.trim()
    return trimmed || null
}

export async function updateProfileAction(data: UpdateProfileInput) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return { success: false, error: 'Unauthorized' }
        }

        const updateRate = await consumeRateLimit(
            `profile:update:${user.id}`,
            PROFILE_UPDATE_LIMIT,
            PROFILE_UPDATE_WINDOW_SECONDS
        )
        if (!updateRate.allowed) {
            return { success: false, error: 'Too many profile updates. Please wait and try again.' }
        }

        const result = profileUpdateSchema.safeParse(data)
        if (!result.success) {
            return { success: false, error: result.error.issues[0].message }
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
                openTo: true,
                experience: true,
                education: true,
                updatedAt: true,
            },
        })
        if (!current) {
            return { success: false, error: 'Profile not found' }
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
                openTo: current.openTo || [],
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
                return { success: false, error: 'Too many username changes. Please try again later.' }
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
                }
            }

            const existing = await db.query.profiles.findFirst({
                columns: { id: true },
                where: and(
                    sql`lower(${profiles.username}) = ${patch.username.toLowerCase()}`,
                    ne(profiles.id, user.id)
                ),
            })
            if (existing) {
                return { success: false, error: 'Username is already taken' }
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
        if (patch.openTo !== undefined) updateData.openTo = patch.openTo
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

        const updatedRows = await db
            .update(profiles)
            .set(updateData)
            .where(whereClause)
            .returning({ id: profiles.id, updatedAt: profiles.updatedAt, username: profiles.username })

        if (updatedRows.length === 0) {
            if (expectedUpdatedAt) {
                return {
                    success: false,
                    error: 'Profile was updated elsewhere. Please refresh and retry.',
                    code: 'PROFILE_CONFLICT',
                }
            }
            return { success: false, error: 'Profile not found' }
        }

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

        if (auditRows.length > 0) {
            try {
                await db.insert(profileAuditEvents).values(auditRows)
            } catch (auditInsertError) {
                console.warn('Profile audit logging unavailable, skipping insert', auditInsertError)
            }
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

        return { success: true, updatedAt: updatedRows[0].updatedAt.toISOString() }
    } catch (error) {
        console.error('Error updating profile:', error)
        return { success: false, error: 'Failed to update profile' }
    }
}

export async function updateBioAction(bio: string) {
    return updateProfileAction({ bio });
}

export async function getProfileBasic(userId: string) {
    if (!userId) return null;
    try {
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
    } catch (error) {
        console.error('Error fetching profile basic:', error);
        return null;
    }
}

export async function getProfileProjectsAction(userId: string) {
    if (!userId) return [];
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        const isOwner = user?.id === userId

        const visibilityFilter = isOwner
            ? eq(projects.ownerId, userId)
            : and(
                eq(projects.ownerId, userId),
                eq(projects.visibility, 'public'),
                ne(projects.status, 'draft')
            )

        const userProjects = await db
            .select({
                id: projects.id,
                slug: projects.slug,
                title: projects.title,
                description: projects.description,
                shortDescription: projects.shortDescription,
                coverImage: projects.coverImage,
                updatedAt: projects.updatedAt,
            })
            .from(projects)
            .where(visibilityFilter)
            .orderBy(desc(projects.updatedAt), desc(projects.createdAt))
            .limit(12);

        return userProjects.map((project) => ({
            ...project,
            image: project.coverImage || null,
            url: project.slug ? `/projects/${project.slug}` : `/projects/${project.id}`,
        }));
    } catch (error) {
        console.error('Error fetching profile projects:', error);
        return [];
    }
}

export async function getProfileStatsAction(userId: string) {
    if (!userId) return { connectionsCount: 0, projectsCount: 0, followersCount: 0 };
    try {
        const [profileStats] = await db
            .select({
                connectionsCount: profiles.connectionsCount,
                projectsCount: profiles.projectsCount,
                followersCount: profiles.followersCount,
            })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);

        if (profileStats) {
            return {
                connectionsCount: profileStats.connectionsCount || 0,
                projectsCount: profileStats.projectsCount || 0,
                followersCount: profileStats.followersCount || 0,
            };
        }

        return {
            connectionsCount: 0,
            projectsCount: 0,
            followersCount: 0
        };
    } catch (error) {
        console.error('Error fetching profile stats:', error);
        return { connectionsCount: 0, projectsCount: 0, followersCount: 0 };
    }
}
