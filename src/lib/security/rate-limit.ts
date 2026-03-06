interface RateLimitResult {
    allowed: boolean;
    count: number;
    limit: number;
    resetAt: number;
}

interface InMemoryBucket {
    count: number;
    resetAt: number;
}

const LOCAL_BUCKETS_MAX = 10_000;
const localBuckets = new Map<string, InMemoryBucket>();
let hasLoggedLocalFallback = false;
let hasLoggedRedisCommandFailure = false;

const RATE_LIMIT_INCREMENT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return current
`;

export type RateLimitMode = 'best-effort' | 'distributed-only';
export type RateLimitFallback = 'deny' | 'local' | 'allow';

type RateLimitRoutePolicy = {
    mode?: RateLimitMode;
    fallback?: RateLimitFallback;
};

export const RATE_LIMIT_ROUTE_POLICIES: Record<string, RateLimitRoutePolicy> = {
    default: {},
    health: { mode: 'best-effort', fallback: 'allow' },
    ready: { mode: 'best-effort', fallback: 'allow' },
    publicRead: { mode: 'best-effort', fallback: 'local' },
};

export type ConsumeRateLimitOptions = {
    mode?: RateLimitMode;
    fallback?: RateLimitFallback;
    route?: keyof typeof RATE_LIMIT_ROUTE_POLICIES;
};

function getRateLimitMode(): RateLimitMode {
    if (process.env.RATE_LIMIT_MODE === 'distributed-only') return 'distributed-only';
    if (process.env.RATE_LIMIT_MODE === 'best-effort') return 'best-effort';
    return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
        ? 'best-effort'
        : 'distributed-only';
}

function defaultFallbackForMode(mode: RateLimitMode): RateLimitFallback {
    return mode === 'distributed-only' ? 'deny' : 'local';
}

function resolveConsumeOptions(options?: ConsumeRateLimitOptions): { mode: RateLimitMode; fallback: RateLimitFallback } {
    const routePolicy = options?.route ? RATE_LIMIT_ROUTE_POLICIES[options.route] : undefined;
    const mode = options?.mode ?? routePolicy?.mode ?? getRateLimitMode();
    const fallback = options?.fallback ?? routePolicy?.fallback ?? defaultFallbackForMode(mode);
    return { mode, fallback };
}

function cleanupLocalBuckets() {
    const now = Date.now();
    for (const [key, bucket] of localBuckets) {
        if (bucket.resetAt <= now) {
            localBuckets.delete(key);
        }
    }
    if (localBuckets.size > LOCAL_BUCKETS_MAX) {
        const excess = localBuckets.size - LOCAL_BUCKETS_MAX;
        const iter = localBuckets.keys();
        for (let i = 0; i < excess; i++) {
            const key = iter.next().value;
            if (key) localBuckets.delete(key);
        }
    }
}

let cachedRedisClient: Awaited<ReturnType<typeof createRedisClient>> | undefined;

async function createRedisClient() {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
        return null;
    }
    try {
        const redisPackage = await import('@upstash/redis');
        return new redisPackage.Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
    } catch {
        return null;
    }
}

async function getRedisClient() {
    if (cachedRedisClient !== undefined) return cachedRedisClient;
    cachedRedisClient = await createRedisClient();
    return cachedRedisClient;
}

async function consumeLocalRateLimit(identifier: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    cleanupLocalBuckets();

    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const existing = localBuckets.get(identifier);

    if (!existing || existing.resetAt <= now) {
        const next = { count: 1, resetAt: now + windowMs };
        localBuckets.set(identifier, next);
        return {
            allowed: true,
            count: 1,
            limit,
            resetAt: next.resetAt,
        };
    }

    existing.count += 1;
    return {
        allowed: existing.count <= limit,
        count: existing.count,
        limit,
        resetAt: existing.resetAt,
    };
}

export async function consumeRateLimit(
    identifier: string,
    limit: number,
    windowSeconds: number,
    options?: ConsumeRateLimitOptions,
): Promise<RateLimitResult> {
    cleanupLocalBuckets();

    const redis = await getRedisClient();
    const { mode, fallback } = resolveConsumeOptions(options);

    if (!redis) {
        if (!hasLoggedLocalFallback) {
            hasLoggedLocalFallback = true;
            const behavior = fallback === 'deny'
                ? 'blocking all requests'
                : fallback === 'allow'
                    ? 'allowing requests'
                    : 'using in-memory fallback';
            console.warn(`[rate-limit] Redis unavailable, ${behavior}`, {
                mode,
                fallback,
            });
        }
        if (fallback === 'allow') {
            return {
                allowed: true,
                count: 1,
                limit,
                resetAt: Date.now() + windowSeconds * 1000,
            };
        }
        if (fallback === 'deny') {
            return {
                allowed: false,
                count: 0,
                limit,
                resetAt: Date.now() + windowSeconds * 1000,
            };
        }
        return consumeLocalRateLimit(identifier, limit, windowSeconds);
    }

    const windowBucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const redisKey = `ratelimit:${identifier}:${windowBucket}`;

    try {
        const rawCount = await redis.eval(
            RATE_LIMIT_INCREMENT_SCRIPT,
            [redisKey],
            [String(windowSeconds)],
        );
        const count = Number(rawCount);
        const normalizedCount = Number.isFinite(count) ? count : 0;

        return {
            allowed: normalizedCount <= limit,
            count: normalizedCount,
            limit,
            resetAt: (windowBucket + 1) * windowSeconds * 1000,
        };
    } catch (error) {
        if (!hasLoggedRedisCommandFailure) {
            hasLoggedRedisCommandFailure = true;
            console.warn('[rate-limit] Redis command failed, applying fallback behavior', {
                mode,
                fallback,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        if (fallback === 'allow') {
            return {
                allowed: true,
                count: 1,
                limit,
                resetAt: Date.now() + windowSeconds * 1000,
            };
        }
        if (fallback === 'deny') {
            return {
                allowed: false,
                count: 0,
                limit,
                resetAt: Date.now() + windowSeconds * 1000,
            };
        }
        return consumeLocalRateLimit(identifier, limit, windowSeconds);
    }
}

export async function consumeRateLimitForRoute(
    route: keyof typeof RATE_LIMIT_ROUTE_POLICIES,
    identifier: string,
    limit: number,
    windowSeconds: number,
    overrides?: Omit<ConsumeRateLimitOptions, 'route'>,
): Promise<RateLimitResult> {
    return consumeRateLimit(identifier, limit, windowSeconds, {
        route,
        ...overrides,
    });
}
