/**
 * Redis SET for O(1) blocked-pair lookups.
 * Uses Redis SET commands (SADD, SREM, SISMEMBER) for exact membership checks.
 * No false positives or false negatives.
 *
 * PURE OPTIMIZATION: Eliminates DB queries for the common case
 * where users are NOT blocked (99%+ of all privacy checks).
 */

import { getRedisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { randomUUID } from 'node:crypto';

const BLOCKED_PAIRS_KEY = 'blocked_pairs';
const BLOCKED_PAIRS_REBUILD_SENTINEL = '__blocked_pairs_rebuild__';
const REBUILD_BATCH_SIZE = 1000;
const SWAP_BLOCKED_PAIRS_SCRIPT = `
redis.call('RENAME', KEYS[1], KEYS[2])
redis.call('SREM', KEYS[2], ARGV[1])
return 1
`;

/**
 * Normalizes a pair to a canonical key so A:B == B:A.
 */
function canonicalPairKey(userA: string, userB: string): string {
    return userA < userB ? `${userA}:${userB}` : `${userB}:${userA}`;
}

/**
 * Adds a blocked pair to the Redis SET.
 * Call this whenever a user blocks another.
 */
export async function addBlockedPair(userA: string, userB: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        const key = canonicalPairKey(userA, userB);
        await redis.sadd(BLOCKED_PAIRS_KEY, key);
    } catch (error) {
        logger.warn('[blocked-pairs] addBlockedPair failed:', { error: error instanceof Error ? error.message : String(error) });
    }
}

/**
 * Checks if a blocked pair exists in the Redis SET.
 * Returns `true` if blocked, `false` if not.
 */
export async function isBlockedPair(userA: string, userB: string): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return true; // If Redis is down, assume blocked (force DB check)

    try {
        const key = canonicalPairKey(userA, userB);
        const result = await redis.sismember(BLOCKED_PAIRS_KEY, key);
        return result === 1;
    } catch {
        return true; // On error, force DB check (safe fallback)
    }
}

/**
 * Removes a blocked pair from the Redis SET.
 * Call this whenever a user unblocks another.
 */
export async function removeBlockedPair(userA: string, userB: string): Promise<void> {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        const key = canonicalPairKey(userA, userB);
        await redis.srem(BLOCKED_PAIRS_KEY, key);
    } catch (error) {
        logger.warn('[blocked-pairs] removeBlockedPair failed:', { error: error instanceof Error ? error.message : String(error) });
    }
}

/**
 * Rebuilds the entire blocked pairs SET from the database.
 * Should be called by a cron job (e.g., daily).
 */
export async function rebuildBlockedPairsSet(): Promise<number> {
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

    const tempKey = `${BLOCKED_PAIRS_KEY}:rebuild:${randomUUID()}`;

    try {
        // Keep the temporary key alive as a set even when there are no blocked rows.
        await redis.sadd(tempKey, BLOCKED_PAIRS_REBUILD_SENTINEL);

        let count = 0;
        const pairKeys = blockedRows.map((row) => canonicalPairKey(row.requesterId, row.addresseeId));

        for (let index = 0; index < pairKeys.length; index += REBUILD_BATCH_SIZE) {
            const batch = pairKeys.slice(index, index + REBUILD_BATCH_SIZE);
            if (batch.length > 0) {
                await (redis as any).sadd(tempKey, ...batch);
                count += batch.length;
            }
        }

        await (redis as unknown as {
            eval: (script: string, keys: string[], args: string[]) => Promise<number | string | null>
        }).eval(
            SWAP_BLOCKED_PAIRS_SCRIPT,
            [tempKey, BLOCKED_PAIRS_KEY],
            [BLOCKED_PAIRS_REBUILD_SENTINEL],
        );

        return count;
    } catch (error) {
        try {
            await redis.del(tempKey);
        } catch {
            // Best-effort cleanup.
        }

        throw error;
    }
}
