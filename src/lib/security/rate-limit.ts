import { getRedisClient } from '@/lib/redis'

export interface RateLimitResult {
    allowed: boolean
    count: number
    limit: number
    remaining: number
    resetAt: number
    degraded: boolean
    reason?: 'redis_unavailable' | 'redis_error'
}

export type RateLimitMode = 'best-effort' | 'distributed-only'
export type RateLimitFailMode = 'fail_closed' | 'allow' | 'stale_or_shed'

export interface RateLimitPolicy {
    scope: string
    burst: number
    refillRate: number
    keyParts: string[]
    failMode: RateLimitFailMode
    testLocal?: boolean
}

type RouteRateLimitPolicy = {
    mode?: RateLimitMode
    failMode?: RateLimitFailMode
}

type InMemoryBucket = {
    tokens: number
    lastRefillAt: number
}

const TOKEN_BUCKET_SCRIPT = `
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])
local ttl_ms = tonumber(ARGV[5])

local state = redis.call('HMGET', KEYS[1], 'tokens', 'updated_at', 'count')
local tokens = tonumber(state[1])
local updated_at = tonumber(state[2])
local count = tonumber(state[3])

if tokens == nil then
  tokens = capacity
  updated_at = now_ms
  count = 0
end

local elapsed = math.max(0, now_ms - updated_at)
tokens = math.min(capacity, tokens + (elapsed * refill_per_ms))
updated_at = now_ms
count = count + 1

local allowed = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated_at', updated_at, 'count', count)
redis.call('PEXPIRE', KEYS[1], ttl_ms)

local retry_after_ms = 0
if allowed == 0 then
  retry_after_ms = math.ceil((requested - tokens) / refill_per_ms)
end

return { allowed, count, tokens, retry_after_ms }
`

const TEST_BUCKETS = new Map<string, InMemoryBucket>()
let hasLoggedRedisUnavailable = false
let hasLoggedRedisCommandFailure = false

export const RATE_LIMIT_ROUTE_POLICIES: Record<string, RouteRateLimitPolicy> = {
    default: {},
    health: { mode: 'best-effort', failMode: 'allow' },
    ready: { mode: 'best-effort', failMode: 'allow' },
    publicRead: { mode: 'distributed-only', failMode: 'stale_or_shed' },
}

// SEC-H4 / SEC-L3: per-scope fail-mode registry. Without this, Redis outages
// either silently let every request through (catastrophic for bruteforce
// paths like login / MFA / password) or block everything (catastrophic for
// typing / presence heartbeats).
//
// Matching is first-prefix-wins. Any identifier that does not match a scope
// here falls back to the mode default — which is `fail_closed` in production
// (`distributed-only`) and `allow` in tests / dev. New sensitive endpoints
// SHOULD be listed here explicitly so the fail posture is visible at review
// time rather than buried in a call site.
export type RateLimitScopePolicy = {
    prefix: string
    failMode: RateLimitFailMode
    // Optional metadata – future: telemetry tagging.
    category: 'sensitive' | 'soft' | 'public'
}

export const RATE_LIMIT_SCOPE_POLICIES: RateLimitScopePolicy[] = [
    // Credential / auth surface — never allow during an outage.
    { prefix: 'auth:', failMode: 'fail_closed', category: 'sensitive' },
    { prefix: 'login:', failMode: 'fail_closed', category: 'sensitive' },
    { prefix: 'signup:', failMode: 'fail_closed', category: 'sensitive' },
    { prefix: 'password:', failMode: 'fail_closed', category: 'sensitive' },
    { prefix: 'mfa:', failMode: 'fail_closed', category: 'sensitive' },
    { prefix: 'step-up:', failMode: 'fail_closed', category: 'sensitive' },
    { prefix: 'recovery:', failMode: 'fail_closed', category: 'sensitive' },
    { prefix: 'account:', failMode: 'fail_closed', category: 'sensitive' },
    { prefix: 'onboarding:', failMode: 'fail_closed', category: 'sensitive' },
    { prefix: 'upload:', failMode: 'fail_closed', category: 'sensitive' },
    { prefix: 'admin-', failMode: 'fail_closed', category: 'sensitive' },
    { prefix: 'connections-send', failMode: 'fail_closed', category: 'sensitive' },
    // Hot paths where blocking every user on Redis hiccup is worse than the
    // short window of unchecked traffic. The local bucket in dev avoids
    // letting tests flake when Redis isn't available.
    { prefix: 'presence:', failMode: 'stale_or_shed', category: 'soft' },
    { prefix: 'typing:', failMode: 'stale_or_shed', category: 'soft' },
    { prefix: 'realtime:', failMode: 'stale_or_shed', category: 'soft' },
    // Public, unauthenticated read endpoints: fail open so the site stays up.
    { prefix: 'health:', failMode: 'allow', category: 'public' },
    { prefix: 'ready:', failMode: 'allow', category: 'public' },
]

export function resolveScopeFailMode(identifier: string): RateLimitFailMode | undefined {
    for (const policy of RATE_LIMIT_SCOPE_POLICIES) {
        if (identifier.startsWith(policy.prefix)) return policy.failMode
    }
    return undefined
}

export type ConsumeRateLimitOptions = {
    mode?: RateLimitMode
    failMode?: RateLimitFailMode
    fallback?: 'deny' | 'allow' | 'local'
    route?: keyof typeof RATE_LIMIT_ROUTE_POLICIES
    /**
     * Scope identifier used to look up `RATE_LIMIT_SCOPE_POLICIES` when no
     * explicit `failMode` is provided. Defaults to the identifier passed to
     * `consumeRateLimit`.
     */
    scope?: string
}

function getRateLimitMode(): RateLimitMode {
    if (process.env.RATE_LIMIT_MODE === 'distributed-only') return 'distributed-only'
    if (process.env.RATE_LIMIT_MODE === 'best-effort') return 'best-effort'
    return process.env.NODE_ENV === 'test' ? 'best-effort' : 'distributed-only'
}

function normalizeFailMode(
    options?: Pick<ConsumeRateLimitOptions, 'failMode' | 'fallback'>
): RateLimitFailMode | undefined {
    if (options?.failMode) return options.failMode
    switch (options?.fallback) {
        case 'allow':
            return 'allow'
        case 'deny':
            return 'fail_closed'
        case 'local':
            return process.env.NODE_ENV === 'test' ? 'allow' : 'stale_or_shed'
        default:
            return undefined
    }
}

function defaultFailMode(mode: RateLimitMode): RateLimitFailMode {
    return mode === 'distributed-only' ? 'fail_closed' : 'allow'
}

function resolveConsumeOptions(
    identifier: string,
    options?: ConsumeRateLimitOptions,
): {
    mode: RateLimitMode
    failMode: RateLimitFailMode
    testLocal: boolean
} {
    const routePolicy = options?.route ? RATE_LIMIT_ROUTE_POLICIES[options.route] : undefined
    const mode = options?.mode ?? routePolicy?.mode ?? getRateLimitMode()
    const scopeLookup = options?.scope ?? identifier
    const scopeFailMode = resolveScopeFailMode(scopeLookup)
    const failMode =
        normalizeFailMode(options)
        ?? routePolicy?.failMode
        ?? scopeFailMode
        ?? defaultFailMode(mode)
    const testLocal =
        process.env.NODE_ENV === 'test'
        && options?.failMode === undefined
        && options?.fallback === undefined
        && routePolicy?.failMode === undefined
        && scopeFailMode === undefined
    return { mode, failMode, testLocal }
}

function buildPolicy(
    identifier: string,
    limit: number,
    windowSeconds: number,
    options?: ConsumeRateLimitOptions,
): RateLimitPolicy {
    const effectiveLimit = Math.max(1, Math.trunc(limit))
    const effectiveWindowSeconds = Math.max(1, Math.trunc(windowSeconds))
    const { failMode, testLocal } = resolveConsumeOptions(identifier, options)

    return {
        scope: options?.route ?? 'default',
        burst: effectiveLimit,
        refillRate: effectiveLimit / effectiveWindowSeconds,
        keyParts: [identifier],
        failMode,
        testLocal,
    }
}

function resultFromUnavailable(
    limit: number,
    windowSeconds: number,
    failMode: RateLimitFailMode,
    reason: RateLimitResult['reason'],
): RateLimitResult {
    const now = Date.now()
    switch (failMode) {
        case 'allow':
            return {
                allowed: true,
                count: 1,
                limit,
                remaining: limit,
                resetAt: now + windowSeconds * 1000,
                degraded: true,
                reason,
            }
        case 'stale_or_shed':
        case 'fail_closed':
        default:
            return {
                allowed: false,
                count: 0,
                limit,
                remaining: 0,
                resetAt: now + windowSeconds * 1000,
                degraded: true,
                reason,
            }
    }
}

function consumeTestRateLimit(identifier: string, limit: number, windowSeconds: number): RateLimitResult {
    const now = Date.now()
    const existing = TEST_BUCKETS.get(identifier)
    const refillRate = limit / Math.max(1, windowSeconds)
    const refillPerMs = refillRate / 1000
    const capacity = Math.max(1, limit)
    const bucket = existing ?? {
        tokens: capacity,
        lastRefillAt: now,
    }

    const elapsedMs = Math.max(0, now - bucket.lastRefillAt)
    const refilledTokens = elapsedMs * refillPerMs
    bucket.tokens = Math.min(capacity, bucket.tokens + refilledTokens)
    bucket.lastRefillAt = now

    const allowed = bucket.tokens >= 1
    if (allowed) {
        bucket.tokens -= 1
    }

    TEST_BUCKETS.set(identifier, bucket)

    const remaining = Math.max(0, Math.floor(bucket.tokens))
    const usedCount = Math.min(capacity, Math.max(0, capacity - remaining))
    const msPerToken = refillPerMs > 0 ? 1 / refillPerMs : Infinity
    const resetAt = allowed
        ? now + Math.ceil(Math.max(0, capacity - bucket.tokens) * msPerToken)
        : now + Math.ceil(Math.max(0, 1 - bucket.tokens) * msPerToken)

    return {
        allowed,
        count: usedCount,
        limit,
        remaining,
        resetAt: Number.isFinite(resetAt) ? resetAt : now + windowSeconds * 1000,
        degraded: true,
        reason: 'redis_unavailable',
    }
}

export async function consumeRateLimitPolicy(policy: RateLimitPolicy): Promise<RateLimitResult> {
    const burst = Math.max(1, Math.trunc(policy.burst))
    const refillRate = Math.max(1 / burst, policy.refillRate)
    const refillPerMs = refillRate / 1000
    const limit = burst
    const redisKey = `ratelimit:${policy.scope}:${policy.keyParts.join(':')}`
    const redis = getRedisClient()

    if (!redis) {
        if (process.env.NODE_ENV === 'test' && policy.testLocal) {
            return consumeTestRateLimit(redisKey, limit, Math.ceil(burst / refillRate))
        }

        if (!hasLoggedRedisUnavailable) {
            hasLoggedRedisUnavailable = true
            console.warn('[rate-limit] Redis unavailable', {
                scope: policy.scope,
                failMode: policy.failMode,
            })
        }

        return resultFromUnavailable(limit, Math.ceil(burst / refillRate), policy.failMode, 'redis_unavailable')
    }

    const nowMs = Date.now()
    const ttlMs = Math.max(1_000, Math.ceil((burst / refillRate) * 1000 * 2))

    try {
        const raw = await (redis as unknown as {
            eval: (script: string, keys: string[], args: string[]) => Promise<number[]>
        }).eval(
            TOKEN_BUCKET_SCRIPT,
            [redisKey],
            [
                String(burst),
                String(refillPerMs),
                String(nowMs),
                '1',
                String(ttlMs),
            ],
        )

        const [allowedRaw, countRaw, remainingTokensRaw, retryAfterMsRaw] = raw || []
        const allowed = Number(allowedRaw) === 1
        const count = Number.isFinite(Number(countRaw)) ? Number(countRaw) : 0
        const remainingTokens = Number.isFinite(Number(remainingTokensRaw)) ? Number(remainingTokensRaw) : 0
        const retryAfterMs = Number.isFinite(Number(retryAfterMsRaw)) ? Number(retryAfterMsRaw) : 0

        return {
            allowed,
            count,
            limit,
            remaining: Math.max(0, Math.floor(remainingTokens)),
            resetAt: allowed ? nowMs + Math.ceil((burst - remainingTokens) / refillPerMs) : nowMs + retryAfterMs,
            degraded: false,
        }
    } catch (error) {
        if (process.env.NODE_ENV === 'test' && policy.testLocal) {
            return consumeTestRateLimit(redisKey, limit, Math.ceil(burst / refillRate))
        }

        if (!hasLoggedRedisCommandFailure) {
            hasLoggedRedisCommandFailure = true
            console.warn('[rate-limit] Redis command failed', {
                scope: policy.scope,
                failMode: policy.failMode,
                error: error instanceof Error ? error.message : String(error),
            })
        }

        return resultFromUnavailable(limit, Math.ceil(burst / refillRate), policy.failMode, 'redis_error')
    }
}

export async function consumeRateLimit(
    identifier: string,
    limit: number,
    windowSeconds: number,
    options?: ConsumeRateLimitOptions,
): Promise<RateLimitResult> {
    if (
        process.env.NODE_ENV === 'test'
        && !options
    ) {
        return consumeTestRateLimit(`ratelimit:default:${identifier}`, limit, windowSeconds)
    }

    const policy = buildPolicy(identifier, limit, windowSeconds, options)
    return consumeRateLimitPolicy(policy)
}

export async function consumeRateLimitForRoute(
    route: keyof typeof RATE_LIMIT_ROUTE_POLICIES,
    identifier: string,
    limit: number,
    windowSeconds: number,
) {
    return consumeRateLimit(identifier, limit, windowSeconds, { route })
}
