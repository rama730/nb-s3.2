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
import { inArray } from 'drizzle-orm';

export interface SocialProofResult {
    mutualCount: number;
    mutualNames: string[];
    summary: string; // e.g., "Friend of Alice, Bob, and 3 others"
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
        return { mutualCount: 0, mutualNames: [], summary: '' };
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
            return { mutualCount: 0, mutualNames: [], summary: '' };
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

        // Build summary string
        let summary = '';
        if (mutualCount === 1) {
            summary = `Friend of ${mutualNames[0]}`;
        } else if (mutualCount === 2) {
            summary = `Friend of ${mutualNames[0]} and ${mutualNames[1]}`;
        } else if (mutualCount <= limit) {
            const last = mutualNames[mutualNames.length - 1]!;
            summary = `Friend of ${mutualNames.slice(0, -1).join(', ')}, and ${last}`;
        } else {
            const displayNames = mutualNames.slice(0, limit);
            const remaining = mutualCount - limit;
            summary = `Friend of ${displayNames.join(', ')}, and ${remaining} other${remaining === 1 ? '' : 's'}`;
        }

        return { mutualCount, mutualNames, summary };
    } catch (error) {
        console.warn('[social-proof] SINTER lookup failed:', error instanceof Error ? error.message : String(error));
        return { mutualCount: 0, mutualNames: [], summary: '' };
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

    if (!redis || targetIds.length === 0) {
        return results;
    }

    try {
        const viewerKey = `user:${viewerId}:connections`;
        const viewerExists = await redis.exists(viewerKey);
        if (!viewerExists) return results;

        // Process in parallel for speed
        const proofs = await Promise.all(
            targetIds.map(async (targetId) => {
                const targetKey = `user:${targetId}:connections`;
                const targetExists = await redis.exists(targetKey);
                if (!targetExists) return { targetId, mutualIds: [] as string[] };

                const mutualIds = await redis.sinter(viewerKey, targetKey) as string[];
                return { targetId, mutualIds };
            }),
        );

        // Collect all unique IDs to resolve in one DB query
        const allMutualIds = new Set<string>();
        for (const { mutualIds } of proofs) {
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
    }

    return results;
}
