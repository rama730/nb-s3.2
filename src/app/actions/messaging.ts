'use server';

import { db } from '@/lib/db';
import {
    conversations,
    dmPairs,
    conversationParticipants,
    messages,
    messageAttachments,
    profiles
} from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import { eq, and, desc, lt, gt, ne, isNull, inArray, sql, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

// ============================================================================
// TYPES
// ============================================================================

export interface ConversationWithDetails {
    id: string;
    type: 'dm' | 'group';
    updatedAt: Date;
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

export interface MessageWithSender {
    id: string;
    conversationId: string;
    senderId: string | null;
    content: string | null;
    type: 'text' | 'image' | 'video' | 'file' | 'system' | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
    editedAt: Date | null;
    deletedAt: Date | null;
    sender: {
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
    } | null;
    attachments: Array<{
        id: string;
        type: 'image' | 'video' | 'file';
        url: string;
        filename: string;
        sizeBytes: number | null;
        mimeType: string | null;
        thumbnailUrl: string | null;
        width: number | null;
        height: number | null;
    }>;
}

export interface SendMessageResult {
    success: boolean;
    error?: string;
    message?: MessageWithSender;
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
// GET OR CREATE DM CONVERSATION (OPTIMIZED - No nested loops)
// ============================================================================

export async function getOrCreateDMConversation(
    otherUserId: string
): Promise<{ success: boolean; error?: string; conversationId?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        if (user.id === otherUserId) {
            return { success: false, error: 'Cannot message yourself' };
        }

        const [low, high] = user.id < otherUserId ? [user.id, otherUserId] : [otherUserId, user.id];

        const conversationId = await db.transaction(async (tx) => {
            // Serialize DM creation per pair to prevent duplicates.
            await tx.execute(sql`
                SELECT pg_advisory_xact_lock(
                    hashtext(CAST(${low} AS text)),
                    hashtext(CAST(${high} AS text))
                )
            `);

            const existing = await tx
                .select({ conversationId: dmPairs.conversationId })
                .from(dmPairs)
                .where(and(eq(dmPairs.userLow, low), eq(dmPairs.userHigh, high)))
                .limit(1);

            if (existing[0]?.conversationId) {
                // Ensure both participants exist (repair if needed).
                await tx.insert(conversationParticipants)
                    .values([
                        { conversationId: existing[0].conversationId, userId: user.id },
                        { conversationId: existing[0].conversationId, userId: otherUserId },
                    ])
                    .onConflictDoNothing({
                        target: [conversationParticipants.conversationId, conversationParticipants.userId],
                    });

                return existing[0].conversationId;
            }

            const [newConversation] = await tx
                .insert(conversations)
                .values({ type: 'dm' })
                .returning({ id: conversations.id });

            await tx.insert(conversationParticipants)
                .values([
                    { conversationId: newConversation.id, userId: user.id },
                    { conversationId: newConversation.id, userId: otherUserId },
                ])
                .onConflictDoNothing({
                    target: [conversationParticipants.conversationId, conversationParticipants.userId],
                });

            await tx.insert(dmPairs).values({
                userLow: low,
                userHigh: high,
                conversationId: newConversation.id,
            });

            return newConversation.id;
        });

        return { success: true, conversationId };
    } catch (error) {
        console.error('Error getting/creating conversation:', error);
        return { success: false, error: 'Failed to create conversation' };
    }
}

// ============================================================================
// GET USER'S CONVERSATIONS (OPTIMIZED - No N+1 queries)
// ============================================================================

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

        // QUERY 1: Get filtered/paginated conversation IDs for this user
        // We order by lastReadAt vaguely or we need a proper join to order by updated_at?
        // Ideally conversations are ordered by 'updated_at' descending.
        // The previous implementation selected from `conversationParticipants` which doesn't have `updated_at`.
        // To properly sort by most recent, we need to join with `conversations`.

        const userConversations = await db.execute<{
            conversation_id: string;
            unread_count: number;
            last_message_at: Date | null;
            updated_at: Date;
        }>(sql`
            SELECT 
                cp.conversation_id,
                cp.unread_count,
                cp.last_message_at,
                c.updated_at
            FROM ${conversationParticipants} cp
            INNER JOIN ${conversations} c ON c.id = cp.conversation_id
            WHERE cp.user_id = ${user.id}
            AND c.type != 'project_group'
            ${cursor ? sql`AND (cp.last_message_at < ${new Date(cursor).toISOString()} OR cp.last_message_at IS NULL)` : sql``}
            ORDER BY cp.last_message_at DESC NULLS LAST
            LIMIT ${limit + 1}
        `);

        const userConvArray = Array.from(userConversations);
        const hasMore = userConvArray.length > limit;
        const paginatedConvs = userConvArray.slice(0, limit);

        if (paginatedConvs.length === 0) {
            return { success: true, conversations: [], hasMore: false };
        }

        const conversationIds = paginatedConvs.map((c: any) => c.conversation_id);

        // QUERY 2: Get conversation details + last message using window function
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
                SELECT id, content, sender_id, created_at, type
                FROM ${messages}
                WHERE conversation_id = c.id 
                AND deleted_at IS NULL
                ORDER BY created_at DESC
                LIMIT 1
            ) lm ON true
            WHERE c.id IN ${conversationIds}
        `);

        // Map for fast lookup of conversation details (type, last message)
        const detailsMap = new Map(Array.from(conversationsWithLastMessage).map((c: any) => [c.id, c]));

        // QUERY 3: Get all participants for these conversations
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

        // Build participant map
        const participantMap = new Map<string, typeof allParticipants>();
        for (const p of allParticipants) {
            if (!participantMap.has(p.conversationId)) {
                participantMap.set(p.conversationId, []);
            }
            if (p.userId !== user.id) {
                participantMap.get(p.conversationId)!.push(p);
            }
        }

        // Build final result
        const result: ConversationWithDetails[] = paginatedConvs.map((userConv: any) => {
            const details = detailsMap.get(userConv.conversation_id);
            if (!details) return null; // Should not happen due to FK

            return {
                id: details.id,
                type: details.type as 'dm' | 'group',
                updatedAt: userConv.last_message_at || userConv.updated_at || new Date(),
                participants: (participantMap.get(details.id) || []).map(p => ({
                    id: p.userId,
                    username: p.username,
                    fullName: p.fullName,
                    avatarUrl: p.avatarUrl,
                })),
                lastMessage: details.last_message_id ? {
                    id: details.last_message_id,
                    content: details.last_message_content,
                    senderId: details.last_message_sender_id,
                    createdAt: details.last_message_created_at!,
                    type: details.last_message_type,
                } : null,
                unreadCount: userConv.unread_count || 0, // O(1) Read from denormalized column
            };
        }).filter(Boolean) as ConversationWithDetails[];

        // Re-sort client side just in case mapping shuffled, though map preservation usually works
        // The initial query defined the order.

        return {
            success: true,
            conversations: result,
            hasMore,
            nextCursor: hasMore ? result[result.length - 1].updatedAt.toISOString() : undefined
        };
    } catch (error) {
        console.error('Error fetching conversations:', error);
        return { success: false, error: 'Failed to fetch conversations' };
    }
}

// ============================================================================
// GET MESSAGES FOR A CONVERSATION (Paginated)
// ============================================================================

export async function getMessages(
    conversationId: string,
    cursor?: string,
    limit: number = 30
): Promise<{
    success: boolean;
    error?: string;
    messages?: MessageWithSender[];
    hasMore?: boolean;
    nextCursor?: string;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        // Verify user is participant
        const participant = await db
            .select()
            .from(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, user.id)
                )
            )
            .limit(1);

        if (participant.length === 0) {
            return { success: false, error: 'Not a participant of this conversation' };
        }

        // Build query
        const query = db
            .select({
                id: messages.id,
                conversationId: messages.conversationId,
                senderId: messages.senderId,
                content: messages.content,
                type: messages.type,
                metadata: messages.metadata,
                createdAt: messages.createdAt,
                editedAt: messages.editedAt,
                deletedAt: messages.deletedAt,
            })
            .from(messages)
            .where(
                cursor
                    ? and(
                        eq(messages.conversationId, conversationId),
                        lt(messages.createdAt, new Date(cursor))
                    )
                    : eq(messages.conversationId, conversationId)
            )
            .orderBy(desc(messages.createdAt))
            .limit(limit + 1);

        const messageList = await query;
        const hasMore = messageList.length > limit;
        const paginatedMessages = messageList.slice(0, limit);

        if (paginatedMessages.length === 0) {
            return { success: true, messages: [], hasMore: false };
        }

        // Get sender profiles
        const senderIds = [...new Set(paginatedMessages.map(m => m.senderId).filter(Boolean))] as string[];
        const senderProfiles = senderIds.length > 0
            ? await db
                .select({
                    id: profiles.id,
                    username: profiles.username,
                    fullName: profiles.fullName,
                    avatarUrl: profiles.avatarUrl,
                })
                .from(profiles)
                .where(inArray(profiles.id, senderIds))
            : [];

        const senderMap = new Map(senderProfiles.map(s => [s.id, s]));

        // Get attachments
        const messageIds = paginatedMessages.map(m => m.id);
        const attachmentList = await db
            .select()
            .from(messageAttachments)
            .where(inArray(messageAttachments.messageId, messageIds));

        const attachmentMap = new Map<string, typeof attachmentList>();
        for (const att of attachmentList) {
            if (!attachmentMap.has(att.messageId)) {
                attachmentMap.set(att.messageId, []);
            }
            attachmentMap.get(att.messageId)!.push(att);
        }

        // Build result (reverse to show oldest first in UI)
        const result: MessageWithSender[] = paginatedMessages.reverse().map(m => ({
            id: m.id,
            conversationId: m.conversationId,
            senderId: m.senderId,
            content: m.content,
            type: m.type as MessageWithSender['type'],
            metadata: m.metadata || {},
            createdAt: m.createdAt,
            editedAt: m.editedAt,
            deletedAt: m.deletedAt,
            sender: m.senderId ? senderMap.get(m.senderId) || null : null,
            attachments: (attachmentMap.get(m.id) || []).map(a => ({
                id: a.id,
                type: a.type as 'image' | 'video' | 'file',
                url: a.url,
                filename: a.filename,
                sizeBytes: a.sizeBytes,
                mimeType: a.mimeType,
                thumbnailUrl: a.thumbnailUrl,
                width: a.width,
                height: a.height,
            })),
        }));

        return {
            success: true,
            messages: result,
            hasMore,
            nextCursor: hasMore ? paginatedMessages[paginatedMessages.length - 1].createdAt.toISOString() : undefined,
        };
    } catch (error) {
        console.error('Error fetching messages:', error);
        return { success: false, error: 'Failed to fetch messages' };
    }
}

// ============================================================================
// SEND MESSAGE
// ============================================================================

export async function sendMessage(
    conversationId: string,
    content: string,
    type: 'text' | 'image' | 'video' | 'file' = 'text',
    attachmentIds?: string[]
): Promise<SendMessageResult> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        // Verify user is participant
        const participant = await db
            .select()
            .from(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, user.id)
                )
            )
            .limit(1);

        if (participant.length === 0) {
            return { success: false, error: 'Not a participant of this conversation' };
        }

        // Validate content
        if (!content?.trim() && (!attachmentIds || attachmentIds.length === 0)) {
            return { success: false, error: 'Message cannot be empty' };
        }

        // Use transaction for atomic message send + count update
        const { newMessage, senderProfile } = await db.transaction(async (tx) => {
            // 1. Insert message
            const [msg] = await tx
                .insert(messages)
                .values({
                    conversationId,
                    senderId: user.id,
                    content: content?.trim() || null,
                    type,
                })
                .returning();

            // 2. Get sender profile
            const [profile] = await tx
                .select({
                    id: profiles.id,
                    username: profiles.username,
                    fullName: profiles.fullName,
                    avatarUrl: profiles.avatarUrl,
                })
                .from(profiles)
                .where(eq(profiles.id, user.id))
                .limit(1);

            // 3. Update conversation timestamp
            const now = new Date();
            await tx
                .update(conversations)
                .set({ updatedAt: now })
                .where(eq(conversations.id, conversationId));

            // 4. Update Recipient(s) counter
            await tx.update(conversationParticipants)
                .set({
                    unreadCount: sql`unread_count + 1`,
                    lastMessageAt: now
                })
                .where(
                    and(
                        eq(conversationParticipants.conversationId, conversationId),
                        ne(conversationParticipants.userId, user.id)
                    )
                );

            // 5. Update Sender state
            await tx.update(conversationParticipants)
                .set({
                    lastMessageAt: now,
                    unreadCount: 0,
                    lastReadAt: now
                })
                .where(
                    and(
                        eq(conversationParticipants.conversationId, conversationId),
                        eq(conversationParticipants.userId, user.id)
                    )
                );

            return { newMessage: msg, senderProfile: profile };
        });

        revalidatePath('/messages');

        return {
            success: true,
            message: {
                id: newMessage.id,
                conversationId: newMessage.conversationId,
                senderId: newMessage.senderId,
                content: newMessage.content,
                type: newMessage.type as MessageWithSender['type'],
                metadata: newMessage.metadata || {},
                createdAt: newMessage.createdAt,
                editedAt: newMessage.editedAt,
                deletedAt: newMessage.deletedAt,
                sender: senderProfile || null,
                attachments: [],
            },
        };
    } catch (error) {
        console.error('Error sending message:', error);
        return { success: false, error: 'Failed to send message' };
    }
}

// ============================================================================
// MARK CONVERSATION AS READ
// ============================================================================

export async function markConversationAsRead(
    conversationId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        await db
            .update(conversationParticipants)
            .set({
                lastReadAt: new Date(),
                unreadCount: 0 // Reset denormalized counter
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

// ============================================================================
// SEARCH MESSAGES
// ============================================================================

export async function searchMessages(
    query: string,
    limit: number = 20
): Promise<{
    success: boolean;
    error?: string;
    results?: Array<{
        message: MessageWithSender;
        conversationId: string;
        // Pure Optimization: Return full details to hydrate ghost conversations
        conversation: ConversationWithDetails;
    }>;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        if (!query?.trim()) {
            return { success: true, results: [] };
        }

        // Get user's conversations first
        const userConversations = await db
            .select({ conversationId: conversationParticipants.conversationId })
            .from(conversationParticipants)
            .where(eq(conversationParticipants.userId, user.id));

        if (userConversations.length === 0) {
            return { success: true, results: [] };
        }

        const conversationIds = userConversations.map(c => c.conversationId);

        // Search using full-text search
        const searchResults = await db
            .select({
                id: messages.id,
                conversationId: messages.conversationId,
                senderId: messages.senderId,
                content: messages.content,
                type: messages.type,
                metadata: messages.metadata,
                createdAt: messages.createdAt,
                editedAt: messages.editedAt,
                deletedAt: messages.deletedAt,
            })
            .from(messages)
            .where(
                and(
                    inArray(messages.conversationId, conversationIds),
                    sql`${messages.deletedAt} IS NULL`,
                    sql`to_tsvector('english', coalesce(${messages.content}, '')) @@ plainto_tsquery('english', ${query})`
                )
            )
            .orderBy(desc(messages.createdAt))
            .limit(limit);

        if (searchResults.length === 0) {
            return { success: true, results: [] };
        }

        // Get sender profiles
        const senderIds = [...new Set(searchResults.map(m => m.senderId).filter(Boolean))] as string[];
        const senderProfiles = senderIds.length > 0
            ? await db
                .select({
                    id: profiles.id,
                    username: profiles.username,
                    fullName: profiles.fullName,
                    avatarUrl: profiles.avatarUrl,
                })
                .from(profiles)
                .where(inArray(profiles.id, senderIds))
            : [];

        const senderMap = new Map(senderProfiles.map(s => [s.id, s]));

        // Pure Optimization: Hydrate conversation details for found messages
        // This prevents "Ghost Conversation" crashes in the client
        const resultConversationIds = [...new Set(searchResults.map(m => m.conversationId))];

        // 1. Get conversation details + last message
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
                SELECT id, content, sender_id, created_at, type
                FROM ${messages}
                WHERE conversation_id = c.id 
                AND deleted_at IS NULL
                ORDER BY created_at DESC
                LIMIT 1
            ) lm ON true
            WHERE c.id IN ${resultConversationIds}
        `);

        // 2. Get participants
        const allParticipants = await db
            .select({
                conversationId: conversationParticipants.conversationId,
                userId: conversationParticipants.userId,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                unreadCount: conversationParticipants.unreadCount, // Get denormalized count
            })
            .from(conversationParticipants)
            .innerJoin(profiles, eq(profiles.id, conversationParticipants.userId))
            .where(inArray(conversationParticipants.conversationId, resultConversationIds));

        // 3. Build Maps
        const detailsMap = new Map(Array.from(conversationsWithLastMessage).map((c: any) => [c.id, c]));
        const participantMap = new Map<string, typeof allParticipants>();

        let selfUnreadMap = new Map<string, number>();

        for (const p of allParticipants) {
            if (!participantMap.has(p.conversationId)) {
                participantMap.set(p.conversationId, []);
            }
            if (p.userId !== user.id) {
                participantMap.get(p.conversationId)!.push(p);
            } else {
                // Capture my unread count for this conversation
                selfUnreadMap.set(p.conversationId, p.unreadCount || 0);
            }
        }

        const results = searchResults.map(m => {
            const details = detailsMap.get(m.conversationId);
            const participants = participantMap.get(m.conversationId) || [];

            // Build full conversation object
            const conversation: ConversationWithDetails = {
                id: m.conversationId,
                type: details?.type as 'dm' | 'group' || 'dm',
                updatedAt: details?.updated_at || new Date(),
                participants: participants.map(p => ({
                    id: p.userId,
                    username: p.username,
                    fullName: p.fullName,
                    avatarUrl: p.avatarUrl,
                })),
                lastMessage: details?.last_message_id ? {
                    id: details.last_message_id,
                    content: details.last_message_content,
                    senderId: details.last_message_sender_id,
                    createdAt: details.last_message_created_at!,
                    type: details.last_message_type,
                } : null,
                unreadCount: selfUnreadMap.get(m.conversationId) || 0
            };

            return {
                conversationId: m.conversationId,
                message: {
                    id: m.id,
                    conversationId: m.conversationId,
                    senderId: m.senderId,
                    content: m.content,
                    type: m.type as MessageWithSender['type'],
                    metadata: m.metadata || {},
                    createdAt: m.createdAt,
                    editedAt: m.editedAt,
                    deletedAt: m.deletedAt,
                    sender: m.senderId ? senderMap.get(m.senderId) || null : null,
                    attachments: [],
                },
                conversation
            };
        });

        return { success: true, results };
    } catch (error) {
        console.error('Error searching messages:', error);
        return { success: false, error: 'Failed to search messages' };
    }
}

// ============================================================================
// DELETE MESSAGE (Soft delete)
// ============================================================================

export async function deleteMessage(
    messageId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        // Only allow deleting own messages
        const [existingMessage] = await db
            .select()
            .from(messages)
            .where(
                and(
                    eq(messages.id, messageId),
                    eq(messages.senderId, user.id)
                )
            )
            .limit(1);

        if (!existingMessage) {
            return { success: false, error: 'Message not found or not authorized' };
        }

        await db
            .update(messages)
            .set({ deletedAt: new Date() })
            .where(eq(messages.id, messageId));

        revalidatePath('/messages');
        return { success: true };
    } catch (error) {
        console.error('Error deleting message:', error);
        return { success: false, error: 'Failed to delete message' };
    }
}

// ============================================================================
// GET UNREAD COUNT
// ============================================================================

export async function getUnreadCount(): Promise<{
    success: boolean;
    count?: number;
    error?: string;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        // Optimized: O(1) Sum of denormalized columns
        // No loop, no joins with messages table
        const [result] = await db
            .select({ count: sql<number>`SUM(unread_count)::int` })
            .from(conversationParticipants)
            .where(eq(conversationParticipants.userId, user.id));

        return { success: true, count: result?.count || 0 };
    } catch (error) {
        console.error('Error getting unread count:', error);
        return { success: false, error: 'Failed to get unread count' };
    }
}

// ============================================================================
// UPLOAD ATTACHMENT
// ============================================================================

export interface UploadedAttachment {
    id: string;
    type: 'image' | 'video' | 'file';
    url: string;
    filename: string;
    sizeBytes: number;
    mimeType: string;
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
}

export async function uploadAttachment(
    formData: FormData
): Promise<{ success: boolean; error?: string; attachment?: UploadedAttachment }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const file = formData.get('file') as File;
        if (!file) return { success: false, error: 'No file provided' };

        // Validate file size (50MB max)
        const MAX_SIZE = 50 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            return { success: false, error: 'File too large. Maximum size is 50MB.' };
        }

        // Determine file type
        let fileType: 'image' | 'video' | 'file' = 'file';
        if (file.type.startsWith('image/')) {
            fileType = 'image';
        } else if (file.type.startsWith('video/')) {
            fileType = 'video';
        }

        // Generate unique filename
        const timestamp = Date.now();
        const ext = file.name.split('.').pop() || 'bin';
        const uniqueName = `${timestamp}-${Math.random().toString(36).substring(7)}.${ext}`;
        const storagePath = `${user.id}/${uniqueName}`;

        // Upload to Supabase Storage
        const supabase = await createClient();
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('chat-attachments')
            .upload(storagePath, file, {
                contentType: file.type,
                upsert: false,
            });

        if (uploadError) {
            console.error('Storage upload error:', uploadError);
            return { success: false, error: 'Failed to upload file' };
        }

        // Get public URL (signed URL for private bucket)
        const { data: urlData } = await supabase.storage
            .from('chat-attachments')
            .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year expiry

        if (!urlData?.signedUrl) {
            return { success: false, error: 'Failed to generate file URL' };
        }

        // Generate thumbnail URL for images
        let thumbnailUrl: string | null = null;
        if (fileType === 'image') {
            // Supabase image transformations
            thumbnailUrl = urlData.signedUrl.replace(
                '/object/sign/',
                '/render/image/sign/'
            ) + '&width=200&height=200&resize=cover';
        }

        const attachment: UploadedAttachment = {
            id: uploadData.path,
            type: fileType,
            url: urlData.signedUrl,
            filename: file.name,
            sizeBytes: file.size,
            mimeType: file.type,
            thumbnailUrl,
            width: null,
            height: null,
        };

        return { success: true, attachment };
    } catch (error) {
        console.error('Error uploading attachment:', error);
        return { success: false, error: 'Failed to upload attachment' };
    }
}

// ============================================================================
// SEND MESSAGE WITH ATTACHMENTS
// ============================================================================

export async function sendMessageWithAttachments(
    conversationId: string,
    content: string,
    attachments: UploadedAttachment[]
): Promise<SendMessageResult> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        // Verify user is participant
        const participant = await db
            .select()
            .from(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, user.id)
                )
            )
            .limit(1);

        if (participant.length === 0) {
            return { success: false, error: 'Not a participant of this conversation' };
        }

        // Validate content
        if (!content?.trim() && attachments.length === 0) {
            return { success: false, error: 'Message cannot be empty' };
        }

        // Determine message type based on attachments
        let messageType: 'text' | 'image' | 'video' | 'file' = 'text';
        if (attachments.length > 0) {
            const primaryAttachment = attachments[0];
            messageType = primaryAttachment.type;
        }

        // Insert message
        const [newMessage] = await db
            .insert(messages)
            .values({
                conversationId,
                senderId: user.id,
                content: content?.trim() || null,
                type: messageType,
            })
            .returning();

        // Insert attachments
        if (attachments.length > 0) {
            await db.insert(messageAttachments).values(
                attachments.map(att => ({
                    messageId: newMessage.id,
                    type: att.type,
                    url: att.url,
                    filename: att.filename,
                    sizeBytes: att.sizeBytes,
                    mimeType: att.mimeType,
                    thumbnailUrl: att.thumbnailUrl,
                    width: att.width,
                    height: att.height,
                }))
            );
        }

        // Get sender profile
        const [senderProfile] = await db
            .select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(eq(profiles.id, user.id))
            .limit(1);

        // Update conversation timestamp
        await db
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, conversationId));

        // Mark as read for sender
        await db
            .update(conversationParticipants)
            .set({ lastReadAt: new Date() })
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, user.id)
                )
            );

        revalidatePath('/messages');

        return {
            success: true,
            message: {
                id: newMessage.id,
                conversationId: newMessage.conversationId,
                senderId: newMessage.senderId,
                content: newMessage.content,
                type: newMessage.type as MessageWithSender['type'],
                metadata: newMessage.metadata || {},
                createdAt: newMessage.createdAt,
                editedAt: newMessage.editedAt,
                deletedAt: newMessage.deletedAt,
                sender: senderProfile || null,
                attachments: attachments.map(att => ({
                    id: att.id,
                    type: att.type,
                    url: att.url,
                    filename: att.filename,
                    sizeBytes: att.sizeBytes,
                    mimeType: att.mimeType,
                    thumbnailUrl: att.thumbnailUrl,
                    width: att.width,
                    height: att.height,
                })),
            },
        };
    } catch (error) {
        console.error('Error sending message with attachments:', error);
        return { success: false, error: 'Failed to send message' };
    }
}


// ============================================================================
// GET PROJECT GROUPS (User's Projects with Chat)
// ============================================================================

import { projects, projectMembers } from '@/lib/db/schema';

export interface ProjectGroupConversation {
    id: string; // conversationId
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

        // OPTIMIZED: Single query fetching project details, member counts, last message, AND unread counts
        // Uses the denormalized 'unread_count' from conversation_participants for O(1) performance
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
                    cp.unread_count -- Get denormalized unread count directly
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
                SELECT id, content, sender_id, created_at, type
                FROM ${messages}
                WHERE conversation_id = up.conversation_id 
                AND deleted_at IS NULL
                ORDER BY created_at DESC
                LIMIT 1
            ) lm ON true
            LEFT JOIN member_counts mc ON mc.project_id = up.project_id
            ORDER BY up.updated_at DESC
        `);

        const projectArray = Array.from(projectGroupsResult);
        const hasMore = projectArray.length > limit;
        const paginatedProjects = projectArray.slice(0, limit);

        // No separate unread count query needed anymore!

        // Build result
        const result: ProjectGroupConversation[] = paginatedProjects.map((proj: any) => ({
            id: proj.conversation_id,
            projectId: proj.project_id,
            projectTitle: proj.project_title,
            projectSlug: proj.project_slug,
            projectCoverImage: proj.project_cover_image,
            updatedAt: proj.updated_at,
            lastMessage: proj.last_message_id ? {
                id: proj.last_message_id,
                content: proj.last_message_content,
                senderId: proj.last_message_sender_id,
                createdAt: proj.last_message_created_at!,
                type: proj.last_message_type,
            } : null,
            unreadCount: proj.unread_count || 0,
            memberCount: proj.member_count || 1,
        }));

        return { success: true, projectGroups: result, hasMore };
    } catch (error) {
        console.error('Error fetching project groups:', error);
        return { success: false, error: 'Failed to fetch project groups' };
    }
}
