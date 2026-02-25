import { consumeRateLimit } from '@/lib/security/rate-limit'
import { onboardingError, type OnboardingError } from '@/lib/onboarding/errors'
import { normalizeUsername, validateUsername } from '@/lib/validations/username'

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
    }
}

export function buildOnboardingRateLimitKeys(params: {
    viewerKey: string
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
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function checkUsernameAvailabilityWithClient(params: {
    supabase: any
    username: string
    viewerKey: string
    viewerId?: string | null
    ipAddress?: string | null
    userAgent?: string | null
}): Promise<UsernameAvailabilityResult> {
    const normalizedUsername = normalizeUsername(params.username)
    const usernameValidation = validateUsername(normalizedUsername)
    if (!usernameValidation.valid) {
        const error = onboardingError('USERNAME_INVALID', usernameValidation.message)
        return { available: false, message: error.message, code: error.code, error }
    }

    const rateConfig = getUsernameCheckRateLimitConfig()
    const keys = buildOnboardingRateLimitKeys({
        viewerKey: params.viewerKey,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
    })

    const [userRate, ipRate, fingerprintRate] = await Promise.all([
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
    ])

    if (!userRate.allowed || !ipRate.allowed || !fingerprintRate.allowed) {
        const error = onboardingError(
            'RATE_LIMITED',
            'Too many checks. Please wait and try again.',
            true
        )
        return {
            available: false,
            message: error.message,
            code: error.code,
            error,
            rateLimited: true,
        }
    }

    const { data, error: queryError } = await params.supabase
        .from('profiles')
        .select('id')
        .eq('username', normalizedUsername)
        .maybeSingle()

    if (queryError) {
        console.error('Error checking username availability:', queryError)
        const error = onboardingError('DB_ERROR', 'Error checking availability', true)
        return { available: false, message: error.message, code: error.code, error }
    }

    if (data && data.id !== params.viewerId) {
        const error = onboardingError('USERNAME_TAKEN', 'Username is already taken')
        return { available: false, message: error.message, code: error.code, error }
    }

    return { available: true, message: 'Username is available!' }
}
