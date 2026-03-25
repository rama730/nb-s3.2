/**
 * Redis Rolling Window Counters for Connection Stats.
 *
 * PURE OPTIMIZATION: Replaces expensive `count(*) FILTER (...)` SQL queries
 * with O(1) Redis INCR/GET operations for real-time connection statistics.
 *
 * Uses TTL-based keys that auto-expire for natural rolling windows:
 * - Monthly stats: key expires at end of current month
 * - Daily stats: key expires at end of current day
 */

import { getRedisClient } from '@/lib/redis';

type StatType = 'gained' | 'this_month' | 'sent_this_month';

function getMonthlyKey(userId: string, type: StatType): string {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return `conn_stats:${userId}:${type}:${monthKey}`;
}

function getMonthlyTTL(): number {
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return Math.max(1, Math.ceil((endOfMonth.getTime() - now.getTime()) / 1000));
}

/**
 * Increments a connection stat counter.
 * Non-blocking, fire-and-forget pattern.
 */
export async function incrementConnectionStat(userId: string, type: StatType, amount: number = 1): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        const key = getMonthlyKey(userId, type);
        const pipeline = redis.pipeline();
        pipeline.incrby(key, amount);
        pipeline.expire(key, getMonthlyTTL());
        await pipeline.exec();
    } catch (error) {
        console.warn('[connection-stats] Increment failed:', error instanceof Error ? error.message : String(error));
    }
}

/**
 * Decrements a connection stat counter (for disconnections).
 */
export async function decrementConnectionStat(userId: string, type: StatType, amount: number = 1): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        const key = getMonthlyKey(userId, type);
        await redis.decrby(key, amount);
    } catch (error) {
        console.warn('[connection-stats] Decrement failed:', error instanceof Error ? error.message : String(error));
    }
}

/**
 * Gets connection stats from Redis counters.
 * Returns null if Redis is unavailable (caller should fall back to DB).
 */
export async function getConnectionStatsFromRedis(userId: string): Promise<{
    connectionsThisMonth: number;
    connectionsGained: number;
} | null> {
    const redis = getRedisClient();
    if (!redis) return null;

    try {
        const [thisMonth, gained] = await Promise.all([
            redis.get(getMonthlyKey(userId, 'this_month')),
            redis.get(getMonthlyKey(userId, 'gained')),
        ]);

        return {
            connectionsThisMonth: Number(thisMonth || 0),
            connectionsGained: Number(gained || 0),
        };
    } catch {
        return null;
    }
}
