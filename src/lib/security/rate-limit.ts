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

const localBuckets = new Map<string, InMemoryBucket>();
let hasLoggedLocalFallback = false;

type RateLimitMode = 'best-effort' | 'distributed-only';

function getRateLimitMode(): RateLimitMode {
    return process.env.RATE_LIMIT_MODE === 'distributed-only' ? 'distributed-only' : 'best-effort';
}

const cleanupLocalBuckets = () => {
    const now = Date.now();
    for (const [key, bucket] of localBuckets) {
        if (bucket.resetAt <= now) {
            localBuckets.delete(key);
        }
    }
};

const getRedisClient = async () => {
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
};

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
): Promise<RateLimitResult> {
    const redis = await getRedisClient();
    const mode = getRateLimitMode();

    if (!redis) {
        if (!hasLoggedLocalFallback) {
            hasLoggedLocalFallback = true;
            const behavior = mode === 'distributed-only' ? 'blocking all requests' : 'using in-memory fallback';
            console.warn(`[rate-limit] Redis unavailable, ${behavior}`, {
                mode,
            });
        }
        if (mode === 'distributed-only') {
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
        const count = await redis.incr(redisKey);
        if (count === 1) {
            await redis.expire(redisKey, windowSeconds);
        }

        return {
            allowed: count <= limit,
            count,
            limit,
            resetAt: (windowBucket + 1) * windowSeconds * 1000,
        };
    } catch (error) {
        console.warn('[rate-limit] Redis command failed, applying fallback behavior', {
            mode,
            error: error instanceof Error ? error.message : String(error),
        });
        if (mode === 'distributed-only') {
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
