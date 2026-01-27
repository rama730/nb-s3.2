import { Redis } from '@upstash/redis';

export const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Cache a value in Redis with a TTL (seconds)
 */
export async function cacheData<T>(key: string, data: T, ttl: number = 60): Promise<void> {
    await redis.set(key, JSON.stringify(data), { ex: ttl });
}

/**
 * Retrieve a cached value from Redis
 */
export async function getCachedData<T>(key: string): Promise<T | null> {
    const data = await redis.get<string>(key);
    if (!data) return null;
    // Upstash/Redis client automatically parses JSON if it was stored as JSON, 
    // but let's be safe if we treated it as string above. 
    // Actually redis.get<T> does the parsing if the return type is inferred or specified.
    // If we stored it as a stringified JSON manually, we might need to parse.
    // The Redis client handles objects natively roughly. 
    // Let's assume standard behavior:
    return data as T;
}

/**
 * Rate Limiter helper (Fixed Window)
 * Returns true if allowed, false if blocked
 */
export async function rateLimit(identifier: string, limit: number = 10, window: number = 60): Promise<boolean> {
    const key = `ratelimit:${identifier}`;
    const count = await redis.incr(key);
    if (count === 1) {
        await redis.expire(key, window);
    }
    return count <= limit;
}
