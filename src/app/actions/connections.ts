"use server";

import { db } from '@/lib/db';
import { z } from 'zod';
import { connectionSuggestionDismissals, connectionSuggestions, connections, messageWorkflowItems, profiles, projects, roleApplications } from '@/lib/db/schema';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { eq, and, or, desc, asc, sql, inArray, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { IdempotencyConflictError, runIdempotent } from '@/lib/security/idempotency';
import {
    CONNECTION_REQUEST_HISTORY_STATUSES,
    isConnectionHistoryStatus,
    type ConnectionRequestHistoryStatus,
} from '@/lib/applications/status';
import { runInFlightDeduped } from '@/lib/utils/inflight-dedupe';
import { APPLICATION_BANNER_HIDE_AFTER_MS } from '@/lib/chat/banner-lifecycle';
import { redis, getCachedData, cacheData } from '@/lib/redis';
import {
    invalidateDiscoverCacheForUsers,
    revalidateConnectionsPaths,
    syncConnectionsToRedis,
} from '@/lib/connections/internal-helpers';
import { queueCounterRefreshBestEffort } from '@/lib/workspace/counter-buffer';
import { recordPrivacyReadEvents } from '@/lib/privacy/audit';
import { buildViewerScopedProfileView } from '@/lib/privacy/profile-views';
import { resolvePrivacyRelationship, resolvePrivacyRelationships } from '@/lib/privacy/resolver';
import type { PrivacyRelationshipState } from '@/lib/privacy/relationship-state';
import { emitConnectionAcceptedNotification, emitConnectionRequestReceivedNotification } from '@/lib/notifications/emitters';
import { logger } from '@/lib/logger';
import { containsLikePattern, normalizeSearchQuery, tokenizeSearchQuery } from '@/lib/search/query';
import { recordGlobalSearchMetric } from '@/lib/search/observability';
import { inngest } from '../../inngest/client';

// ============================================================================
// TYPES
// ============================================================================

export interface ConnectionStats {
    totalConnections: number;
    pendingIncoming: number;
    pendingSent: number;
}

export async function readPeoplePendingCountsAction() {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false as const, error: 'Not authenticated', pendingConnections: 0, pendingInvites: 0 };

        const [connectionCount, inviteCount] = await Promise.all([
            db
                .select({ count: sql<number>`COUNT(*)::int` })
                .from(connections)
                .where(and(eq(connections.addresseeId, user.id), eq(connections.status, 'pending'))),
            db
                .select({ count: sql<number>`COUNT(*)::int` })
                .from(messageWorkflowItems)
                .where(and(
                    eq(messageWorkflowItems.assigneeUserId, user.id),
                    eq(messageWorkflowItems.kind, 'project_invite'),
                    eq(messageWorkflowItems.status, 'pending'),
                )),
        ]);

        return {
            success: true as const,
            pendingConnections: Number(connectionCount[0]?.count ?? 0),
            pendingInvites: Number(inviteCount[0]?.count ?? 0),
        };
    } catch (error) {
        logger.error('connections.pending_counts_failed', {
            module: 'connections',
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: 'Failed to load pending requests', pendingConnections: 0, pendingInvites: 0 };
    }
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
    experienceLevel?: 'student' | 'junior' | 'mid' | 'senior' | 'lead' | 'founder' | null;
    skills?: string[];
    interests?: string[];
    openTo?: string[];
    messagePrivacy?: 'everyone' | 'connections' | null;
    canSendMessage?: boolean;
    lastActiveAt?: string | null;
    scoringBreakdown?: { overlap: number; mutual: number; recency: number; completeness: number };
}

export type ConnectionsFeedTab = 'network' | 'requests_incoming' | 'requests_sent' | 'discover';

export interface DiscoverFilters {
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
    includeMeta?: boolean;
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

async function applySuggestedProfilePrivacy(
    viewerId: string,
    items: SuggestedProfile[],
): Promise<SuggestedProfile[]> {
    const relationships = await resolvePrivacyRelationships(viewerId, items.map((item) => item.id));

    return items.map((item) => {
        const relationship = relationships.get(item.id) ?? null;
        const scoped = buildViewerScopedProfileView({
            profile: item as unknown as Record<string, unknown> & { id: string },
            relationship,
            isOwner: viewerId === item.id,
        });
        const locked = !!relationship && !relationship.canViewProfile;
        const connectionStatus = suggestedStatusFromPrivacyRelationship(relationship, item.connectionStatus);
        const connectionId = getUsableRelationshipConnectionId(relationship?.latestConnectionId) ?? item.connectionId;

        if (!locked) {
            return {
                ...item,
                connectionStatus,
                connectionId,
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
            connectionStatus,
            connectionId,
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

function suggestedStatusFromPrivacyRelationship(
    relationship: PrivacyRelationshipState | null,
    fallback: SuggestedProfile['connectionStatus'],
): SuggestedProfile['connectionStatus'] {
    if (!relationship) return fallback;
    switch (relationship.connectionState) {
        case 'connected':
            return 'connected';
        case 'pending_outgoing':
            return 'pending_sent';
        case 'pending_incoming':
            return 'pending_received';
        case 'blocked_by_viewer':
        case 'blocked_by_target':
            return 'blocked';
        case 'none':
        default:
            return 'none';
    }
}

function getUsableRelationshipConnectionId(connectionId: string | null | undefined) {
    if (!connectionId || connectionId.startsWith('redis-fast-path-')) return undefined;
    return connectionId;
}

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
// ============================================================================

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

function buildProfileNameIlikeSearchCondition(searchTokens: string[]) {
    return and(...searchTokens.map((token) => {
        const pattern = containsLikePattern(token);
        return sql`(${profiles.fullName} ILIKE ${pattern} OR ${profiles.username} ILIKE ${pattern})`;
    }))!;
}

function buildProfileNameFuzzySearchCondition(searchPattern: string, safeSearch: string) {
    return sql`(
        similarity(${profiles.fullName}, ${safeSearch}) > 0.3
        OR similarity(${profiles.username}, ${safeSearch}) > 0.3
        OR ${profiles.fullName} ILIKE ${searchPattern}
        OR ${profiles.username} ILIKE ${searchPattern}
    )`;
}

function buildDiscoverProfileSearchCondition(searchTokens: string[]) {
    return and(...searchTokens.map((token) => {
        const pattern = containsLikePattern(token);
        return sql`(
            ${profiles.fullName} ILIKE ${pattern}
            OR ${profiles.username} ILIKE ${pattern}
            OR ${profiles.headline} ILIKE ${pattern}
            OR ${profiles.location} ILIKE ${pattern}
            OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(${profiles.skills}) = 'array' THEN ${profiles.skills} ELSE '[]'::jsonb END
                ) AS skill(value)
                WHERE skill.value ILIKE ${pattern}
            )
            OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(${profiles.interests}) = 'array' THEN ${profiles.interests} ELSE '[]'::jsonb END
                ) AS interest(value)
                WHERE interest.value ILIKE ${pattern}
            )
        )`;
    }))!;
}

function buildConnectionDateCursorCondition(params: {
    column: typeof connections.updatedAt | typeof connections.createdAt | typeof profiles.updatedAt;
    idColumn?: typeof connections.id | typeof profiles.id;
    isoValue: string;
    id?: string | null;
    direction: 'before' | 'after';
}) {
    const operator = params.direction === 'after' ? sql`>` : sql`<`;
    if (!params.id) {
        return sql`${params.column} ${operator} ${params.isoValue}`;
    }
    const idColumn = params.idColumn ?? connections.id;
    return sql`(
        ${params.column} ${operator} ${params.isoValue}
        OR (${params.column} = ${params.isoValue} AND ${idColumn} ${operator} ${params.id})
    )`;
}

function buildSuggestionScoreCursorCondition(cursor: { score: number; id: string }) {
    return sql`(
        ${connectionSuggestions.score} < ${cursor.score}
        OR (${connectionSuggestions.score} = ${cursor.score} AND ${connectionSuggestions.suggestedUserId} < ${cursor.id})
    )`;
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
    const normalized = normalizeSearchQuery(search || '');
    return normalized.length > 0 ? normalized : undefined;
}

function getErrorCode(error: unknown) {
    if (!error || typeof error !== "object" || !("code" in error)) {
        return null;
    }
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
}

const connectionsFeedInputSchema = z.object({
    tab: z.enum(['network', 'discover', 'requests_incoming', 'requests_sent']),
    limit: z.number().max(100).optional(),
    cursor: z.string().optional(),
    search: z.string().max(100).optional(),
    sortBy: z.enum(['recent', 'name', 'oldest']).optional(),
    filters: z.object({
        seniorPlus: z.boolean().optional(),
        hasMutuals: z.boolean().optional(),
        hasSharedProjects: z.boolean().optional(),
    }).strict().optional(),
    historyFilters: z.object({
        status: z.enum(CONNECTION_REQUEST_HISTORY_STATUSES).optional(),
        direction: z.enum(['sent', 'received']).optional(),
        dateFrom: z.string().trim().max(40).optional(),
        dateTo: z.string().trim().max(40).optional(),
    }).strict().optional(),
    requestSortBy: z.enum(['recent', 'mutual', 'oldest']).optional(),
    includeMeta: z.boolean().optional(),
});

async function getConnectionsFeedImpl(input: ConnectionsFeedInput) {
    const startedAt = performance.now();
    const validation = connectionsFeedInputSchema.safeParse(input);
    if (!validation.success) {
        return {
            success: false as const,
            code: 'VALIDATION' as const,
            error: 'Invalid connection search request',
            items: [],
            nextCursor: null,
            hasMore: false,
            stats: { totalConnections: 0, pendingIncoming: 0, pendingSent: 0 },
        };
    }
    input = validation.data;

    const user = await getAuthUser();
    if (!user) {
        return {
            success: false as const,
            code: 'UNAUTHENTICATED' as const,
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
    const includeMeta = input.includeMeta !== false;
    const recordPreview = (outcome: 'success' | 'empty' | 'rate-limited' | 'error', resultCount: number) => {
        if (includeMeta || !safeSearch) return;
        recordGlobalSearchMetric({
            domain: 'people',
            scope: tab,
            outcome,
            durationMs: performance.now() - startedAt,
            resultCount,
            queryLength: safeSearch.length,
            tokenCount: tokenizeSearchQuery(safeSearch).length,
        });
    };

    if (safeSearch) {
        const searchRate = await consumeRateLimit(`connections-search:${user.id}`, 100, 60);
        if (!searchRate.allowed) {
            recordPreview('rate-limited', 0);
            return {
                success: false as const,
                code: 'RATE_LIMITED' as const,
                retryAfterMs: 1_000,
                error: 'Too many searches. Please wait and try again.',
                items: [],
                nextCursor: null,
                hasMore: false,
                stats: includeMeta
                    ? await getConnectionStatsForUser(user.id)
                    : { totalConnections: 0, pendingIncoming: 0, pendingSent: 0 },
            };
        }
    }

    const stats = includeMeta
        ? await getConnectionStatsForUser(user.id)
        : { totalConnections: 0, pendingIncoming: 0, pendingSent: 0 };
    const searchPattern = safeSearch ? containsLikePattern(safeSearch.toLowerCase()) : undefined;
    const searchTokens = safeSearch ? tokenizeSearchQuery(safeSearch.toLowerCase()) : [];
    const rawParsedCursor = parseConnectionsCursor(input.cursor);

    if (tab === 'network') {
        const sortBy = input.sortBy ?? 'recent';
        const parsedCursor = rawParsedCursor?.sortMode === sortBy ? rawParsedCursor : null;
        const conditions = [
            eq(connections.status, 'accepted'),
            or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id)),
            eq(profiles.onboardingStatus, 'completed'),
        ];

        if (searchPattern && safeSearch) conditions.push(searchTokens.length === 1
            ? buildProfileNameFuzzySearchCondition(searchPattern, safeSearch)
            : buildProfileNameIlikeSearchCondition(searchTokens));

        if (parsedCursor) {
            if (sortBy === 'name' && parsedCursor.kind === 'name') {
                conditions.push(buildNameSortedConnectionsCursorCondition(parsedCursor));
            } else if (sortBy === 'oldest' && parsedCursor.kind === 'date') {
                conditions.push(buildConnectionDateCursorCondition({
                    column: connections.updatedAt,
                    isoValue: parsedCursor.updatedAt,
                    id: parsedCursor.id,
                    direction: 'after',
                }));
            } else if (sortBy !== 'name' && parsedCursor.kind === 'date') {
                conditions.push(buildConnectionDateCursorCondition({
                    column: connections.updatedAt,
                    isoValue: parsedCursor.updatedAt,
                    id: parsedCursor.id,
                    direction: 'before',
                }));
            }
        }

        const orderClauses = sortBy === 'name'
            ? [
                sql`${profiles.fullName} ASC NULLS LAST`,
                sql`${profiles.username} ASC NULLS LAST`,
                desc(connections.id),
            ]
            : sortBy === 'oldest'
                ? [asc(connections.updatedAt), asc(connections.id)]
                : [desc(connections.updatedAt), desc(connections.id)];

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

        const items = rows.slice(0, limit).map((row) => ({
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

        const nextCursor = hasMore && visibleItems.length > 0
            ? sortBy === 'name'
                ? encodeConnectionsNameCursor(
                    visibleItems[visibleItems.length - 1]!.otherUser.fullName,
                    visibleItems[visibleItems.length - 1]!.otherUser.username,
                    visibleItems[visibleItems.length - 1]!.id,
                )
                : encodeConnectionsCursor(visibleItems[visibleItems.length - 1]!.updatedAt, visibleItems[visibleItems.length - 1]!.id, sortBy)
            : null;

        recordPreview(visibleItems.length > 0 ? 'success' : 'empty', visibleItems.length);
        return { success: true as const, items: visibleItems, hasMore, nextCursor, stats };
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

        const conditions = [
            eq(connections.status, 'pending'),
            userCondition,
            eq(profiles.onboardingStatus, 'completed'),
        ];
        if (searchPattern) conditions.push(buildProfileNameIlikeSearchCondition(searchTokens));
        if (!isMutualRequestsSort && rawParsedCursor?.kind === 'date') {
            conditions.push(buildConnectionDateCursorCondition({
                column: connections.createdAt,
                isoValue: rawParsedCursor.updatedAt,
                id: rawParsedCursor.id,
                direction: 'before',
            }));
        }

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
                input.requestSortBy === 'oldest' ? asc(connections.createdAt) : desc(connections.createdAt),
                input.requestSortBy === 'oldest' ? asc(connections.id) : desc(connections.id),
            );

        const effectiveLimit = Math.min(limit + 1, MAX_REQUESTS_LIMIT);
        const rows = await requestsQuery.limit(effectiveLimit);

        const rawHasMore = rows.length > limit;

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
                    items[items.length - 1]!.mutualCount ?? 0,
                    items[items.length - 1]!.createdAt,
                    items[items.length - 1]!.id,
                )
                : null;
            return { success: true as const, items, hasMore, nextCursor, stats };
        }

        const items = dedupedItems.slice(0, limit);
        const nextCursor = rawHasMore && items.length > 0
            ? encodeConnectionsCursor(
                items[items.length - 1]!.createdAt,
                items[items.length - 1]!.id,
                input.requestSortBy === 'oldest' ? 'oldest' : 'recent',
            )
            : null;

        return { success: true as const, items, hasMore: rawHasMore, nextCursor, stats };
    }

    let suggestionCursor: { score: number; id: string } | null = null;
    if (input.cursor?.startsWith('s:')) {
        const [scoreValue, id] = input.cursor.slice(2).split('|');
        const score = Number(scoreValue);
        if (Number.isFinite(score) && id) suggestionCursor = { score, id };
    }

    const discoverConditions = [
        eq(connectionSuggestions.userId, user.id),
        eq(profiles.onboardingStatus, 'completed'),
        isNull(profiles.deletedAt),
        sql`NOT EXISTS (
            SELECT 1 FROM ${connectionSuggestionDismissals}
            WHERE ${connectionSuggestionDismissals.userId} = ${user.id}
              AND ${connectionSuggestionDismissals.dismissedProfileId} = ${profiles.id}
        )`,
        sql`NOT EXISTS (
            SELECT 1 FROM ${connections} existing
            WHERE (existing.requester_id = ${user.id} AND existing.addressee_id = ${profiles.id})
               OR (existing.requester_id = ${profiles.id} AND existing.addressee_id = ${user.id})
        )`,
    ];
    if (suggestionCursor) discoverConditions.push(buildSuggestionScoreCursorCondition(suggestionCursor));
    if (searchPattern) {
        discoverConditions.push(eq(profiles.visibility, 'public'));
        discoverConditions.push(buildDiscoverProfileSearchCondition(searchTokens));
    }
    if (input.filters?.seniorPlus) discoverConditions.push(sql`${profiles.experienceLevel} IN ('senior', 'lead', 'founder')`);
    if (input.filters?.hasMutuals) discoverConditions.push(sql`${connectionSuggestions.mutualConnectionsCount} > 0`);
    if (input.filters?.hasSharedProjects) {
        discoverConditions.push(sql`EXISTS (SELECT 1 FROM ${projects} WHERE ${projects.ownerId} = ${profiles.id})`);
    }

    const rows = searchPattern ? [] : await db
        .select({
            suggestedUserId: connectionSuggestions.suggestedUserId,
            mutualConnectionsCount: connectionSuggestions.mutualConnectionsCount,
            score: connectionSuggestions.score,
            reason: connectionSuggestions.reason,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
            headline: profiles.headline,
            location: profiles.location,
            visibility: profiles.visibility,
            messagePrivacy: profiles.messagePrivacy,
            experienceLevel: profiles.experienceLevel,
            lastActiveAt: profiles.lastActiveAt,
            skills: profiles.skills,
            interests: profiles.interests,
            openTo: profiles.openTo,
        })
        .from(connectionSuggestions)
        .innerJoin(profiles, eq(profiles.id, connectionSuggestions.suggestedUserId))
        .where(and(...discoverConditions))
        .orderBy(desc(connectionSuggestions.score), desc(connectionSuggestions.suggestedUserId))
        .limit(limit + 1);

    let items = rows.slice(0, limit).map((row) => {
        const profileVisibility = (row.visibility || 'public') as SuggestedProfile['profileVisibility'];
        return {
            id: row.suggestedUserId,
            type: 'discover' as const,
            username: row.username,
            fullName: row.fullName,
            avatarUrl: row.avatarUrl,
            headline: row.headline,
            location: row.location,
            connectionStatus: 'none' as const,
            canConnect: true,
            profileVisibility,
            isLockedProfile: profileVisibility !== 'public',
            mutualConnections: row.mutualConnectionsCount,
            recommendationReason: row.reason || `${row.mutualConnectionsCount} mutual connections`,
            experienceLevel: row.experienceLevel as SuggestedProfile['experienceLevel'],
            openTo: (row.openTo as string[]) ?? [],
            messagePrivacy: (row.messagePrivacy || 'connections') as SuggestedProfile['messagePrivacy'],
            canSendMessage: row.messagePrivacy === 'everyone',
            lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
            skills: (row.skills as string[]) ?? [],
            interests: (row.interests as string[]) ?? [],
        };
    });

    let searchFallbackHasMore = false;
    let searchFallbackNextCursor: string | null = null;

    // Search must cover every eligible profile, not only the viewer's precomputed
    // suggestion rows. The same query is also the cold-start fallback.
    if (!suggestionCursor && !input.filters?.hasMutuals && (Boolean(searchPattern) || items.length === 0)) {
        const fallbackConditions = [
            sql`${profiles.id} != ${user.id}`,
            eq(profiles.onboardingStatus, 'completed'),
            isNull(profiles.deletedAt),
        ];
        if (searchPattern) {
            fallbackConditions.push(sql`NOT EXISTS (
                SELECT 1 FROM ${connections} blocked_connection
                WHERE blocked_connection.status = 'blocked'
                  AND (
                    (blocked_connection.requester_id = ${user.id} AND blocked_connection.addressee_id = ${profiles.id})
                    OR (blocked_connection.requester_id = ${profiles.id} AND blocked_connection.addressee_id = ${user.id})
                  )
            )`);
            fallbackConditions.push(sql`(
                ${profiles.visibility} = 'public'
                OR EXISTS (
                    SELECT 1 FROM ${connections} accepted_connection
                    WHERE accepted_connection.status = 'accepted'
                      AND (
                        (accepted_connection.requester_id = ${user.id} AND accepted_connection.addressee_id = ${profiles.id})
                        OR (accepted_connection.requester_id = ${profiles.id} AND accepted_connection.addressee_id = ${user.id})
                      )
                )
            )`);
            fallbackConditions.push(buildDiscoverProfileSearchCondition(searchTokens));
        } else {
            fallbackConditions.push(sql`NOT EXISTS (
                SELECT 1 FROM ${connectionSuggestionDismissals}
                WHERE ${connectionSuggestionDismissals.userId} = ${user.id}
                  AND ${connectionSuggestionDismissals.dismissedProfileId} = ${profiles.id}
            )`);
            fallbackConditions.push(sql`NOT EXISTS (
                SELECT 1 FROM ${connections} existing
                WHERE (existing.requester_id = ${user.id} AND existing.addressee_id = ${profiles.id})
                   OR (existing.requester_id = ${profiles.id} AND existing.addressee_id = ${user.id})
            )`);
        }
        if (input.filters?.seniorPlus) fallbackConditions.push(sql`${profiles.experienceLevel} IN ('senior', 'lead', 'founder')`);
        if (input.filters?.hasSharedProjects) {
            fallbackConditions.push(sql`EXISTS (SELECT 1 FROM ${projects} WHERE ${projects.ownerId} = ${profiles.id})`);
        }
        if (searchPattern && rawParsedCursor?.kind === 'date' && rawParsedCursor.sortMode === 'recent') {
            fallbackConditions.push(buildConnectionDateCursorCondition({
                column: profiles.updatedAt,
                idColumn: profiles.id,
                isoValue: rawParsedCursor.updatedAt,
                id: rawParsedCursor.id,
                direction: 'before',
            }));
        }

        const fallbackRows = await db
            .select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                headline: profiles.headline,
                location: profiles.location,
                visibility: profiles.visibility,
                messagePrivacy: profiles.messagePrivacy,
                experienceLevel: profiles.experienceLevel,
                lastActiveAt: profiles.lastActiveAt,
                skills: profiles.skills,
                interests: profiles.interests,
                openTo: profiles.openTo,
                updatedAt: profiles.updatedAt,
            })
            .from(profiles)
            .where(and(...fallbackConditions))
            .orderBy(
                searchPattern ? sql`CASE
                    WHEN lower(coalesce(${profiles.username}, '')) = ${safeSearch?.toLowerCase() ?? ''} THEN 100
                    WHEN lower(coalesce(${profiles.fullName}, '')) = ${safeSearch?.toLowerCase() ?? ''} THEN 95
                    WHEN lower(coalesce(${profiles.username}, '')) LIKE ${(safeSearch?.toLowerCase() ?? '') + '%'} THEN 80
                    WHEN lower(coalesce(${profiles.fullName}, '')) LIKE ${(safeSearch?.toLowerCase() ?? '') + '%'} THEN 75
                    ELSE 10
                END DESC` : desc(profiles.lastActiveAt),
                searchPattern ? desc(profiles.updatedAt) : desc(profiles.id),
                desc(profiles.id),
            )
            .limit(limit + 1);

        const fallbackPageRows = fallbackRows.slice(0, limit);
        if (searchPattern) {
            searchFallbackHasMore = fallbackRows.length > limit;
            const lastFallbackRow = fallbackPageRows[fallbackPageRows.length - 1];
            searchFallbackNextCursor = searchFallbackHasMore && lastFallbackRow
                ? encodeConnectionsCursor(lastFallbackRow.updatedAt, lastFallbackRow.id, 'recent')
                : null;
        }

        items = fallbackPageRows.map((row) => {
            const profileVisibility = (row.visibility || 'public') as SuggestedProfile['profileVisibility'];
            return {
                id: row.id,
                type: 'discover' as const,
                username: row.username,
                fullName: row.fullName,
                avatarUrl: row.avatarUrl,
                headline: row.headline,
                location: row.location,
                connectionStatus: 'none' as const,
                canConnect: true,
                profileVisibility,
                isLockedProfile: profileVisibility !== 'public',
                mutualConnections: 0,
                recommendationReason: "Suggested for your network",
                experienceLevel: row.experienceLevel as SuggestedProfile['experienceLevel'],
                openTo: (row.openTo as string[]) ?? [],
                messagePrivacy: (row.messagePrivacy || 'connections') as SuggestedProfile['messagePrivacy'],
                canSendMessage: row.messagePrivacy === 'everyone',
                lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
                skills: (row.skills as string[]) ?? [],
                interests: (row.interests as string[]) ?? [],
            };
        });
    }
    const visibleItems = await applySuggestedProfilePrivacy(user.id, items);
    const [viewerProjects, viewerProfiles] = await Promise.all([
        includeMeta ? db.select({ id: projects.id }).from(projects).where(eq(projects.ownerId, user.id)).limit(50) : Promise.resolve([]),
        includeMeta ? db.select({ skills: profiles.skills }).from(profiles).where(eq(profiles.id, user.id)).limit(1) : Promise.resolve([]),
        recordPrivacyReadEvents({
            subjectUserIds: visibleItems.map((item) => item.id),
            viewerUserId: user.id,
            eventType: 'discover_profile_served',
            route: 'connections.discover.precomputed',
            metadata: { count: visibleItems.length },
        }),
    ]);
    const hasMore = searchPattern ? searchFallbackHasMore : rows.length > limit;
    const last = rows[Math.min(limit - 1, rows.length - 1)];
    recordPreview(visibleItems.length > 0 ? 'success' : 'empty', visibleItems.length);
    return {
        success: true as const,
        items: visibleItems,
        hasMore,
        nextCursor: searchPattern
            ? searchFallbackNextCursor
            : hasMore && last ? `s:${last.score}|${last.suggestedUserId}` : null,
        stats,
        viewerProjectIds: viewerProjects.map((project) => project.id),
        viewerSkills: (viewerProfiles[0]?.skills as string[]) ?? [],
    };
}

export async function getConnectionsFeed(input: ConnectionsFeedInput) {
    const user = await getAuthUser();
    if (!user) {
        return getConnectionsFeedImpl(input);
    }
    const safeSearch = input.search ? input.search.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
    const includeMeta = input.includeMeta !== false;
    const cacheKey = !includeMeta && safeSearch
        ? `search:preview:people:${user.id}:${input.tab}:${safeSearch.toLowerCase()}`
        : null;

    if (cacheKey) {
        const cached = await getCachedData<any>(cacheKey);
        if (cached) {
            return cached as Awaited<ReturnType<typeof getConnectionsFeedImpl>>;
        }
    }

    const result = await getConnectionsFeedImpl(input);

    if (cacheKey && result && result.success && result.items.length > 0) {
        await cacheData(cacheKey, result, 180);
    }

    return result;
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

            let nextCursor: string | null = null;
            if (hasMore && items.length > 0) {
                const last = items[items.length - 1];
                nextCursor = `${last!.eventAt}|${last!.id}`;
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

// Two anti-spam layers independent of the short-window per-user and
// per-target token buckets above. The daily cap stops "phishing-style" fan-out
// where one compromised account DMs hundreds of strangers per day; the
// per-(sender, target) 24h hold prevents oscillating the same request until a
// bucket refills.
const CONNECTION_REQUEST_DAILY_CAP = 50;
const CONNECTION_REQUEST_DAILY_WINDOW_SECONDS = 24 * 60 * 60;
const CONNECTION_REQUEST_PER_TARGET_HOLD_SECONDS = 24 * 60 * 60;

async function clearConnectionRequestHold(userA: string, userB: string) {
    if (!redis) return;
    try {
        await Promise.allSettled([
            redis.del(`connections-send-hold:${userA}:${userB}`),
            redis.del(`connections-send-hold:${userB}:${userA}`),
        ]);
    } catch {
        // A stale hold should never make terminal DB states unrecoverable.
    }
}

export async function sendConnectionRequest(
    addresseeId: string,
    idempotencyKey?: string,
    _message?: string,
): Promise<{
    success: boolean;
    error?: string;
    connectionId?: string;
    status?: 'created' | 'pending_sent' | 'pending_received' | 'connected';
}> {
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
        // Clamp message length to prevent oversized payloads.
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

        const [existingConnection] = await db
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

        if (existingConnection?.status === 'accepted') {
            return { success: true, connectionId: existingConnection.id, status: 'connected' };
        }

        if (existingConnection?.status === 'pending') {
            return {
                success: true,
                connectionId: existingConnection.id,
                status: existingConnection.requesterId === user.id ? 'pending_sent' : 'pending_received',
            };
        }

        if (existingConnection?.status === 'blocked') {
            return await returnFailure('You cannot send a request to this account.');
        }

        if (existingConnection?.status === 'rejected') {
            const isSameDirection = existingConnection.requesterId === user.id && existingConnection.addresseeId === addresseeId;
            if (isSameDirection) {
                const cooldownUntil = new Date(new Date(existingConnection.updatedAt).getTime() + REJECT_REQUEST_COOLDOWN_MS);
                if (cooldownUntil.getTime() > Date.now()) {
                    return await returnFailure(`This request was recently declined. You can retry after ${cooldownUntil.toLocaleString()}.`);
                }
            }
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

        const canRetryExistingConnection =
            existingConnection?.status === 'cancelled'
            || existingConnection?.status === 'disconnected'
            || existingConnection?.status === 'rejected';

        if (canRetryExistingConnection) {
            await clearConnectionRequestHold(user.id, addresseeId);
        }

        const perTargetHoldKey = `connections-send-hold:${user.id}:${addresseeId}`;
        const shouldEnforcePerTargetHold = !existingConnection;
        if (shouldEnforcePerTargetHold && redis) {
            try {
                const held = await redis.get(perTargetHoldKey);
                if (held) {
                    return await returnFailure('You have recently contacted this person. Please wait before trying again.');
                }
            } catch {
                // Fall through — Redis hiccup should not block legit flow.
            }
        }

        const requestRate = await consumeRateLimit(`connections-send:${user.id}`, 30, 60);
        if (!requestRate.allowed) {
            return await returnFailure('Too many requests. Please wait and try again.');
        }
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
                const conn = existing[0]!;
                if (conn.status === 'accepted') return { connectionId: conn.id, status: 'connected' as const, skippedWrite: true };
                if (conn.status === 'pending') {
                    return {
                        connectionId: conn.id,
                        status: conn.requesterId === user.id ? 'pending_sent' as const : 'pending_received' as const,
                        skippedWrite: true,
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
                            message: requestMessage,
                            updatedAt: new Date(),
                            createdAt: new Date(), // PURE OPTIMIZATION: Reset createdAt so it bubbles to top of incoming feeds
                        })
                        .where(eq(connections.id, conn.id));
                    return { connectionId: conn.id, status: 'created' as const };
                }
            }

            try {
                const inserted = await tx
                    .insert(connections)
                    .values({
                        requesterId: user.id,
                        addresseeId: addresseeId,
                        status: 'pending',
                        message: requestMessage,
                    })
                    .returning({ id: connections.id });
                return { connectionId: inserted[0]!.id, status: 'created' as const };
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

        if (!txResult.skippedWrite && redis) {
            try {
                await redis.set(perTargetHoldKey, '1', {
                    nx: true,
                    ex: CONNECTION_REQUEST_PER_TARGET_HOLD_SECONDS,
                });
            } catch { /* ignore */ }
        }

        await queueCounterRefreshBestEffort([addresseeId]);
        await invalidateDiscoverCacheForUsers([user.id, addresseeId]);


        if (!txResult.skippedWrite) {
            try {
                await emitConnectionRequestReceivedNotification({
                    recipientUserId: addresseeId,
                    actorUserId: user.id,
                    actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
                    actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
                    connectionId: txResult.connectionId,
                    eventKey: new Date().toISOString(),
                });
            } catch (notificationError) {
                console.error('[sendConnectionRequest] Notification failed:', {
                    connectionId: txResult.connectionId,
                    actorUserId: user.id,
                    recipientUserId: addresseeId,
                    error: notificationError instanceof Error ? notificationError.message : String(notificationError),
                });
            }
        }

        await revalidateConnectionsPaths();
        return { success: true, connectionId: txResult.connectionId, status: txResult.status ?? 'created' };
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

        // Validate and clamp dismiss feedback reason.
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

        await invalidateDiscoverCacheForUsers([user.id]);
        revalidatePath('/people');
        return { success: true };
    } catch (error) {
        console.error('Error dismissing suggestion:', error);
        return { success: false, error: 'Failed to dismiss suggestion' };
    }
}

export async function acceptAllIncomingConnectionRequests(
    limit: number = 100
): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const effectiveLimit = Math.max(1, Math.min(limit, 200));
        const bulkAcceptRate = await consumeRateLimit(`connections-accept-all:${user.id}`, 6, 60);
        if (!bulkAcceptRate.allowed) {
            return { success: false, error: 'Too many bulk actions. Please wait and try again.' };
        }

        const accepted = await db.transaction(async (tx) => {
            const pendingRows = await tx
                .select({ id: connections.id })
                .from(connections)
                .where(
                    and(
                        eq(connections.addresseeId, user.id),
                        eq(connections.status, 'pending')
                    )
                )
                .orderBy(desc(connections.createdAt), desc(connections.id))
                .limit(effectiveLimit);
            const pendingIds = pendingRows.map((row) => row.id);
            if (pendingIds.length === 0) return [];

            const rows = await tx
                .update(connections)
                .set({
                    status: 'accepted',
                    updatedAt: new Date(),
                })
                .where(inArray(connections.id, pendingIds))
                .returning({
                    id: connections.id,
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                });

            for (const row of rows) {
                await applyConnectionsCountDelta(tx, [row.requesterId, row.addresseeId], 1);
            }
            return rows;
        });

        if (accepted.length > 0) {
            const affectedUserIds = new Set<string>([user.id]);
            for (const row of accepted) {
                affectedUserIds.add(row.requesterId);
                affectedUserIds.add(row.addresseeId);
            }

            await Promise.allSettled(
                accepted.map((row) => clearConnectionRequestHold(row.requesterId, row.addresseeId)),
            );
            await queueCounterRefreshBestEffort([...affectedUserIds]);
            await invalidateDiscoverCacheForUsers(affectedUserIds);
            await Promise.allSettled([
                ...[...affectedUserIds].map((userId) => syncConnectionsToRedis(userId)),
                ...[...affectedUserIds].map((userId) =>
                    inngest.send({ name: 'workspace/connections.sync_suggestions', data: { userId } }),
                ),
                ...accepted.map((row) =>
                    emitConnectionAcceptedNotification({
                        recipientUserId: row.requesterId,
                        actorUserId: row.addresseeId,
                        actorName: (user.user_metadata?.full_name as string | undefined)
                            ?? (user.user_metadata?.username as string | undefined)
                            ?? null,
                        actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
                        connectionId: row.id,
                        eventKey: `${row.id}:${new Date().toISOString()}`,
                    }),
                ),
            ]);
            await revalidateConnectionsPaths();
        }

        return { success: true, count: accepted.length };
    } catch (error) {
        console.error('Error accepting all requests:', error);
        return { success: false, error: 'Failed to accept all requests' };
    }
}

export async function rejectAllIncomingConnectionRequests(
    limit: number = 100
): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const effectiveLimit = Math.max(1, Math.min(limit, 200));
        const bulkRejectRate = await consumeRateLimit(`connections-reject-all:${user.id}`, 6, 60);
        if (!bulkRejectRate.allowed) {
            return { success: false, error: 'Too many bulk actions. Please wait and try again.' };
        }

        const rejected = await db.transaction(async (tx) => {
            const pendingRows = await tx
                .select({ id: connections.id })
                .from(connections)
                .where(
                    and(
                        eq(connections.addresseeId, user.id),
                        eq(connections.status, 'pending')
                    )
                )
                .orderBy(desc(connections.createdAt), desc(connections.id))
                .limit(effectiveLimit);
            const pendingIds = pendingRows.map((row) => row.id);
            if (pendingIds.length === 0) return [];

            return tx
                .update(connections)
                .set({
                    status: 'rejected',
                    rejectionReason: null,
                    updatedAt: new Date(),
                })
                .where(inArray(connections.id, pendingIds))
                .returning({
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                });
        });

        if (rejected.length > 0) {
            const affectedUserIds = new Set<string>([user.id]);
            for (const row of rejected) {
                affectedUserIds.add(row.requesterId);
                affectedUserIds.add(row.addresseeId);
            }
            await queueCounterRefreshBestEffort([...affectedUserIds]);
            await invalidateDiscoverCacheForUsers(affectedUserIds);
            await revalidateConnectionsPaths();
        }

        return { success: true, count: rejected.length };
    } catch (error) {
        console.error('Error rejecting all requests:', error);
        return { success: false, error: 'Failed to reject all requests' };
    }
}

// ============================================================================
// CANCEL CONNECTION REQUEST (Requester only, pending only)
// ============================================================================

export async function cancelConnectionRequest(
    connectionId: string
): Promise<{
    success: boolean;
    error?: string;
    connectionId?: string;
    requesterId?: string;
    addresseeId?: string;
    status?: 'withdrawn' | 'already_withdrawn';
}> {
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

        let cancelled: {
            id: string;
            requesterId: string;
            addresseeId: string;
            status: 'withdrawn' | 'already_withdrawn';
        } | null = updated ? {
            id: updated.id,
            requesterId: updated.requesterId,
            addresseeId: updated.addresseeId,
            status: 'withdrawn' as const,
        } : null;

        if (!cancelled) {
            const [existing] = await db
                .select({
                    id: connections.id,
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                    status: connections.status,
                })
                .from(connections)
                .where(and(eq(connections.id, connectionId), eq(connections.requesterId, user.id)))
                .limit(1);

            if (!existing) return { success: false, error: 'Request not found' };
            if (existing.status === 'cancelled') {
                cancelled = {
                    id: existing.id,
                    requesterId: existing.requesterId,
                    addresseeId: existing.addresseeId,
                    status: 'already_withdrawn' as const,
                };
            } else if (existing.status === 'accepted') {
                return { success: false, error: 'Request was already accepted.' };
            } else if (existing.status === 'rejected') {
                return { success: false, error: 'Request was already declined.' };
            } else {
                return { success: false, error: 'Request cannot be withdrawn.' };
            }
        }
        if (!cancelled) return { success: false, error: 'Request cannot be withdrawn.' };

        await clearConnectionRequestHold(cancelled.requesterId, cancelled.addresseeId);
        await queueCounterRefreshBestEffort([cancelled.addresseeId]);
        await invalidateDiscoverCacheForUsers([cancelled.requesterId, cancelled.addresseeId]);
        await revalidateConnectionsPaths();
        return {
            success: true,
            connectionId: cancelled.id,
            requesterId: cancelled.requesterId,
            addresseeId: cancelled.addresseeId,
            status: cancelled.status,
        };
    } catch (error) {
        console.error('Error cancelling request:', error);
        return { success: false, error: 'Failed to withdraw request' };
    }
}

// ============================================================================
// ACCEPT CONNECTION REQUEST (Addressee only)
// ============================================================================

// Accept a caller-supplied `idempotencyKey` so a double-clicked
// "Accept" button, a flaky network retry, or an offline queue flush never
// produces two acceptance events for the same pending request. The key is
// scoped to (user, connectionId) so a key cannot replay across different
// connections or across users.
export async function acceptConnectionRequest(
    connectionId: string,
    opts?: { idempotencyKey?: string }
): Promise<{ success: boolean; error?: string; requesterId?: string; addresseeId?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const acceptRate = await consumeRateLimit(`connections-accept:${user.id}`, 60, 60);
        if (!acceptRate.allowed) {
            return { success: false, error: 'Too many actions. Please wait and try again.' };
        }

        const { result } = await runIdempotent<{ success: boolean; error?: string; requesterId?: string; addresseeId?: string }>(
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

                    if (updated.length === 0) {
                        const [existing] = await tx
                            .select({
                                requesterId: connections.requesterId,
                                addresseeId: connections.addresseeId,
                                status: connections.status,
                            })
                            .from(connections)
                            .where(and(eq(connections.id, connectionId), eq(connections.addresseeId, user.id)))
                            .limit(1);

                        if (existing?.status === 'accepted') {
                            return {
                                requesterId: existing.requesterId,
                                addresseeId: existing.addresseeId,
                                changed: false,
                            };
                        }

                        return null;
                    }

                    await applyConnectionsCountDelta(
                        tx,
                        [updated[0]!.requesterId, updated[0]!.addresseeId],
                        1
                    );

                    return { ...updated[0], changed: true };
                });

                if (!accepted) {
                    return { success: false, error: 'Request not found' };
                }

                const acceptedRequesterId = accepted.requesterId;
                const acceptedAddresseeId = accepted.addresseeId;
                if (!acceptedRequesterId || !acceptedAddresseeId) {
                    return { success: false, error: 'Connection record is incomplete' };
                }

                await clearConnectionRequestHold(acceptedRequesterId, acceptedAddresseeId);
                await queueCounterRefreshBestEffort([acceptedRequesterId, acceptedAddresseeId]);
                await invalidateDiscoverCacheForUsers([acceptedRequesterId, acceptedAddresseeId]);

                if (accepted.changed) {
                    await Promise.allSettled([
                        syncConnectionsToRedis(acceptedRequesterId),
                        syncConnectionsToRedis(acceptedAddresseeId),
                        inngest.send({ name: 'workspace/connections.sync_suggestions', data: { userId: acceptedRequesterId } }),
                        inngest.send({ name: 'workspace/connections.sync_suggestions', data: { userId: acceptedAddresseeId } }),
                    ]).catch(console.error);

                    try {
                        await emitConnectionAcceptedNotification({
                            recipientUserId: acceptedRequesterId,
                            actorUserId: acceptedAddresseeId,
                            actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
                            actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
                            connectionId,
                            eventKey: new Date().toISOString(),
                        });
                    } catch (notificationError) {
                        console.error('[acceptConnectionRequest] Notification failed:', {
                            connectionId,
                            actorUserId: acceptedAddresseeId,
                            recipientUserId: acceptedRequesterId,
                            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
                        });
                    }
                }

                await revalidateConnectionsPaths();
                return { success: true, requesterId: acceptedRequesterId, addresseeId: acceptedAddresseeId };
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

// Accept an optional idempotencyKey so rapid double-submits don't
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

        await clearConnectionRequestHold(removed.requesterId, removed.addresseeId);
        await invalidateDiscoverCacheForUsers([removed.requesterId, removed.addresseeId]);

        // Non-blocking sync to Redis Edge Cache (removes from set).
        await Promise.allSettled([
            syncConnectionsToRedis(removed.requesterId),
            syncConnectionsToRedis(removed.addresseeId),
        ]).catch(console.error);

        await revalidateConnectionsPaths();
        return { success: true };
    } catch (error) {
        console.error('Error removing connection:', error);
        return { success: false, error: 'Failed to remove connection' };
    }
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

        const visibility = targetProfile[0]!.visibility || 'public';
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

    const normalizedSearch = normalizeSearchQuery(search || '').toLowerCase();
    const searchPattern = normalizedSearch ? containsLikePattern(normalizedSearch) : undefined;
    const searchTokens = normalizedSearch ? tokenizeSearchQuery(normalizedSearch) : [];
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

    if (searchPattern) conditions.push(buildProfileNameIlikeSearchCondition(searchTokens));

    if (cursorDate && cursorConnectionId) {
        conditions.push(buildConnectionDateCursorCondition({
            column: connections.updatedAt,
            isoValue: cursorDate.toISOString(),
            id: cursorConnectionId,
            direction: 'before',
        }));
    } else if (cursorDate) {
        conditions.push(buildConnectionDateCursorCondition({
            column: connections.updatedAt,
            isoValue: cursorDate.toISOString(),
            direction: 'before',
        }));
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
        ? `${connectionList[connectionList.length - 1]!.updatedAt.toISOString()}|${connectionList[connectionList.length - 1]!.id}`
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

export async function withdrawAllSentConnectionRequests(): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const withdrawRate = await consumeRateLimit(`connections-withdraw-all:${user.id}`, 6, 60);
        if (!withdrawRate.allowed) {
            return { success: false, error: 'Too many bulk actions. Please wait and try again.' };
        }

        const withdrawn = await db
            .update(connections)
            .set({
                status: 'cancelled',
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(connections.requesterId, user.id),
                    eq(connections.status, 'pending')
                )
            )
            .returning({
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
            });

        if (withdrawn.length > 0) {
            await Promise.allSettled(
                withdrawn.map((row) => clearConnectionRequestHold(row.requesterId, row.addresseeId)),
            );

            const affectedUserIds = new Set<string>([user.id]);
            for (const row of withdrawn) {
                affectedUserIds.add(row.addresseeId);
            }

            await queueCounterRefreshBestEffort([...affectedUserIds]);
            await invalidateDiscoverCacheForUsers(affectedUserIds);
            await revalidateConnectionsPaths();
        }

        return { success: true, count: withdrawn.length };
    } catch (error) {
        console.error('connections.withdraw_all_sent_failed', { error });
        return { success: false, error: 'Failed to withdraw requests' };
    }
}
