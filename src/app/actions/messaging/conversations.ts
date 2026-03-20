'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
    conversationParticipants,
    conversations,
    dmPairs,
    messageHiddenForUsers,
    messages,
    profiles,
    projects,
    projectMembers,
} from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { runInFlightDeduped } from '@/lib/async/inflight-dedupe';

export interface ConversationWithDetails {
    id: string;
    type: 'dm' | 'group' | 'project_group';
    updatedAt: Date;
    lifecycleState?: 'draft' | 'active' | 'archived';
    muted?: boolean;
    participants: Array<{
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
    }>;
    lastMessage: {
        id: string;
        content: string | null;
        senderId: string | null;
        createdAt: Date;
        type: string | null;
    } | null;
    unreadCount: number;
}

export interface ProjectGroupConversation {
    id: string;
    projectId: string;
    projectTitle: string;
    projectSlug: string | null;
    projectCoverImage: string | null;
    updatedAt: Date;
    lastMessage: {
        id: string;
        content: string | null;
        senderId: string | null;
        createdAt: Date;
        type: string | null;
    } | null;
    unreadCount: number;
    memberCount: number;
}

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getAuthUser() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export async function getConversations(
    limit: number = 20,
    cursor?: string
): Promise<{
    success: boolean;
    error?: string;
    conversations?: ConversationWithDetails[];
    hasMore?: boolean;
    nextCursor?: string;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const [cursorAtRaw, cursorConversationIdRaw] = cursor ? cursor.split('|') : [];
        const parsedCursorAt = cursorAtRaw ? new Date(cursorAtRaw) : cursor ? new Date(cursor) : undefined;
        const cursorAt = parsedCursorAt && !Number.isNaN(parsedCursorAt.getTime()) ? parsedCursorAt : undefined;
        const cursorConversationId =
            cursorConversationIdRaw && UUID_V4_REGEX.test(cursorConversationIdRaw)
                ? cursorConversationIdRaw
                : undefined;
        const safeLimit = Math.max(1, Math.min(limit, 100));
        const dedupeKey = `messages:conversations:${user.id}:${safeLimit}:${cursorAt?.toISOString() ?? ''}:${cursorConversationId ?? ''}`;

        return await runInFlightDeduped(dedupeKey, async () => {
            const userConversations = await db.execute<{
                conversation_id: string;
                unread_count: number;
                last_message_at: Date | null;
                updated_at: Date;
                sort_at: Date;
                archived_at: Date | null;
                muted: boolean | null;
            }>(sql`
                SELECT 
                    cp.conversation_id,
                    cp.unread_count,
                    cp.last_message_at,
                    c.updated_at,
                    cp.archived_at,
                    cp.muted,
                    COALESCE(cp.last_message_at, c.updated_at) AS sort_at
                FROM ${conversationParticipants} cp
                INNER JOIN ${conversations} c ON c.id = cp.conversation_id
                WHERE cp.user_id = ${user.id}
                AND cp.archived_at IS NULL
                AND c.type != 'project_group'
                ${cursorAt ? sql`
                    AND (
                        COALESCE(cp.last_message_at, c.updated_at) < ${cursorAt.toISOString()}
                        ${cursorConversationId ? sql`OR (
                            COALESCE(cp.last_message_at, c.updated_at) = ${cursorAt.toISOString()}
                            AND cp.conversation_id < ${cursorConversationId}
                        )` : sql``}
                    )
                ` : sql``}
                ORDER BY COALESCE(cp.last_message_at, c.updated_at) DESC, cp.conversation_id DESC
                LIMIT ${safeLimit + 1}
            `);

            const userConvArray = Array.from(userConversations);
            const hasMore = userConvArray.length > safeLimit;
            const paginatedConvs = userConvArray.slice(0, safeLimit);

            if (paginatedConvs.length === 0) {
                return { success: true, conversations: [], hasMore: false };
            }

            const conversationIds = paginatedConvs.map((conversation) => conversation.conversation_id);

            const conversationsWithLastMessage = await db.execute<{
                id: string;
                type: string;
                updated_at: Date;
                last_message_id: string | null;
                last_message_content: string | null;
                last_message_sender_id: string | null;
                last_message_created_at: Date | null;
                last_message_type: string | null;
            }>(sql`
                SELECT 
                    c.id,
                    c.type,
                    c.updated_at,
                    lm.id as last_message_id,
                    lm.content as last_message_content,
                    lm.sender_id as last_message_sender_id,
                    lm.created_at as last_message_created_at,
                    lm.type as last_message_type
                FROM ${conversations} c
                LEFT JOIN LATERAL (
                    SELECT m.id, m.content, m.sender_id, m.created_at, m.type
                    FROM ${messages} m
                    WHERE m.conversation_id = c.id
                    AND m.deleted_at IS NULL
                    AND NOT EXISTS (
                        SELECT 1
                        FROM ${messageHiddenForUsers} h
                        WHERE h.message_id = m.id
                        AND h.user_id = ${user.id}
                    )
                    ORDER BY m.created_at DESC
                    LIMIT 1
                ) lm ON true
                WHERE c.id IN ${conversationIds}
            `);

            const detailsMap = new Map(Array.from(conversationsWithLastMessage).map((conversation) => [conversation.id, conversation]));

            const allParticipants = await db
                .select({
                    conversationId: conversationParticipants.conversationId,
                    userId: conversationParticipants.userId,
                    username: profiles.username,
                    fullName: profiles.fullName,
                    avatarUrl: profiles.avatarUrl,
                })
                .from(conversationParticipants)
                .innerJoin(profiles, eq(profiles.id, conversationParticipants.userId))
                .where(inArray(conversationParticipants.conversationId, conversationIds));

            const participantMap = new Map<string, typeof allParticipants>();
            for (const participant of allParticipants) {
                if (!participantMap.has(participant.conversationId)) {
                    participantMap.set(participant.conversationId, []);
                }
                if (participant.userId !== user.id) {
                    participantMap.get(participant.conversationId)!.push(participant);
                }
            }

            const result: ConversationWithDetails[] = paginatedConvs.map((userConv) => {
                const details = detailsMap.get(userConv.conversation_id);
                if (!details) return null;

                return {
                    id: details.id,
                    type: details.type as 'dm' | 'group' | 'project_group',
                    updatedAt: userConv.sort_at || userConv.last_message_at || userConv.updated_at || new Date(),
                    lifecycleState: details.last_message_id ? 'active' : 'draft',
                    muted: Boolean(userConv.muted),
                    participants: (participantMap.get(details.id) || []).map((participant) => ({
                        id: participant.userId,
                        username: participant.username,
                        fullName: participant.fullName,
                        avatarUrl: participant.avatarUrl,
                    })),
                    lastMessage: details.last_message_id ? {
                        id: details.last_message_id,
                        content: details.last_message_content,
                        senderId: details.last_message_sender_id,
                        createdAt: details.last_message_created_at!,
                        type: details.last_message_type,
                    } : null,
                    unreadCount: userConv.unread_count || 0,
                };
            }).filter(Boolean) as ConversationWithDetails[];

            return {
                success: true,
                conversations: result,
                hasMore,
                nextCursor: hasMore
                    ? `${paginatedConvs[paginatedConvs.length - 1].sort_at.toISOString()}|${paginatedConvs[paginatedConvs.length - 1].conversation_id}`
                    : undefined,
            };
        });
    } catch (error) {
        console.error('Error fetching conversations:', error);
        return { success: false, error: 'Failed to fetch conversations' };
    }
}

export async function getConversationById(
    conversationId: string
): Promise<{ success: boolean; error?: string; conversation?: ConversationWithDetails }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        return await runInFlightDeduped(`messages:conversation:${user.id}:${conversationId}`, async () => {
            const membership = await db
                .select({
                    unreadCount: conversationParticipants.unreadCount,
                    archivedAt: conversationParticipants.archivedAt,
                    muted: conversationParticipants.muted,
                })
                .from(conversationParticipants)
                .where(
                    and(
                        eq(conversationParticipants.conversationId, conversationId),
                        eq(conversationParticipants.userId, user.id)
                    )
                )
                .limit(1);

            if (membership.length === 0) {
                return { success: false, error: 'Access denied' };
            }

            const detailsRows = await db.execute<{
                id: string;
                type: string;
                updated_at: Date;
                last_message_id: string | null;
                last_message_content: string | null;
                last_message_sender_id: string | null;
                last_message_created_at: Date | null;
                last_message_type: string | null;
            }>(sql`
                SELECT 
                    c.id,
                    c.type,
                    c.updated_at,
                    lm.id as last_message_id,
                    lm.content as last_message_content,
                    lm.sender_id as last_message_sender_id,
                    lm.created_at as last_message_created_at,
                    lm.type as last_message_type
                FROM ${conversations} c
                LEFT JOIN LATERAL (
                    SELECT m.id, m.content, m.sender_id, m.created_at, m.type
                    FROM ${messages} m
                    WHERE m.conversation_id = c.id
                    AND m.deleted_at IS NULL
                    AND NOT EXISTS (
                        SELECT 1
                        FROM ${messageHiddenForUsers} h
                        WHERE h.message_id = m.id
                        AND h.user_id = ${user.id}
                    )
                    ORDER BY m.created_at DESC
                    LIMIT 1
                ) lm ON true
                WHERE c.id = ${conversationId}
                LIMIT 1
            `);

            const details = Array.from(detailsRows)[0];
            if (!details) return { success: false, error: 'Conversation not found' };
            if (details.type === 'project_group') {
                return { success: false, error: 'Unsupported conversation type' };
            }

            const participants = await db
                .select({
                    id: profiles.id,
                    username: profiles.username,
                    fullName: profiles.fullName,
                    avatarUrl: profiles.avatarUrl,
                })
                .from(conversationParticipants)
                .innerJoin(profiles, eq(profiles.id, conversationParticipants.userId))
                .where(
                    and(
                        eq(conversationParticipants.conversationId, conversationId),
                        ne(conversationParticipants.userId, user.id)
                    )
                );

            return {
                success: true,
                conversation: {
                    id: details.id,
                    type: details.type as 'dm' | 'group' | 'project_group',
                    updatedAt: details.last_message_created_at || details.updated_at || new Date(),
                    lifecycleState: membership[0].archivedAt ? 'archived' : details.last_message_id ? 'active' : 'draft',
                    muted: Boolean(membership[0].muted),
                    participants: participants.map((participant) => ({
                        id: participant.id,
                        username: participant.username,
                        fullName: participant.fullName,
                        avatarUrl: participant.avatarUrl,
                    })),
                    lastMessage: details.last_message_id
                        ? {
                            id: details.last_message_id,
                            content: details.last_message_content,
                            senderId: details.last_message_sender_id,
                            createdAt: details.last_message_created_at!,
                            type: details.last_message_type,
                        }
                        : null,
                    unreadCount: membership[0].unreadCount || 0,
                },
            };
        });
    } catch (error) {
        console.error('Error fetching conversation by id:', error);
        return { success: false, error: 'Failed to fetch conversation' };
    }
}

export async function markConversationAsRead(
    conversationId: string,
    lastReadMessageId?: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const [membership] = await db
            .select({
                id: conversationParticipants.id,
                lastReadMessageId: conversationParticipants.lastReadMessageId,
            })
            .from(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, user.id)
                )
            )
            .limit(1);

        if (!membership) {
            return { success: false, error: 'Not a participant of this conversation' };
        }

        let watermarkMessage: { id: string; createdAt: Date } | null = null;

        if (lastReadMessageId) {
            const [explicit] = await db
                .select({ id: messages.id, createdAt: messages.createdAt })
                .from(messages)
                .where(
                    and(
                        eq(messages.id, lastReadMessageId),
                        eq(messages.conversationId, conversationId),
                        isNull(messages.deletedAt)
                    )
                )
                .limit(1);

            if (!explicit) {
                return { success: false, error: 'Read watermark message not found' };
            }
            watermarkMessage = explicit;
        } else {
            const [latest] = await db
                .select({ id: messages.id, createdAt: messages.createdAt })
                .from(messages)
                .where(
                    and(
                        eq(messages.conversationId, conversationId),
                        isNull(messages.deletedAt),
                        sql`NOT EXISTS (
                            SELECT 1
                            FROM ${messageHiddenForUsers} h
                            WHERE h.message_id = ${messages.id}
                            AND h.user_id = ${user.id}
                        )`
                    )
                )
                .orderBy(desc(messages.createdAt))
                .limit(1);

            watermarkMessage = latest || null;
        }

        await db
            .update(conversationParticipants)
            .set({
                lastReadAt: watermarkMessage?.createdAt || new Date(),
                lastReadMessageId: watermarkMessage?.id || membership.lastReadMessageId || null,
                unreadCount: 0,
                archivedAt: null,
            })
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, user.id)
                )
            );

        return { success: true };
    } catch (error) {
        console.error('Error marking as read:', error);
        return { success: false, error: 'Failed to mark as read' };
    }
}

export async function setConversationArchived(
    conversationId: string,
    archived: boolean
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const updated = await db
            .update(conversationParticipants)
            .set({
                archivedAt: archived ? new Date() : null,
            })
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, user.id)
                )
            )
            .returning({ id: conversationParticipants.id });

        if (updated.length === 0) {
            return { success: false, error: 'Conversation not found' };
        }

        revalidatePath('/messages');
        return { success: true };
    } catch (error) {
        console.error('Error updating archive state:', error);
        return { success: false, error: 'Failed to update conversation state' };
    }
}

export async function setConversationMuted(
    conversationId: string,
    muted: boolean
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const updated = await db
            .update(conversationParticipants)
            .set({ muted })
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, user.id)
                )
            )
            .returning({ id: conversationParticipants.id });

        if (updated.length === 0) {
            return { success: false, error: 'Conversation not found' };
        }

        revalidatePath('/messages');
        return { success: true };
    } catch (error) {
        console.error('Error updating mute state:', error);
        return { success: false, error: 'Failed to update mute state' };
    }
}

export async function getUnreadCount(): Promise<{
    success: boolean;
    count?: number;
    error?: string;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const dedupeKey = `messages:unread-count:${user.id}`;

        return await runInFlightDeduped(dedupeKey, async () => {
            const [result] = await db
                .select({ count: sql<number>`SUM(unread_count)::int` })
                .from(conversationParticipants)
                .where(
                    and(
                        eq(conversationParticipants.userId, user.id),
                        isNull(conversationParticipants.archivedAt)
                    )
                );

            return { success: true, count: result?.count || 0 };
        });
    } catch (error) {
        console.error('Error getting unread count:', error);
        return { success: false, error: 'Failed to get unread count' };
    }
}

export async function getProjectGroups(
    limit: number = 20,
    offset: number = 0
): Promise<{
    success: boolean;
    error?: string;
    projectGroups?: ProjectGroupConversation[];
    hasMore?: boolean;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const projectGroupsResult = await db.execute<{
            conversation_id: string;
            project_id: string;
            project_title: string;
            project_slug: string | null;
            project_cover_image: string | null;
            updated_at: Date;
            last_message_id: string | null;
            last_message_content: string | null;
            last_message_sender_id: string | null;
            last_message_created_at: Date | null;
            last_message_type: string | null;
            member_count: number;
            unread_count: number;
        }>(sql`
            WITH user_projects AS (
                SELECT 
                    p.id as project_id,
                    p.conversation_id,
                    p.title as project_title,
                    p.slug as project_slug,
                    p.cover_image as project_cover_image,
                    c.updated_at,
                    cp.unread_count
                FROM ${projects} p
                INNER JOIN ${projectMembers} pm ON pm.project_id = p.id
                INNER JOIN ${conversations} c ON c.id = p.conversation_id
                INNER JOIN ${conversationParticipants} cp ON cp.conversation_id = p.conversation_id AND cp.user_id = ${user.id}
                WHERE pm.user_id = ${user.id}
                AND p.conversation_id IS NOT NULL
                ORDER BY c.updated_at DESC
                LIMIT ${limit + 1} OFFSET ${offset}
            ),
            member_counts AS (
                SELECT 
                    pm.project_id,
                    COUNT(*)::int as member_count
                FROM ${projectMembers} pm
                WHERE pm.project_id IN (SELECT project_id FROM user_projects)
                GROUP BY pm.project_id
            )
            SELECT 
                up.conversation_id,
                up.project_id,
                up.project_title,
                up.project_slug,
                up.project_cover_image,
                up.updated_at,
                lm.id as last_message_id,
                lm.content as last_message_content,
                lm.sender_id as last_message_sender_id,
                lm.created_at as last_message_created_at,
                lm.type as last_message_type,
                COALESCE(mc.member_count, 1) as member_count,
                COALESCE(up.unread_count, 0) as unread_count
            FROM user_projects up
            LEFT JOIN LATERAL (
                SELECT m.id, m.content, m.sender_id, m.created_at, m.type
                FROM ${messages} m
                WHERE m.conversation_id = up.conversation_id
                AND m.deleted_at IS NULL
                AND NOT EXISTS (
                    SELECT 1
                    FROM ${messageHiddenForUsers} h
                    WHERE h.message_id = m.id
                    AND h.user_id = ${user.id}
                )
                ORDER BY m.created_at DESC
                LIMIT 1
            ) lm ON true
            LEFT JOIN member_counts mc ON mc.project_id = up.project_id
            ORDER BY up.updated_at DESC
        `);

        const projectArray = Array.from(projectGroupsResult);
        const hasMore = projectArray.length > limit;
        const paginatedProjects = projectArray.slice(0, limit);

        const result: ProjectGroupConversation[] = paginatedProjects.map((project) => ({
            id: project.conversation_id,
            projectId: project.project_id,
            projectTitle: project.project_title,
            projectSlug: project.project_slug,
            projectCoverImage: project.project_cover_image,
            updatedAt: project.updated_at,
            lastMessage: project.last_message_id ? {
                id: project.last_message_id,
                content: project.last_message_content,
                senderId: project.last_message_sender_id,
                createdAt: project.last_message_created_at!,
                type: project.last_message_type,
            } : null,
            unreadCount: project.unread_count || 0,
            memberCount: project.member_count || 1,
        }));

        return { success: true, projectGroups: result, hasMore };
    } catch (error) {
        console.error('Error fetching project groups:', error);
        return { success: false, error: 'Failed to fetch project groups' };
    }
}
