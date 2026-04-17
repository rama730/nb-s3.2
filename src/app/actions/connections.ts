'use server';

import { db } from '@/lib/db';
import { isMissingRelationError } from '@/lib/db/errors';
import { connectionSuggestionDismissals, connectionSuggestions, connections, profiles, projects, roleApplications } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq, and, or, desc, asc, sql, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { IdempotencyConflictError, runIdempotent } from '@/lib/security/idempotency';
import {
    CONNECTION_REQUEST_HISTORY_STATUSES,
    isConnectionHistoryStatus,
    type ConnectionRequestHistoryStatus,
} from '@/lib/applications/status';
import { runInFlightDeduped } from '@/lib/async/inflight-dedupe';
import { APPLICATION_BANNER_HIDE_AFTER_MS } from '@/lib/chat/banner-lifecycle';
import { cacheData, getCachedData, redis } from '@/lib/redis';
import { queueCounterRefreshBestEffort } from '@/lib/workspace/counter-buffer';
import { recordPrivacyReadEvents } from '@/lib/privacy/audit';
import { buildViewerScopedProfileView } from '@/lib/privacy/profile-views';
import { resolvePrivacyRelationship, resolvePrivacyRelationships } from '@/lib/privacy/resolver';
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
    connectionStatus: 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'blocked';
    connectionId?: string;
    canConnect?: boolean;
    profileVisibility?: 'public' | 'connections' | 'private';
    isLockedProfile?: boolean;
    mutualConnections?: number;
    recommendationReason?: string;
    projects?: Array<{ id: string; title: string; status: string | null }>;
    availabilityStatus?: 'available' | 'busy' | 'offline' | 'focusing' | null;
    experienceLevel?: 'student' | 'junior' | 'mid' | 'senior' | 'lead' | 'founder' | null;
    skills?: string[];
    interests?: string[];
    tags?: string[];
    openTo?: string[];
    messagePrivacy?: 'everyone' | 'connections' | null;
    canSendMessage?: boolean;
    lastActiveAt?: string | null;
    scoringBreakdown?: { overlap: number; mutual: number; recency: number; completeness: number };
}

export type ConnectionsFeedTab = 'network' | 'requests_incoming' | 'requests_sent' | 'discover';

export interface DiscoverFilters {
    available?: boolean;
    seniorPlus?: boolean;
    hasMutuals?: boolean;
    hasSharedProjects?: boolean;
}

export interface HistoryFilters {
    status?: ConnectionRequestHistoryStatus;
    direction?: 'sent' | 'received';
    dateFrom?: string;
    dateTo?: string;
}

export interface ConnectionsFeedInput {
    tab: ConnectionsFeedTab;
    limit?: number;
    cursor?: string;
    search?: string;
    sortBy?: 'recent' | 'name' | 'oldest';
    filters?: DiscoverFilters;
    historyFilters?: HistoryFilters;
    requestSortBy?: 'recent' | 'mutual' | 'oldest';
}

const CONNECTION_REJECTION_REASONS = ['not_interested', 'dont_know', 'spam', 'other'] as const;
const MAX_REQUESTS_LIMIT = 1000;
export type ConnectionRejectionReason = (typeof CONNECTION_REJECTION_REASONS)[number];

interface ConnectionsFeedStats {
    totalConnections: number;
    pendingIncoming: number;
    pendingSent: number;
}

function isPresent<T>(value: T | null | undefined): value is T {
    return value !== null && value !== undefined;
}

async function countPendingIncomingRequests(userId: string): Promise<number> {
    const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(connections)
        .where(and(eq(connections.addresseeId, userId), eq(connections.status, 'pending')));

    return Number(row?.count ?? 0);
}

async function applySuggestedProfilePrivacy(
    viewerId: string,
    items: SuggestedProfile[],
): Promise<SuggestedProfile[]> {
    const relationships = await resolvePrivacyRelationships(viewerId, items.map((item) => item.id));

    return items.map((item, index) => {
        const relationship = relationships.get(item.id) ?? null;
        const scoped = buildViewerScopedProfileView({
            profile: item as unknown as Record<string, unknown> & { id: string },
            relationship,
            isOwner: viewerId === item.id,
        });
        const locked = !!relationship && !relationship.canViewProfile;

        if (!locked) {
            return {
                ...item,
                username: scoped?.username ?? item.username,
                fullName: scoped?.fullName ?? item.fullName,
                avatarUrl: scoped?.avatarUrl ?? item.avatarUrl,
                headline: scoped?.headline ?? item.headline,
                location: scoped?.location ?? item.location,
                skills: scoped?.skills ?? item.skills ?? [],
                interests: scoped?.interests ?? item.interests ?? [],
                openTo: scoped?.openTo ?? item.openTo ?? [],
                lastActiveAt: typeof scoped?.lastActiveAt === 'string'
                    ? scoped.lastActiveAt
                    : scoped?.lastActiveAt instanceof Date
                        ? scoped.lastActiveAt.toISOString()
                        : item.lastActiveAt ?? null,
                messagePrivacy: (scoped?.messagePrivacy as SuggestedProfile['messagePrivacy']) ?? item.messagePrivacy ?? null,
                canSendMessage: relationship?.canSendMessage ?? item.canSendMessage,
                canConnect: relationship?.canSendConnectionRequest ?? item.canConnect,
                isLockedProfile: false,
            };
        }

        return {
            ...item,
            username: scoped?.username ?? null,
            fullName: scoped?.fullName ?? null,
            avatarUrl: scoped?.avatarUrl ?? null,
            headline: scoped?.headline ?? null,
            location: scoped?.location ?? null,
            projects: [],
            skills: scoped?.skills ?? [],
            interests: scoped?.interests ?? [],
            openTo: scoped?.openTo ?? [],
            lastActiveAt: typeof scoped?.lastActiveAt === 'string'
                ? scoped.lastActiveAt
                : scoped?.lastActiveAt instanceof Date
                    ? scoped.lastActiveAt.toISOString()
                    : null,
            messagePrivacy: (scoped?.messagePrivacy as SuggestedProfile['messagePrivacy']) ?? null,
            canSendMessage: relationship?.canSendMessage ?? false,
            canConnect: relationship?.canSendConnectionRequest ?? false,
            isLockedProfile: locked,
        };
    });
}

type PendingRequestsResult = {
    incoming: Array<{
        id: string;
        requesterId: string;
        addresseeId: string;
        status: string;
        createdAt: Date;
        requesterUsername?: string | null;
        requesterFullName?: string | null;
        requesterAvatarUrl?: string | null;
        requesterHeadline?: string | null;
    }>;
    sent: Array<{
        id: string;
        requesterId: string;
        addresseeId: string;
        status: string;
        createdAt: Date;
        addresseeUsername?: string | null;
        addresseeFullName?: string | null;
        addresseeAvatarUrl?: string | null;
        addresseeHeadline?: string | null;
    }>;
    hasMoreIncoming: boolean;
    hasMoreSent: boolean;
};

type ConnectionStatsQueryRow = {
    pendingIncoming: number;
    pendingSent: number;
    connectionsThisMonth?: number;
    connectionsGained?: number;
};

type DiscoverFeedItem = {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
    headline: string | null;
    location: string | null;
    connectionStatus: SuggestedProfile['connectionStatus'];
    connectionId?: string;
    canConnect: boolean;
    mutualConnections?: number;
    recommendationReason?: string;
    projects?: SuggestedProfile['projects'];
    openTo?: SuggestedProfile['openTo'];
    messagePrivacy?: SuggestedProfile['messagePrivacy'];
    canSendMessage?: boolean;
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



// ============================================================================
// 2A: lastActiveAt debounce mechanism
// ============================================================================

async function touchLastActive(userId: string) {
    try {
        if (!redis) return;
        const key = `last_active:${userId}`;
        const alreadySet = await redis.get(key);
        if (alreadySet) return;
        await redis.set(key, '1', { ex: 300 });
        await db
            .update(profiles)
            .set({ lastActiveAt: new Date() })
            .where(eq(profiles.id, userId));
    } catch (e) {
        console.error('[touchLastActive] Error:', e);
    }
}

// ============================================================================
// 2D: Cache viewerProjectIds per-session
// ============================================================================

async function getCachedViewerProjectIds(userId: string, forceQuery: boolean = false): Promise<string[]> {
    if (redis) {
        try {
            const cached = await redis.get(`viewer:projects:${userId}`);
            if (cached) {
                try {
                    return JSON.parse(cached as string);
                } catch (error) {
                    console.warn('[getCachedViewerProjectIds] Invalid cache payload', {
                        userId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        } catch { /* ignore */ }
    }
    if (!forceQuery) return [];
    const rows = await db.select({ id: projects.id }).from(projects).where(eq(projects.ownerId, userId)).limit(50);
    const ids = rows.map(r => r.id);
    if (redis) {
        try {
            await redis.set(`viewer:projects:${userId}`, JSON.stringify(ids), { ex: 300 });
        } catch { /* ignore */ }
    }
    return ids;
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
const CONNECTIONS_DATE_CURSOR_PREFIX = 'd:';
const CONNECTIONS_NAME_CURSOR_PREFIX = 'n:';
const CONNECTIONS_MUTUAL_CURSOR_PREFIX = 'm:';

type DateConnectionsCursor = {
    kind: 'date';
    sortMode: 'recent' | 'oldest';
    updatedAt: string;
    id: string;
};

type NameConnectionsCursor = {
    kind: 'name';
    sortMode: 'name';
    fullName: string | null;
    username: string | null;
    id: string;
};

type MutualConnectionsCursor = {
    kind: 'mutual';
    sortMode: 'mutual';
    mutualCount: number;
    createdAt: string;
    id: string;
};

type ParsedConnectionsCursor = DateConnectionsCursor | NameConnectionsCursor | MutualConnectionsCursor;

function encodeConnectionsCursor(updatedAt: Date, id: string, sortMode: 'recent' | 'oldest') {
    return `${CONNECTIONS_DATE_CURSOR_PREFIX}${sortMode}${CONNECTIONS_CURSOR_DELIMITER}${updatedAt.toISOString()}${CONNECTIONS_CURSOR_DELIMITER}${id}`;
}

function encodeConnectionsNameCursor(fullName: string | null, username: string | null, id: string) {
    const payload = Buffer.from(JSON.stringify({
        sortMode: 'name' as const,
        fullName: fullName ?? null,
        username: username ?? null,
        id,
    }), 'utf8').toString('base64url');

    return `${CONNECTIONS_NAME_CURSOR_PREFIX}${payload}`;
}

function encodeConnectionsMutualCursor(mutualCount: number, createdAt: Date, id: string) {
    const payload = Buffer.from(JSON.stringify({
        sortMode: 'mutual' as const,
        mutualCount,
        createdAt: createdAt.toISOString(),
        id,
    }), 'utf8').toString('base64url');

    return `${CONNECTIONS_MUTUAL_CURSOR_PREFIX}${payload}`;
}

function parseConnectionsCursor(cursor?: string): ParsedConnectionsCursor | null {
    if (!cursor) return null;

    if (cursor.startsWith(CONNECTIONS_MUTUAL_CURSOR_PREFIX)) {
        try {
            const payload = Buffer.from(cursor.slice(CONNECTIONS_MUTUAL_CURSOR_PREFIX.length), 'base64url').toString('utf8');
            const parsed = JSON.parse(payload) as {
                sortMode?: 'mutual';
                mutualCount?: number;
                createdAt?: string;
                id?: string;
            };

            if (!parsed.id || typeof parsed.mutualCount !== 'number' || !Number.isFinite(parsed.mutualCount) || !parsed.createdAt) {
                return null;
            }

            const parsedDate = new Date(parsed.createdAt);
            if (Number.isNaN(parsedDate.getTime())) return null;

            return {
                kind: 'mutual',
                sortMode: 'mutual',
                mutualCount: parsed.mutualCount,
                createdAt: parsedDate.toISOString(),
                id: parsed.id,
            };
        } catch {
            return null;
        }
    }

    if (cursor.startsWith(CONNECTIONS_NAME_CURSOR_PREFIX)) {
        try {
            const payload = Buffer.from(cursor.slice(CONNECTIONS_NAME_CURSOR_PREFIX.length), 'base64url').toString('utf8');
            const parsed = JSON.parse(payload) as {
                sortMode?: 'name';
                fullName?: string | null;
                username?: string | null;
                id?: string;
            };

            if (!parsed.id) return null;

            return {
                kind: 'name',
                sortMode: 'name',
                fullName: typeof parsed.fullName === 'string' ? parsed.fullName : null,
                username: typeof parsed.username === 'string' ? parsed.username : null,
                id: parsed.id,
            };
        } catch {
            return null;
        }
    }

    const rawCursor = cursor.startsWith(CONNECTIONS_DATE_CURSOR_PREFIX)
        ? cursor.slice(CONNECTIONS_DATE_CURSOR_PREFIX.length)
        : cursor;
    const parts = rawCursor.split(CONNECTIONS_CURSOR_DELIMITER);
    const [sortModeRaw, dateRaw, id] = parts.length === 3
        ? parts
        : [null, parts[0], parts[1]];
    if (!dateRaw || !id) return null;
    const parsedDate = new Date(dateRaw);
    if (Number.isNaN(parsedDate.getTime())) return null;
    const sortMode = sortModeRaw === 'recent' || sortModeRaw === 'oldest' ? sortModeRaw : 'recent';
    return { kind: 'date', sortMode, updatedAt: parsedDate.toISOString(), id };
}

function buildNullableCursorEquals(
    column: typeof profiles.fullName | typeof profiles.username,
    value: string | null,
) {
    return value === null ? sql`${column} IS NULL` : sql`${column} = ${value}`;
}

function compareIncomingRequestsByMutual(
    a: { mutualCount?: number; createdAt: Date; id: string },
    b: { mutualCount?: number; createdAt: Date; id: string },
) {
    const mutualDiff = (b.mutualCount ?? 0) - (a.mutualCount ?? 0);
    if (mutualDiff !== 0) return mutualDiff;

    const createdAtDiff = b.createdAt.getTime() - a.createdAt.getTime();
    if (createdAtDiff !== 0) return createdAtDiff;

    return b.id.localeCompare(a.id);
}

function buildNullableAscendingAfterCursor(
    column: typeof profiles.fullName | typeof profiles.username,
    value: string | null,
) {
    if (value === null) {
        return sql`FALSE`;
    }

    return sql`(${column} IS NULL OR ${column} > ${value})`;
}

function buildNameSortedConnectionsCursorCondition(cursor: NameConnectionsCursor) {
    const fullNameEquals = buildNullableCursorEquals(profiles.fullName, cursor.fullName);
    const fullNameAfter = buildNullableAscendingAfterCursor(profiles.fullName, cursor.fullName);
    const usernameEquals = buildNullableCursorEquals(profiles.username, cursor.username);
    const usernameAfter = buildNullableAscendingAfterCursor(profiles.username, cursor.username);

    return sql`(
        ${fullNameAfter}
        OR (${fullNameEquals} AND ${usernameAfter})
        OR (${fullNameEquals} AND ${usernameEquals} AND ${connections.id} < ${cursor.id})
    )`;
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
    // H5: Clamp search length to prevent expensive DB queries
    const normalized = (search || '').trim().slice(0, 200);
    return normalized.length > 0 ? normalized : undefined;
}

function getErrorCode(error: unknown) {
    if (!error || typeof error !== "object" || !("code" in error)) {
        return null;
    }
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
}

const DISCOVER_CACHE_KEY_PREFIX = 'connections:feed:discover:v2';
let hasConnectionSuggestionsTable: boolean | null = null;

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
    const redisClient = redis;
    if (!redisClient) return;
    try {
        const discoverPattern = `discover:profile:${userId}:*`;
        const inboxPattern = `connections:inbox_cache:${userId}:*`;
        const patterns = [discoverPattern, inboxPattern];
        
        for (const pattern of patterns) {
            let cursor = "0";
            do {
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
                        await Promise.all(batch.map((key) => redisClient.unlink(key)));
                    }
                }
            } while (cursor !== '0');
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
    const redisClient = redis;
    if (!redisClient) return;
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
        
        const pipeline = redisClient.pipeline();
        pipeline.del(key);
        if (otherIds.length > 0) {
            for (const otherId of otherIds) {
                pipeline.sadd(key, otherId);
            }
            pipeline.expire(key, 86400); // 24h cache duration
        }
        await pipeline.exec();
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
    } catch (error) {
        console.error('Redis isConnected check failed:', error);
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

    // 2A: Fire-and-forget lastActiveAt debounce
    touchLastActive(user.id).catch(() => {});

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
    const rawParsedCursor = parseConnectionsCursor(input.cursor);

    if (tab === 'network') {
        const sortBy = input.sortBy ?? 'recent';
        const parsedCursor = rawParsedCursor?.sortMode === sortBy ? rawParsedCursor : null;
        const conditions = [
            eq(connections.status, 'accepted'),
            or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id)),
        ];

        // 2J: Trigram search with ILIKE fallback
        if (searchPattern && safeSearch) {
            conditions.push(
                sql`(
                    similarity(${profiles.fullName}, ${safeSearch}) > 0.3
                    OR similarity(${profiles.username}, ${safeSearch}) > 0.3
                    OR ${profiles.fullName} ILIKE ${searchPattern}
                    OR ${profiles.username} ILIKE ${searchPattern}
                )`,
            );
        }

        if (parsedCursor) {
            if (sortBy === 'name' && parsedCursor.kind === 'name') {
                conditions.push(buildNameSortedConnectionsCursorCondition(parsedCursor));
            } else if (sortBy === 'oldest' && parsedCursor.kind === 'date') {
                conditions.push(sql`(
                    ${connections.updatedAt} > ${parsedCursor.updatedAt}
                    OR (${connections.updatedAt} = ${parsedCursor.updatedAt} AND ${connections.id} > ${parsedCursor.id})
                )`);
            } else if (sortBy !== 'name' && parsedCursor.kind === 'date') {
                conditions.push(sql`(
                    ${connections.updatedAt} < ${parsedCursor.updatedAt}
                    OR (${connections.updatedAt} = ${parsedCursor.updatedAt} AND ${connections.id} < ${parsedCursor.id})
                )`);
            }
        }

        // 2I: Server-side sorting
        const orderClauses = sortBy === 'name'
            ? [
                sql`${profiles.fullName} ASC NULLS LAST`,
                sql`${profiles.username} ASC NULLS LAST`,
                desc(connections.id),
            ]
            : sortBy === 'oldest'
                ? [asc(connections.updatedAt), asc(connections.id)]
                : [desc(connections.updatedAt), desc(connections.id)];

        // 2K: Use SQL DISTINCT ON to remove duplicates at query level
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
                skills: profiles.skills,
                interests: profiles.interests,
                bio: profiles.bio,
                messagePrivacy: profiles.messagePrivacy,
                openTo: profiles.openTo,
                lastActiveAt: profiles.lastActiveAt,
                tags: connections.tags,
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
            .orderBy(...orderClauses)
            .limit(limit + 1);

        const hasMore = rows.length > limit;

        // 2S: Connection active status — read from Redis Set
        let activeUserIds: Set<string> | null = null;
        if (redis) {
            try {
                const activeMembers = await redis.smembers(`active_connections:${user.id}`);
                if (activeMembers && activeMembers.length > 0) {
                    activeUserIds = new Set(activeMembers);
                }
            } catch { /* ignore */ }
        }

        // 2K: Removed client-side seenNetworkUserIds dedup — uniqueness ensured by query join
        const items = rows.slice(0, limit).map((row) => ({
            id: row.id,
            type: 'network' as const,
            requesterId: row.requesterId,
            addresseeId: row.addresseeId,
            status: row.status,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            tags: (row.tags as string[] | null) ?? [],
            isActive: activeUserIds?.has(row.profileId) ?? false,
            otherUser: {
                id: row.profileId,
                username: row.username,
                fullName: row.fullName,
                avatarUrl: row.avatarUrl,
                headline: row.headline,
                location: row.location,
                skills: (row.skills as string[] | null) ?? [],
                interests: (row.interests as string[] | null) ?? [],
                bio: (row.bio as string | null) ?? null,
                openTo: (row.openTo as string[] | null) ?? [],
                messagePrivacy: (row.messagePrivacy || 'connections') as SuggestedProfile['messagePrivacy'],
                canSendMessage: true,
                lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
            },
        }));
        const networkRelationships = await resolvePrivacyRelationships(
            user.id,
            items.map((item) => item.otherUser.id).filter(Boolean),
        );
        const visibleItems = items.map((item) => {
            const relationship = networkRelationships.get(item.otherUser.id) ?? null;
            const scoped = buildViewerScopedProfileView({
                profile: {
                    id: item.otherUser.id,
                    username: item.otherUser.username,
                    fullName: item.otherUser.fullName,
                    avatarUrl: item.otherUser.avatarUrl,
                    headline: item.otherUser.headline,
                    location: item.otherUser.location,
                    skills: item.otherUser.skills,
                    interests: item.otherUser.interests,
                    bio: item.otherUser.bio,
                    openTo: item.otherUser.openTo,
                    messagePrivacy: item.otherUser.messagePrivacy,
                    lastActiveAt: item.otherUser.lastActiveAt,
                },
                relationship,
                isOwner: false,
            });

            return {
                ...item,
                otherUser: {
                    ...item.otherUser,
                    username: scoped?.username ?? null,
                    fullName: scoped?.fullName ?? null,
                    avatarUrl: scoped?.avatarUrl ?? null,
                    headline: scoped?.headline ?? null,
                    location: scoped?.location ?? null,
                    skills: scoped?.skills ?? [],
                    interests: scoped?.interests ?? [],
                    bio: scoped?.bio ?? null,
                    openTo: scoped?.openTo ?? [],
                    messagePrivacy: (scoped?.messagePrivacy as SuggestedProfile['messagePrivacy']) ?? null,
                    canSendMessage: relationship?.canSendMessage ?? false,
                    lastActiveAt: typeof scoped?.lastActiveAt === 'string'
                        ? scoped.lastActiveAt
                        : scoped?.lastActiveAt instanceof Date
                            ? scoped.lastActiveAt.toISOString()
                            : null,
                },
            };
        });
        await recordPrivacyReadEvents({
            subjectUserIds: visibleItems.map((item) => item.otherUser.id),
            viewerUserId: user.id,
            eventType: 'network_profile_served',
            route: 'connections.network',
            metadata: { count: visibleItems.length },
        });

        // 1F: Merge monthly stats into network feed response
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        let connectionsThisMonth = 0;
        let connectionsGained = 0;
        try {
            const [monthlyStats] = await db
                .select({
                    thisMonth: sql<number>`COUNT(*) FILTER (WHERE ${connections.status} = 'accepted' AND ${connections.updatedAt} >= ${monthStart})`,
                    lastMonth: sql<number>`COUNT(*) FILTER (WHERE ${connections.status} = 'accepted' AND ${connections.updatedAt} >= ${prevMonthStart} AND ${connections.updatedAt} < ${monthStart})`,
                })
                .from(connections)
                .where(or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id)));
            connectionsThisMonth = Number(monthlyStats?.thisMonth ?? 0);
            connectionsGained = Math.max(0, connectionsThisMonth - Number(monthlyStats?.lastMonth ?? 0));
        } catch { /* non-critical */ }

        const enrichedStats = { ...stats, connectionsThisMonth, connectionsGained };

        const nextCursor = hasMore && visibleItems.length > 0
            ? sortBy === 'name'
                ? encodeConnectionsNameCursor(
                    visibleItems[visibleItems.length - 1].otherUser.fullName,
                    visibleItems[visibleItems.length - 1].otherUser.username,
                    visibleItems[visibleItems.length - 1].id,
                )
                : encodeConnectionsCursor(visibleItems[visibleItems.length - 1].updatedAt, visibleItems[visibleItems.length - 1].id, sortBy)
            : null;

        return { success: true as const, items: visibleItems, hasMore, nextCursor, stats: enrichedStats };
    }

    if (tab === 'requests_incoming' || tab === 'requests_sent') {
        const isIncoming = tab === 'requests_incoming';
        const isMutualRequestsSort = isIncoming && input.requestSortBy === 'mutual';
        const mutualCursor = isMutualRequestsSort && rawParsedCursor?.kind === 'mutual' ? rawParsedCursor : null;
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
        if (!isMutualRequestsSort && rawParsedCursor?.kind === 'date') {
            conditions.push(sql`(
                ${connections.createdAt} < ${rawParsedCursor.updatedAt}
                OR (${connections.createdAt} = ${rawParsedCursor.updatedAt} AND ${connections.id} < ${rawParsedCursor.id})
            )`);
        }

        // 2B: Add message column to request SELECT
        const requestsQuery = db
            .select({
                id: connections.id,
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
                status: connections.status,
                createdAt: connections.createdAt,
                updatedAt: connections.updatedAt,
                message: connections.message,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                headline: profiles.headline,
                location: profiles.location,
                skills: profiles.skills,
                interests: profiles.interests,
                openTo: profiles.openTo,
                messagePrivacy: profiles.messagePrivacy,
                lastActiveAt: profiles.lastActiveAt,
            })
            .from(connections)
            .innerJoin(profiles, profileJoinCondition)
            .where(and(...conditions))
            .orderBy(
                // 1K: Configurable request sorting
                input.requestSortBy === 'oldest' ? asc(connections.createdAt) : desc(connections.createdAt),
                input.requestSortBy === 'oldest' ? asc(connections.id) : desc(connections.id),
            );

        const effectiveLimit = Math.min(limit + 1, MAX_REQUESTS_LIMIT);
        const rows = await requestsQuery.limit(effectiveLimit);

        const rawHasMore = rows.length > limit;

        // 2L: Smart ordering for incoming requests — read mutual counts from Redis
        let mutualCountsMap: Record<string, string> | null = null;
        if (isIncoming && redis) {
            try {
                const hash = await redis.hgetall(`discover:mutuals:${user.id}`);
                if (hash && Object.keys(hash).length > 0) {
                    mutualCountsMap = hash as Record<string, string>;
                }
            } catch { /* ignore */ }
        }

        const candidateRows = isMutualRequestsSort ? rows : rows.slice(0, limit + 10);
        const seenRequestUserIds = new Set<string>();
            const dedupedItems = candidateRows.reduce<Array<{
                id: string;
                type: ConnectionsFeedTab;
                requesterId: string;
                addresseeId: string;
            status: string;
            createdAt: Date;
            updatedAt: Date;
            message?: string | null;
            mutualCount?: number;
                user: {
                    id: string;
                    username: string | null;
                    fullName: string | null;
                    avatarUrl: string | null;
                    headline: string | null;
                    location: string | null;
                    skills?: string[];
                    interests?: string[];
                    openTo?: string[];
                    messagePrivacy?: SuggestedProfile['messagePrivacy'];
                    canSendMessage?: boolean;
                    lastActiveAt?: string | null;
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
                message: row.message,
                mutualCount: isIncoming && mutualCountsMap ? Number(mutualCountsMap[userId] || 0) : undefined,
                user: {
                    id: isIncoming ? row.requesterId : row.addresseeId,
                    username: row.username,
                    fullName: row.fullName,
                    avatarUrl: row.avatarUrl,
                    headline: row.headline,
                    location: row.location,
                    skills: (row.skills as string[] | null) ?? [],
                    interests: (row.interests as string[] | null) ?? [],
                    openTo: (row.openTo as string[] | null) ?? [],
                    messagePrivacy: (row.messagePrivacy || 'connections') as SuggestedProfile['messagePrivacy'],
                    canSendMessage: (row.messagePrivacy || 'connections') === 'everyone',
                    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
                },
            });
            return acc;
        }, []);

        if (isMutualRequestsSort) {
            const sortedItems = [...dedupedItems].sort(compareIncomingRequestsByMutual);
            const pagedItems = mutualCursor
                ? sortedItems.filter((item) => compareIncomingRequestsByMutual(item, {
                    mutualCount: mutualCursor.mutualCount,
                    createdAt: new Date(mutualCursor.createdAt),
                    id: mutualCursor.id,
                }) > 0)
                : sortedItems;
            const items = pagedItems.slice(0, limit);
            const hasMore = pagedItems.length > limit;
            const nextCursor = hasMore && items.length > 0
                ? encodeConnectionsMutualCursor(
                    items[items.length - 1].mutualCount ?? 0,
                    items[items.length - 1].createdAt,
                    items[items.length - 1].id,
                )
                : null;
            return { success: true as const, items, hasMore, nextCursor, stats };
        }

        const items = dedupedItems.slice(0, limit);
        const nextCursor = rawHasMore && items.length > 0
            ? encodeConnectionsCursor(
                items[items.length - 1].createdAt,
                items[items.length - 1].id,
                input.requestSortBy === 'oldest' ? 'oldest' : 'recent',
            )
            : null;

        return { success: true as const, items, hasMore: rawHasMore, nextCursor, stats };
    }

    // discover
    // 2F: Keyset cursor for discover — offset cursors use `o:`, pre-computed score cursors use `s:`,
    // and lightweight real-time connection-count cursors use `c:`.
    let safeOffset = 0;
    let discoverSuggestionKeyset: { score: number; id: string } | null = null;
    let discoverConnectionsKeyset: { connectionsCount: number; id: string } | null = null;
    if (input.cursor?.startsWith('o:')) {
        const discoverOffset = Number(input.cursor.slice(2));
        safeOffset = Number.isFinite(discoverOffset) && discoverOffset > 0 ? Math.min(discoverOffset, 1000) : 0;
    } else if (input.cursor?.startsWith('s:')) {
        const rest = input.cursor.slice(2);
        const sepIdx = rest.indexOf('|');
        if (sepIdx > 0) {
            const scoreRaw = Number(rest.slice(0, sepIdx));
            const id = rest.slice(sepIdx + 1);
            if (Number.isFinite(scoreRaw) && id) {
                discoverSuggestionKeyset = { score: scoreRaw, id };
            }
        }
    } else if (input.cursor?.startsWith('c:')) {
        const rest = input.cursor.slice(2);
        const sepIdx = rest.indexOf('|');
        if (sepIdx > 0) {
            const connectionsCount = Number(rest.slice(0, sepIdx));
            const id = rest.slice(sepIdx + 1);
            if (Number.isFinite(connectionsCount) && id) {
                discoverConnectionsKeyset = { connectionsCount, id };
            }
        }
    }

    // PURE OPTIMIZATION: Split heavy vs light queries based on offset
    const isHeavyLoad = safeOffset === 0 && !discoverSuggestionKeyset && !discoverConnectionsKeyset && !searchPattern;
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
    if (!searchPattern && hasConnectionSuggestionsTable !== false) {
        try {
            // 2F: Keyset cursor for pre-computed path
            const preComputedConditions = [eq(connectionSuggestions.userId, user.id)];
            if (discoverSuggestionKeyset) {
                preComputedConditions.push(sql`(
                    ${connectionSuggestions.score} < ${discoverSuggestionKeyset.score}
                    OR (${connectionSuggestions.score} = ${discoverSuggestionKeyset.score} AND ${connectionSuggestions.suggestedUserId} < ${discoverSuggestionKeyset.id})
                )`);
            }

            const preComputed = await db
                .select({
                    suggestedUserId: connectionSuggestions.suggestedUserId,
                    mutualConnectionsCount: connectionSuggestions.mutualConnectionsCount,
                    score: connectionSuggestions.score,
                    reason: connectionSuggestions.reason,
                })
                .from(connectionSuggestions)
                .where(and(...preComputedConditions))
                .orderBy(desc(connectionSuggestions.score))
                .limit(limit + 1)
                .offset(discoverSuggestionKeyset ? 0 : safeOffset);
            hasConnectionSuggestionsTable = true;

            if (preComputed.length > 0) {
                const suggestedIds = preComputed.slice(0, limit).map(s => s.suggestedUserId);
                // 2A, 2H: Add lastActiveAt, skills, interests to SELECT
                const suggestedProfiles = await db
                    .select({
                        id: profiles.id,
                        username: profiles.username,
                        fullName: profiles.fullName,
                        avatarUrl: profiles.avatarUrl,
                        headline: profiles.headline,
                        location: profiles.location,
                        visibility: profiles.visibility,
                        messagePrivacy: profiles.messagePrivacy,
                        connectionsCount: profiles.connectionsCount,
                        availabilityStatus: profiles.availabilityStatus,
                        experienceLevel: profiles.experienceLevel,
                        lastActiveAt: profiles.lastActiveAt,
                        skills: profiles.skills,
                        interests: profiles.interests,
                        openTo: profiles.openTo,
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
                        connectionId: undefined,
                        canConnect: true,
                        profileVisibility,
                        isLockedProfile: profileVisibility !== 'public',
                        mutualConnections: s.mutualConnectionsCount,
                        recommendationReason: s.reason || `${s.mutualConnectionsCount} mutual connections`,
                        projects: [] as Array<{ id: string; title: string; status: string | null }>,
                        availabilityStatus: p.availabilityStatus as SuggestedProfile['availabilityStatus'],
                        experienceLevel: p.experienceLevel as SuggestedProfile['experienceLevel'],
                        openTo: (p.openTo as string[]) ?? [],
                        messagePrivacy: (p.messagePrivacy || 'connections') as SuggestedProfile['messagePrivacy'],
                        canSendMessage: p.messagePrivacy === 'everyone',
                        lastActiveAt: p.lastActiveAt?.toISOString() ?? null,
                        skills: (p.skills as string[]) ?? [],
                        interests: (p.interests as string[]) ?? [],
                    };
                }).filter(isPresent);

                if (preComputedItems.length > 0) {
                    const visiblePreComputedItems = await applySuggestedProfilePrivacy(user.id, preComputedItems);
                    await recordPrivacyReadEvents({
                        subjectUserIds: visiblePreComputedItems.map((item) => item.id),
                        viewerUserId: user.id,
                        eventType: 'discover_profile_served',
                        route: 'connections.discover.precomputed',
                        metadata: { count: visiblePreComputedItems.length },
                    });
                    const hasMore = preComputed.length > limit;
                    // 2F: Return keyset cursor using score
                    const lastItem = preComputed[Math.min(limit - 1, preComputed.length - 1)];
                    const nextCursor = hasMore ? `s:${lastItem.score}|${lastItem.suggestedUserId}` : null;
                    // 2D: Use cached viewer project IDs
                    const [viewerProjectIds, viewerProfileRows] = await Promise.all([
                        getCachedViewerProjectIds(user.id, isHeavyLoad),
                        db
                            .select({ skills: profiles.skills, location: profiles.location })
                            .from(profiles)
                            .where(eq(profiles.id, user.id))
                            .limit(1),
                    ]);
                    const viewerSkills = (viewerProfileRows[0]?.skills as string[]) ?? [];
                    const viewerLocation = viewerProfileRows[0]?.location ?? null;
                    return { success: true as const, items: visiblePreComputedItems, hasMore, nextCursor, stats, viewerProjectIds, viewerSkills, viewerLocation };
                }
            }
        } catch (e) {
            if (isMissingRelationError(e, 'connection_suggestions')) {
                hasConnectionSuggestionsTable = false;
                console.warn('[discover] connection_suggestions table is unavailable; falling back to real-time suggestions.');
            } else {
                console.warn('[discover] Pre-computed suggestions read failed, falling back to real-time:', e);
            }
        }
    }

    // =========================================================================
    // PHASE 6B: Graceful Degradation — Timeout-guarded real-time discovery
    // If the heavy query takes >3s, fall back to a cached "Global Trending" feed
    // =========================================================================
    const DISCOVER_TIMEOUT_MS = 3000;

    const realTimeDiscoverResult = await Promise.race([
        (async () => {
            // 2D: Use cached viewer project IDs
            const [meProfile, viewerProjectIds] = await Promise.all([
                db
                    .select({
                        skills: profiles.skills,
                        interests: profiles.interests,
                        openTo: profiles.openTo,
                        location: profiles.location,
                    })
                    .from(profiles)
                    .where(eq(profiles.id, user.id))
                    .limit(1),
                getCachedViewerProjectIds(user.id, isHeavyLoad),
            ]);

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
                        OR EXISTS (SELECT 1 FROM unnest(${profiles.skills}::text[]) s WHERE s ILIKE ${searchPattern})
                        OR EXISTS (SELECT 1 FROM unnest(${profiles.interests}::text[]) i WHERE i ILIKE ${searchPattern})
                    )`,
                );
            }

            // 1I: Server-side filters for discover
            const discoverFilters = input.filters;
            if (discoverFilters?.available) {
                candidateBaseConditions.push(sql`${profiles.availabilityStatus} = 'available'`);
            }
            if (discoverFilters?.seniorPlus) {
                candidateBaseConditions.push(sql`${profiles.experienceLevel} IN ('senior', 'lead', 'founder')`);
            }

            // 2F: Keyset cursor for real-time path
            if (discoverConnectionsKeyset) {
                candidateBaseConditions.push(sql`(
                    ${profiles.connectionsCount} < ${discoverConnectionsKeyset.connectionsCount}
                    OR (${profiles.connectionsCount} = ${discoverConnectionsKeyset.connectionsCount} AND ${profiles.id} < ${discoverConnectionsKeyset.id})
                )`);
            }

            // 2A: Add lastActiveAt to SELECT
            const candidates = await db
                .select({
                    id: profiles.id,
                    username: profiles.username,
                    fullName: profiles.fullName,
                    avatarUrl: profiles.avatarUrl,
                    headline: profiles.headline,
                    location: profiles.location,
                    visibility: profiles.visibility,
                    messagePrivacy: profiles.messagePrivacy,
                    skills: profiles.skills,
                    interests: profiles.interests,
                    openTo: profiles.openTo,
                    createdAt: profiles.createdAt,
                    connectionsCount: profiles.connectionsCount,
                    availabilityStatus: profiles.availabilityStatus,
                    experienceLevel: profiles.experienceLevel,
                    lastActiveAt: profiles.lastActiveAt,
                })
                .from(profiles)
                .where(and(...candidateBaseConditions))
                .orderBy(desc(profiles.connectionsCount), desc(profiles.createdAt), desc(profiles.id))
                .limit(limit + 1)
                .offset(discoverConnectionsKeyset ? 0 : safeOffset);

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

                // 2E: Cache mutual counts to Redis hash for light load
                if (redis && mutualCounts.size > 0) {
                    try {
                        const hashKey = `discover:mutuals:${user.id}`;
                        const hashEntries: Record<string, string> = {};
                        for (const [cid, count] of mutualCounts) {
                            hashEntries[cid] = String(count);
                        }
                        await redis.hset(hashKey, hashEntries);
                        await redis.expire(hashKey, 300);
                    } catch { /* ignore */ }
                }
            } else {
                // 2E: Light load — read mutual counts from Redis
                if (redis) {
                    try {
                        const hash = await redis.hgetall(`discover:mutuals:${user.id}`);
                        if (hash) {
                            for (const [cid, count] of Object.entries(hash)) {
                                mutualCounts.set(cid, Number(count));
                            }
                        }
                    } catch { /* ignore */ }
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

            // 1E: Configurable scoring weights from Redis
            let wOverlap = 5, wMutual = 3, wRecency = 0.03;
            if (redis) {
                try {
                    const weights = await redis.hgetall('discover:scoring_weights');
                    if (weights) {
                        if (weights.overlap != null) {
                            const overlapWeight = Number(weights.overlap);
                            if (Number.isFinite(overlapWeight)) wOverlap = overlapWeight;
                        }
                        if (weights.mutual != null) {
                            const mutualWeight = Number(weights.mutual);
                            if (Number.isFinite(mutualWeight)) wMutual = mutualWeight;
                        }
                        if (weights.recency != null) {
                            const recencyWeight = Number(weights.recency);
                            if (Number.isFinite(recencyWeight)) wRecency = recencyWeight;
                        }
                    }
                } catch { /* fallback to defaults */ }
            }

            const scored = candidates.map((candidate) => {
                const conn = connectionByCandidate.get(candidate.id);
                const status = conn?.status === 'accepted'
                    ? 'connected'
                    : conn?.status === 'blocked'
                        ? 'blocked'
                    : conn?.status === 'pending'
                        ? (conn.requesterId === user.id ? 'pending_sent' : 'pending_received')
                        : 'none';
                const canConnect = status === 'none';

                if (!isHeavyLoad) {
                    // 2E: Use cached mutual counts on light load
                    const cachedMutual = mutualCounts.get(candidate.id) || 0;
                    return {
                        ...candidate,
                        score: candidate.connectionsCount || 0,
                        status,
                        canConnect,
                        mutual: cachedMutual,
                        recommendationReason: cachedMutual > 0 ? `${cachedMutual} mutual connections` : undefined,
                        scoringBreakdown: undefined as SuggestedProfile['scoringBreakdown'],
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
                const rawScore = overlap * wOverlap + mutual * wMutual + recency * wRecency;

                // 2G: Profile completeness multiplier
                const hasHeadline = !!candidate.headline;
                const hasSkills = ((candidate.skills as string[]) || []).length > 0;
                const hasInterests = ((candidate.interests as string[]) || []).length > 0;
                const hasLocation = !!candidate.location;
                let completeness = 1.0;
                if (!hasHeadline && !hasSkills && !hasInterests && !hasLocation) {
                    completeness = 0.5;
                } else if (hasHeadline && (hasSkills || hasInterests) && hasLocation) {
                    completeness = 1.5;
                }
                const score = rawScore * completeness;

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
                    scoringBreakdown: { overlap, mutual, recency, completeness },
                };
            });

            // 1I: Post-query filters (require computed data)
            if (discoverFilters?.hasMutuals) {
                for (let i = scored.length - 1; i >= 0; i--) {
                    if ((scored[i].mutual ?? 0) === 0) scored.splice(i, 1);
                }
            }
            if (discoverFilters?.hasSharedProjects && isHeavyLoad) {
                for (let i = scored.length - 1; i >= 0; i--) {
                    if (!projectsByOwner.has(scored[i].id) || projectsByOwner.get(scored[i].id)!.length === 0) {
                        scored.splice(i, 1);
                    }
                }
            }

            if (isHeavyLoad) {
                scored.sort((a, b) => b.score - a.score || +new Date(b.createdAt) - +new Date(a.createdAt));

                // 2R: Diversity enforcement — prevent any single reason from dominating >50%
                if (scored.length > 4) {
                    const reasonCounts = new Map<string, number>();
                    for (const s of scored) {
                        if (s.recommendationReason) {
                            reasonCounts.set(s.recommendationReason, (reasonCounts.get(s.recommendationReason) || 0) + 1);
                        }
                    }
                    const threshold = Math.ceil(scored.length * 0.5);
                    let dominantReason: string | null = null;
                    for (const [reason, count] of reasonCounts) {
                        if (count > threshold) { dominantReason = reason; break; }
                    }
                    if (dominantReason) {
                        const dominant: typeof scored = [];
                        const others: typeof scored = [];
                        for (const s of scored) {
                            if (s.recommendationReason === dominantReason) dominant.push(s);
                            else others.push(s);
                        }
                        // Interleave: take from dominant and others alternately
                        const interleaved: typeof scored = [];
                        let di = 0, oi = 0;
                        while (di < dominant.length || oi < others.length) {
                            if (di < dominant.length) interleaved.push(dominant[di++]);
                            if (oi < others.length) interleaved.push(others[oi++]);
                        }
                        scored.length = 0;
                        scored.push(...interleaved);
                    }
                }
            }

            // 2P: Read lane preferences (heavy load only)
            let lanePreferences: Record<string, number> | undefined;
            if (isHeavyLoad && redis) {
                try {
                    const prefs = await redis.hgetall(`discover:preference:${user.id}`);
                    if (prefs && Object.keys(prefs).length > 0) {
                        lanePreferences = {};
                        for (const [k, v] of Object.entries(prefs)) {
                            lanePreferences[k] = Number(v);
                        }
                    }
                } catch { /* ignore */ }
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
                    connectionId: connectionByCandidate.get(candidate.id)?.id,
                    canConnect: candidate.canConnect,
                    profileVisibility,
                    isLockedProfile: candidate.status !== 'connected' && profileVisibility !== 'public',
                    mutualConnections: isHeavyLoad ? candidate.mutual : (mutualCounts.get(candidate.id) || undefined),
                    recommendationReason: isHeavyLoad ? candidate.recommendationReason : (candidate.recommendationReason || undefined),
                    projects: isHeavyLoad ? projectsByOwner.get(candidate.id) || [] : undefined,
                    availabilityStatus: candidate.availabilityStatus as SuggestedProfile['availabilityStatus'],
                    experienceLevel: candidate.experienceLevel as SuggestedProfile['experienceLevel'],
                    openTo: (candidate.openTo as string[]) ?? [],
                    messagePrivacy: (candidate.messagePrivacy || 'connections') as SuggestedProfile['messagePrivacy'],
                    canSendMessage:
                        candidate.status === 'connected'
                        || (candidate.messagePrivacy || 'connections') === 'everyone',
                    // 2H: skills, interests, lastActiveAt
                    skills: (candidate.skills as string[]) ?? [],
                    interests: (candidate.interests as string[]) ?? [],
                    lastActiveAt: candidate.lastActiveAt?.toISOString() ?? null,
                    scoringBreakdown: candidate.scoringBreakdown,
                };
            });
            const visibleItems = await applySuggestedProfilePrivacy(user.id, items);
            await recordPrivacyReadEvents({
                subjectUserIds: visibleItems.map((item) => item.id),
                viewerUserId: user.id,
                eventType: 'discover_profile_served',
                route: 'connections.discover.realtime',
                metadata: { count: visibleItems.length },
            });

            // 2F: Use offset pagination when custom scoring is applied; otherwise keep the lightweight keyset.
            let nextCursor: string | null = null;
            if (hasMore && items.length > 0) {
                if (isHeavyLoad) {
                    nextCursor = `o:${safeOffset + limit}`;
                } else {
                    const lastScored = scored[Math.min(limit - 1, scored.length - 1)];
                    nextCursor = `c:${lastScored.connectionsCount}|${lastScored.id}`;
                }
            }
            return {
                success: true as const,
                items: visibleItems,
                hasMore,
                nextCursor,
                stats,
                viewerProjectIds,
                lanePreferences,
                viewerSkills: (meProfile[0]?.skills as string[]) ?? [],
                viewerLocation: meProfile[0]?.location ?? null,
            };
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
    // 2A, 2H: Add lastActiveAt, skills, interests to fallback SELECT
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
            availabilityStatus: profiles.availabilityStatus,
            experienceLevel: profiles.experienceLevel,
            lastActiveAt: profiles.lastActiveAt,
            skills: profiles.skills,
            interests: profiles.interests,
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
            connectionId: undefined,
            canConnect: true,
            profileVisibility,
            isLockedProfile: profileVisibility !== 'public',
            mutualConnections: undefined,
            recommendationReason: 'Trending in your network',
            projects: undefined,
            availabilityStatus: p.availabilityStatus as SuggestedProfile['availabilityStatus'],
            experienceLevel: p.experienceLevel as SuggestedProfile['experienceLevel'],
            lastActiveAt: p.lastActiveAt?.toISOString() ?? null,
            skills: (p.skills as string[]) ?? [],
            interests: (p.interests as string[]) ?? [],
        };
    });
    const visibleTrendingItems = await applySuggestedProfilePrivacy(user.id, trendingItems);
    await recordPrivacyReadEvents({
        subjectUserIds: visibleTrendingItems.map((item) => item.id),
        viewerUserId: user.id,
        eventType: 'discover_profile_served',
        route: 'connections.discover.trending',
        metadata: { count: visibleTrendingItems.length },
    });

    // 2D: Use cached viewer project IDs
    const [fallbackViewerProjectIds, fallbackViewerSkillsRow] = await Promise.all([
        getCachedViewerProjectIds(user.id, isHeavyLoad),
        db.select({ skills: profiles.skills }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
    ]);
    const fallbackViewerSkills = (fallbackViewerSkillsRow[0]?.skills as string[]) ?? [];
    const fallbackResult = { success: true as const, items: visibleTrendingItems, hasMore: trendingHasMore, nextCursor: trendingHasMore ? `o:${safeOffset + limit}` : null, stats, viewerProjectIds: fallbackViewerProjectIds, viewerSkills: fallbackViewerSkills };
    try {
        await cacheData(cacheKey, fallbackResult, 5 * 60); // Cache fallback for 5 mins
    } catch { /* ignore */ }
    return fallbackResult;
}

export async function getConnectionRequestHistory(
    limit: number = 80,
    cursor?: string,
    filters?: HistoryFilters,
): Promise<{
    success: boolean;
    items: ConnectionRequestHistoryItem[];
    nextCursor?: string | null;
    hasMore?: boolean;
    error?: string;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, items: [], error: 'Not authenticated' };

        const effectiveLimit = Math.max(1, Math.min(limit, 200));

        // 2M: Parse keyset cursor (eventAt|id)
        let historyCursor: { eventAt: string; id: string } | null = null;
        if (cursor) {
            const sepIdx = cursor.indexOf('|');
            if (sepIdx > 0) {
                const eventAtRaw = cursor.slice(0, sepIdx);
                const id = cursor.slice(sepIdx + 1);
                const parsed = new Date(eventAtRaw);
                if (!Number.isNaN(parsed.getTime()) && id) {
                    historyCursor = { eventAt: parsed.toISOString(), id };
                }
            }
        }

        const dedupeKey = `connections:request-history:${user.id}:${effectiveLimit}:${cursor || 'none'}:${JSON.stringify(filters ?? {})}`;
        return await runInFlightDeduped(dedupeKey, async () => {
            const historyEventAtExpr = sql`CASE
                WHEN ${connections.status} = 'pending' THEN ${connections.createdAt}
                ELSE ${connections.updatedAt}
            END`;
            const conditions = [
                or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id)),
                inArray(connections.status, CONNECTION_HISTORY_STATUSES),
            ];

            // 1J: History filters
            if (filters?.status && isConnectionHistoryStatus(filters.status)) {
                conditions.push(eq(connections.status, filters.status));
            }
            if (filters?.direction === 'sent') {
                conditions.push(eq(connections.requesterId, user.id));
            } else if (filters?.direction === 'received') {
                conditions.push(eq(connections.addresseeId, user.id));
            }
            if (filters?.dateFrom) {
                const from = new Date(filters.dateFrom);
                if (!Number.isNaN(from.getTime())) {
                    conditions.push(sql`${historyEventAtExpr} >= ${from.toISOString()}`);
                }
            }
            if (filters?.dateTo) {
                const to = new Date(filters.dateTo);
                if (!Number.isNaN(to.getTime())) {
                    conditions.push(sql`${historyEventAtExpr} <= ${to.toISOString()}`);
                }
            }

            // 2M: Keyset pagination
            if (historyCursor) {
                conditions.push(sql`(
                    ${historyEventAtExpr} < ${historyCursor.eventAt}
                    OR (${historyEventAtExpr} = ${historyCursor.eventAt} AND ${connections.id} < ${historyCursor.id})
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
                    eventAt: historyEventAtExpr,
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
                .where(and(...conditions))
                .orderBy(desc(historyEventAtExpr), desc(connections.id))
                .limit(effectiveLimit + 1);

            const hasMore = rows.length > effectiveLimit;
            const items: ConnectionRequestHistoryItem[] = rows.slice(0, effectiveLimit).flatMap((row) => {
                if (!isConnectionRequestHistoryStatus(row.status)) {
                    console.error('Invalid connection history status encountered', {
                        connectionId: row.id,
                        status: row.status,
                    });
                    return [];
                }

                const status = row.status;
                const eventAt = new Date(row.eventAt as string | number | Date).toISOString();
                return [{
                    id: row.id,
                    kind: 'connection',
                    direction: row.requesterId === user.id ? 'outgoing' : 'incoming',
                    status,
                    eventAt,
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

            // 2M: Build next cursor
            let nextCursor: string | null = null;
            if (hasMore && items.length > 0) {
                const last = items[items.length - 1];
                nextCursor = `${last.eventAt}|${last.id}`;
            }

            return { success: true, items, nextCursor, hasMore };
        });
    } catch (error) {
        console.error('Error fetching connection request history:', error);
        return { success: false, items: [], error: 'Failed to load history' };
    }
}

// ============================================================================
// SEND CONNECTION REQUEST
// ============================================================================

const CONNECTION_REQUEST_IDEMPOTENCY_TTL_SECONDS = 60;

// SEC-H7: Two anti-spam layers independent of the short-window per-user and
// per-target token buckets above. The daily cap stops "phishing-style" fan-out
// where one compromised account DMs hundreds of strangers per day; the
// per-(sender, target) 24h hold prevents oscillating the same request until a
// bucket refills.
const CONNECTION_REQUEST_DAILY_CAP = 50;
const CONNECTION_REQUEST_DAILY_WINDOW_SECONDS = 24 * 60 * 60;
const CONNECTION_REQUEST_PER_TARGET_HOLD_SECONDS = 24 * 60 * 60;

export async function sendConnectionRequest(
    addresseeId: string,
    idempotencyKey?: string,
    _message?: string,
    lane?: string,
): Promise<{ success: boolean; error?: string; connectionId?: string }> {
    let idempotencyCacheKey: string | null = null;

    const releaseIdempotencyLock = async () => {
        if (!idempotencyCacheKey || !redis) return;
        try {
            await redis.del(idempotencyCacheKey);
        } catch {
            // Keep the request flow resilient; TTL still bounds stale locks if Redis delete fails.
        } finally {
            idempotencyCacheKey = null;
        }
    };

    const returnFailure = async (error: string): Promise<{ success: boolean; error: string }> => {
        await releaseIdempotencyLock();
        return { success: false, error };
    };

    try {
        // H6: Clamp message length to prevent oversized payloads
        const requestMessage = _message?.trim().slice(0, 500) || null;
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        if (idempotencyKey && redis) {
            idempotencyCacheKey = `idempotent:conn:${user.id}:${idempotencyKey}`;
            const isFirst = await redis.set(idempotencyCacheKey, '1', {
                nx: true,
                ex: CONNECTION_REQUEST_IDEMPOTENCY_TTL_SECONDS,
            });
            if (!isFirst) {
                console.log(`[connections] Idempotency lock hit for ${idempotencyCacheKey}`);
                return { success: true };
            }
        }

        // Can't connect to yourself
        if (user.id === addresseeId) {
            return await returnFailure('Cannot connect to yourself');
        }

        const requestRate = await consumeRateLimit(`connections-send:${user.id}`, 30, 60);
        if (!requestRate.allowed) {
            return await returnFailure('Too many requests. Please wait and try again.');
        }
        // SEC-H7: daily global cap per sender. Independent of the 30/60s bucket
        // above, which only throttles bursts — this one enforces "you can't
        // DM 500 strangers today."
        const dailyRate = await consumeRateLimit(
            `connections-send-daily:${user.id}`,
            CONNECTION_REQUEST_DAILY_CAP,
            CONNECTION_REQUEST_DAILY_WINDOW_SECONDS,
        );
        if (!dailyRate.allowed) {
            return await returnFailure('You have sent too many connection requests today. Try again tomorrow.');
        }
        const targetRate = await consumeRateLimit(`connections-send-target:${user.id}:${addresseeId}`, 3, 3600);
        if (!targetRate.allowed) {
            return await returnFailure('You have sent too many requests to this person. Please wait before trying again.');
        }

        // SEC-H7: per-(sender, target) 24h hold. Once a request has been
        // attempted against this target within the past 24 hours, reject any
        // new attempt — even if the per-hour bucket has since refilled. The
        // hold is stamped AFTER the DB write succeeds (below) so a legit
        // retry after an auth failure still works.
        const perTargetHoldKey = `connections-send-hold:${user.id}:${addresseeId}`;
        if (redis) {
            try {
                const held = await redis.get(perTargetHoldKey);
                if (held) {
                    return await returnFailure('You have recently contacted this person. Please wait before trying again.');
                }
            } catch {
                // Fall through — Redis hiccup should not block legit flow;
                // the DB-level duplicate check below still enforces state.
            }
        }

        // PURE OPTIMIZATION: O(1) Pre-check for already connected users (1M+ Users Scalability)
        if (await isConnected(user.id, addresseeId)) {
            return await returnFailure('Already connected');
        }

        const privacy = await resolvePrivacyRelationship(user.id, addresseeId);
        if (!privacy) {
            return await returnFailure('User not found');
        }
        if (!privacy.canSendConnectionRequest) {
            if (privacy.blockedByViewer || privacy.blockedByTarget) {
                return await returnFailure('You cannot send a request to this account.');
            }
            if (privacy.connectionPrivacy === 'nobody') {
                return await returnFailure('This user is not accepting connection requests.');
            }
            if (privacy.connectionPrivacy === 'mutuals_only') {
                return await returnFailure('This user only accepts requests from mutual connections.');
            }
            return await returnFailure('Cannot send request right now.');
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

                    // 2B: Store message on UPDATE
                    await tx
                        .update(connections)
                        .set({
                            requesterId: user.id,
                            addresseeId,
                            status: 'pending',
                            message: requestMessage,
                            updatedAt: new Date(),
                            createdAt: new Date(), // PURE OPTIMIZATION: Reset createdAt so it bubbles to top of incoming feeds
                        })
                        .where(eq(connections.id, conn.id));
                    return { connectionId: conn.id };
                }
            }

            try {
                // 2B: Store message on INSERT
                const inserted = await tx
                    .insert(connections)
                    .values({
                        requesterId: user.id,
                        addresseeId: addresseeId,
                        status: 'pending',
                        message: requestMessage,
                    })
                    .returning({ id: connections.id });
                return { connectionId: inserted[0].id };
            } catch (err: unknown) {
                // If unique constraint is violated, someone else inserted concurrently
                if (getErrorCode(err) === '23505') {
                    return { error: 'Request was already sent or a connection exists.' };
                }
                throw err;
            }
        });

        if (!txResult.connectionId) {
            return await returnFailure(txResult.error || 'Failed to send request');
        }

        // SEC-H7: stamp the per-(sender, target) 24h hold now that the DB
        // write has committed. If Redis is unavailable the DB unique constraint
        // + REJECT_REQUEST_COOLDOWN_MS still serve as a backstop.
        if (redis) {
            try {
                await redis.set(perTargetHoldKey, '1', {
                    nx: true,
                    ex: CONNECTION_REQUEST_PER_TARGET_HOLD_SECONDS,
                });
            } catch { /* ignore */ }
        }

        await queueCounterRefreshBestEffort([addresseeId]);
        await invalidateDiscoverCacheForUsers([user.id, addresseeId]);

        // 2P: Lane preference tracking
        if (lane && redis) {
            try {
                const prefKey = `discover:preference:${user.id}`;
                await redis.hincrby(prefKey, lane, 1);
                await redis.expire(prefKey, 7 * 24 * 60 * 60); // 7 days TTL
            } catch { /* ignore */ }
        }

        await revalidateConnectionsPaths();
        return { success: true, connectionId: txResult.connectionId };
    } catch (error) {
        await releaseIdempotencyLock();
        console.error('Error sending connection request:', error);
        return { success: false, error: 'Failed to send request' };
    }
}

export async function dismissConnectionSuggestion(
    dismissedProfileId: string,
    feedbackReason?: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        if (dismissedProfileId === user.id) return { success: false, error: 'Invalid target profile' };

        const dismissRate = await consumeRateLimit(`connections-dismiss:${user.id}`, 200, 60);
        if (!dismissRate.allowed) {
            return { success: false, error: 'Too many actions. Please wait and try again.' };
        }

        // M14: Validate and clamp dismiss feedback reason
        const safeFeedbackReason = feedbackReason?.trim().slice(0, 120) || undefined;

        await db
            .insert(connectionSuggestionDismissals)
            .values({
                userId: user.id,
                dismissedProfileId,
                ...(safeFeedbackReason ? { reason: safeFeedbackReason } : {}),
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

// 2N: Undo dismiss connection suggestion
export async function undoDismissConnectionSuggestion(
    profileId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const undoRate = await consumeRateLimit(`connections-undo-dismiss:${user.id}`, 60, 60);
        if (!undoRate.allowed) {
            return { success: false, error: 'Too many actions. Please wait and try again.' };
        }

        await db
            .delete(connectionSuggestionDismissals)
            .where(
                and(
                    eq(connectionSuggestionDismissals.userId, user.id),
                    eq(connectionSuggestionDismissals.dismissedProfileId, profileId),
                )
            );

        await invalidateDiscoverCacheForUser(user.id);
        revalidatePath('/people');
        return { success: true };
    } catch (error) {
        console.error('Error undoing dismiss:', error);
        return { success: false, error: 'Failed to undo dismiss' };
    }
}

// 2O: Update connection tags
export async function updateConnectionTags(
    connectionId: string,
    tags: string[]
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const tagRate = await consumeRateLimit(`connections-tags:${user.id}`, 60, 60);
        if (!tagRate.allowed) {
            return { success: false, error: 'Too many actions. Please wait and try again.' };
        }

        // Validate tags: max 10, each max 30 chars
        const safeTags = tags.slice(0, 10).map(t => t.trim().slice(0, 30)).filter(Boolean);

        const result = await db
            .update(connections)
            .set({ tags: safeTags })
            .where(
                and(
                    eq(connections.id, connectionId),
                    eq(connections.status, 'accepted'),
                    or(
                        eq(connections.requesterId, user.id),
                        eq(connections.addresseeId, user.id),
                    ),
                )
            )
            .returning({ id: connections.id });

        if (result.length === 0) {
            return { success: false, error: 'Connection not found or not accepted' };
        }

        return { success: true };
    } catch (error) {
        console.error('Error updating tags:', error);
        return { success: false, error: 'Failed to update tags' };
    }
}

// 2Q: Track discover impressions (fire-and-forget)
export async function trackDiscoverImpressions(
    profileIds: string[]
): Promise<{ success: boolean }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false };
        if (!profileIds.length) return { success: true };

        const impressionRate = await consumeRateLimit(`discover-impressions:${user.id}`, 30, 60);
        if (!impressionRate.allowed) return { success: false };

        if (!redis) return { success: true };

        const dateKey = new Date().toISOString().slice(0, 10);
        const key = `discover:imp:${user.id}:${dateKey}`;

        // HyperLogLog for unique impression tracking
        await redis.pfadd(key, ...profileIds.slice(0, 50));
        // TTL 7 days
        await redis.expire(key, 7 * 24 * 3600);

        return { success: true };
    } catch {
        // Fire-and-forget — swallow errors
        return { success: false };
    }
}

// 2V: Batch action progress with jobId
export async function acceptAllIncomingConnectionRequests(
    limit: number = 100
): Promise<{ success: boolean; queued?: true; jobId?: string; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const effectiveLimit = Math.max(1, Math.min(limit, 200));
        const bulkAcceptRate = await consumeRateLimit(`connections-accept-all:${user.id}`, 6, 60);
        if (!bulkAcceptRate.allowed) {
            return { success: false, error: 'Too many bulk actions. Please wait and try again.' };
        }

        const jobId = randomUUID();
        let redisJobCreated = false;

        // 2V: Store job progress in Redis
        if (redis) {
            try {
                const pendingCount = await countPendingIncomingRequests(user.id);
                const total = Math.min(effectiveLimit, pendingCount);
                await redis.hset(`bulk_job:${jobId}`, {
                    total: String(total),
                    completed: '0',
                    failed: '0',
                    status: 'pending',
                });
                await redis.expire(`bulk_job:${jobId}`, 3600);
                redisJobCreated = true;
            } catch { /* ignore */ }
        }

        try {
            await inngest.send({
                name: 'workspace/connections.bulk',
                data: {
                    userId: user.id,
                    action: 'accept',
                    limit: effectiveLimit,
                    jobId,
                }
            });
        } catch (enqueueError) {
            if (redisJobCreated && redis) {
                void redis.del(`bulk_job:${jobId}`).catch(() => undefined);
            }
            throw enqueueError;
        }

        return { success: true, queued: true, jobId };
    } catch (error) {
        console.error('Error initiating bulk accept queue:', error);
        return { success: false, error: 'Failed to accept all requests' };
    }
}

// 2V: Batch action progress with jobId
export async function rejectAllIncomingConnectionRequests(
    limit: number = 100
): Promise<{ success: boolean; queued?: true; jobId?: string; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const effectiveLimit = Math.max(1, Math.min(limit, 200));
        const bulkRejectRate = await consumeRateLimit(`connections-reject-all:${user.id}`, 6, 60);
        if (!bulkRejectRate.allowed) {
            return { success: false, error: 'Too many bulk actions. Please wait and try again.' };
        }

        const jobId = randomUUID();
        let redisJobCreated = false;

        // 2V: Store job progress in Redis
        if (redis) {
            try {
                const pendingCount = await countPendingIncomingRequests(user.id);
                const total = Math.min(effectiveLimit, pendingCount);
                await redis.hset(`bulk_job:${jobId}`, {
                    total: String(total),
                    completed: '0',
                    failed: '0',
                    status: 'pending',
                });
                await redis.expire(`bulk_job:${jobId}`, 3600);
                redisJobCreated = true;
            } catch { /* ignore */ }
        }

        try {
            await inngest.send({
                name: 'workspace/connections.bulk',
                data: {
                    userId: user.id,
                    action: 'reject',
                    limit: effectiveLimit,
                    jobId,
                }
            });
        } catch (enqueueError) {
            if (redisJobCreated && redis) {
                void redis.del(`bulk_job:${jobId}`).catch(() => undefined);
            }
            throw enqueueError;
        }

        return { success: true, queued: true, jobId };
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

// SEC-H14: accept a caller-supplied `idempotencyKey` so a double-clicked
// "Accept" button, a flaky network retry, or an offline queue flush never
// produces two acceptance events for the same pending request. The key is
// scoped to (user, connectionId) so a key cannot replay across different
// connections or across users.
export async function acceptConnectionRequest(
    connectionId: string,
    opts?: { idempotencyKey?: string }
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const acceptRate = await consumeRateLimit(`connections-accept:${user.id}`, 60, 60);
        if (!acceptRate.allowed) {
            return { success: false, error: 'Too many actions. Please wait and try again.' };
        }

        const { result } = await runIdempotent<{ success: boolean; error?: string }>(
            {
                namespace: 'connections.accept',
                scopeId: `${user.id}:${connectionId}`,
                key: opts?.idempotencyKey,
            },
            async () => {
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
            },
        );

        return result;
    } catch (error) {
        if (error instanceof IdempotencyConflictError) {
            return { success: false, error: 'Request already in progress. Please wait.' };
        }
        console.error('Error accepting request:', error);
        return { success: false, error: 'Failed to accept request' };
    }
}

// ============================================================================
// REJECT CONNECTION REQUEST (Addressee only)
// ============================================================================

// 2C: Add optional reason parameter; 2T: Add serverNow for clock drift fix
// SEC-H14: accept an optional idempotencyKey so rapid double-submits don't
// produce duplicate rejection rows. The scope includes the connectionId so
// two different connections can't share a replay window.
export async function rejectConnectionRequest(
    connectionId: string,
    reason?: string,
    opts?: { idempotencyKey?: string },
): Promise<{ success: boolean; error?: string; undoUntil?: string; serverNow?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        if (reason && !(CONNECTION_REJECTION_REASONS as readonly string[]).includes(reason)) {
            return { success: false, error: `Invalid rejection reason. Must be one of: ${CONNECTION_REJECTION_REASONS.join(', ')}` };
        }

        const rejectRate = await consumeRateLimit(`connections-reject:${user.id}`, 60, 60);
        if (!rejectRate.allowed) {
            return { success: false, error: 'Too many actions. Please wait and try again.' };
        }

        const { result } = await runIdempotent<{
            success: boolean;
            error?: string;
            undoUntil?: string;
            serverNow?: string;
        }>(
            {
                namespace: 'connections.reject',
                scopeId: `${user.id}:${connectionId}`,
                key: opts?.idempotencyKey,
            },
            async () => {
                const [rejected] = await db
                    .update(connections)
                    .set({
                        status: 'rejected',
                        rejectionReason: reason ?? null,
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
                    serverNow: new Date().toISOString(),
                };
            },
        );

        return result;
    } catch (error) {
        if (error instanceof IdempotencyConflictError) {
            return { success: false, error: 'Request already in progress. Please wait.' };
        }
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

            const statsRow = stats[0] as ConnectionStatsQueryRow | undefined;

            return {
                totalConnections: Number(profileCounter[0]?.connectionsCount || 0),
                pendingIncoming: canViewPrivateStats ? Number(statsRow?.pendingIncoming || 0) : 0,
                pendingSent: canViewPrivateStats ? Number(statsRow?.pendingSent || 0) : 0,
                connectionsThisMonth: canViewPrivateStats
                    ? (redisStats?.connectionsThisMonth ?? Number(statsRow?.connectionsThisMonth || 0))
                    : 0,
                connectionsGained: canViewPrivateStats
                    ? (redisStats?.connectionsGained ?? Number(statsRow?.connectionsGained || 0))
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
        connectionId: item.connectionId,
        canConnect: item.canConnect,
        mutualConnections: item.mutualConnections || 0,
        recommendationReason: item.recommendationReason,
        projects: item.projects || [],
        openTo: item.openTo || [],
        messagePrivacy: item.messagePrivacy || 'connections',
        canSendMessage: item.canSendMessage,
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
                const cached = await getCachedData<PendingRequestsResult>(cacheKey);
                if (cached) return cached;
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
                await cacheData(cacheKey, result, 300);
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
        limit: rawLimit = 30,
        cursor,
        search,
        targetUserId,
    } = input;

    // C1: Clamp limit to prevent unbounded fetches
    const limit = Math.max(1, Math.min(rawLimit, 60));

    const user = await getAuthUser();
    const userIdToFetch = targetUserId || user?.id;

    if (!userIdToFetch) return { connections: [], hasMore: false, nextCursor: null };

    // C1: Rate limit to prevent enumeration
    if (user?.id) {
        const rate = await consumeRateLimit(`connections-accepted:${user.id}`, 60, 60);
        if (!rate.allowed) {
            return { connections: [], hasMore: false, nextCursor: null };
        }
    }

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
    activeApplicationStatus?: 'pending' | 'accepted' | 'rejected' | 'project_deleted';
    activeProjectId?: string;
    error?: string;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        // C2: Rate limit to prevent relationship enumeration
        const rate = await consumeRateLimit(`connections-status:${user.id}`, 120, 60);
        if (!rate.allowed) {
            return { success: false, error: 'Too many requests. Please wait and try again.' };
        }

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
            const appStatus = activeApp.status as 'pending' | 'accepted' | 'rejected' | 'project_deleted';
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
