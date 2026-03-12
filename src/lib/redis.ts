import { Redis } from '@upstash/redis';

let redis: Redis | null = null;
try {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
        redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
    }
} catch (e) {
    console.warn("Redis initialization failed. Caching disabled.");
}

export { redis };

type LocalRateLimitEntry = {
    count: number;
    resetAtMs: number;
};

const localRateLimitStore = new Map<string, LocalRateLimitEntry>();
const LOCAL_RATE_LIMIT_MAX_KEYS = 10_000;
let warnedRedisRateLimitFallback = false;

function applyLocalRateLimit(identifier: string, limit: number, window: number): boolean {
    const nowMs = Date.now();
    const key = `ratelimit:${identifier}`;
    const resetAtMs = nowMs + window * 1000;
    const existing = localRateLimitStore.get(key);

    if (!existing || existing.resetAtMs <= nowMs) {
        localRateLimitStore.set(key, { count: 1, resetAtMs });
        return true;
    }

    existing.count += 1;
    localRateLimitStore.set(key, existing);

    // Opportunistic cleanup to avoid unbounded growth in long-lived processes.
    if (localRateLimitStore.size > LOCAL_RATE_LIMIT_MAX_KEYS) {
        for (const [entryKey, entry] of localRateLimitStore) {
            if (entry.resetAtMs <= nowMs) {
                localRateLimitStore.delete(entryKey);
            }
        }
    }

    return existing.count <= limit;
}

/**
 * Cache a value in Redis with a TTL (seconds)
 */
export async function cacheData<T>(key: string, data: T, ttl: number = 60): Promise<void> {
    if (!redis) return;
    await redis.set(key, JSON.stringify(data), { ex: ttl });
}

/**
 * Retrieve a cached value from Redis
 */
export async function getCachedData<T>(key: string): Promise<T | null> {
    if (!redis) return null;
    const data = await redis.get<string>(key);
    if (!data) return null;
    return data as T;
}

/**
 * Rate Limiter helper (Fixed Window)
 * Returns true if allowed, false if blocked
 */
export async function rateLimit(identifier: string, limit: number = 10, window: number = 60): Promise<boolean> {
    if (!redis) return applyLocalRateLimit(identifier, limit, window);
    try {
        const key = `ratelimit:${identifier}`;
        const count = await redis.incr(key);
        if (count === 1) {
            await redis.expire(key, window);
        }
        return count <= limit;
    } catch (error) {
        if (!warnedRedisRateLimitFallback) {
            warnedRedisRateLimitFallback = true;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[rate-limit] Redis unavailable, using in-memory fallback: ${message}`);
        }
        return applyLocalRateLimit(identifier, limit, window);
    }
}
