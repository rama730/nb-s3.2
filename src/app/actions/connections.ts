'use server';

import { db } from '@/lib/db';
import { connectionSuggestionDismissals, connectionSuggestions, connections, profiles, projects, roleApplications } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq, and, or, desc, sql, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import {
    CONNECTION_REQUEST_HISTORY_STATUSES,
    isConnectionHistoryStatus,
    type ConnectionRequestHistoryStatus,
} from '@/lib/applications/status';
import { runInFlightDeduped } from '@/lib/async/inflight-dedupe';
import { APPLICATION_BANNER_HIDE_AFTER_MS } from '@/lib/chat/banner-lifecycle';
import { cacheData, getCachedData, redis } from '@/lib/redis';
import { queueCounterRefreshBestEffort } from '@/lib/workspace/counter-buffer';
import { resolvePrivacyRelationship } from '@/lib/privacy/resolver';
import { inngest } from '../../inngest/client';

// ============================================================================
// TYPES
// ============================================================================

export interface ConnectionStats {
    totalConnections: number;
    pendingIncoming: number;
    pendingSent: number;
    connectionsThisMonth: number;
    connectionsGained: number;
}

export interface SuggestedProfile {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    headline: string | null;
    location: string | null;
    connectionStatus: 'none' | 'pending_sent' | 'pending_received' | 'connected';
    canConnect?: boolean;
    profileVisibility?: 'public' | 'connections' | 'private';
    isLockedProfile?: boolean;
    mutualConnections?: number;
    recommendationReason?: string;
    projects?: Array<{ id: string; title: string; status: string | null }>;
}

export type ConnectionsFeedTab = 'network' | 'requests_incoming' | 'requests_sent' | 'discover';

export interface ConnectionsFeedInput {
    tab: ConnectionsFeedTab;
    limit?: number;
    cursor?: string;
    search?: string;
}

interface ConnectionsFeedStats {
    totalConnections: number;
    pendingIncoming: number;
    pendingSent: number;
}

type DiscoverFeedItem = {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    headline: string | null;
    location: string | null;
    connectionStatus: SuggestedProfile['connectionStatus'];
    canConnect: boolean;
    mutualConnections?: number;
    recommendationReason?: string;
    projects?: SuggestedProfile['projects'];
};

type RequestFeedItem = {
    id: string;
    requesterId: string;
    addresseeId: string;
    status: string;
    createdAt: Date;
    user?: {
        username?: string | null;
        fullName?: string | null;
        avatarUrl?: string | null;
        headline?: string | null;
    } | null;
};

export interface ConnectionRequestHistoryItem {
    id: string;
    kind: 'connection';
    direction: 'incoming' | 'outgoing';
    status: ConnectionRequestHistoryStatus;
    eventAt: string;
    createdAt: string;
    user: {
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
        headline: string | null;
    };
}

type NetworkFeedItem = {
    id: string;
    requesterId: string;
    addresseeId: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    otherUser?: {
        id?: string;
        username?: string | null;
        fullName?: string | null;
        avatarUrl?: string | null;
        headline?: string | null;
    } | null;
};

const REJECT_REQUEST_COOLDOWN_MS = 2 * 24 * 60 * 60 * 1000;
const CONNECTION_HISTORY_STATUSES: readonly ConnectionRequestHistoryStatus[] = CONNECTION_REQUEST_HISTORY_STATUSES;

function isConnectionRequestHistoryStatus(status: unknown): status is ConnectionRequestHistoryStatus {
    return isConnectionHistoryStatus(status);
}
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ============================================================================
// HELPER: Get authenticated user
// ============================================================================

async function getAuthUser() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}



// PURE OPTIMIZATION: lockConnectionPair fully replaced by native UNIQUE index constraint

async function applyConnectionsCountDelta(tx: DbTransaction, userIds: string[], delta: number) {
    if (userIds.length === 0 || delta === 0) return;
    await tx
        .update(profiles)
        .set({
            connectionsCount: sql`GREATEST(0, ${profiles.connectionsCount} + ${delta})`,
            updatedAt: new Date(),
        })
        .where(inArray(profiles.id, userIds));
}

export async function applyConnectionsCountIncrements(tx: DbTransaction, increments: Map<string, number>) {
    if (increments.size === 0) return;
    const entries = [...increments.entries()].filter(([, value]) => value !== 0);
    if (entries.length === 0) return;

    const ids = entries.map(([id]) => id);
    const cases = sql.join(
        entries.map(([id, value]) => sql`WHEN ${profiles.id} = ${id} THEN ${value}`),
        sql` `,
    );

    await tx
        .update(profiles)
        .set({
            connectionsCount: sql`GREATEST(0, ${profiles.connectionsCount} + CASE ${cases} ELSE 0 END)`,
            updatedAt: new Date(),
        })
        .where(inArray(profiles.id, ids));
}

const CONNECTIONS_CURSOR_DELIMITER = '|';

function encodeConnectionsCursor(updatedAt: Date, id: string) {
    return `${updatedAt.toISOString()}${CONNECTIONS_CURSOR_DELIMITER}${id}`;
}

function parseConnectionsCursor(cursor?: string) {
    if (!cursor) return null;
    const [dateRaw, id] = cursor.split(CONNECTIONS_CURSOR_DELIMITER);
    if (!dateRaw || !id) return null;
    const parsedDate = new Date(dateRaw);
    if (Number.isNaN(parsedDate.getTime())) return null;
    return { updatedAt: parsedDate.toISOString(), id };
}

export async function revalidateConnectionsPaths() {
    revalidatePath('/people');
    revalidatePath('/connections');
    revalidatePath('/profile');
    revalidatePath('/messages');
}

async function getConnectionStatsForUser(targetId: string): Promise<ConnectionsFeedStats> {
    const [stats] = await db.select({
        totalConnections: sql<number>`count(*) FILTER (
            WHERE ${connections.status} = 'accepted'
            AND (${connections.requesterId} = ${targetId} OR ${connections.addresseeId} = ${targetId})
        )`,
        pendingIncoming: sql<number>`count(*) FILTER (
            WHERE ${connections.status} = 'pending'
            AND ${connections.addresseeId} = ${targetId}
        )`,
        pendingSent: sql<number>`count(*) FILTER (
            WHERE ${connections.status} = 'pending'
            AND ${connections.requesterId} = ${targetId}
        )`,
    })
        .from(connections)
        .where(or(eq(connections.requesterId, targetId), eq(connections.addresseeId, targetId)));

    return {
        totalConnections: Number(stats?.totalConnections || 0),
        pendingIncoming: Number(stats?.pendingIncoming || 0),
        pendingSent: Number(stats?.pendingSent || 0),
    };
}

function getSafeSearch(search?: string) {
    const normalized = (search || '').trim();
    return normalized.length > 0 ? normalized : undefined;
}

const DISCOVER_CACHE_KEY_PREFIX = 'connections:feed:discover:v2';

function buildDiscoverCacheKey(params: {
    userId: string;
    limit: number;
    offset: number;
    cursor?: string;
    search?: string;
}) {
    const cursorPart = params.cursor ? encodeURIComponent(params.cursor) : '';
    const searchPart = params.search ? encodeURIComponent(params.search.toLowerCase()) : '';
    return `${DISCOVER_CACHE_KEY_PREFIX}:${params.userId}:l:${params.limit}:o:${params.offset}:c:${cursorPart}:q:${searchPart}`;
}

async function invalidateDiscoverCacheForUser(userId: string) {
    if (!redis) return;
    const redisClient = redis;
    const prefix = `${DISCOVER_CACHE_KEY_PREFIX}:${userId}:`;
    try {
        const discoverPattern = `discover:profile:${userId}:*`;
        const inboxPattern = `connections:inbox_cache:${userId}:*`;
        const patterns = [discoverPattern, inboxPattern];
        
        for (const pattern of patterns) {
            let cursor = 0;
            do {
                const redisClient = redis as any;
                const [nextCursor, keys] = await redisClient.scan(cursor, {
                    match: pattern,
                    count: 100,
                });
                cursor = nextCursor;
    
                if (keys.length > 0) {
                    const deleteBatchSize = 100;
                    for (let i = 0; i < keys.length; i += deleteBatchSize) {
                        const batch = keys.slice(i, i + deleteBatchSize);
                        if (batch.length === 0) continue;
                        await redisClient.unlink(...batch);
                    }
                }
            } while (String(cursor) !== '0');
        }
    } catch (error) {
        console.error('Failed to invalidate discover and inbox cache:', error);
    }
}

export async function invalidateDiscoverCacheForUsers(userIds: Iterable<string | null | undefined>) {
    const uniqueUserIds = Array.from(
        new Set(
            Array.from(userIds).filter((userId): userId is string => typeof userId === 'string' && userId.length > 0),
        ),
    );
    if (uniqueUserIds.length === 0) return;
    // PURE OPTIMIZATION: Execute cache invalidation non-blocking to prevent request hangs
    Promise.allSettled(uniqueUserIds.map((userId) => invalidateDiscoverCacheForUser(userId))).catch(console.error);
}

// ============================================================================
// REDIS CONNECTION EDGE CACHING (O(1) Authorization Checks)
// ============================================================================

export async function syncConnectionsToRedis(userId: string) {
    if (!redis) return;
    try {
        const key = `user:${userId}:connections`;
        const accepted = await db
            .select({
                otherId: sql<string>`CASE 
                    WHEN ${connections.requesterId} = ${userId} THEN ${connections.addresseeId} 
                    ELSE ${connections.requesterId} 
                END`
            })
            .from(connections)
            .where(and(
                eq(connections.status, 'accepted'),
                or(eq(connections.requesterId, userId), eq(connections.addresseeId, userId))
            ));
        
        const otherIds = accepted.map(row => row.otherId);
        
        if (otherIds.length > 0) {
            await (redis as any).sadd(key, ...otherIds);
            await redis.expire(key, 86400); // 24h cache duration
        } else {
            await redis.del(key);
        }
    } catch (error) {
        console.error('Failed to sync connections to Redis:', error);
    }
}

export async function isConnected(userId1: string, userId2: string): Promise<boolean> {
    if (!redis) {
        const [conn] = await db
            .select({ id: connections.id })
            .from(connections)
            .where(and(
                eq(connections.status, 'accepted'),
                or(
                    and(eq(connections.requesterId, userId1), eq(connections.addresseeId, userId2)),
                    and(eq(connections.requesterId, userId2), eq(connections.addresseeId, userId1))
                )
            ))
            .limit(1);
        return !!conn;
    }

    try {
        const key = `user:${userId1}:connections`;
        const exists = await redis.exists(key);
        
        if (exists) {
            const isMember = await redis.sismember(key, userId2);
            return !!isMember;
        }
        
        const [conn] = await db
            .select({ id: connections.id })
            .from(connections)
            .where(and(
                eq(connections.status, 'accepted'),
                or(
                    and(eq(connections.requesterId, userId1), eq(connections.addresseeId, userId2)),
                    and(eq(connections.requesterId, userId2), eq(connections.addresseeId, userId1))
                )
            ))
            .limit(1);
            
        syncConnectionsToRedis(userId1).catch(console.error);
        
        return !!conn;
    } catch (error) {
        console.error('Redis isConnected check failed:', error);
        return false;
    }
}

export async function getConnectionsFeed(input: ConnectionsFeedInput) {
    const user = await getAuthUser();
    if (!user) {
        return {
            success: false as const,
            error: 'Not authenticated',
            items: [],
            nextCursor: null,
            hasMore: false,
            stats: { totalConnections: 0, pendingIncoming: 0, pendingSent: 0 },
        };
    }

    const limit = Math.max(1, Math.min(input.limit ?? 20, 60));
    const tab = input.tab;
    const safeSearch = getSafeSearch(input.search);

    if (safeSearch) {
        const searchRate = await consumeRateLimit(`connections-search:${user.id}`, 100, 60);
        if (!searchRate.allowed) {
            return {
                success: false as const,
                error: 'Too many searches. Please wait and try again.',
                items: [],
                nextCursor: null,
                hasMore: false,
                stats: await getConnectionStatsForUser(user.id),
            };
        }
    }

    const stats = await getConnectionStatsForUser(user.id);
    const searchPattern = safeSearch ? `%${safeSearch.toLowerCase()}%` : undefined;
    const parsedCursor = parseConnectionsCursor(input.cursor);

    if (tab === 'network') {
        const conditions = [
            eq(connections.status, 'accepted'),
            or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id)),
        ];

        if (searchPattern) {
            conditions.push(
                sql`(${profiles.fullName} ILIKE ${searchPattern} OR ${profiles.username} ILIKE ${searchPattern})`,
            );
        }

        if (parsedCursor) {
            conditions.push(sql`(
                ${connections.updatedAt} < ${parsedCursor.updatedAt}
                OR (${connections.updatedAt} = ${parsedCursor.updatedAt} AND ${connections.id} < ${parsedCursor.id})
            )`);
        }

        const rows = await db
            .select({
                id: connections.id,
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
                status: connections.status,
                createdAt: connections.createdAt,
                updatedAt: connections.updatedAt,
                profileId: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                headline: profiles.headline,
                location: profiles.location,
            })
            .from(connections)
            .innerJoin(
                profiles,
                or(
                    and(eq(connections.requesterId, user.id), eq(connections.addresseeId, profiles.id)),
                    and(eq(connections.addresseeId, user.id), eq(connections.requesterId, profiles.id)),
                ),
            )
            .where(and(...conditions))
            .orderBy(desc(connections.updatedAt), desc(connections.id))
            .limit(limit + 1);

        const hasMore = rows.length > limit;
        const seenNetworkUserIds = new Set<string>();
        const items = rows.slice(0, limit + 10).reduce<Array<{
            id: string;
            type: 'network';
            requesterId: string;
            addresseeId: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            otherUser: {
                id: string;
                username: string | null;
                fullName: string | null;
                avatarUrl: string | null;
                headline: string | null;
                location: string | null;
            };
        }>>((acc, row) => {
            if (seenNetworkUserIds.has(row.profileId)) return acc;
            seenNetworkUserIds.add(row.profileId);
            acc.push({
                id: row.id,
                type: 'network' as const,
                requesterId: row.requesterId,
                addresseeId: row.addresseeId,
                status: row.status,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                otherUser: {
                    id: row.profileId,
                    username: row.username,
                    fullName: row.fullName,
                    avatarUrl: row.avatarUrl,
                    headline: row.headline,
                    location: row.location,
                },
            });
            return acc;
        }, []).slice(0, limit);

        const nextCursor = hasMore && items.length > 0
            ? encodeConnectionsCursor(items[items.length - 1].updatedAt, items[items.length - 1].id)
            : null;

        return { success: true as const, items, hasMore, nextCursor, stats };
    }

    if (tab === 'requests_incoming' || tab === 'requests_sent') {
        const isIncoming = tab === 'requests_incoming';
        const profileJoinCondition = isIncoming
            ? eq(profiles.id, connections.requesterId)
            : eq(profiles.id, connections.addresseeId);
        const userCondition = isIncoming
            ? eq(connections.addresseeId, user.id)
            : eq(connections.requesterId, user.id);

        const conditions = [eq(connections.status, 'pending'), userCondition];
        if (searchPattern) {
            conditions.push(
                sql`(${profiles.fullName} ILIKE ${searchPattern} OR ${profiles.username} ILIKE ${searchPattern})`,
            );
        }
        if (parsedCursor) {
            conditions.push(sql`(
                ${connections.createdAt} < ${parsedCursor.updatedAt}
                OR (${connections.createdAt} = ${parsedCursor.updatedAt} AND ${connections.id} < ${parsedCursor.id})
            )`);
        }

        const rows = await db
            .select({
                id: connections.id,
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
                status: connections.status,
                createdAt: connections.createdAt,
                updatedAt: connections.updatedAt,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                headline: profiles.headline,
                location: profiles.location,
            })
            .from(connections)
            .innerJoin(profiles, profileJoinCondition)
            .where(and(...conditions))
            .orderBy(desc(connections.createdAt), desc(connections.id))
            .limit(limit + 1);

        const hasMore = rows.length > limit;
        const seenRequestUserIds = new Set<string>();
        const items = rows.slice(0, limit + 10).reduce<Array<{
            id: string;
            type: ConnectionsFeedTab;
            requesterId: string;
            addresseeId: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            user: {
                id: string;
                username: string | null;
                fullName: string | null;
                avatarUrl: string | null;
                headline: string | null;
                location: string | null;
            };
        }>>((acc, row) => {
            const userId = isIncoming ? row.requesterId : row.addresseeId;
            if (seenRequestUserIds.has(userId)) return acc;
            seenRequestUserIds.add(userId);
            acc.push({
                id: row.id,
                type: tab,
                requesterId: row.requesterId,
                addresseeId: row.addresseeId,
                status: row.status,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                user: {
                    id: isIncoming ? row.requesterId : row.addresseeId,
                    username: row.username,
                    fullName: row.fullName,
                    avatarUrl: row.avatarUrl,
                    headline: row.headline,
                    location: row.location,
                },
            });
            return acc;
        }, []).slice(0, limit);

        const nextCursor = hasMore && items.length > 0
            ? encodeConnectionsCursor(items[items.length - 1].createdAt, items[items.length - 1].id)
            : null;

        return { success: true as const, items, hasMore, nextCursor, stats };
    }

    // discover
    const discoverOffset = input.cursor?.startsWith('o:')
        ? Number(input.cursor.slice(2))
        : 0;
    const safeOffset = Number.isFinite(discoverOffset) && discoverOffset > 0 ? Math.min(discoverOffset, 1000) : 0;

    // PURE OPTIMIZATION: Split heavy vs light queries based on offset
    const isHeavyLoad = safeOffset === 0 && !searchPattern;
    const cacheKey = buildDiscoverCacheKey({
        userId: user.id,
        limit,
        offset: safeOffset,
        cursor: input.cursor,
        search: safeSearch,
    });

    // Redis Buffer Cache for Light Explore Load
    if (!isHeavyLoad && !searchPattern) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cachedResult = await getCachedData<any>(cacheKey);
            if (cachedResult) return cachedResult;
        } catch (e) {
            console.error("Redis Cache error:", e);
        }
    }

    // =========================================================================
    // PHASE 6B: Pre-computed Suggestions Fast Path
    // Try reading from the `connection_suggestions` table first (O(1) read).
    // This data is pre-computed by the social-graph-suggestions Inngest worker.
    // =========================================================================
    if (!searchPattern) {
        try {
            const preComputed = await db
                .select({
                    suggestedUserId: connectionSuggestions.suggestedUserId,
                    mutualConnectionsCount: connectionSuggestions.mutualConnectionsCount,
                    score: connectionSuggestions.score,
                    reason: connectionSuggestions.reason,
                })
                .from(connectionSuggestions)
                .where(eq(connectionSuggestions.userId, user.id))
                .orderBy(desc(connectionSuggestions.score))
                .limit(limit + 1)
                .offset(safeOffset);

            if (preComputed.length > 0) {
                const suggestedIds = preComputed.slice(0, limit).map(s => s.suggestedUserId);
                const suggestedProfiles = await db
                    .select({
                        id: profiles.id,
                        username: profiles.username,
                        fullName: profiles.fullName,
                        avatarUrl: profiles.avatarUrl,
                        headline: profiles.headline,
                        location: profiles.location,
                        visibility: profiles.visibility,
                        connectionsCount: profiles.connectionsCount,
                    })
                    .from(profiles)
                    .where(inArray(profiles.id, suggestedIds));

                const profileMap = new Map(suggestedProfiles.map(p => [p.id, p]));
                const preComputedItems = preComputed.slice(0, limit).map(s => {
                    const p = profileMap.get(s.suggestedUserId);
                    if (!p) return null;
                    const profileVisibility = (p.visibility || 'public') as SuggestedProfile['profileVisibility'];
                    return {
                        id: p.id,
                        type: 'discover' as const,
                        username: p.username,
                        fullName: p.fullName,
                        avatarUrl: p.avatarUrl,
                        headline: p.headline,
                        location: p.location,
                        connectionStatus: 'none' as SuggestedProfile['connectionStatus'],
                        canConnect: true,
                        profileVisibility,
                        isLockedProfile: profileVisibility !== 'public',
                        mutualConnections: s.mutualConnectionsCount,
                        recommendationReason: s.reason || `${s.mutualConnectionsCount} mutual connections`,
                        projects: [] as Array<{ id: string; title: string; status: string | null }>,
                    };
                }).filter(Boolean);

                if (preComputedItems.length > 0) {
                    const hasMore = preComputed.length > limit;
                    const nextCursor = hasMore ? `o:${safeOffset + limit}` : null;
                    return { success: true as const, items: preComputedItems, hasMore, nextCursor, stats };
                }
            }
        } catch (e) {
            console.warn('[discover] Pre-computed suggestions read failed, falling back to real-time:', e);
        }
    }

    // =========================================================================
    // PHASE 6B: Graceful Degradation — Timeout-guarded real-time discovery
    // If the heavy query takes >3s, fall back to a cached "Global Trending" feed
    // =========================================================================
    const DISCOVER_TIMEOUT_MS = 3000;

    const realTimeDiscoverResult = await Promise.race([
        (async () => {
            const meProfile = await db
                .select({
                    skills: profiles.skills,
                    interests: profiles.interests,
                    openTo: profiles.openTo,
                })
                .from(profiles)
                .where(eq(profiles.id, user.id))
                .limit(1);

            const mySignals = new Set<string>([
                ...((meProfile[0]?.skills || []).map((v) => v.toLowerCase())),
                ...((meProfile[0]?.interests || []).map((v) => v.toLowerCase())),
                ...((meProfile[0]?.openTo || []).map((v) => v.toLowerCase())),
            ]);

            const candidateBaseConditions = [sql`${profiles.id} <> ${user.id}`];
            candidateBaseConditions.push(sql`NOT EXISTS (
                SELECT 1
                FROM ${connectionSuggestionDismissals}
                WHERE ${connectionSuggestionDismissals.userId} = ${user.id}
                AND ${connectionSuggestionDismissals.dismissedProfileId} = ${profiles.id}
            )`);
            candidateBaseConditions.push(sql`NOT EXISTS (
                SELECT 1
                FROM ${connections} privacy_block
                WHERE privacy_block.status = 'blocked'
                AND (
                    (privacy_block.requester_id = ${user.id} AND privacy_block.addressee_id = ${profiles.id} AND privacy_block.blocked_by = ${user.id})
                    OR
                    (privacy_block.requester_id = ${profiles.id} AND privacy_block.addressee_id = ${user.id} AND privacy_block.blocked_by = ${profiles.id})
                )
            )`);
            if (searchPattern) {
                candidateBaseConditions.push(
                    sql`(
                        ${profiles.fullName} ILIKE ${searchPattern}
                        OR ${profiles.username} ILIKE ${searchPattern}
                        OR ${profiles.headline} ILIKE ${searchPattern}
                        OR ${profiles.location} ILIKE ${searchPattern}
                    )`,
                );
            }

            const candidates = await db
                .select({
                    id: profiles.id,
                    username: profiles.username,
                    fullName: profiles.fullName,
                    avatarUrl: profiles.avatarUrl,
                    headline: profiles.headline,
                    location: profiles.location,
                    visibility: profiles.visibility,
                    skills: isHeavyLoad ? profiles.skills : sql`NULL::text[]`,
                    interests: isHeavyLoad ? profiles.interests : sql`NULL::text[]`,
                    createdAt: profiles.createdAt,
                    connectionsCount: profiles.connectionsCount,
                })
                .from(profiles)
                .where(and(...candidateBaseConditions))
                .orderBy(desc(profiles.connectionsCount), desc(profiles.createdAt), desc(profiles.id))
                .limit(limit + 1)
                .offset(safeOffset);

            const candidateIds = candidates.map((candidate) => candidate.id);
            if (candidateIds.length === 0) {
                return {
                    success: true as const,
                    items: [],
                    hasMore: false,
                    nextCursor: null,
                    stats,
                };
            }

            const existingConnections = await db
                .select({
                    id: connections.id,
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                    status: connections.status,
                    createdAt: connections.createdAt,
                    updatedAt: connections.updatedAt,
                })
                .from(connections)
                .where(
                    or(
                        and(eq(connections.requesterId, user.id), inArray(connections.addresseeId, candidateIds)),
                        and(eq(connections.addresseeId, user.id), inArray(connections.requesterId, candidateIds)),
                    ),
                );

            const connectionByCandidate = new Map<string, { status: typeof connections.$inferSelect.status; requesterId: string; id: string; updatedAt: Date }>();
            for (const conn of existingConnections) {
                const candidateId = conn.requesterId === user.id ? conn.addresseeId : conn.requesterId;
                const existing = connectionByCandidate.get(candidateId);
                if (!existing) {
                    connectionByCandidate.set(candidateId, { status: conn.status, requesterId: conn.requesterId, id: conn.id, updatedAt: conn.updatedAt });
                    continue;
                }
                const getPriority = (s: string) => {
                    if (s === 'accepted') return 1;
                    if (s === 'blocked') return 2;
                    if (s === 'pending') return 3;
                    return 4;
                };
                if (getPriority(conn.status) < getPriority(existing.status) || (getPriority(conn.status) === getPriority(existing.status) && conn.updatedAt > existing.updatedAt)) {
                    connectionByCandidate.set(candidateId, { status: conn.status, requesterId: conn.requesterId, id: conn.id, updatedAt: conn.updatedAt });
                }
            }

            let candidateProjects: Array<{ ownerId: string; id: string; title: string; status: string | null }> = [];
            const mutualCounts = new Map<string, number>();

            if (isHeavyLoad) {
                const fetchedProjects = await db
                    .select({
                        ownerId: projects.ownerId,
                        id: projects.id,
                        title: projects.title,
                        status: projects.status,
                    })
                    .from(projects)
                    .where(inArray(projects.ownerId, candidateIds))
                    .orderBy(desc(projects.createdAt));
                candidateProjects = fetchedProjects;

                const myPeerRows = await db
                    .select({
                        peerId: sql<string>`CASE
                            WHEN ${connections.requesterId} = ${user.id} THEN ${connections.addresseeId}
                            ELSE ${connections.requesterId}
                        END`,
                    })
                    .from(connections)
                    .where(
                        and(
                            eq(connections.status, 'accepted'),
                            or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id)),
                        ),
                    )
                    .limit(1000);
                const myPeerIds = myPeerRows.map((row) => row.peerId);

                if (myPeerIds.length > 0) {
                    const candidateIdSet = new Set(candidateIds);
                    const mutualRows = await db
                        .select({
                            requesterId: connections.requesterId,
                            addresseeId: connections.addresseeId,
                        })
                        .from(connections)
                        .where(
                            and(
                                eq(connections.status, 'accepted'),
                                or(
                                    and(inArray(connections.requesterId, candidateIds), inArray(connections.addresseeId, myPeerIds)),
                                    and(inArray(connections.addresseeId, candidateIds), inArray(connections.requesterId, myPeerIds)),
                                ),
                            ),
                        );

                    for (const row of mutualRows) {
                        const candidateId = candidateIdSet.has(row.requesterId) ? row.requesterId : row.addresseeId;
                        mutualCounts.set(candidateId, (mutualCounts.get(candidateId) || 0) + 1);
                    }
                }
            }

            const projectsByOwner = new Map<string, Array<{ id: string; title: string; status: string | null }>>();
            if (isHeavyLoad) {
                for (const project of candidateProjects) {
                    if (!projectsByOwner.has(project.ownerId)) {
                        projectsByOwner.set(project.ownerId, []);
                    }
                    const ownerProjects = projectsByOwner.get(project.ownerId)!;
                    if (ownerProjects.length < 3) {
                        ownerProjects.push({ id: project.id, title: project.title, status: project.status });
                    }
                }
            }

            const scored = candidates.map((candidate) => {
                const conn = connectionByCandidate.get(candidate.id);
                const status = conn?.status === 'accepted'
                    ? 'connected'
                    : conn?.status === 'pending'
                        ? (conn.requesterId === user.id ? 'pending_sent' : 'pending_received')
                        : 'none';
                const canConnect = status === 'none';

                if (!isHeavyLoad) {
                    return {
                        ...candidate,
                        score: candidate.connectionsCount || 0,
                        status,
                        canConnect,
                        mutual: 0,
                        recommendationReason: undefined,
                    };
                }

                const candidateSignals = new Set<string>([
                    ...(((candidate.skills as string[]) || []).map((v) => v.toLowerCase())),
                    ...(((candidate.interests as string[]) || []).map((v) => v.toLowerCase())),
                ]);
                let overlap = 0;
                for (const signal of candidateSignals) {
                    if (mySignals.has(signal)) overlap += 1;
                }
                const mutual = mutualCounts.get(candidate.id) || 0;
                const recency = Math.max(0, 365 - (Date.now() - new Date(candidate.createdAt).getTime()) / (1000 * 60 * 60 * 24));
                const score = overlap * 5 + mutual * 3 + recency * 0.03;

                const recommendationReason = overlap > 0
                    ? 'Skills match'
                    : mutual > 0
                        ? `${mutual} mutual connections`
                        : 'Suggested for your network';

                return {
                    ...candidate,
                    score,
                    status,
                    canConnect,
                    mutual,
                    recommendationReason,
                };
            });

            if (isHeavyLoad) {
                scored.sort((a, b) => b.score - a.score || +new Date(b.createdAt) - +new Date(a.createdAt));
            }
            const hasMore = scored.length > limit;
            const items = scored.slice(0, limit).map((candidate) => {
                const profileVisibility = (candidate.visibility || 'public') as SuggestedProfile['profileVisibility'];
                return {
                    id: candidate.id,
                    type: 'discover' as const,
                    username: candidate.username,
                    fullName: candidate.fullName,
                    avatarUrl: candidate.avatarUrl,
                    headline: candidate.headline,
                    location: candidate.location,
                    connectionStatus: candidate.status as SuggestedProfile['connectionStatus'],
                    canConnect: candidate.canConnect,
                    profileVisibility,
                    isLockedProfile: candidate.status !== 'connected' && profileVisibility !== 'public',
                    mutualConnections: isHeavyLoad ? candidate.mutual : undefined,
                    recommendationReason: isHeavyLoad ? candidate.recommendationReason : undefined,
                    projects: isHeavyLoad ? projectsByOwner.get(candidate.id) || [] : undefined,
                };
            });

            const nextCursor = hasMore ? `o:${safeOffset + limit}` : null;
            return { success: true as const, items, hasMore, nextCursor, stats };
        })(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), DISCOVER_TIMEOUT_MS)),
    ]);

    // If the real-time query completed, use it
    if (realTimeDiscoverResult) {
        const finalResult = realTimeDiscoverResult;
        if (!isHeavyLoad && !searchPattern) {
            try {
                await cacheData(cacheKey, finalResult, 15 * 60);
            } catch (e) {
                console.error("Redis Cache Write error:", e);
            }
        }
        return finalResult;
    }

    // GRACEFUL DEGRADATION: Timed out — serve "Global Trending" fallback
    console.warn('[discover] Real-time query timed out, serving Global Trending fallback');
    const trendingProfiles = await db
        .select({
            id: profiles.id,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
            headline: profiles.headline,
            location: profiles.location,
            visibility: profiles.visibility,
            connectionsCount: profiles.connectionsCount,
        })
        .from(profiles)
        .where(sql`${profiles.id} <> ${user.id}`)
        .orderBy(desc(profiles.connectionsCount))
        .limit(limit + 1);

    const trendingHasMore = trendingProfiles.length > limit;
    const trendingItems = trendingProfiles.slice(0, limit).map(p => {
        const profileVisibility = (p.visibility || 'public') as SuggestedProfile['profileVisibility'];
        return {
            id: p.id,
            type: 'discover' as const,
            username: p.username,
            fullName: p.fullName,
            avatarUrl: p.avatarUrl,
            headline: p.headline,
            location: p.location,
            connectionStatus: 'none' as SuggestedProfile['connectionStatus'],
            canConnect: true,
            profileVisibility,
            isLockedProfile: profileVisibility !== 'public',
            mutualConnections: undefined,
            recommendationReason: 'Trending in your network',
            projects: undefined,
        };
    });

    const fallbackResult = { success: true as const, items: trendingItems, hasMore: trendingHasMore, nextCursor: trendingHasMore ? `o:${safeOffset + limit}` : null, stats };
    try {
        await cacheData(cacheKey, fallbackResult, 5 * 60); // Cache fallback for 5 mins
    } catch { /* ignore */ }
    return fallbackResult;
}

export async function getConnectionRequestHistory(limit: number = 80): Promise<{
    success: boolean;
    items: ConnectionRequestHistoryItem[];
    error?: string;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, items: [], error: 'Not authenticated' };

        const effectiveLimit = Math.max(1, Math.min(limit, 200));
        const dedupeKey = `connections:request-history:${user.id}:${effectiveLimit}`;
        return await runInFlightDeduped(dedupeKey, async () => {
            const rows = await db
                .select({
                    id: connections.id,
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                    status: connections.status,
                    createdAt: connections.createdAt,
                    updatedAt: connections.updatedAt,
                    profileId: profiles.id,
                    username: profiles.username,
                    fullName: profiles.fullName,
                    avatarUrl: profiles.avatarUrl,
                    headline: profiles.headline,
                })
                .from(connections)
                .innerJoin(
                    profiles,
                    or(
                        and(eq(connections.requesterId, user.id), eq(connections.addresseeId, profiles.id)),
                        and(eq(connections.addresseeId, user.id), eq(connections.requesterId, profiles.id)),
                    ),
                )
                .where(
                    and(
                        or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id)),
                        inArray(connections.status, CONNECTION_HISTORY_STATUSES),
                    ),
                )
                .orderBy(desc(connections.updatedAt), desc(connections.id))
                .limit(effectiveLimit);

            const items: ConnectionRequestHistoryItem[] = rows.flatMap((row) => {
                if (!isConnectionRequestHistoryStatus(row.status)) {
                    console.error('Invalid connection history status encountered', {
                        connectionId: row.id,
                        status: row.status,
                    });
                    return [];
                }

                const status = row.status;
                return [{
                    id: row.id,
                    kind: 'connection',
                    direction: row.requesterId === user.id ? 'outgoing' : 'incoming',
                    status,
                    eventAt: (status === 'pending' ? row.createdAt : row.updatedAt).toISOString(),
                    createdAt: row.createdAt.toISOString(),
                    user: {
                        id: row.profileId,
                        username: row.username,
                        fullName: row.fullName,
                        avatarUrl: row.avatarUrl,
                        headline: row.headline,
                    },
                }];
            });

            return { success: true, items };
        });
    } catch (error) {
        console.error('Error fetching connection request history:', error);
        return { success: false, items: [], error: 'Failed to load history' };
    }
}

// ============================================================================
// SEND CONNECTION REQUEST
// ============================================================================

export async function sendConnectionRequest(
    addresseeId: string,
    idempotencyKey?: string,
    _message?: string
): Promise<{ success: boolean; error?: string; connectionId?: string }> {
    try {
        void _message;
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        if (idempotencyKey && redis) {
            const cacheKey = `idempotent:conn:${user.id}:${idempotencyKey}`;
            const isFirst = await redis.set(cacheKey, '1', { nx: true, ex: 15 });
            if (!isFirst) {
                console.log(`[connections] Idempotency lock hit for ${cacheKey}`);
                return { success: true, connectionId: 'duplicate' };
            }
        }

        // Can't connect to yourself
        if (user.id === addresseeId) {
            return { success: false, error: 'Cannot connect to yourself' };
        }

        const requestRate = await consumeRateLimit(`connections-send:${user.id}`, 30, 60);
        if (!requestRate.allowed) {
            return { success: false, error: 'Too many requests. Please wait and try again.' };
        }

        // PURE OPTIMIZATION: O(1) Pre-check for already connected users (1M+ Users Scalability)
        if (await isConnected(user.id, addresseeId)) {
            return { success: false, error: 'Already connected' };
        }

        const privacy = await resolvePrivacyRelationship(user.id, addresseeId);
        if (!privacy) {
            return { success: false, error: 'User not found' };
        }
        if (!privacy.canSendConnectionRequest) {
            if (privacy.blockedByViewer || privacy.blockedByTarget) {
                return { success: false, error: 'You cannot send a request to this account.' };
            }
            if (privacy.connectionPrivacy === 'nobody') {
                return { success: false, error: 'This user is not accepting connection requests.' };
            }
            if (privacy.connectionPrivacy === 'mutuals_only') {
                return { success: false, error: 'This user only accepts requests from mutual connections.' };
            }
            return { success: false, error: 'Cannot send request right now.' };
        }

        // PURE OPTIMIZATION: Dropped advisory lock for native connection pairs unique constraints
        const txResult = await db.transaction(async (tx) => {
            const existing = await tx
                .select({
                    id: connections.id,
                    status: connections.status,
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                    updatedAt: connections.updatedAt,
                })
                .from(connections)
                .where(
                    or(
                        and(eq(connections.requesterId, user.id), eq(connections.addresseeId, addresseeId)),
                        and(eq(connections.requesterId, addresseeId), eq(connections.addresseeId, user.id))
                    )
                )
                .orderBy(desc(connections.updatedAt))
                .limit(1);

            if (existing.length > 0) {
                const conn = existing[0];
                if (conn.status === 'accepted') return { error: 'Already connected' };
                if (conn.status === 'pending') {
                    return {
                        connectionId: conn.id,
                        error: conn.requesterId === user.id ? 'Request already pending' : 'Incoming request exists',
                    };
                }
                if (conn.status === 'blocked') return { error: 'Cannot send request' };
                if (conn.status === 'rejected' || conn.status === 'cancelled' || conn.status === 'disconnected') {
                    if (conn.status === 'rejected') {
                        const isSameDirection = conn.requesterId === user.id && conn.addresseeId === addresseeId;
                        if (isSameDirection) {
                            const cooldownUntil = new Date(new Date(conn.updatedAt).getTime() + REJECT_REQUEST_COOLDOWN_MS);
                            if (cooldownUntil.getTime() > Date.now()) {
                                return {
                                    error: `This request was recently declined. You can retry after ${cooldownUntil.toLocaleString()}.`,
                                };
                            }
                        }
                    }

                    await tx
                        .update(connections)
                        .set({
                            requesterId: user.id,
                            addresseeId,
                            status: 'pending',
                            updatedAt: new Date(),
                            createdAt: new Date(), // PURE OPTIMIZATION: Reset createdAt so it bubbles to top of incoming feeds
                        })
                        .where(eq(connections.id, conn.id));
                    return { connectionId: conn.id };
                }
            }

            try {
                const inserted = await tx
                    .insert(connections)
                    .values({
                        requesterId: user.id,
                        addresseeId: addresseeId,
                        status: 'pending',
                    })
                    .returning({ id: connections.id });
                return { connectionId: inserted[0].id };
            } catch (err: any) {
                // If unique constraint is violated, someone else inserted concurrently
                if (err?.code === '23505') {
                    return { error: 'Request was already sent or a connection exists.' };
                }
                throw err;
            }
        });

        if (!txResult.connectionId) {
            return { success: false, error: txResult.error || 'Failed to send request' };
        }

        await queueCounterRefreshBestEffort([addresseeId]);
        await invalidateDiscoverCacheForUsers([user.id, addresseeId]);
        await revalidateConnectionsPaths();
        return { success: true, connectionId: txResult.connectionId };
    } catch (error) {
        console.error('Error sending connection request:', error);
        return { success: false, error: 'Failed to send request' };
    }
}

export async function dismissConnectionSuggestion(
    dismissedProfileId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        if (dismissedProfileId === user.id) return { success: false, error: 'Invalid target profile' };

        const dismissRate = await consumeRateLimit(`connections-dismiss:${user.id}`, 200, 60);
        if (!dismissRate.allowed) {
            return { success: false, error: 'Too many actions. Please wait and try again.' };
        }

        await db
            .insert(connectionSuggestionDismissals)
            .values({
                userId: user.id,
                dismissedProfileId,
            })
            .onConflictDoNothing({
                target: [connectionSuggestionDismissals.userId, connectionSuggestionDismissals.dismissedProfileId],
            });

        await invalidateDiscoverCacheForUser(user.id);
        revalidatePath('/people');
        return { success: true };
    } catch (error) {
        console.error('Error dismissing suggestion:', error);
        return { success: false, error: 'Failed to dismiss suggestion' };
    }
}

export async function acceptAllIncomingConnectionRequests(
    limit: number = 100
): Promise<{ success: boolean; acceptedCount?: number; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const effectiveLimit = Math.max(1, Math.min(limit, 200));
        const bulkAcceptRate = await consumeRateLimit(`connections-accept-all:${user.id}`, 6, 60);
        if (!bulkAcceptRate.allowed) {
            return { success: false, error: 'Too many bulk actions. Please wait and try again.' };
        }

        await inngest.send({
            name: 'workspace/connections.bulk',
            data: {
                userId: user.id,
                action: 'accept',
                limit: effectiveLimit,
            }
        });
        
        return { success: true };
    } catch (error) {
        console.error('Error initiating bulk accept queue:', error);
        return { success: false, error: 'Failed to accept all requests' };
    }
}

export async function rejectAllIncomingConnectionRequests(
    limit: number = 100
): Promise<{ success: boolean; rejectedCount?: number; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const effectiveLimit = Math.max(1, Math.min(limit, 200));
        const bulkRejectRate = await consumeRateLimit(`connections-reject-all:${user.id}`, 6, 60);
        if (!bulkRejectRate.allowed) {
            return { success: false, error: 'Too many bulk actions. Please wait and try again.' };
        }

        await inngest.send({
            name: 'workspace/connections.bulk',
            data: {
                userId: user.id,
                action: 'reject',
                limit: effectiveLimit,
            }
        });
        
        return { success: true };
    } catch (error) {
        console.error('Error initiating bulk reject queue:', error);
        return { success: false, error: 'Failed to reject all requests' };
    }
}

// ============================================================================
// CANCEL CONNECTION REQUEST (Requester only, pending only)
// ============================================================================

export async function cancelConnectionRequest(
    connectionId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const cancelRate = await consumeRateLimit(`connections-cancel:${user.id}`, 60, 60);
        if (!cancelRate.allowed) {
            return { success: false, error: 'Too many actions. Please wait and try again.' };
        }

        const [updated] = await db
            .update(connections)
            .set({
                status: 'cancelled',
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(connections.id, connectionId),
                    eq(connections.requesterId, user.id),
                    eq(connections.status, 'pending')
                )
            )
            .returning({
                id: connections.id,
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
            });

        const cancelled = updated ? {
            id: updated.id,
            requesterId: updated.requesterId,
            addresseeId: updated.addresseeId,
        } : null;

        if (!cancelled) return { success: false, error: 'Request not found or cannot be cancelled' };

        await queueCounterRefreshBestEffort([cancelled.addresseeId]);
        await invalidateDiscoverCacheForUsers([cancelled.requesterId, cancelled.addresseeId]);
        await revalidateConnectionsPaths();
        return { success: true };
    } catch (error) {
        console.error('Error cancelling request:', error);
        return { success: false, error: 'Failed to cancel request' };
    }
}

// ============================================================================
// ACCEPT CONNECTION REQUEST (Addressee only)
// ============================================================================

export async function acceptConnectionRequest(
    connectionId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const acceptRate = await consumeRateLimit(`connections-accept:${user.id}`, 60, 60);
        if (!acceptRate.allowed) {
            return { success: false, error: 'Too many actions. Please wait and try again.' };
        }

        const accepted = await db.transaction(async (tx) => {
            const updated = await tx
                .update(connections)
                .set({
                    status: 'accepted',
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(connections.id, connectionId),
                        eq(connections.addresseeId, user.id),
                        eq(connections.status, 'pending')
                    )
                )
                .returning({
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                });

            if (updated.length === 0) return null;

            await applyConnectionsCountDelta(
                tx,
                [updated[0].requesterId, updated[0].addresseeId],
                1
            );

            return updated[0];
        });

        if (!accepted) {
            return { success: false, error: 'Request not found' };
        }

        await queueCounterRefreshBestEffort([accepted.requesterId, accepted.addresseeId]);
        await invalidateDiscoverCacheForUsers([accepted.requesterId, accepted.addresseeId]);
        
        // PURE OPTIMIZATION: Non-blocking sync to Redis Edge Cache + Suggestion Pre-computation + Rolling Stats
        const { incrementConnectionStat } = await import('@/lib/connections/connection-stats-counters');
        Promise.allSettled([
            syncConnectionsToRedis(accepted.requesterId),
            syncConnectionsToRedis(accepted.addresseeId),
            inngest.send({ name: 'workspace/connections.sync_suggestions', data: { userId: accepted.requesterId } }),
            inngest.send({ name: 'workspace/connections.sync_suggestions', data: { userId: accepted.addresseeId } }),
            // Phase 6C: Rolling window stat counters
            incrementConnectionStat(accepted.requesterId, 'this_month'),
            incrementConnectionStat(accepted.addresseeId, 'this_month'),
            incrementConnectionStat(accepted.addresseeId, 'gained'),
        ]).catch(console.error);

        await revalidateConnectionsPaths();
        return { success: true };
    } catch (error) {
        console.error('Error accepting request:', error);
        return { success: false, error: 'Failed to accept request' };
    }
}

// ============================================================================
// REJECT CONNECTION REQUEST (Addressee only)
// ============================================================================

export async function rejectConnectionRequest(
    connectionId: string
): Promise<{ success: boolean; error?: string; undoUntil?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const rejectRate = await consumeRateLimit(`connections-reject:${user.id}`, 60, 60);
        if (!rejectRate.allowed) {
            return { success: false, error: 'Too many actions. Please wait and try again.' };
        }

        const [rejected] = await db
            .update(connections)
            .set({
                status: 'rejected',
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(connections.id, connectionId),
                    eq(connections.addresseeId, user.id),
                    eq(connections.status, 'pending')
                )
            )
            .returning({
                id: connections.id,
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
                updatedAt: connections.updatedAt,
            });

        if (!rejected) {
            return { success: false, error: 'Request not found' };
        }

        await queueCounterRefreshBestEffort([rejected.addresseeId]);
        await invalidateDiscoverCacheForUsers([rejected.requesterId, rejected.addresseeId]);
        await revalidateConnectionsPaths();
        return {
            success: true,
            undoUntil: new Date(new Date(rejected.updatedAt).getTime() + 15_000).toISOString(),
        };
    } catch (error) {
        console.error('Error rejecting request:', error);
        return { success: false, error: 'Failed to reject request' };
    }
}

export async function undoRejectConnectionRequest(
    connectionId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const undoRate = await consumeRateLimit(`connections-undo-reject:${user.id}`, 60, 60);
        if (!undoRate.allowed) {
            return { success: false, error: 'Too many actions. Please wait and try again.' };
        }

        const cutoff = new Date(Date.now() - 15_000);
        const [restored] = await db
            .update(connections)
            .set({
                status: 'pending',
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(connections.id, connectionId),
                    eq(connections.addresseeId, user.id),
                    eq(connections.status, 'rejected'),
                    sql`${connections.updatedAt} >= ${cutoff}`
                )
            )
            .returning({
                id: connections.id,
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
            });

        if (!restored) {
            return { success: false, error: 'Undo window expired' };
        }

        await queueCounterRefreshBestEffort([restored.addresseeId]);
        await invalidateDiscoverCacheForUsers([restored.requesterId, restored.addresseeId]);
        await revalidateConnectionsPaths();
        return { success: true };
    } catch (error) {
        console.error('Error undoing reject request:', error);
        return { success: false, error: 'Failed to undo reject' };
    }
}

// ============================================================================
// REMOVE CONNECTION (Either party can remove)
// ============================================================================

export async function removeConnection(
    connectionId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const removeRate = await consumeRateLimit(`connections-remove:${user.id}`, 60, 60);
        if (!removeRate.allowed) {
            return { success: false, error: 'Too many actions. Please wait and try again.' };
        }

        const removed = await db.transaction(async (tx) => {
            // PURE OPTIMIZATION: Removed read-before-write and advisory lock in favor of atomic UPDATE + RETURNING.
            const [updated] = await tx
                .update(connections)
                .set({
                    status: 'disconnected',
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(connections.id, connectionId),
                        eq(connections.status, 'accepted'),
                        or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id))
                    )
                )
                .returning({
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                });

            if (!updated) return null;

            await applyConnectionsCountDelta(tx, [updated.requesterId, updated.addresseeId], -1);
            return updated;
        });

        if (!removed) {
            return { success: false, error: 'Connection not found' };
        }

        await invalidateDiscoverCacheForUsers([removed.requesterId, removed.addresseeId]);

        // PURE OPTIMIZATION: Non-blocking sync to Redis Edge Cache (removes from set) + Rolling Stats
        const { decrementConnectionStat } = await import('@/lib/connections/connection-stats-counters');
        Promise.allSettled([
            syncConnectionsToRedis(removed.requesterId),
            syncConnectionsToRedis(removed.addresseeId),
            // Phase 6C: Decrement rolling window stat counters
            decrementConnectionStat(removed.requesterId, 'this_month'),
            decrementConnectionStat(removed.addresseeId, 'this_month'),
        ]).catch(console.error);

        await revalidateConnectionsPaths();
        return { success: true };
    } catch (error) {
        console.error('Error removing connection:', error);
        return { success: false, error: 'Failed to remove connection' };
    }
}

// ============================================================================
// GET CONNECTION STATS
// ============================================================================

export async function getConnectionStats(
    userId?: string
): Promise<ConnectionStats> {
    const user = await getAuthUser();
    const targetId = userId || user?.id;
    const canViewPrivateStats = !!user?.id && user.id === targetId;

    if (!targetId) {
        return {
            totalConnections: 0,
            pendingIncoming: 0,
            pendingSent: 0,
            connectionsThisMonth: 0,
            connectionsGained: 0,
        };
    }

    try {
        const dedupeKey = `connections:stats:${user?.id ?? 'anon'}:${targetId}:${canViewPrivateStats ? 'self' : 'public'}`;
        return await runInFlightDeduped(dedupeKey, async () => {
            // Phase 6C: Try Redis counters first for monthly/gained stats
            let redisStats: { connectionsThisMonth: number; connectionsGained: number } | null = null;
            if (canViewPrivateStats) {
                try {
                    const { getConnectionStatsFromRedis } = await import('@/lib/connections/connection-stats-counters');
                    redisStats = await getConnectionStatsFromRedis(targetId);
                } catch { /* Redis failure — fall through to DB */ }
            }

            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const startOfMonthIso = startOfMonth.toISOString();

            // If we got Redis stats, we can skip the expensive count(*) FILTER for monthly data
            const [profileCounter, stats] = await Promise.all([
                db
                    .select({ connectionsCount: profiles.connectionsCount })
                    .from(profiles)
                    .where(eq(profiles.id, targetId))
                    .limit(1),
                // Only query pending counts (cheap) — skip monthly aggregations if Redis has them
                redisStats
                    ? db.select({
                        pendingIncoming: sql<number>`count(*) FILTER (
                            WHERE ${connections.addresseeId} = ${targetId}
                            AND ${connections.status} = 'pending'
                        )`,
                        pendingSent: sql<number>`count(*) FILTER (
                            WHERE ${connections.requesterId} = ${targetId}
                            AND ${connections.status} = 'pending'
                        )`,
                    })
                        .from(connections)
                        .where(
                            or(
                                eq(connections.requesterId, targetId),
                                eq(connections.addresseeId, targetId)
                            )
                        )
                    : db.select({
                        pendingIncoming: sql<number>`count(*) FILTER (
                            WHERE ${connections.addresseeId} = ${targetId}
                            AND ${connections.status} = 'pending'
                        )`,
                        pendingSent: sql<number>`count(*) FILTER (
                            WHERE ${connections.requesterId} = ${targetId}
                            AND ${connections.status} = 'pending'
                        )`,
                        connectionsThisMonth: sql<number>`count(*) FILTER (
                            WHERE ${connections.status} = 'accepted'
                            AND (${connections.requesterId} = ${targetId} OR ${connections.addresseeId} = ${targetId})
                            AND ${connections.updatedAt} >= ${startOfMonthIso}
                        )`,
                        connectionsGained: sql<number>`count(*) FILTER (
                            WHERE ${connections.addresseeId} = ${targetId}
                            AND ${connections.status} = 'accepted'
                            AND ${connections.updatedAt} >= ${startOfMonthIso}
                        )`
                    })
                        .from(connections)
                        .where(
                            or(
                                eq(connections.requesterId, targetId),
                                eq(connections.addresseeId, targetId)
                            )
                        ),
            ]);

            return {
                totalConnections: Number(profileCounter[0]?.connectionsCount || 0),
                pendingIncoming: canViewPrivateStats ? Number(stats[0]?.pendingIncoming || 0) : 0,
                pendingSent: canViewPrivateStats ? Number(stats[0]?.pendingSent || 0) : 0,
                connectionsThisMonth: canViewPrivateStats
                    ? (redisStats?.connectionsThisMonth ?? Number((stats[0] as any)?.connectionsThisMonth || 0))
                    : 0,
                connectionsGained: canViewPrivateStats
                    ? (redisStats?.connectionsGained ?? Number((stats[0] as any)?.connectionsGained || 0))
                    : 0,
            };
        });
    } catch (error) {
        console.error('Error fetching connection stats:', error);
        // Return zeros if table doesn't exist or query fails
        return {
            totalConnections: 0,
            pendingIncoming: 0,
            pendingSent: 0,
            connectionsThisMonth: 0,
            connectionsGained: 0,
        };
    }
}

// ============================================================================
// GET SUGGESTED PEOPLE (Discovery)
// ============================================================================

export async function getSuggestedPeople(
    limit: number = 20,
    offset: number = 0
): Promise<{ profiles: SuggestedProfile[]; hasMore: boolean }> {
    const feed = await getConnectionsFeed({
        tab: 'discover',
        limit,
        cursor: `o:${Math.max(offset, 0)}`,
    });

    if (!feed.success) {
        return { profiles: [], hasMore: false };
    }

    const result: SuggestedProfile[] = (feed.items as DiscoverFeedItem[]).map((item) => ({
        id: item.id,
        username: item.username,
        fullName: item.fullName,
        avatarUrl: item.avatarUrl,
        headline: item.headline,
        location: item.location,
        connectionStatus: item.connectionStatus || 'none',
        canConnect: item.canConnect,
        mutualConnections: item.mutualConnections || 0,
        recommendationReason: item.recommendationReason,
        projects: item.projects || [],
    }));

    return { profiles: result, hasMore: feed.hasMore };
}

// ============================================================================
// GET PENDING REQUESTS (Incoming + Sent)
// ============================================================================

export async function getPendingRequests(
    limit: number = 20,
    offset: number = 0
) {
    const safeLimit = Math.max(1, Math.min(limit, 60));
    const safeOffset = Math.max(0, offset);
    const user = await getAuthUser();
    const dedupeKey = `connections:pending:${user?.id ?? 'anon'}:${safeLimit}:${safeOffset}`;

    return runInFlightDeduped(dedupeKey, async () => {
        if (!user) return { incoming: [], sent: [], hasMoreIncoming: false, hasMoreSent: false };

        if (safeOffset > 0) {
            const [incoming, sent] = await Promise.all([
                db
                    .select({
                        id: connections.id,
                        requesterId: connections.requesterId,
                        addresseeId: connections.addresseeId,
                        status: connections.status,
                        createdAt: connections.createdAt,
                        requesterUsername: profiles.username,
                        requesterFullName: profiles.fullName,
                        requesterAvatarUrl: profiles.avatarUrl,
                        requesterHeadline: profiles.headline,
                    })
                    .from(connections)
                    .innerJoin(profiles, eq(profiles.id, connections.requesterId))
                    .where(and(eq(connections.addresseeId, user.id), eq(connections.status, 'pending')))
                    .orderBy(desc(connections.createdAt))
                    .limit(safeLimit + 1)
                    .offset(safeOffset),
                db
                    .select({
                        id: connections.id,
                        requesterId: connections.requesterId,
                        addresseeId: connections.addresseeId,
                        status: connections.status,
                        createdAt: connections.createdAt,
                        addresseeUsername: profiles.username,
                        addresseeFullName: profiles.fullName,
                        addresseeAvatarUrl: profiles.avatarUrl,
                        addresseeHeadline: profiles.headline,
                    })
                    .from(connections)
                    .innerJoin(profiles, eq(profiles.id, connections.addresseeId))
                    .where(and(eq(connections.requesterId, user.id), eq(connections.status, 'pending')))
                    .orderBy(desc(connections.createdAt))
                    .limit(safeLimit + 1)
                    .offset(safeOffset),
            ]);

            return {
                incoming: incoming.slice(0, safeLimit),
                sent: sent.slice(0, safeLimit),
                hasMoreIncoming: incoming.length > safeLimit,
                hasMoreSent: sent.length > safeLimit,
            };
        }

        const cacheKey = `connections:inbox_cache:${user.id}:${safeLimit}`;
        if (safeOffset === 0 && redis) {
            try {
                const cached = await redis.get(cacheKey);
                if (cached) return cached as any;
            } catch (error) {
                console.error('Redis cache read error for inbox:', error);
            }
        }

        const [incomingFeed, sentFeed] = await Promise.all([
            getConnectionsFeed({ tab: 'requests_incoming', limit: safeLimit }),
            getConnectionsFeed({ tab: 'requests_sent', limit: safeLimit }),
        ]);

        if (!incomingFeed.success && !sentFeed.success) {
            return { incoming: [], sent: [], hasMoreIncoming: false, hasMoreSent: false };
        }

        const result = {
            incoming: incomingFeed.success
                ? (incomingFeed.items as RequestFeedItem[]).map((item) => ({
                    id: item.id,
                    requesterId: item.requesterId,
                    addresseeId: item.addresseeId,
                    status: item.status,
                    createdAt: item.createdAt,
                    requesterUsername: item.user?.username,
                    requesterFullName: item.user?.fullName,
                    requesterAvatarUrl: item.user?.avatarUrl,
                    requesterHeadline: item.user?.headline,
                }))
                : [],
            sent: sentFeed.success
                ? (sentFeed.items as RequestFeedItem[]).map((item) => ({
                    id: item.id,
                    requesterId: item.requesterId,
                    addresseeId: item.addresseeId,
                    status: item.status,
                    createdAt: item.createdAt,
                    addresseeUsername: item.user?.username,
                    addresseeFullName: item.user?.fullName,
                    addresseeAvatarUrl: item.user?.avatarUrl,
                    addresseeHeadline: item.user?.headline,
                }))
                : [],
            hasMoreIncoming: incomingFeed.success ? incomingFeed.hasMore : false,
            hasMoreSent: sentFeed.success ? sentFeed.hasMore : false,
        };

        if (safeOffset === 0 && redis) {
            try {
                await redis.set(cacheKey, JSON.stringify(result), { ex: 300 });
            } catch (error) {
                console.error('Redis cache write error for inbox:', error);
            }
        }

        return result;
    });
}

// ============================================================================
// GET ACCEPTED CONNECTIONS (Paginated)
// ============================================================================

export async function getAcceptedConnections(
    input: {
        limit?: number;
        cursor?: string; // cursor format: ISODate|connectionId
        search?: string;
        targetUserId?: string;
    } = {}
) {
    const {
        limit = 30,
        cursor,
        search,
        targetUserId,
    } = input;

    const user = await getAuthUser();
    const userIdToFetch = targetUserId || user?.id;

    if (!userIdToFetch) return { connections: [], hasMore: false, nextCursor: null };

    if (!targetUserId || targetUserId === user?.id) {
        const feed = await getConnectionsFeed({
            tab: 'network',
            limit,
            cursor,
            search,
        });

        if (!feed.success) {
            return { connections: [], hasMore: false, nextCursor: null };
        }

        return {
            connections: (feed.items as NetworkFeedItem[]).map((item) => ({
                id: item.id,
                requesterId: item.requesterId,
                addresseeId: item.addresseeId,
                status: item.status,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                otherUser: item.otherUser,
            })),
            hasMore: feed.hasMore,
            nextCursor: feed.nextCursor,
        };
    }

    if (targetUserId && targetUserId !== user?.id) {
        const targetProfile = await db
            .select({ visibility: profiles.visibility })
            .from(profiles)
            .where(eq(profiles.id, targetUserId))
            .limit(1);

        if (targetProfile.length === 0) {
            return { connections: [], hasMore: false, nextCursor: null };
        }

        const visibility = targetProfile[0].visibility || 'public';
        if (visibility === 'private') {
            return { connections: [], hasMore: false, nextCursor: null };
        }

        if (visibility === 'connections') {
            if (!user?.id) {
                return { connections: [], hasMore: false, nextCursor: null };
            }

            const relation = await db
                .select({ id: connections.id })
                .from(connections)
                .where(
                    and(
                        eq(connections.status, 'accepted'),
                        or(
                            and(eq(connections.requesterId, user.id), eq(connections.addresseeId, targetUserId)),
                            and(eq(connections.requesterId, targetUserId), eq(connections.addresseeId, user.id))
                        )
                    )
                )
                .limit(1);

            if (relation.length === 0) {
                return { connections: [], hasMore: false, nextCursor: null };
            }
        }
    }

    const searchPattern = search ? `%${search.trim().toLowerCase()}%` : undefined;
    const [cursorDateRaw, cursorIdRaw] = cursor ? cursor.split('|') : [];
    const cursorDate = cursorDateRaw ? new Date(cursorDateRaw) : undefined;
    const cursorConnectionId = cursorIdRaw || undefined;

    const conditions = [
        eq(connections.status, 'accepted'),
        or(
            eq(connections.requesterId, userIdToFetch),
            eq(connections.addresseeId, userIdToFetch)
        ),
    ];

    if (searchPattern) {
        conditions.push(
            sql`(${profiles.fullName} ILIKE ${searchPattern} OR ${profiles.username} ILIKE ${searchPattern})`
        );
    }

    if (cursorDate && cursorConnectionId) {
        conditions.push(sql`(
            ${connections.updatedAt} < ${cursorDate.toISOString()}
            OR (${connections.updatedAt} = ${cursorDate.toISOString()} AND ${connections.id} < ${cursorConnectionId})
        )`);
    } else if (cursorDate) {
        conditions.push(sql`${connections.updatedAt} < ${cursorDate.toISOString()}`);
    }

    // Join only the opposite party profile to avoid self-rows and simplify filtering.
    const results = await db
        .select({
            // Connection
            id: connections.id,
            requesterId: connections.requesterId,
            addresseeId: connections.addresseeId,
            status: connections.status,
            createdAt: connections.createdAt,
            updatedAt: connections.updatedAt,
            // Profile (Other User)
            profileId: profiles.id,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
            headline: profiles.headline,
        })
        .from(connections)
        .innerJoin(
            profiles,
            or(
                and(
                    eq(connections.requesterId, userIdToFetch),
                    eq(connections.addresseeId, profiles.id)
                ),
                and(
                    eq(connections.addresseeId, userIdToFetch),
                    eq(connections.requesterId, profiles.id)
                )
            )
        )
        .where(and(...conditions))
        .orderBy(desc(connections.updatedAt), desc(connections.id))
        .limit(limit + 1);

    const hasMore = results.length > limit;
    const connectionList = results.slice(0, limit);

    const nextCursor = hasMore && connectionList.length > 0
        ? `${connectionList[connectionList.length - 1].updatedAt.toISOString()}|${connectionList[connectionList.length - 1].id}`
        : null;

    // Map to expected structure
    const enrichedConnections = connectionList.map(row => ({
        id: row.id,
        requesterId: row.requesterId,
        addresseeId: row.addresseeId,
        status: row.status as typeof connections.$inferSelect.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        otherUser: {
            id: row.profileId,
            username: row.username,
            fullName: row.fullName,
            avatarUrl: row.avatarUrl,
            headline: row.headline
        }
    }));

    return { connections: enrichedConnections, hasMore, nextCursor };
}

// ============================================================================
// SEARCH ACCEPTED CONNECTIONS
// ============================================================================

export async function searchConnections(query: string, limit: number = 20) {
    const user = await getAuthUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    if (!query.trim()) return { success: true, connections: [] };

    try {
        const feed = await getConnectionsFeed({
            tab: 'network',
            limit,
            search: query,
        });

        if (!feed.success) {
            return { success: false, error: feed.error || 'Failed to search connections' };
        }

        const foundConnections = (feed.items as NetworkFeedItem[]).map((item) => ({
            connectionId: item.id,
            userId: item.otherUser?.id,
            username: item.otherUser?.username,
            fullName: item.otherUser?.fullName,
            avatarUrl: item.otherUser?.avatarUrl,
            headline: item.otherUser?.headline,
        }));

        return { success: true, connections: foundConnections };
    } catch (error) {
        console.error('Error searching connections:', error);
        return { success: false, error: 'Failed to search connections' };
    }
}
// ============================================================================
// CHECK CONNECTION STATUS
// ============================================================================

// ============================================================================
// CHECK CONNECTION STATUS
// ============================================================================

export async function checkConnectionStatus(
    otherUserId: string
): Promise<{
    success: boolean;
    status?: 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'blocked' | 'open';
    connectionId?: string;
    isIncomingRequest?: boolean;
    isPendingSent?: boolean;
    hasActiveApplication?: boolean;
    isApplicant?: boolean;
    isCreator?: boolean;
    activeApplicationId?: string;
    activeApplicationStatus?: 'pending' | 'accepted' | 'rejected';
    activeProjectId?: string;
    error?: string;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const [privacy, activeApplications] = await Promise.all([
            resolvePrivacyRelationship(user.id, otherUserId),
            db
                .select({
                    id: roleApplications.id,
                    applicantId: roleApplications.applicantId,
                    creatorId: roleApplications.creatorId,
                    status: roleApplications.status,
                    projectId: roleApplications.projectId,
                    updatedAt: roleApplications.updatedAt,
                })
                .from(roleApplications)
                .where(
                    and(
                        or(
                            and(eq(roleApplications.applicantId, user.id), eq(roleApplications.creatorId, otherUserId)),
                            and(eq(roleApplications.applicantId, otherUserId), eq(roleApplications.creatorId, user.id))
                        )
                    )
                )
                .orderBy(desc(roleApplications.updatedAt), desc(roleApplications.id))
                .limit(1)
        ]);
        const activeApp = activeApplications[0];
        if (!privacy) {
            return { success: false, error: 'User not found' };
        }

        // RULE: If there is an active application, the gate is OPEN
        if (activeApp) {
            const appStatus = activeApp.status as 'pending' | 'accepted' | 'rejected';
            const isPending = appStatus === 'pending';
            const updatedAtMs = new Date(activeApp.updatedAt).getTime();
            const isFreshTerminal =
                Number.isFinite(updatedAtMs) &&
                Date.now() - updatedAtMs <= APPLICATION_BANNER_HIDE_AFTER_MS;

            // Only override the standard status with the application gate if it is tangibly active or fresh.
            if (isPending || isFreshTerminal) {
                return {
                    success: true,
                    status: 'open', // Allows messaging system to operate
                    connectionId: privacy.latestConnectionId ?? undefined,
                    hasActiveApplication: true,
                    activeApplicationId: activeApp.id,
                    activeApplicationStatus: appStatus,
                    activeProjectId: activeApp.projectId, // Mapped correctly by Drizzle
                    isApplicant: activeApp.applicantId === user.id,
                    isCreator: activeApp.creatorId === user.id,
                    // PURE OPTIMIZATION: Crucially append connection booleans so profile UI doesn't visually drop existing connection requests!
                    isIncomingRequest: privacy.connectionState === 'pending_incoming',
                    isPendingSent: privacy.connectionState === 'pending_outgoing'
                };
            }
        }

        if (privacy.blockedByViewer || privacy.blockedByTarget) {
            return { success: true, status: 'blocked', connectionId: privacy.latestConnectionId ?? undefined };
        }

        if (privacy.connectionState === 'connected') {
            return { success: true, status: 'connected', connectionId: privacy.latestConnectionId ?? undefined };
        }

        if (privacy.connectionState === 'pending_outgoing') {
            if (privacy.canSendMessage) {
                return {
                    success: true,
                    status: 'open',
                    connectionId: privacy.latestConnectionId ?? undefined,
                    isPendingSent: true,
                };
            }
            return { success: true, status: 'pending_sent', connectionId: privacy.latestConnectionId ?? undefined };
        }

        if (privacy.connectionState === 'pending_incoming') {
            return {
                success: true,
                status: 'open',
                connectionId: privacy.latestConnectionId ?? undefined,
                isIncomingRequest: true,
            };
        }

        if (privacy.canSendMessage) {
            return { success: true, status: 'open' };
        }

        return { success: true, status: 'none' };
    } catch (error) {
        console.error('Error checking connection status:', error);
        return { success: false, error: 'Failed to check connection status' };
    }
}
