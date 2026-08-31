/**
 * Social Proof Engine — "Friend of Alice, Bob, and 3 others"
 *
 * PURE OPTIMIZATION: Uses Redis SINTER (Set Intersection) for O(1)
 * mutual connection discovery instead of expensive SQL JOINs.
 * Falls back to database queries if Redis is unavailable.
 */

import { getRedisClient } from '@/lib/redis';
import { db } from '@/lib/db';
import { profiles } from '@/lib/db/schema';
import { inArray, sql } from 'drizzle-orm';

export interface SocialProofResult {
    mutualCount: number;
    mutualNames: string[];
    summary: string; // e.g., "Friend of Alice, Bob, and 3 others"
}

async function getMutualConnectionProofFromDatabase(
    viewerId: string,
    targetId: string,
    limit: number,
): Promise<SocialProofResult> {
    const safeLimit = Math.max(1, Math.min(10, limit));
    const rows = await db.execute<{
        mutual_id: string;
        full_name: string | null;
        username: string | null;
        mutual_count: number;
    }>(sql`
        WITH viewer_peers AS (
            SELECT CASE
                WHEN requester_id = ${viewerId} THEN addressee_id
                ELSE requester_id
            END AS peer_id
            FROM connections
            WHERE status = 'accepted'
              AND (requester_id = ${viewerId} OR addressee_id = ${viewerId})
            LIMIT 5001
        ), mutuals AS (
            SELECT DISTINCT CASE
                WHEN c.requester_id = ${targetId} THEN c.addressee_id
                ELSE c.requester_id
            END AS peer_id
            FROM connections c
            INNER JOIN viewer_peers vp ON vp.peer_id = CASE
                WHEN c.requester_id = ${targetId} THEN c.addressee_id
                ELSE c.requester_id
            END
            WHERE c.status = 'accepted'
              AND (c.requester_id = ${targetId} OR c.addressee_id = ${targetId})
        )
        SELECT
            m.peer_id AS mutual_id,
            p.full_name,
            p.username,
            count(*) OVER ()::int AS mutual_count
        FROM mutuals m
        INNER JOIN profiles p ON p.id = m.peer_id AND p.deleted_at IS NULL
        ORDER BY m.peer_id
        LIMIT ${safeLimit}
    `);
    const resultRows = Array.from(rows);
    const mutualCount = Number(resultRows[0]?.mutual_count ?? 0);
    const mutualNames = resultRows.map((row) => row.full_name || row.username || 'Someone');
    return buildSocialProof(mutualCount, mutualNames, safeLimit);
}

function buildSocialProof(mutualCount: number, mutualNames: string[], limit: number): SocialProofResult {
    if (mutualCount === 0) return { mutualCount: 0, mutualNames: [], summary: '' };
    let summary = '';
    if (mutualCount === 1) summary = `Friend of ${mutualNames[0]}`;
    else if (mutualCount === 2) summary = `Friend of ${mutualNames[0]} and ${mutualNames[1]}`;
    else if (mutualCount <= limit) {
        const last = mutualNames[mutualNames.length - 1]!;
        summary = `Friend of ${mutualNames.slice(0, -1).join(', ')}, and ${last}`;
    } else {
        const remaining = mutualCount - Math.min(limit, mutualNames.length);
        summary = `Friend of ${mutualNames.slice(0, limit).join(', ')}, and ${remaining} other${remaining === 1 ? '' : 's'}`;
    }
    return { mutualCount, mutualNames: mutualNames.slice(0, limit), summary };
}

/**
 * Gets mutual connection names between two users using Redis SINTER.
 * Returns actual names for rich "Friend of..." overlays.
 *
 * @param viewerId - The current user viewing the profile
 * @param targetId - The profile being viewed
 * @param limit - Max number of names to resolve (default: 3)
 */
export async function getMutualConnectionProof(
    viewerId: string,
    targetId: string,
    limit: number = 3,
): Promise<SocialProofResult> {
    const redis = getRedisClient();
    if (!redis) {
        return getMutualConnectionProofFromDatabase(viewerId, targetId, limit);
    }

    try {
        const viewerKey = `user:${viewerId}:connections`;
        const targetKey = `user:${targetId}:connections`;

        // Check if both sets exist
        const [viewerExists, targetExists] = await Promise.all([
            redis.exists(viewerKey),
            redis.exists(targetKey),
        ]);

        if (!viewerExists || !targetExists) {
            return getMutualConnectionProofFromDatabase(viewerId, targetId, limit);
        }

        // SINTER returns the intersection of two sets — O(N*M) but with small sets it's instant
        const mutualIds = await redis.sinter(viewerKey, targetKey) as string[];
        const mutualCount = mutualIds.length;

        if (mutualCount === 0) {
            return { mutualCount: 0, mutualNames: [], summary: '' };
        }

        // Resolve names for the top N mutual connections
        const idsToResolve = mutualIds.slice(0, limit);
        const resolvedProfiles = await db
            .select({
                id: profiles.id,
                fullName: profiles.fullName,
                username: profiles.username,
            })
            .from(profiles)
            .where(inArray(profiles.id, idsToResolve));

        const mutualNames = resolvedProfiles
            .map(p => p.fullName || p.username || 'Someone')
            .slice(0, limit);

        return buildSocialProof(mutualCount, mutualNames, limit);
    } catch (error) {
        console.warn('[social-proof] SINTER lookup failed:', error instanceof Error ? error.message : String(error));
        return getMutualConnectionProofFromDatabase(viewerId, targetId, limit);
    }
}

/**
 * Batch social proof lookup for multiple targets.
 * Useful for discover feed and search results.
 */
export async function getBatchMutualConnectionProof(
    viewerId: string,
    targetIds: string[],
    limit: number = 2,
): Promise<Map<string, SocialProofResult>> {
    const results = new Map<string, SocialProofResult>();
    const redis = getRedisClient();

    if (targetIds.length === 0) {
        return results;
    }

    if (!redis) {
        for (let index = 0; index < targetIds.length; index += 8) {
            const batch = targetIds.slice(index, index + 8);
            const proofs = await Promise.all(batch.map(async (targetId) => ({
                targetId,
                proof: await getMutualConnectionProofFromDatabase(viewerId, targetId, limit),
            })));
            for (const item of proofs) results.set(item.targetId, item.proof);
        }
        return results;
    }

    try {
        const viewerKey = `user:${viewerId}:connections`;
        const viewerExists = await redis.exists(viewerKey);
        if (!viewerExists) {
            for (let index = 0; index < targetIds.length; index += 8) {
                const batch = targetIds.slice(index, index + 8);
                const fallback = await Promise.all(batch.map(async (targetId) => ({
                    targetId,
                    proof: await getMutualConnectionProofFromDatabase(viewerId, targetId, limit),
                })));
                for (const item of fallback) results.set(item.targetId, item.proof);
            }
            return results;
        }

        // Process in parallel for speed
        const proofs = await Promise.all(
            targetIds.map(async (targetId) => {
                const targetKey = `user:${targetId}:connections`;
                const targetExists = await redis.exists(targetKey);
                if (!targetExists) return { targetId, mutualIds: null as string[] | null };

                const mutualIds = await redis.sinter(viewerKey, targetKey) as string[];
                return { targetId, mutualIds };
            }),
        );

        const missingTargets = proofs.filter((item) => item.mutualIds === null).map((item) => item.targetId);
        for (let index = 0; index < missingTargets.length; index += 8) {
            const batch = missingTargets.slice(index, index + 8);
            const fallback = await Promise.all(batch.map(async (targetId) => ({
                targetId,
                proof: await getMutualConnectionProofFromDatabase(viewerId, targetId, limit),
            })));
            for (const item of fallback) results.set(item.targetId, item.proof);
        }

        // Collect all unique IDs to resolve in one DB query
        const allMutualIds = new Set<string>();
        for (const { mutualIds } of proofs) {
            if (!mutualIds) continue;
            for (const id of mutualIds.slice(0, limit)) {
                allMutualIds.add(id);
            }
        }

        const profileMap = new Map<string, { fullName: string | null; username: string | null }>();
        if (allMutualIds.size > 0) {
            const resolvedProfiles = await db
                .select({
                    id: profiles.id,
                    fullName: profiles.fullName,
                    username: profiles.username,
                })
                .from(profiles)
                .where(inArray(profiles.id, Array.from(allMutualIds)));

            for (const p of resolvedProfiles) {
                profileMap.set(p.id, { fullName: p.fullName, username: p.username });
            }
        }

        // Build results
        for (const { targetId, mutualIds } of proofs) {
            if (!mutualIds) continue;
            const mutualCount = mutualIds.length;
            if (mutualCount === 0) {
                results.set(targetId, { mutualCount: 0, mutualNames: [], summary: '' });
                continue;
            }

            const names = mutualIds.slice(0, limit).map(id => {
                const p = profileMap.get(id);
                return p?.fullName || p?.username || 'Someone';
            });

            let summary = '';
            if (mutualCount === 1) {
                summary = `Friend of ${names[0]}`;
            } else if (mutualCount === 2) {
                summary = `Friend of ${names[0]} and ${names[1]}`;
            } else if (mutualCount <= limit) {
                const last = names[names.length - 1]!;
                summary = `Friend of ${names.slice(0, -1).join(', ')}, and ${last}`;
            } else {
                const remaining = mutualCount - limit;
                summary = `Friend of ${names.join(', ')}, and ${remaining} other${remaining === 1 ? '' : 's'}`;
            }

            results.set(targetId, { mutualCount, mutualNames: names, summary });
        }
    } catch (error) {
        console.warn('[social-proof] Batch lookup failed:', error instanceof Error ? error.message : String(error));
        for (let index = 0; index < targetIds.length; index += 8) {
            const batch = targetIds.slice(index, index + 8);
            const fallback = await Promise.all(batch.map(async (targetId) => ({
                targetId,
                proof: await getMutualConnectionProofFromDatabase(viewerId, targetId, limit),
            })));
            for (const item of fallback) results.set(item.targetId, item.proof);
        }
    }

    return results;
}
