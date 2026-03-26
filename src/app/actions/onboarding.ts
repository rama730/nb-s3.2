'use server'

import { db } from '@/lib/db'
import { onboardingDrafts, onboardingEvents, onboardingSubmissions, profiles, usernameAliases } from '@/lib/db/schema'
import {
    ONBOARDING_AVAILABILITY_VALUES,
    ONBOARDING_EXPERIENCE_LEVEL_VALUES,
    ONBOARDING_GENDER_VALUES,
    ONBOARDING_HOURS_PER_WEEK_VALUES,
    ONBOARDING_MESSAGE_PRIVACY_VALUES,
    ONBOARDING_SOCIAL_KEYS,
    ONBOARDING_TOTAL_STEPS,
    ONBOARDING_VISIBILITY_VALUES,
    type OnboardingAvailabilityStatus,
    type OnboardingExperienceLevel,
    type OnboardingGenderIdentity,
    type OnboardingHoursPerWeek,
    type OnboardingMessagePrivacy,
    type OnboardingSocialLinks,
    type OnboardingVisibility,
} from '@/lib/onboarding/contracts'
import { onboardingEventInputSchema, type OnboardingEventInput } from '@/lib/onboarding/events'
import { onboardingError, type OnboardingError } from '@/lib/onboarding/errors'
import { UsernamePersistenceError, findUnavailableUsernames, generateDeterministicUsernameCandidates, getUsernameAvailability, mapUsernamePersistenceError } from '@/lib/usernames/service'
import { consumeRateLimit } from '@/lib/security/rate-limit'
import { createClient } from '@/lib/supabase/server'
import { isEmailVerified } from '@/lib/auth/email-verification'
import type { OnboardingPayloadInput } from '@/lib/validations/onboarding'
import { normalizeOnboardingPayload } from '@/lib/validations/onboarding'
import { normalizeUsername, sanitizeUsernameInput, validateUsername } from '@/lib/validations/username'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { headers } from 'next/headers'

const ONBOARDING_COMPLETE_LIMIT = 10
const ONBOARDING_COMPLETE_WINDOW_SECONDS = 60
const ONBOARDING_COMPLETE_IP_LIMIT = 30
const ONBOARDING_COMPLETE_FINGERPRINT_LIMIT = 20
const ONBOARDING_IDEMPOTENCY_MIN_CHARS = 12
const ONBOARDING_IDEMPOTENCY_MAX_CHARS = 80
const ONBOARDING_PROCESSING_STALE_MS = 60_000
const ONBOARDING_STEP_MIN = 1
const ONBOARDING_STEP_MAX = ONBOARDING_TOTAL_STEPS
const MAX_DRAFT_TAG_ITEMS = 25
const MAX_DRAFT_OPEN_TO_ITEMS = 12
const MAX_DRAFT_TAG_ITEM_CHARS = 32
const MAX_DRAFT_HEADLINE_CHARS = 120
const MAX_DRAFT_BIO_CHARS = 500
const MAX_DRAFT_LOCATION_CHARS = 120
const MAX_DRAFT_WEBSITE_CHARS = 200
const MAX_DRAFT_PRONOUNS_CHARS = 60
const MAX_DRAFT_SOCIAL_URL_CHARS = 200
const MAX_DRAFT_FULL_NAME_CHARS = 80

type DraftPayload = {
    username?: string
    fullName?: string
    avatarUrl?: string
    headline?: string
    bio?: string
    location?: string
    website?: string
    skills?: string[]
    interests?: string[]
    openTo?: string[]
    availabilityStatus?: OnboardingAvailabilityStatus
    messagePrivacy?: OnboardingMessagePrivacy
    socialLinks?: OnboardingSocialLinks
    experienceLevel?: OnboardingExperienceLevel
    hoursPerWeek?: OnboardingHoursPerWeek
    genderIdentity?: OnboardingGenderIdentity
    pronouns?: string
    visibility?: OnboardingVisibility
}

function clampStep(step: number): number {
    if (!Number.isFinite(step)) return ONBOARDING_STEP_MIN
    return Math.min(ONBOARDING_STEP_MAX, Math.max(ONBOARDING_STEP_MIN, Math.floor(step)))
}

function trimOptionalString(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== 'string') return undefined
    const normalized = value.trim().slice(0, maxLength)
    return normalized.length > 0 ? normalized : undefined
}

function trimOptionalUrl(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== 'string') return undefined
    const normalized = value.trim().slice(0, maxLength)
    if (!normalized) return undefined
    if (/^https?:\/\//i.test(normalized)) return normalized
    return `https://${normalized}`
}

function sanitizeEnum<T extends string>(
    value: unknown,
    allowed: readonly T[]
): T | undefined {
    if (typeof value !== 'string') return undefined
    return allowed.includes(value as T) ? (value as T) : undefined
}

function sanitizeDraftTagList(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined
    const seen = new Set<string>()
    const list: string[] = []

    for (const item of value) {
        if (typeof item !== 'string') continue
        const normalized = item.trim().slice(0, MAX_DRAFT_TAG_ITEM_CHARS)
        if (!normalized) continue
        const key = normalized.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        list.push(normalized)
        if (list.length >= MAX_DRAFT_TAG_ITEMS) break
    }

    return list
}

function sanitizeDraftOpenToList(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined
    const seen = new Set<string>()
    const list: string[] = []
    for (const item of value) {
        if (typeof item !== 'string') continue
        const normalized = item.trim().slice(0, MAX_DRAFT_TAG_ITEM_CHARS)
        if (!normalized) continue
        const key = normalized.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        list.push(normalized)
        if (list.length >= MAX_DRAFT_OPEN_TO_ITEMS) break
    }
    return list
}

function sanitizeDraftSocialLinks(value: unknown): OnboardingSocialLinks | undefined {
    if (!value || typeof value !== 'object') return undefined
    const source = value as Record<string, unknown>
    const result: OnboardingSocialLinks = {}
    for (const key of ONBOARDING_SOCIAL_KEYS) {
        const normalized = trimOptionalUrl(source[key], MAX_DRAFT_SOCIAL_URL_CHARS)
        if (!normalized) continue
        result[key] = normalized
    }
    return Object.keys(result).length > 0 ? result : undefined
}

function sanitizeOnboardingDraft(input: unknown): DraftPayload {
    const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    const visibility = source.visibility
    const availabilityStatus = sanitizeEnum(
        source.availabilityStatus,
        ONBOARDING_AVAILABILITY_VALUES
    )
    const messagePrivacy = sanitizeEnum(
        source.messagePrivacy,
        ONBOARDING_MESSAGE_PRIVACY_VALUES
    )
    const experienceLevel = sanitizeEnum(
        source.experienceLevel,
        ONBOARDING_EXPERIENCE_LEVEL_VALUES
    )
    const hoursPerWeek = sanitizeEnum(
        source.hoursPerWeek,
        ONBOARDING_HOURS_PER_WEEK_VALUES
    )
    const genderIdentity = sanitizeEnum(
        source.genderIdentity,
        ONBOARDING_GENDER_VALUES
    )
    return {
        username: typeof source.username === 'string' ? sanitizeUsernameInput(source.username) : undefined,
        fullName: trimOptionalString(source.fullName, MAX_DRAFT_FULL_NAME_CHARS),
        avatarUrl: trimOptionalString(source.avatarUrl, 2000),
        headline: trimOptionalString(source.headline, MAX_DRAFT_HEADLINE_CHARS),
        bio: trimOptionalString(source.bio, MAX_DRAFT_BIO_CHARS),
        location: trimOptionalString(source.location, MAX_DRAFT_LOCATION_CHARS),
        website: trimOptionalUrl(source.website, MAX_DRAFT_WEBSITE_CHARS),
        skills: sanitizeDraftTagList(source.skills),
        interests: sanitizeDraftTagList(source.interests),
        openTo: sanitizeDraftOpenToList(source.openTo),
        availabilityStatus,
        messagePrivacy,
        socialLinks: sanitizeDraftSocialLinks(source.socialLinks),
        experienceLevel,
        hoursPerWeek,
        genderIdentity,
        pronouns: trimOptionalString(source.pronouns, MAX_DRAFT_PRONOUNS_CHARS),
        visibility: ONBOARDING_VISIBILITY_VALUES.includes(visibility as OnboardingVisibility)
            ? (visibility as OnboardingVisibility)
            : undefined,
    }
}

function sanitizeOnboardingDraftPatch(input: unknown): Partial<DraftPayload> {
    const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    const patch: Partial<DraftPayload> = {}

    if ('username' in source) {
        patch.username = typeof source.username === 'string' ? sanitizeUsernameInput(source.username) : undefined
    }
    if ('fullName' in source) patch.fullName = trimOptionalString(source.fullName, MAX_DRAFT_FULL_NAME_CHARS)
    if ('avatarUrl' in source) patch.avatarUrl = trimOptionalString(source.avatarUrl, 2000)
    if ('headline' in source) patch.headline = trimOptionalString(source.headline, MAX_DRAFT_HEADLINE_CHARS)
    if ('bio' in source) patch.bio = trimOptionalString(source.bio, MAX_DRAFT_BIO_CHARS)
    if ('location' in source) patch.location = trimOptionalString(source.location, MAX_DRAFT_LOCATION_CHARS)
    if ('website' in source) patch.website = trimOptionalUrl(source.website, MAX_DRAFT_WEBSITE_CHARS)
    if ('skills' in source) patch.skills = sanitizeDraftTagList(source.skills)
    if ('interests' in source) patch.interests = sanitizeDraftTagList(source.interests)
    if ('openTo' in source) patch.openTo = sanitizeDraftOpenToList(source.openTo)
    if ('availabilityStatus' in source) {
        patch.availabilityStatus = sanitizeEnum(source.availabilityStatus, ONBOARDING_AVAILABILITY_VALUES)
    }
    if ('messagePrivacy' in source) {
        patch.messagePrivacy = sanitizeEnum(source.messagePrivacy, ONBOARDING_MESSAGE_PRIVACY_VALUES)
    }
    if ('socialLinks' in source) patch.socialLinks = sanitizeDraftSocialLinks(source.socialLinks)
    if ('experienceLevel' in source) {
        patch.experienceLevel = sanitizeEnum(source.experienceLevel, ONBOARDING_EXPERIENCE_LEVEL_VALUES)
    }
    if ('hoursPerWeek' in source) {
        patch.hoursPerWeek = sanitizeEnum(source.hoursPerWeek, ONBOARDING_HOURS_PER_WEEK_VALUES)
    }
    if ('genderIdentity' in source) {
        patch.genderIdentity = sanitizeEnum(source.genderIdentity, ONBOARDING_GENDER_VALUES)
    }
    if ('pronouns' in source) patch.pronouns = trimOptionalString(source.pronouns, MAX_DRAFT_PRONOUNS_CHARS)
    if ('visibility' in source) {
        const visibility = source.visibility
        patch.visibility = ONBOARDING_VISIBILITY_VALUES.includes(visibility as OnboardingVisibility)
            ? (visibility as OnboardingVisibility)
            : undefined
    }

    return patch
}

function sanitizeTelemetryMetadata(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object') return {}
    const entries = Object.entries(input as Record<string, unknown>).slice(0, 20)
    const metadata: Record<string, unknown> = {}
    for (const [key, value] of entries) {
        if (!key) continue
        if (typeof value === 'string') {
            metadata[key] = value.slice(0, 300)
            continue
        }
        if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
            metadata[key] = value
            continue
        }
    }
    return metadata
}

function toLegacyErrorMessage(error: OnboardingError | undefined, fallback: string): string {
    return error?.message || fallback
}

function parseIdempotencyKey(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const normalized = value.trim()
    if (normalized.length < ONBOARDING_IDEMPOTENCY_MIN_CHARS) return null
    if (normalized.length > ONBOARDING_IDEMPOTENCY_MAX_CHARS) return null
    if (!/^[a-zA-Z0-9:_-]+$/.test(normalized)) return null
    return normalized
}

function buildOnboardingCompleteRateLimitKeys(params: {
    userId: string
    ipAddress: string
    userAgent: string
}) {
    const ua = params.userAgent.toLowerCase().slice(0, 120) || 'unknown'
    return {
        user: `onboarding:complete:user:${params.userId}`,
        ip: `onboarding:complete:ip:${params.ipAddress}`,
        fingerprint: `onboarding:complete:fingerprint:${params.ipAddress}:${ua}`,
    }
}

function mapOnboardingPersistenceError(error: unknown): OnboardingError {
    const usernameError = mapUsernamePersistenceError(error)
    if (usernameError.code !== 'DB_ERROR') {
        return usernameError
    }
    const code = (error as { code?: string })?.code
    if (code === '22P02') {
        return onboardingError('INVALID_INPUT', 'Invalid onboarding input')
    }
    return onboardingError('DB_ERROR', 'Unable to complete onboarding right now', true)
}

async function getViewerIdentity() {
    const supabase = await createClient()
    const [{ data: authData }, headerStore] = await Promise.all([
        supabase.auth.getUser(),
        headers(),
    ])

    const user = authData.user || null
    const ipAddress = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const userAgent = headerStore.get('user-agent') || 'unknown'
    const viewerKey = user?.id || `anon:${ipAddress}`

    return {
        supabase,
        user,
        ipAddress,
        userAgent,
        viewerKey,
    }
}

async function syncOnboardingClaims(params: {
    supabase: Awaited<ReturnType<typeof createClient>>
    username: string
    fullName: string
    avatarUrl?: string
    emailVerified?: boolean
}): Promise<boolean> {
    const payload = {
        data: {
            username: params.username,
            onboarded: true,
            full_name: params.fullName,
            avatar_url: params.avatarUrl || null,
            email_verified: params.emailVerified === true,
        },
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const { error } = await params.supabase.auth.updateUser(payload)
        if (!error) return true
        console.error('Error syncing onboarding claims (attempt):', attempt + 1, error.message)
    }
    return false
}

async function ensureUsernameIsAvailable(params: {
    username: string
    userId: string
}) {
    try {
        const availability = await getUsernameAvailability({
            username: params.username,
            viewerId: params.userId,
        })
        if (!availability.available) {
            return {
                ok: false as const,
                error: availability.error || onboardingError(availability.code || 'USERNAME_TAKEN', availability.message),
            }
        }

        return { ok: true as const }
    } catch (error) {
        console.error('Error checking username availability:', error)
        return {
            ok: false as const,
            error: onboardingError('DB_ERROR', 'Unable to verify username availability', true),
        }
    }
}

function buildProfileOnboardingValues(params: {
    userEmail: string
    payload: ReturnType<typeof normalizeOnboardingPayload>
    avatarUrl: string | null
}) {
    return {
        email: params.userEmail,
        username: params.payload.username,
        fullName: params.payload.fullName,
        avatarUrl: params.avatarUrl,
        headline: params.payload.headline || null,
        bio: params.payload.bio || null,
        location: params.payload.location || null,
        website: params.payload.website || null,
        skills: params.payload.skills,
        interests: params.payload.interests,
        openTo: params.payload.openTo,
        availabilityStatus: params.payload.availabilityStatus,
        messagePrivacy: params.payload.messagePrivacy,
        socialLinks: params.payload.socialLinks,
        experienceLevel: params.payload.experienceLevel || null,
        hoursPerWeek: params.payload.hoursPerWeek || null,
        genderIdentity: params.payload.genderIdentity || null,
        pronouns: params.payload.pronouns || null,
        visibility: params.payload.visibility,
    }
}

function generateCandidateUsernames(fullName: string): string[] {
    return generateDeterministicUsernameCandidates(fullName)
}

async function beginOnboardingSubmission(params: {
    userId: string
    idempotencyKey: string
}): Promise<
    | { mode: 'process'; submissionId: string }
    | { mode: 'replay'; response: { success: boolean; needsMetadataSync?: boolean; error?: OnboardingError } }
    | { mode: 'in-progress' }
> {
    const now = new Date()
    const inserted = await db
        .insert(onboardingSubmissions)
        .values({
            userId: params.userId,
            idempotencyKey: params.idempotencyKey,
            status: 'processing',
            response: {},
            createdAt: now,
            updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: onboardingSubmissions.id })

    if (inserted.length > 0) {
        return { mode: 'process', submissionId: inserted[0].id }
    }

    const existing = await db.query.onboardingSubmissions.findFirst({
        where: and(
            eq(onboardingSubmissions.userId, params.userId),
            eq(onboardingSubmissions.idempotencyKey, params.idempotencyKey)
        ),
        columns: {
            id: true,
            status: true,
            response: true,
            updatedAt: true,
        },
    })

    if (!existing) {
        return { mode: 'in-progress' }
    }

    if (existing.status === 'completed') {
        const response = (existing.response || {}) as {
            success?: boolean
            needsMetadataSync?: boolean
            error?: OnboardingError
        }
        return {
            mode: 'replay',
            response: {
                success: response.success === true,
                needsMetadataSync: response.needsMetadataSync === true,
                error: response.error,
            },
        }
    }

    const stale = now.getTime() - existing.updatedAt.getTime() > ONBOARDING_PROCESSING_STALE_MS
    if (!stale) {
        return { mode: 'in-progress' }
    }

    const reacquired = await db
        .update(onboardingSubmissions)
        .set({
            status: 'processing',
            response: {},
            updatedAt: now,
        })
        .where(
            and(
                eq(onboardingSubmissions.id, existing.id),
                eq(onboardingSubmissions.status, 'processing')
            )
        )
        .returning({ id: onboardingSubmissions.id })

    if (reacquired.length === 0) {
        return { mode: 'in-progress' }
    }

    return { mode: 'process', submissionId: reacquired[0].id }
}

async function finalizeOnboardingSubmission(params: {
    submissionId: string
    status: 'completed' | 'failed'
    response: Record<string, unknown>
}) {
    await db
        .update(onboardingSubmissions)
        .set({
            status: params.status,
            response: params.response,
            updatedAt: new Date(),
        })
        .where(eq(onboardingSubmissions.id, params.submissionId))
}

export async function completeOnboarding(
    data: OnboardingPayloadInput & { idempotencyKey?: string }
): Promise<{
    success: boolean
    error?: string
    errorDetails?: OnboardingError
    needsMetadataSync?: boolean
}> {
    let submissionId: string | null = null
    try {
        const normalizedUsername = normalizeUsername(data.username)
        const usernameValidation = validateUsername(normalizedUsername)
        if (!usernameValidation.valid) {
            const error = onboardingError('USERNAME_INVALID', usernameValidation.message)
            return { success: false, error: error.message, errorDetails: error }
        }

        let payload: ReturnType<typeof normalizeOnboardingPayload>
        try {
            payload = normalizeOnboardingPayload({ ...data, username: normalizedUsername })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid onboarding data'
            const details = onboardingError('INVALID_INPUT', message)
            return { success: false, error: details.message, errorDetails: details }
        }

        const { supabase, user, ipAddress, userAgent } = await getViewerIdentity()
        if (!user) {
            const error = onboardingError('NOT_AUTHENTICATED', 'Session expired. Please login again.')
            return { success: false, error: error.message, errorDetails: error }
        }
        if (!isEmailVerified(user as unknown as Record<string, unknown>)) {
            const error = onboardingError(
                'INVALID_INPUT',
                'Verify your email before completing onboarding.'
            )
            return { success: false, error: error.message, errorDetails: error }
        }

        const rateKeys = buildOnboardingCompleteRateLimitKeys({
            userId: user.id,
            ipAddress,
            userAgent,
        })
        const [userRate, ipRate, fingerprintRate] = await Promise.all([
            consumeRateLimit(rateKeys.user, ONBOARDING_COMPLETE_LIMIT, ONBOARDING_COMPLETE_WINDOW_SECONDS),
            consumeRateLimit(rateKeys.ip, ONBOARDING_COMPLETE_IP_LIMIT, ONBOARDING_COMPLETE_WINDOW_SECONDS),
            consumeRateLimit(
                rateKeys.fingerprint,
                ONBOARDING_COMPLETE_FINGERPRINT_LIMIT,
                ONBOARDING_COMPLETE_WINDOW_SECONDS
            ),
        ])
        if (!userRate.allowed || !ipRate.allowed || !fingerprintRate.allowed) {
            const error = onboardingError(
                'RATE_LIMITED',
                'Too many attempts. Please wait a minute and try again.',
                true
            )
            return { success: false, error: error.message, errorDetails: error }
        }

        const idempotencyKey =
            parseIdempotencyKey(data.idempotencyKey) ||
            `fallback:${user.id}:${payload.username}`
        const submission = await beginOnboardingSubmission({
            userId: user.id,
            idempotencyKey,
        })
        if (submission.mode === 'replay') {
            if (submission.response.success) {
                return {
                    success: true,
                    needsMetadataSync: submission.response.needsMetadataSync,
                }
            }
            return {
                success: false,
                error: toLegacyErrorMessage(submission.response.error, 'Unable to complete onboarding'),
                errorDetails: submission.response.error,
            }
        }
        if (submission.mode === 'in-progress') {
            const error = onboardingError('SUBMISSION_IN_PROGRESS', 'Your onboarding request is already processing.', true)
            return { success: false, error: error.message, errorDetails: error }
        }
        submissionId = submission.submissionId

        const availability = await ensureUsernameIsAvailable({
            username: payload.username,
            userId: user.id,
        })
        if (!availability.ok) {
            if (submissionId) {
                await finalizeOnboardingSubmission({
                    submissionId,
                    status: 'failed',
                    response: { success: false, error: availability.error },
                })
            }
            return {
                success: false,
                error: availability.error.message,
                errorDetails: availability.error,
            }
        }

        if (!user.email) {
            const error = onboardingError('INVALID_INPUT', 'Account email is missing. Please re-authenticate.')
            if (submissionId) {
                await finalizeOnboardingSubmission({
                    submissionId,
                    status: 'failed',
                    response: { success: false, error },
                })
            }
            return { success: false, error: error.message, errorDetails: error }
        }
        const userEmail = user.email

        const avatarUrl = payload.avatarUrl || user.user_metadata?.avatar_url || null
        const profileValues = buildProfileOnboardingValues({
            userEmail,
            payload,
            avatarUrl,
        })
        await db.transaction(async (tx) => {
            const existingProfile = await tx.query.profiles.findFirst({
                where: eq(profiles.id, user.id),
                columns: {
                    username: true,
                },
            })
            const previousUsername = existingProfile?.username ? normalizeUsername(existingProfile.username) : null

            await tx
                .insert(profiles)
                .values({
                    id: user.id,
                    ...profileValues,
                    updatedAt: new Date(),
                })
                .onConflictDoUpdate({
                    target: profiles.id,
                    set: {
                        ...profileValues,
                        updatedAt: new Date(),
                    },
                })

            if (previousUsername && previousUsername !== payload.username) {
                await tx
                    .update(usernameAliases)
                    .set({
                        isPrimary: false,
                        replacedAt: new Date(),
                    })
                    .where(eq(usernameAliases.username, previousUsername))
            }

            const existingAlias = await tx.query.usernameAliases.findFirst({
                where: eq(usernameAliases.username, payload.username),
                columns: {
                    userId: true,
                    isPrimary: true,
                },
            })
            if (existingAlias) {
                if (existingAlias.userId !== user.id || !existingAlias.isPrimary) {
                    throw new UsernamePersistenceError('USERNAME_TAKEN', 'Username is already taken')
                }
            } else {
                await tx.insert(usernameAliases).values({
                    username: payload.username,
                    userId: user.id,
                    isPrimary: true,
                    claimedAt: new Date(),
                    replacedAt: null,
                })
            }

            await tx
                .delete(onboardingDrafts)
                .where(eq(onboardingDrafts.userId, user.id))

            await tx
                .insert(onboardingEvents)
                .values({
                    userId: user.id,
                    eventType: 'submit_profile_saved',
                    step: ONBOARDING_STEP_MAX,
                    metadata: {
                        visibility: payload.visibility,
                        availabilityStatus: payload.availabilityStatus,
                        messagePrivacy: payload.messagePrivacy,
                        hasHeadline: Boolean(payload.headline),
                        hasBio: Boolean(payload.bio),
                        hasPronouns: Boolean(payload.pronouns),
                        hasGenderIdentity: Boolean(payload.genderIdentity),
                        hasExperienceLevel: Boolean(payload.experienceLevel),
                        hasHoursPerWeek: Boolean(payload.hoursPerWeek),
                        socialLinksCount: Object.keys(payload.socialLinks || {}).length,
                        openToCount: payload.openTo.length,
                        skillsCount: payload.skills.length,
                        interestsCount: payload.interests.length,
                    },
                })
        })

        const metadataSynced = await syncOnboardingClaims({
            supabase,
            username: payload.username,
            fullName: payload.fullName,
            avatarUrl: avatarUrl || undefined,
            emailVerified: true,
        })

        await db.insert(onboardingEvents).values({
            userId: user.id,
            eventType: metadataSynced ? 'submit_success' : 'submit_success_needs_claim_sync',
            step: ONBOARDING_STEP_MAX,
            metadata: {
                needsMetadataSync: !metadataSynced,
            },
        })

        if (submissionId) {
            await finalizeOnboardingSubmission({
                submissionId,
                status: 'completed',
                response: { success: true, needsMetadataSync: !metadataSynced },
            })
        }

        return { success: true, needsMetadataSync: !metadataSynced }
    } catch (error) {
        console.error('Error completing onboarding:', error)
        const details = mapOnboardingPersistenceError(error)
        if (submissionId) {
            await finalizeOnboardingSubmission({
                submissionId,
                status: 'failed',
                response: { success: false, error: details },
            })
        }
        return { success: false, error: details.message, errorDetails: details }
    }
}

export async function repairOnboardingClaims(): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const { data: authData } = await supabase.auth.getUser()
        const user = authData.user
        if (!user) return { success: false, error: 'Not authenticated' }

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('username, full_name, avatar_url')
            .eq('id', user.id)
            .maybeSingle()

        if (profileError) {
            console.error('Error fetching profile for claim repair:', profileError)
            return { success: false, error: 'Unable to read profile for metadata sync' }
        }
        if (!profile?.username) {
            return { success: false, error: 'Profile username not found' }
        }

        const synced = await syncOnboardingClaims({
            supabase,
            username: profile.username,
            fullName: profile.full_name || user.user_metadata?.full_name || user.email || 'User',
            avatarUrl: profile.avatar_url || undefined,
            emailVerified: isEmailVerified(user as unknown as Record<string, unknown>),
        })

        return synced
            ? { success: true }
            : { success: false, error: 'Unable to sync metadata claims' }
    } catch (error) {
        console.error('Error repairing onboarding claims:', error)
        return { success: false, error: 'Unable to sync metadata claims' }
    }
}

export async function getUsernameSuggestions(fullName: string): Promise<{ suggestions: string[] }> {
    const candidates = generateCandidateUsernames(fullName).slice(0, 12)
    if (candidates.length === 0) return { suggestions: [] }

    const normalizedCandidates = candidates.map((candidate) => normalizeUsername(candidate))
    try {
        const taken = await findUnavailableUsernames(normalizedCandidates)

        const suggestions = normalizedCandidates
            .filter((candidate) => !taken.has(candidate))
            .slice(0, 5)
        return { suggestions }
    } catch (error) {
        console.error('Error building username suggestions:', error)
        return { suggestions: [] }
    }
}

export async function getOnboardingDraft(): Promise<{
    success: boolean
    draft?: DraftPayload
    step?: number
    version?: number
    updatedAt?: string
    error?: string
    errorDetails?: OnboardingError
}> {
    try {
        const supabase = await createClient()
        const { data: authData } = await supabase.auth.getUser()
        const user = authData.user
        if (!user) return { success: false, error: 'Not authenticated' }

        const row = await db.query.onboardingDrafts.findFirst({
            where: eq(onboardingDrafts.userId, user.id),
            columns: {
                step: true,
                version: true,
                draft: true,
                updatedAt: true,
            },
        })

        if (!row) return { success: true, step: ONBOARDING_STEP_MIN, version: 0, draft: {} }

        return {
            success: true,
            step: clampStep(row.step),
            version: row.version,
            draft: sanitizeOnboardingDraft(row.draft),
            updatedAt: row.updatedAt.toISOString(),
        }
    } catch (error) {
        console.error('Error loading onboarding draft:', error)
        const details = onboardingError('DB_ERROR', 'Unable to load onboarding draft', true)
        return { success: false, error: details.message, errorDetails: details }
    }
}

export async function saveOnboardingDraft(input: {
    step: number
    draft: Partial<DraftPayload>
    expectedVersion?: number
}): Promise<{
    success: boolean
    version?: number
    step?: number
    draft?: DraftPayload
    updatedAt?: string
    error?: string
    errorDetails?: OnboardingError
}> {
    try {
        const supabase = await createClient()
        const { data: authData } = await supabase.auth.getUser()
        const user = authData.user
        if (!user) {
            const details = onboardingError('NOT_AUTHENTICATED', 'Not authenticated')
            return { success: false, error: details.message, errorDetails: details }
        }

        const safeStep = clampStep(input.step)
        const incomingDraftPatch = sanitizeOnboardingDraftPatch(input.draft)
        const updatedAt = new Date()

        const current = await db.query.onboardingDrafts.findFirst({
            where: eq(onboardingDrafts.userId, user.id),
            columns: {
                version: true,
                step: true,
                draft: true,
                updatedAt: true,
            },
        })

        if (!current) {
            const safeDraft = sanitizeOnboardingDraft(incomingDraftPatch)
            const inserted = await db
                .insert(onboardingDrafts)
                .values({
                    userId: user.id,
                    step: safeStep,
                    version: 1,
                    draft: safeDraft,
                    updatedAt,
                })
                .onConflictDoNothing()
                .returning({
                    version: onboardingDrafts.version,
                    step: onboardingDrafts.step,
                    draft: onboardingDrafts.draft,
                    updatedAt: onboardingDrafts.updatedAt,
                })

            if (inserted.length > 0) {
                return {
                    success: true,
                    version: inserted[0].version,
                    step: clampStep(inserted[0].step),
                    draft: sanitizeOnboardingDraft(inserted[0].draft),
                    updatedAt: inserted[0].updatedAt.toISOString(),
                }
            }
        }

        const latest = current || await db.query.onboardingDrafts.findFirst({
            where: eq(onboardingDrafts.userId, user.id),
            columns: {
                version: true,
                step: true,
                draft: true,
                updatedAt: true,
            },
        })

        if (!latest) {
            const details = onboardingError('DB_ERROR', 'Unable to save onboarding draft', true)
            return { success: false, error: details.message, errorDetails: details }
        }

        const expectedVersion = typeof input.expectedVersion === 'number' ? input.expectedVersion : latest.version
        if (expectedVersion !== latest.version) {
            const details = onboardingError('DRAFT_CONFLICT', 'Draft changed in another session. Synced latest draft.')
            return {
                success: false,
                error: details.message,
                errorDetails: details,
                version: latest.version,
                step: clampStep(latest.step),
                draft: sanitizeOnboardingDraft(latest.draft),
                updatedAt: latest.updatedAt.toISOString(),
            }
        }

        const mergedDraftInput: Record<string, unknown> = {
            ...((latest.draft as Record<string, unknown>) || {}),
        }
        for (const key of Object.keys(incomingDraftPatch) as Array<keyof DraftPayload>) {
            mergedDraftInput[key] = incomingDraftPatch[key]
        }
        const safeDraft = sanitizeOnboardingDraft(mergedDraftInput)
        const nextVersion = latest.version + 1
        const updated = await db
            .update(onboardingDrafts)
            .set({
                step: safeStep,
                draft: safeDraft,
                version: nextVersion,
                updatedAt,
            })
            .where(
                and(
                    eq(onboardingDrafts.userId, user.id),
                    eq(onboardingDrafts.version, latest.version)
                )
            )
            .returning({
                version: onboardingDrafts.version,
                step: onboardingDrafts.step,
                draft: onboardingDrafts.draft,
                updatedAt: onboardingDrafts.updatedAt,
            })

        if (updated.length === 0) {
            const currentDraft = await db.query.onboardingDrafts.findFirst({
                where: eq(onboardingDrafts.userId, user.id),
                columns: {
                    version: true,
                    step: true,
                    draft: true,
                    updatedAt: true,
                },
            })
            const details = onboardingError('DRAFT_CONFLICT', 'Draft changed in another session. Synced latest draft.')
            return {
                success: false,
                error: details.message,
                errorDetails: details,
                version: currentDraft?.version,
                step: currentDraft ? clampStep(currentDraft.step) : ONBOARDING_STEP_MIN,
                draft: sanitizeOnboardingDraft(currentDraft?.draft || {}),
                updatedAt: currentDraft?.updatedAt.toISOString(),
            }
        }

        return {
            success: true,
            version: updated[0].version,
            step: clampStep(updated[0].step),
            draft: sanitizeOnboardingDraft(updated[0].draft),
            updatedAt: updated[0].updatedAt.toISOString(),
        }
    } catch (error) {
        console.error('Error saving onboarding draft:', error)
        const details = onboardingError('DB_ERROR', 'Unable to save onboarding draft', true)
        return { success: false, error: details.message, errorDetails: details }
    }
}

export async function clearOnboardingDraft(): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient()
        const { data: authData } = await supabase.auth.getUser()
        const user = authData.user
        if (!user) {
            const details = onboardingError('NOT_AUTHENTICATED', 'Not authenticated')
            return { success: false, error: details.message }
        }

        await db.delete(onboardingDrafts).where(eq(onboardingDrafts.userId, user.id))
        return { success: true }
    } catch (error) {
        console.error('Error clearing onboarding draft:', error)
        const details = onboardingError('DB_ERROR', 'Unable to clear onboarding draft', true)
        return { success: false, error: details.message }
    }
}

export async function trackOnboardingEvent(input: {
    eventType: OnboardingEventInput['eventType']
    step?: number
    metadata?: Record<string, string | number | boolean | null>
}): Promise<{ success: boolean }> {
    try {
        const supabase = await createClient()
        const { data: authData } = await supabase.auth.getUser()
        const user = authData.user
        if (!user) return { success: false }

        const parsed = onboardingEventInputSchema.safeParse(input)
        if (!parsed.success) return { success: false }
        const payload = parsed.data

        await db.insert(onboardingEvents).values({
            userId: user.id,
            eventType: payload.eventType,
            step: typeof payload.step === 'number' ? clampStep(payload.step) : null,
            metadata: sanitizeTelemetryMetadata(payload.metadata),
        })
        return { success: true }
    } catch (error) {
        console.error('Error tracking onboarding event:', error)
        return { success: false }
    }
}
