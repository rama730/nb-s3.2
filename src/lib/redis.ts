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
    if (!redis) return true; // Fail open if no redis configured
    const key = `ratelimit:${identifier}`;
    const count = await redis.incr(key);
    if (count === 1) {
        await redis.expire(key, window);
    }
    return count <= limit;
}
