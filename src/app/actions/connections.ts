'use server';

import { db } from '@/lib/db';
import { connectionSuggestionDismissals, connections, profiles, projects, roleApplications } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq, and, or, desc, sql, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { consumeRateLimit } from '@/lib/security/rate-limit';

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
    mutualConnections?: number;
    recommendationReason?: string;
    projects: Array<{ id: string; title: string; status: string | null }>;
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
    mutualConnections: number;
    recommendationReason: string;
    projects: SuggestedProfile['projects'];
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
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ============================================================================
// HELPER: Get authenticated user
// ============================================================================

async function getAuthUser() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

function sortConnectionPair(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
}

async function lockConnectionPair(tx: DbTransaction, a: string, b: string) {
    const [low, high] = sortConnectionPair(a, b);
    await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
            hashtext(CAST(${low} AS text)),
            hashtext(CAST(${high} AS text))
        )
    `);
}

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

async function applyConnectionsCountIncrements(tx: DbTransaction, increments: Map<string, number>) {
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

async function revalidateConnectionsPaths() {
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
            skills: profiles.skills,
            interests: profiles.interests,
            createdAt: profiles.createdAt,
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

    const [existingConnections, candidateProjects] = await Promise.all([
        db
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
            ),
        db
            .select({
                ownerId: projects.ownerId,
                id: projects.id,
                title: projects.title,
                status: projects.status,
            })
            .from(projects)
            .where(inArray(projects.ownerId, candidateIds))
            .orderBy(desc(projects.createdAt)),
    ]);

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

    const mutualCounts = new Map<string, number>();
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

    const projectsByOwner = new Map<string, Array<{ id: string; title: string; status: string | null }>>();
    for (const project of candidateProjects) {
        if (!projectsByOwner.has(project.ownerId)) {
            projectsByOwner.set(project.ownerId, []);
        }
        const ownerProjects = projectsByOwner.get(project.ownerId)!;
        if (ownerProjects.length < 3) {
            ownerProjects.push({ id: project.id, title: project.title, status: project.status });
        }
    }

    const connectionByCandidate = new Map<string, { status: typeof connections.$inferSelect.status; requesterId: string; id: string }>();
    for (const conn of existingConnections) {
        const candidateId = conn.requesterId === user.id ? conn.addresseeId : conn.requesterId;
        connectionByCandidate.set(candidateId, { status: conn.status, requesterId: conn.requesterId, id: conn.id });
    }

    const scored = candidates.map((candidate) => {
        const conn = connectionByCandidate.get(candidate.id);
        const candidateSignals = new Set<string>([
            ...((candidate.skills || []).map((v) => v.toLowerCase())),
            ...((candidate.interests || []).map((v) => v.toLowerCase())),
        ]);
        let overlap = 0;
        for (const signal of candidateSignals) {
            if (mySignals.has(signal)) overlap += 1;
        }
        const mutual = mutualCounts.get(candidate.id) || 0;
        const recency = Math.max(0, 365 - (Date.now() - new Date(candidate.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        const score = overlap * 5 + mutual * 3 + recency * 0.03;

        const status = conn?.status === 'accepted'
            ? 'connected'
            : conn?.status === 'pending'
                ? (conn.requesterId === user.id ? 'pending_sent' : 'pending_received')
                : 'none';

        const canConnect = status === 'none';
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

    scored.sort((a, b) => b.score - a.score || +new Date(b.createdAt) - +new Date(a.createdAt));
    const hasMore = scored.length > limit;
    const items = scored.slice(0, limit).map((candidate) => ({
        id: candidate.id,
        type: 'discover' as const,
        username: candidate.username,
        fullName: candidate.fullName,
        avatarUrl: candidate.avatarUrl,
        headline: candidate.headline,
        location: candidate.location,
        connectionStatus: candidate.status as SuggestedProfile['connectionStatus'],
        canConnect: candidate.canConnect,
        mutualConnections: candidate.mutual,
        recommendationReason: candidate.recommendationReason,
        projects: projectsByOwner.get(candidate.id) || [],
    }));

    const nextCursor = hasMore ? `o:${safeOffset + limit}` : null;
    return { success: true as const, items, hasMore, nextCursor, stats };
}

// ============================================================================
// SEND CONNECTION REQUEST
// ============================================================================

export async function sendConnectionRequest(
    addresseeId: string,
    _message?: string
): Promise<{ success: boolean; error?: string; connectionId?: string }> {
    try {
        void _message;
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        // Can't connect to yourself
        if (user.id === addresseeId) {
            return { success: false, error: 'Cannot connect to yourself' };
        }

        const requestRate = await consumeRateLimit(`connections-send:${user.id}`, 30, 60);
        if (!requestRate.allowed) {
            return { success: false, error: 'Too many requests. Please wait and try again.' };
        }

        const [targetProfile] = await db
            .select({ id: profiles.id, visibility: profiles.visibility })
            .from(profiles)
            .where(eq(profiles.id, addresseeId))
            .limit(1);
        if (!targetProfile) {
            return { success: false, error: 'User not found' };
        }
        if (targetProfile.visibility === 'private') {
            return { success: false, error: 'This user is not accepting connection requests.' };
        }

        const txResult = await db.transaction(async (tx) => {
            await lockConnectionPair(tx, user.id, addresseeId);

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

                    await tx
                        .update(connections)
                        .set({
                            requesterId: user.id,
                            addresseeId,
                            status: 'pending',
                            updatedAt: new Date(),
                        })
                        .where(eq(connections.id, conn.id));
                    return { connectionId: conn.id };
                }
            }

            const inserted = await tx
                .insert(connections)
                .values({
                    requesterId: user.id,
                    addresseeId: addresseeId,
                    status: 'pending',
                })
                .returning({ id: connections.id });

            return { connectionId: inserted[0].id };
        });

        if (!txResult.connectionId) {
            return { success: false, error: txResult.error || 'Failed to send request' };
        }

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

        const acceptedCount = await db.transaction(async (tx) => {
            const rows = await tx
                .select({
                    id: connections.id,
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                })
                .from(connections)
                .where(and(eq(connections.addresseeId, user.id), eq(connections.status, 'pending')))
                .orderBy(desc(connections.createdAt))
                .limit(effectiveLimit);

            if (rows.length === 0) return 0;

            const ids = rows.map((row) => row.id);
            const updated = await tx
                .update(connections)
                .set({
                    status: 'accepted',
                    updatedAt: new Date(),
                })
                .where(and(inArray(connections.id, ids), eq(connections.status, 'pending')))
                .returning({
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                });

            if (updated.length === 0) return 0;

            const increments = new Map<string, number>();
            for (const row of updated) {
                increments.set(row.requesterId, (increments.get(row.requesterId) || 0) + 1);
                increments.set(row.addresseeId, (increments.get(row.addresseeId) || 0) + 1);
            }
            await applyConnectionsCountIncrements(tx, increments);
            return updated.length;
        });

        await revalidateConnectionsPaths();
        return { success: true, acceptedCount };
    } catch (error) {
        console.error('Error accepting all requests:', error);
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

        const rejectedCount = await db.transaction(async (tx) => {
            const rows = await tx
                .select({ id: connections.id })
                .from(connections)
                .where(and(eq(connections.addresseeId, user.id), eq(connections.status, 'pending')))
                .orderBy(desc(connections.createdAt))
                .limit(effectiveLimit);

            if (rows.length === 0) return 0;

            const ids = rows.map((row) => row.id);
            const updated = await tx
                .update(connections)
                .set({
                    status: 'rejected',
                    updatedAt: new Date(),
                })
                .where(and(inArray(connections.id, ids), eq(connections.status, 'pending')))
                .returning({ id: connections.id });

            return updated.length;
        });

        await revalidateConnectionsPaths();
        return { success: true, rejectedCount };
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
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const cancelRate = await consumeRateLimit(`connections-cancel:${user.id}`, 60, 60);
        if (!cancelRate.allowed) {
            return { success: false, error: 'Too many actions. Please wait and try again.' };
        }

        const deleted = await db
            .delete(connections)
            .where(
                and(
                    eq(connections.id, connectionId),
                    eq(connections.requesterId, user.id),
                    eq(connections.status, 'pending')
                )
            )
            .returning({ id: connections.id });

        if (deleted.length === 0) {
            return { success: false, error: 'Request not found or cannot be cancelled' };
        }

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
            .returning({ id: connections.id, updatedAt: connections.updatedAt });

        if (!rejected) {
            return { success: false, error: 'Request not found' };
        }

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
            .returning({ id: connections.id });

        if (!restored) {
            return { success: false, error: 'Undo window expired' };
        }

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
            const deleted = await tx
                .delete(connections)
                .where(
                    and(
                        eq(connections.id, connectionId),
                        eq(connections.status, 'accepted'),
                        or(
                            eq(connections.requesterId, user.id),
                            eq(connections.addresseeId, user.id)
                        )
                    )
                )
                .returning({
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                });

            if (deleted.length === 0) return null;

            await applyConnectionsCountDelta(
                tx,
                [deleted[0].requesterId, deleted[0].addresseeId],
                -1
            );

            return deleted[0];
        });

        if (!removed) {
            return { success: false, error: 'Connection not found' };
        }

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
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const [profileCounter, stats] = await Promise.all([
            db
                .select({ connectionsCount: profiles.connectionsCount })
                .from(profiles)
                .where(eq(profiles.id, targetId))
                .limit(1),
            db.select({
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
                    AND ${connections.updatedAt} >= ${startOfMonth}
                )`,
                connectionsGained: sql<number>`count(*) FILTER (
                    WHERE ${connections.addresseeId} = ${targetId}
                    AND ${connections.status} = 'accepted'
                    AND ${connections.updatedAt} >= ${startOfMonth}
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
            connectionsThisMonth: canViewPrivateStats ? Number(stats[0]?.connectionsThisMonth || 0) : 0,
            connectionsGained: canViewPrivateStats ? Number(stats[0]?.connectionsGained || 0) : 0,
        };
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
    if (offset > 0) {
        const user = await getAuthUser();
        if (!user) return { incoming: [], sent: [], hasMoreIncoming: false, hasMoreSent: false };

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
                .limit(limit + 1)
                .offset(offset),
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
                .limit(limit + 1)
                .offset(offset),
        ]);

        return {
            incoming: incoming.slice(0, limit),
            sent: sent.slice(0, limit),
            hasMoreIncoming: incoming.length > limit,
            hasMoreSent: sent.length > limit,
        };
    }

    const cursor = offset > 0 ? `o:${Math.max(offset, 0)}` : undefined;
    const [incomingFeed, sentFeed] = await Promise.all([
        getConnectionsFeed({ tab: 'requests_incoming', limit, cursor }),
        getConnectionsFeed({ tab: 'requests_sent', limit, cursor }),
    ]);

    if (!incomingFeed.success && !sentFeed.success) {
        return { incoming: [], sent: [], hasMoreIncoming: false, hasMoreSent: false };
    }

    return {
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
        status: row.status as 'accepted' | 'pending' | 'blocked' | 'none',
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

        // 1. Fetch Connection, Target Privacy, AND Role Applications in parallel
        const [existing, targetProfileRes, activeApplications] = await Promise.all([
            db
                .select()
                .from(connections)
                .where(
                    or(
                        and(eq(connections.requesterId, user.id), eq(connections.addresseeId, otherUserId)),
                        and(eq(connections.requesterId, otherUserId), eq(connections.addresseeId, user.id))
                    )
                )
                .orderBy(desc(connections.updatedAt))
                .limit(1),
            db
                .select({ messagePrivacy: profiles.messagePrivacy })
                .from(profiles)
                .where(eq(profiles.id, otherUserId))
                .limit(1),
            db
                .select({
                    id: roleApplications.id,
                    applicantId: roleApplications.applicantId,
                    creatorId: roleApplications.creatorId,
                    status: roleApplications.status,
                    projectId: roleApplications.projectId
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
                .orderBy(desc(roleApplications.createdAt))
                .limit(1)
        ]);

        const targetPrivacy = targetProfileRes[0]?.messagePrivacy || 'connections';
        const activeApp = activeApplications[0];

        // RULE: If there is an active application, the gate is OPEN
        if (activeApp) {
            let connectionId: string | undefined;
            if (existing.length > 0) connectionId = existing[0].id;

            return {
                success: true,
                status: 'open',
                connectionId,
                hasActiveApplication: true,
                activeApplicationId: activeApp.id,
                activeApplicationStatus: activeApp.status as 'pending' | 'accepted' | 'rejected',
                activeProjectId: activeApp.projectId, // Mapped correctly by Drizzle
                isApplicant: activeApp.applicantId === user.id,
                isCreator: activeApp.creatorId === user.id
            };
        }

        if (existing.length > 0) {
            const conn = existing[0];

            // BLOCKED
            if (conn.status === 'blocked') {
                return { success: true, status: 'blocked', connectionId: conn.id };
            }

            // ACCEPTED
            if (conn.status === 'accepted') {
                return { success: true, status: 'connected', connectionId: conn.id };
            }

            // PENDING
            if (conn.status === 'pending') {
                const isRequester = conn.requesterId === user.id;

                if (isRequester) {
                    if (targetPrivacy === 'everyone') {
                        return {
                            success: true,
                            status: 'open',
                            connectionId: conn.id,
                            isPendingSent: true
                        };
                    }
                    return { success: true, status: 'pending_sent', connectionId: conn.id };
                } else {
                    return {
                        success: true,
                        status: 'open',
                        connectionId: conn.id,
                        isIncomingRequest: true
                    };
                }
            }
        }

        // NO CONNECTION
        if (targetPrivacy === 'everyone') {
            return { success: true, status: 'open' };
        }

        return { success: true, status: 'none' };
    } catch (error) {
        console.error('Error checking connection status:', error);
        return { success: false, error: 'Failed to check connection status' };
    }
}
