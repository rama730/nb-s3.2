/**
 * Redis-based Bloom Filter for O(1) blocked-pair lookups.
 * Uses Upstash Redis BF.* commands to avoid false negatives entirely.
 * False positives are acceptable (we just fall back to DB for those).
 *
 * PURE OPTIMIZATION: Eliminates DB queries for the common case
 * where users are NOT blocked (99%+ of all privacy checks).
 */

import { getRedisClient } from '@/lib/redis';

const BLOCKED_PAIRS_BF_KEY = 'bf:blocked_pairs';

/**
 * Normalizes a pair to a canonical key so A:B == B:A.
 */
function canonicalPairKey(userA: string, userB: string): string {
    return userA < userB ? `${userA}:${userB}` : `${userB}:${userA}`;
}

/**
 * Initializes the Bloom Filter if it doesn't exist.
 * Called lazily on first write, or explicitly by the rebuild cron.
 */
async function ensureBloomFilter(redis: NonNullable<ReturnType<typeof getRedisClient>>) {
    try {
        // BF.RESERVE creates the filter. If it already exists, Upstash returns an error we swallow.
        await (redis as any).eval(
            `return redis.call('BF.RESERVE', KEYS[1], ARGV[1], ARGV[2])`,
            [BLOCKED_PAIRS_BF_KEY],
            ['0.001', '1000000'] // 0.1% false positive rate, 1M capacity
        );
    } catch {
        // Filter already exists — this is expected and fine.
    }
}

/**
 * Adds a blocked pair to the Bloom Filter.
 * Call this whenever a user blocks another.
 */
export async function addBlockedPair(userA: string, userB: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        await ensureBloomFilter(redis);
        const key = canonicalPairKey(userA, userB);
        await (redis as any).eval(
            `return redis.call('BF.ADD', KEYS[1], ARGV[1])`,
            [BLOCKED_PAIRS_BF_KEY],
            [key]
        );
    } catch (error) {
        console.warn('[bloom-filter] addBlockedPair failed:', error instanceof Error ? error.message : String(error));
    }
}

/**
 * Checks if a blocked pair MIGHT exist.
 * Returns `false` = DEFINITELY not blocked (skip DB).
 * Returns `true` = MIGHT be blocked (verify with DB).
 */
export async function isBlockedPair(userA: string, userB: string): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return true; // If Redis is down, assume blocked (force DB check)

    try {
        const key = canonicalPairKey(userA, userB);
        const result = await (redis as any).eval(
            `return redis.call('BF.EXISTS', KEYS[1], ARGV[1])`,
            [BLOCKED_PAIRS_BF_KEY],
            [key]
        );
        return result === 1;
    } catch {
        return true; // On error, force DB check (safe fallback)
    }
}

/**
 * Removes a blocked pair from the filter.
 * Since standard Bloom Filters don't support deletion, we rebuild.
 * For individual removals, this is a no-op — the cron rebuild handles it.
 */
export async function removeBlockedPair(_userA: string, _userB: string): Promise<void> {
    // Bloom Filters are append-only. The weekly rebuild cron will clean stale entries.
    // This is intentionally a no-op.
    void _userA;
    void _userB;
}

/**
 * Rebuilds the entire Bloom Filter from the database.
 * Should be called by a cron job (e.g., daily).
 */
export async function rebuildBlockedPairsBloomFilter(): Promise<number> {
    const redis = getRedisClient();
    if (!redis) return 0;

    const { db } = await import('@/lib/db');
    const { connections } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');

    const blockedRows = await db
        .select({
            requesterId: connections.requesterId,
            addresseeId: connections.addresseeId,
        })
        .from(connections)
        .where(eq(connections.status, 'blocked'));

    // Delete and recreate the filter
    try {
        await redis.del(BLOCKED_PAIRS_BF_KEY);
    } catch { /* ignore */ }

    await ensureBloomFilter(redis);

    let count = 0;
    for (const row of blockedRows) {
        await addBlockedPair(row.requesterId, row.addresseeId);
        count++;
    }

    return count;
}
