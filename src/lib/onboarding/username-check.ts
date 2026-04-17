import { consumeRateLimit } from '@/lib/security/rate-limit'
import { onboardingError, type OnboardingError } from '@/lib/onboarding/errors'
import { logger } from '@/lib/logger'
import { getUsernameAvailability } from '@/lib/usernames/service'
import { normalizeUsername } from '@/lib/validations/username'
import type { SupabaseClient } from '@supabase/supabase-js'

export type UsernameAvailabilityResult = {
    available: boolean
    message: string
    code?: OnboardingError['code']
    rateLimited?: boolean
    error?: OnboardingError
}

function parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback
    return Math.floor(parsed)
}

export function getUsernameCheckRateLimitConfig() {
    return {
        limit: parsePositiveInt(process.env.ONBOARDING_USERNAME_CHECK_LIMIT, 30),
        windowSeconds: parsePositiveInt(process.env.ONBOARDING_USERNAME_CHECK_WINDOW_SECONDS, 60),
        ipLimit: parsePositiveInt(process.env.ONBOARDING_USERNAME_CHECK_IP_LIMIT, 80),
        fingerprintLimit: parsePositiveInt(process.env.ONBOARDING_USERNAME_CHECK_FINGERPRINT_LIMIT, 50),
        // SEC-H2: anonymous users get a much tighter daily enumeration cap so a
        // patient attacker cannot chew through tens of thousands of usernames
        // over a 24 h window by staying within the per-minute limits.
        anonDailyLimit: parsePositiveInt(process.env.ONBOARDING_USERNAME_CHECK_ANON_DAILY_LIMIT, 500),
        anonDailyWindowSeconds: parsePositiveInt(
            process.env.ONBOARDING_USERNAME_CHECK_ANON_DAILY_WINDOW_SECONDS,
            24 * 60 * 60,
        ),
    }
}

export function buildOnboardingRateLimitKeys(params: {
    viewerKey: string
    normalizedUsername: string
    ipAddress?: string | null
    userAgent?: string | null
}) {
    const ip = (params.ipAddress || 'unknown').trim() || 'unknown'
    const rawUa = (params.userAgent || 'unknown').trim().toLowerCase()
    const ua = rawUa.slice(0, 120) || 'unknown'
    return {
        user: `onboarding:username-check:user:${params.viewerKey}`,
        ip: `onboarding:username-check:ip:${ip}`,
        fingerprint: `onboarding:username-check:fingerprint:${ip}:${ua}`,
        target: `onboarding:username-check:target:${params.normalizedUsername}`,
        anonDaily: `onboarding:username-check:anon-daily:${ip}`,
    }
}

export async function checkUsernameAvailabilityWithClient(params: {
    supabase?: Pick<SupabaseClient, 'from'>
    username: string
    viewerKey: string
    viewerId?: string | null
    ipAddress?: string | null
    userAgent?: string | null
}): Promise<UsernameAvailabilityResult> {
    const normalizedUsername = normalizeUsername(params.username)
    const rateConfig = getUsernameCheckRateLimitConfig()
    const keys = buildOnboardingRateLimitKeys({
        viewerKey: params.viewerKey,
        normalizedUsername,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
    })

    const isAnonymous = !params.viewerId
    const [userRate, ipRate, fingerprintRate, targetRate, anonDailyRate] = await Promise.all([
        consumeRateLimit(
            keys.user,
            rateConfig.limit,
            rateConfig.windowSeconds
        ),
        consumeRateLimit(
            keys.ip,
            rateConfig.ipLimit,
            rateConfig.windowSeconds
        ),
        consumeRateLimit(
            keys.fingerprint,
            rateConfig.fingerprintLimit,
            rateConfig.windowSeconds
        ),
        consumeRateLimit(
            keys.target,
            Math.max(5, Math.floor(rateConfig.limit / 2)),
            rateConfig.windowSeconds
        ),
        isAnonymous
            ? consumeRateLimit(
                keys.anonDaily,
                rateConfig.anonDailyLimit,
                rateConfig.anonDailyWindowSeconds,
            )
            : Promise.resolve({ allowed: true } as const),
    ])

    if (
        !userRate.allowed
        || !ipRate.allowed
        || !fingerprintRate.allowed
        || !targetRate.allowed
        || !anonDailyRate.allowed
    ) {
        const error = onboardingError(
            'RATE_LIMITED',
            'Too many checks. Please wait and try again.',
            true
        )
        logger.metric('username.availability.rate_limited', {
            viewerKey: params.viewerKey,
            userAllowed: userRate.allowed,
            ipAllowed: ipRate.allowed,
            fingerprintAllowed: fingerprintRate.allowed,
            targetAllowed: targetRate.allowed,
            anonDailyAllowed: anonDailyRate.allowed,
        })
        return {
            available: false,
            message: error.message,
            code: error.code,
            error,
            rateLimited: true,
        }
    }

    try {
        const result = await getUsernameAvailability({
            username: params.username,
            viewerId: params.viewerId,
        })
        return {
            available: result.available,
            message: result.message,
            code: result.code,
            error: result.error,
        }
    } catch (queryError) {
        console.error('Error checking username availability:', {
            username: params.username,
            error: queryError,
        })
        const error = onboardingError('DB_ERROR', 'Error checking availability', true)
        logger.metric('username.availability.result', {
            username: params.username,
            available: false,
            reason: error.code,
        })
        return { available: false, message: error.message, code: error.code, error }
    }
}
