import { eq, inArray } from 'drizzle-orm'
import { profiles, reservedUsernames, usernameAliases } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { onboardingError, type OnboardingError } from '@/lib/onboarding/errors'
import { normalizeUsername, sanitizeUsernameInput, validateUsername } from '@/lib/validations/username'

export type UsernameClaim = {
    username: string
    userId: string
    isPrimary: boolean
    claimedAt?: Date
    replacedAt?: Date | null
}

export type UsernameRepository = {
    findReservedUsername(username: string): Promise<{ username: string } | null>
    findUsernameClaim(username: string): Promise<UsernameClaim | null>
    findCurrentUsernameByUserId(userId: string): Promise<{ username: string | null } | null>
    findClaimedUsernames(usernames: string[]): Promise<string[]>
    findReservedUsernames(usernames: string[]): Promise<string[]>
}

export class UsernamePersistenceError extends Error {
    readonly usernameError: OnboardingError

    constructor(code: OnboardingError['code'], message: string, retryable = false) {
        super(message)
        this.name = 'UsernamePersistenceError'
        this.usernameError = onboardingError(code, message, retryable)
    }
}

export type UsernameAvailabilityResult = {
    available: boolean
    message: string
    code?: OnboardingError['code']
    error?: OnboardingError
    normalizedUsername: string
}

export type PublicUsernameRouteResolution =
    | { status: 'not_found'; normalizedUsername: string }
    | { status: 'current'; normalizedUsername: string; currentUsername: string; userId: string }
    | { status: 'redirect'; normalizedUsername: string; currentUsername: string; userId: string; matchedAlias: string }

function createUsernameRepositoryFromExecutor(executor: any): UsernameRepository {
    const queryable = executor

    return {
        async findReservedUsername(username: string) {
            return (await queryable.query.reservedUsernames.findFirst({
                where: eq(reservedUsernames.username, username),
                columns: { username: true },
            })) ?? null
        },
        async findUsernameClaim(username: string) {
            return (await queryable.query.usernameAliases.findFirst({
                where: eq(usernameAliases.username, username),
                columns: {
                    username: true,
                    userId: true,
                    isPrimary: true,
                    claimedAt: true,
                    replacedAt: true,
                },
            })) ?? null
        },
        async findCurrentUsernameByUserId(userId: string) {
            return (await queryable.query.profiles.findFirst({
                where: eq(profiles.id, userId),
                columns: { username: true },
            })) ?? null
        },
        async findClaimedUsernames(usernames: string[]) {
            if (usernames.length === 0) return []
            const rows: Array<{ username: string }> = await queryable
                .select({ username: usernameAliases.username })
                .from(usernameAliases)
                .where(inArray(usernameAliases.username, usernames))
            return rows.map((row) => row.username)
        },
        async findReservedUsernames(usernames: string[]) {
            if (usernames.length === 0) return []
            const rows: Array<{ username: string }> = await queryable
                .select({ username: reservedUsernames.username })
                .from(reservedUsernames)
                .where(inArray(reservedUsernames.username, usernames))
            return rows.map((row) => row.username)
        },
    }
}

async function loadDbUsernameRepository(): Promise<UsernameRepository> {
    const { db } = await import('@/lib/db')
    return createUsernameRepositoryFromExecutor(db)
}

function classifyUsernameAvailability(params: {
    normalizedUsername: string
    viewerId?: string | null
    reserved: { username: string } | null
    claim: UsernameClaim | null
}): UsernameAvailabilityResult {
    if (params.reserved) {
        const error = onboardingError('USERNAME_RESERVED', 'This username is reserved')
        return {
            available: false,
            message: error.message,
            code: error.code,
            error,
            normalizedUsername: params.normalizedUsername,
        }
    }

    if (params.claim) {
        if (params.claim.userId === params.viewerId && params.claim.isPrimary) {
            return {
                available: true,
                message: 'Username is available!',
                normalizedUsername: params.normalizedUsername,
            }
        }

        const error = onboardingError('USERNAME_TAKEN', 'Username is already taken')
        return {
            available: false,
            message: error.message,
            code: error.code,
            error,
            normalizedUsername: params.normalizedUsername,
        }
    }

    return {
        available: true,
        message: 'Username is available!',
        normalizedUsername: params.normalizedUsername,
    }
}

export async function getUsernameAvailability(params: {
    username: string
    repo?: UsernameRepository
    viewerId?: string | null
}): Promise<UsernameAvailabilityResult> {
    const startedAt = Date.now()
    const normalizedUsername = normalizeUsername(params.username)
    const usernameValidation = validateUsername(normalizedUsername)
    if (!usernameValidation.valid) {
        const error = onboardingError('USERNAME_INVALID', usernameValidation.message)
        logger.metric('username.availability.result', {
            normalizedUsername,
            available: false,
            reason: error.code,
            durationMs: Date.now() - startedAt,
        })
        return {
            available: false,
            message: error.message,
            code: error.code,
            error,
            normalizedUsername,
        }
    }

    const repo = params.repo ?? await loadDbUsernameRepository()
    const [reserved, claim] = await Promise.all([
        repo.findReservedUsername(normalizedUsername),
        repo.findUsernameClaim(normalizedUsername),
    ])

    const result = classifyUsernameAvailability({
        normalizedUsername,
        viewerId: params.viewerId,
        reserved,
        claim,
    })

    logger.metric('username.availability.result', {
        normalizedUsername,
        available: result.available,
        reason: result.code ?? 'AVAILABLE',
        durationMs: Date.now() - startedAt,
    })

    return result
}

export async function ensureUsernameClaimable(params: {
    username: string
    viewerId?: string | null
    repo?: UsernameRepository
}) {
    const result = await getUsernameAvailability(params)
    if (!result.available) {
        throw new UsernamePersistenceError(result.code || 'USERNAME_TAKEN', result.message)
    }
    return result.normalizedUsername
}

export async function resolvePublicUsernameRoute(params: {
    username: string
    repo?: UsernameRepository
}): Promise<PublicUsernameRouteResolution> {
    const startedAt = Date.now()
    const normalizedUsername = normalizeUsername(params.username)
    const repo = params.repo ?? await loadDbUsernameRepository()
    const validation = validateUsername(normalizedUsername)

    if (!validation.valid) {
        logger.metric('username.route.resolve', {
            normalizedUsername,
            status: 'not_found',
            reason: 'USERNAME_INVALID',
            durationMs: Date.now() - startedAt,
        })
        return { status: 'not_found', normalizedUsername }
    }

    const claim = await repo.findUsernameClaim(normalizedUsername)
    if (!claim) {
        logger.metric('username.route.resolve', {
            normalizedUsername,
            status: 'not_found',
            reason: 'MISSING',
            durationMs: Date.now() - startedAt,
        })
        return { status: 'not_found', normalizedUsername }
    }

    if (claim.isPrimary) {
        const status = params.username === normalizedUsername ? 'current' : 'redirect'
        logger.metric('username.route.resolve', {
            normalizedUsername,
            status,
            reason: 'PRIMARY',
            durationMs: Date.now() - startedAt,
        })
        if (status === 'current') {
            return {
                status: 'current',
                normalizedUsername,
                currentUsername: normalizedUsername,
                userId: claim.userId,
            }
        }
        return {
            status: 'redirect',
            normalizedUsername,
            currentUsername: normalizedUsername,
            userId: claim.userId,
            matchedAlias: normalizedUsername,
        }
    }

    const current = await repo.findCurrentUsernameByUserId(claim.userId)
    const currentUsername = current?.username ? normalizeUsername(current.username) : ''
    if (!currentUsername || !validateUsername(currentUsername).valid) {
        logger.metric('username.route.resolve', {
            normalizedUsername,
            status: 'not_found',
            reason: 'ORPHANED_ALIAS',
            durationMs: Date.now() - startedAt,
        })
        return { status: 'not_found', normalizedUsername }
    }

    logger.metric('username.route.resolve', {
        normalizedUsername,
        status: 'redirect',
        reason: 'HISTORICAL_ALIAS',
        durationMs: Date.now() - startedAt,
    })

    return {
        status: 'redirect',
        normalizedUsername,
        currentUsername,
        userId: claim.userId,
        matchedAlias: normalizedUsername,
    }
}

function deterministicSuffix(seed: string) {
    let hash = 0
    for (let index = 0; index < seed.length; index += 1) {
        hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
    }
    return `${100 + (hash % 900)}`
}

export function generateDeterministicUsernameCandidates(fullName: string): string[] {
    const normalizedName = fullName.trim().toLowerCase()
    const parts = normalizedName
        .split(/\s+/)
        .map((value) => value.replace(/[^a-z0-9]/g, ''))
        .filter(Boolean)

    if (parts.length === 0) return []

    const first = parts[0] || ''
    const last = parts[parts.length - 1] || ''
    const currentYear = String(new Date().getFullYear())
    const currentYearShort = currentYear.slice(-2)
    const stableSuffix = deterministicSuffix(parts.join('_'))

    const rawCandidates = [
        first,
        `${first}${last}`,
        `${first}_${last}`,
        `${first}${currentYearShort}`,
        `${first}_${currentYearShort}`,
        `${first}${currentYear}`,
        `${first}${stableSuffix}`,
    ]

    const unique = new Set<string>()
    for (const candidate of rawCandidates) {
        const sanitized = sanitizeUsernameInput(candidate)
        if (!sanitized) continue
        if (!validateUsername(sanitized).valid) continue
        unique.add(sanitized)
    }

    return Array.from(unique)
}

export async function findUnavailableUsernames(
    usernames: string[],
    repo?: UsernameRepository,
): Promise<Set<string>> {
    const normalized = Array.from(new Set(usernames.map((username) => normalizeUsername(username)).filter(Boolean)))
    if (normalized.length === 0) return new Set()
    const activeRepo = repo ?? await loadDbUsernameRepository()

    const [claimed, reserved] = await Promise.all([
        activeRepo.findClaimedUsernames(normalized),
        activeRepo.findReservedUsernames(normalized),
    ])

    return new Set([...claimed, ...reserved].map((value) => normalizeUsername(value)))
}

export function mapUsernamePersistenceError(
    error: unknown,
    fallbackMessage = 'Unable to update username right now.',
): OnboardingError {
    if (error instanceof UsernamePersistenceError) {
        return error.usernameError
    }

    const code = (error as { code?: string })?.code
    const message = String((error as { message?: string })?.message || '')
    if (code === '23505') {
        return onboardingError('USERNAME_TAKEN', 'Username is already taken')
    }
    if (code === '23514') {
        if (message.toLowerCase().includes('reserved')) {
            return onboardingError('USERNAME_RESERVED', 'This username is reserved')
        }
        return onboardingError('USERNAME_INVALID', 'Invalid username format')
    }
    return onboardingError('DB_ERROR', fallbackMessage, true)
}
