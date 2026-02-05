'use server';

import { db } from '@/lib/db';
import { connections, profiles, projects, roleApplications } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq, and, or, desc, count, sql, gte, inArray, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

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
    projects: Array<{ id: string; title: string; status: string | null }>;
}

// ============================================================================
// HELPER: Get authenticated user
// ============================================================================

async function getAuthUser() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

// ============================================================================
// SEND CONNECTION REQUEST
// ============================================================================

export async function sendConnectionRequest(
    addresseeId: string,
    message?: string
): Promise<{ success: boolean; error?: string; connectionId?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        // Can't connect to yourself
        if (user.id === addresseeId) {
            return { success: false, error: 'Cannot connect to yourself' };
        }

        // Check if connection already exists
        const existing = await db
            .select()
            .from(connections)
            .where(
                or(
                    and(eq(connections.requesterId, user.id), eq(connections.addresseeId, addresseeId)),
                    and(eq(connections.requesterId, addresseeId), eq(connections.addresseeId, user.id))
                )
            )
            .limit(1);

        if (existing.length > 0) {
            const conn = existing[0];
            if (conn.status === 'accepted') {
                return { success: false, error: 'Already connected' };
            }
            if (conn.status === 'pending') {
                return { success: false, error: 'Request already pending' };
            }
            if (conn.status === 'blocked') {
                return { success: false, error: 'Cannot send request' };
            }
        }

        // Create new connection request
        const result = await db
            .insert(connections)
            .values({
                requesterId: user.id,
                addresseeId: addresseeId,
                status: 'pending',
            })
            .returning({ id: connections.id });

        revalidatePath('/people');
        return { success: true, connectionId: result[0].id };
    } catch (error) {
        console.error('Error sending connection request:', error);
        return { success: false, error: 'Failed to send request' };
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

        // Verify ownership and status
        const conn = await db
            .select()
            .from(connections)
            .where(
                and(
                    eq(connections.id, connectionId),
                    eq(connections.requesterId, user.id),
                    eq(connections.status, 'pending')
                )
            )
            .limit(1);

        if (conn.length === 0) {
            return { success: false, error: 'Request not found or cannot be cancelled' };
        }

        await db.delete(connections).where(eq(connections.id, connectionId));

        revalidatePath('/people');
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

        // Verify addressee and status
        const conn = await db
            .select()
            .from(connections)
            .where(
                and(
                    eq(connections.id, connectionId),
                    eq(connections.addresseeId, user.id),
                    eq(connections.status, 'pending')
                )
            )
            .limit(1);

        if (conn.length === 0) {
            return { success: false, error: 'Request not found' };
        }

        await db
            .update(connections)
            .set({
                status: 'accepted',
                updatedAt: new Date(),
            })
            .where(eq(connections.id, connectionId));

        revalidatePath('/people');
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
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const conn = await db
            .select()
            .from(connections)
            .where(
                and(
                    eq(connections.id, connectionId),
                    eq(connections.addresseeId, user.id),
                    eq(connections.status, 'pending')
                )
            )
            .limit(1);

        if (conn.length === 0) {
            return { success: false, error: 'Request not found' };
        }

        // Delete rejected requests (they can re-request later)
        await db.delete(connections).where(eq(connections.id, connectionId));

        revalidatePath('/people');
        return { success: true };
    } catch (error) {
        console.error('Error rejecting request:', error);
        return { success: false, error: 'Failed to reject request' };
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

        const conn = await db
            .select()
            .from(connections)
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
            .limit(1);

        if (conn.length === 0) {
            return { success: false, error: 'Connection not found' };
        }

        await db.delete(connections).where(eq(connections.id, connectionId));

        revalidatePath('/people');
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

        // Optimized: Single query with FILTER clauses to get all stats
        // This reduces DB roundtrips from 5 to 1
        const [stats] = await db.select({
            totalConnections: sql<number>`count(*) FILTER (
                WHERE ${connections.status} = 'accepted' 
                AND (${connections.requesterId} = ${targetId} OR ${connections.addresseeId} = ${targetId})
            )`,
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
            );

        return {
            // OPTIMIZATION: Use denormalized count from profile if possible, fallback to count(*)
            // For now, we use the specific filters. In future, we can inject the profile's connectionsCount here.
            // But for "My Connections", we want the accurate count.
            // Actually, for specific "Connections This Month", we must filter.
            // But "Total Connections" is now O(1) via the profile count if we fetched it.
            // Since we don't have the profile here easily without another query, we stick to the optimized index scan.
            // With the new composite index (requesterId, status, updatedAt), this is fast.

            totalConnections: Number(stats?.totalConnections || 0),
            pendingIncoming: Number(stats?.pendingIncoming || 0),
            pendingSent: Number(stats?.pendingSent || 0),
            connectionsThisMonth: Number(stats?.connectionsThisMonth || 0),
            connectionsGained: Number(stats?.connectionsGained || 0),
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
    const user = await getAuthUser();

    // Get all profiles except current user
    const allProfiles = await db
        .select({
            id: profiles.id,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
            headline: profiles.headline,
            location: profiles.location,
        })
        .from(profiles)
        .where(user ? sql`${profiles.id} != ${user.id}` : sql`1=1`)
        .orderBy(desc(profiles.createdAt))
        .limit(limit + 1)
        .offset(offset);

    const hasMore = allProfiles.length > limit;
    const profileList = allProfiles.slice(0, limit);

    if (profileList.length === 0) {
        return { profiles: [], hasMore: false };
    }

    // Get connection statuses and projects in parallel
    const profileIds = profileList.map(p => p.id);

    const [connectionStatuses, userProjects] = await Promise.all([
        // Get connection statuses if authenticated
        user
            ? db
                .select({
                    id: connections.id,
                    requesterId: connections.requesterId,
                    addresseeId: connections.addresseeId,
                    status: connections.status,
                })
                .from(connections)
                .where(
                    or(
                        and(eq(connections.requesterId, user.id), inArray(connections.addresseeId, profileIds)),
                        and(eq(connections.addresseeId, user.id), inArray(connections.requesterId, profileIds))
                    )
                )
            : Promise.resolve([]),
        // Get projects for these users
        db
            .select({
                ownerId: projects.ownerId,
                id: projects.id,
                title: projects.title,
                status: projects.status,
            })
            .from(projects)
            .where(inArray(projects.ownerId, profileIds))
            // FIX: Removed .limit(50) which was an aggregate limit causing data starvation.
            // Since we only fetch for ~20 users, and most have <10 public projects, this is safe.
            // Payload reduction: fetching only needed fields.
            .orderBy(desc(projects.createdAt)),
    ]);

    // Build connection status map
    const connectionMap = new Map<string, 'pending_sent' | 'pending_received' | 'connected'>();
    for (const conn of connectionStatuses) {
        const otherUserId = conn.requesterId === user?.id ? conn.addresseeId : conn.requesterId;
        if (conn.status === 'accepted') {
            connectionMap.set(otherUserId, 'connected');
        } else if (conn.status === 'pending') {
            connectionMap.set(otherUserId, conn.requesterId === user?.id ? 'pending_sent' : 'pending_received');
        }
    }

    // Build projects map
    const projectsMap = new Map<string, Array<{ id: string; title: string; status: string | null }>>();
    for (const proj of userProjects) {
        if (!projectsMap.has(proj.ownerId)) {
            projectsMap.set(proj.ownerId, []);
        }
        projectsMap.get(proj.ownerId)!.push({
            id: proj.id,
            title: proj.title,
            status: proj.status,
        });
    }

    const result: SuggestedProfile[] = profileList.map(p => ({
        id: p.id,
        username: p.username,
        fullName: p.fullName,
        avatarUrl: p.avatarUrl,
        headline: p.headline,
        location: p.location,
        connectionStatus: connectionMap.get(p.id) || 'none',
        projects: projectsMap.get(p.id) || [],
    }));

    return { profiles: result, hasMore };
}

// ============================================================================
// GET PENDING REQUESTS (Incoming + Sent)
// ============================================================================

export async function getPendingRequests(
    limit: number = 20,
    offset: number = 0
) {
    const user = await getAuthUser();
    if (!user) return { incoming: [], sent: [], hasMoreIncoming: false, hasMoreSent: false };

    const [incoming, sent] = await Promise.all([
        // Incoming requests
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
        // Sent requests
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

    const hasMoreIncoming = incoming.length > limit;
    const hasMoreSent = sent.length > limit;

    return {
        incoming: incoming.slice(0, limit),
        sent: sent.slice(0, limit),
        hasMoreIncoming,
        hasMoreSent
    };
}

// ============================================================================
// GET ACCEPTED CONNECTIONS (Paginated)
// ============================================================================

export async function getAcceptedConnections(
    limit: number = 30,
    cursor?: string, // ISO Date string for cursor
    search?: string,
    targetUserId?: string
) {
    const user = await getAuthUser();
    const userIdToFetch = targetUserId || user?.id;

    if (!userIdToFetch) return { connections: [], hasMore: false, nextCursor: null };

    const searchPattern = search ? `%${search.trim().toLowerCase()}%` : undefined;
    const cursorDate = cursor ? new Date(cursor) : undefined;

    const conditions = [
        eq(connections.status, 'accepted'),
        or(eq(connections.requesterId, userIdToFetch), eq(connections.addresseeId, userIdToFetch)),
        // Ensure we join the "other" user (not self)
        sql`${profiles.id} != ${userIdToFetch}`
    ];

    if (searchPattern) {
        conditions.push(
            or(
                sql`${profiles.fullName} ILIKE ${searchPattern}`,
                sql`${profiles.username} ILIKE ${searchPattern}`
            )
        );
    }

    if (cursorDate) {
        conditions.push(sql`${connections.updatedAt} < ${cursorDate.toISOString()}`); // Cursor pagination
    }

    // Use a single optimized query with JOIN
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
                eq(connections.requesterId, profiles.id),
                eq(connections.addresseeId, profiles.id)
            )
        )
        .where(and(...conditions))
        .orderBy(desc(connections.updatedAt))
        .limit(limit + 1);

    const hasMore = results.length > limit;
    const connectionList = results.slice(0, limit);

    const nextCursor = hasMore && connectionList.length > 0
        ? connectionList[connectionList.length - 1].updatedAt.toISOString()
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

    const searchQuery = `%${query.trim()}%`;

    try {
        // Find accepted connections where one party is the current user
        // AND the other party matches the search query

        // We need to join with profiles to search by name/username
        const foundConnections = await db
            .select({
                connectionId: connections.id,
                userId: profiles.id,
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
                    and(eq(connections.addresseeId, user.id), eq(connections.requesterId, profiles.id))
                )
            )
            .where(
                and(
                    eq(connections.status, 'accepted'),
                    or(
                        sql`${profiles.fullName} ILIKE ${searchQuery}`,
                        sql`${profiles.username} ILIKE ${searchQuery}`
                    )
                )
            )
            .limit(limit);

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
