'use server';

import { db } from '@/lib/db';
import {
    conversations,
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

        // OPTIMIZED: Find existing DM conversation in a single query
        // Uses a JOIN to check if both users are participants in the same DM conversation
        const existingConversation = await db.execute<{
            conversation_id: string;
        }>(sql`
            SELECT DISTINCT cp1.conversation_id
            FROM ${conversationParticipants} cp1
            INNER JOIN ${conversationParticipants} cp2 
                ON cp1.conversation_id = cp2.conversation_id
            INNER JOIN ${conversations} c 
                ON c.id = cp1.conversation_id
            WHERE 
                cp1.user_id = ${user.id}
                AND cp2.user_id = ${otherUserId}
                AND c.type = 'dm'
            LIMIT 1
        `);

        const existingConvArray = Array.from(existingConversation);
        if (existingConvArray.length > 0) {
            // Found existing conversation
            return { success: true, conversationId: (existingConvArray[0] as any).conversation_id };
        }

        // No existing conversation, create new one
        const [newConversation] = await db
            .insert(conversations)
            .values({ type: 'dm' })
            .returning({ id: conversations.id });

        // Add both participants
        await db.insert(conversationParticipants).values([
            { conversationId: newConversation.id, userId: user.id },
            { conversationId: newConversation.id, userId: otherUserId },
        ]);

        return { success: true, conversationId: newConversation.id };
    } catch (error) {
        console.error('Error getting/creating conversation:', error);
        return { success: false, error: 'Failed to create conversation' };
    }
}

// ============================================================================
// GET USER'S CONVERSATIONS (OPTIMIZED - No N+1 queries)
// ============================================================================

export async function getConversations(): Promise<{
    success: boolean;
    error?: string;
    conversations?: ConversationWithDetails[];
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        // QUERY 1: Get all conversation IDs and last read times for this user
        const userConversations = await db
            .select({
                conversationId: conversationParticipants.conversationId,
                lastReadAt: conversationParticipants.lastReadAt,
            })
            .from(conversationParticipants)
            .where(eq(conversationParticipants.userId, user.id));

        if (userConversations.length === 0) {
            return { success: true, conversations: [] };
        }

        const conversationIds = userConversations.map(c => c.conversationId);
        const lastReadMap = new Map(
            userConversations.map(c => [c.conversationId, c.lastReadAt])
        );

        // QUERY 2: Get conversation details + last message using window function
        // This eliminates the N+1 query pattern for last messages
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
            ORDER BY c.updated_at DESC
        `);

        // QUERY 3: Get all participants for these conversations in one query
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

        // QUERY 4: Get unread counts for all conversations in one aggregated query
        // This eliminates the N+1 query pattern for unread counts
        const unreadCountsResult = await db.execute<{
            conversation_id: string;
            unread_count: number;
        }>(sql`
            SELECT 
                m.conversation_id,
                COUNT(*)::int as unread_count
            FROM ${messages} m
            INNER JOIN ${conversationParticipants} cp 
                ON cp.conversation_id = m.conversation_id
            WHERE 
                m.conversation_id IN ${conversationIds}
                AND m.deleted_at IS NULL
                AND m.sender_id != ${user.id}
                AND cp.user_id = ${user.id}
                AND (
                    cp.last_read_at IS NULL 
                    OR m.created_at > cp.last_read_at
                )
            GROUP BY m.conversation_id
        `);

        const unreadMap = new Map(
            Array.from(unreadCountsResult).map((row: any) => [row.conversation_id, row.unread_count])
        );

        // Build participant map (excluding current user)
        const participantMap = new Map<string, typeof allParticipants>();
        for (const p of allParticipants) {
            if (!participantMap.has(p.conversationId)) {
                participantMap.set(p.conversationId, []);
            }
            // Exclude current user from participant list
            if (p.userId !== user.id) {
                participantMap.get(p.conversationId)!.push(p);
            }
        }

        // Build final result
        const result: ConversationWithDetails[] = Array.from(conversationsWithLastMessage).map((conv: any) => ({
            id: conv.id,
            type: conv.type as 'dm' | 'group',
            updatedAt: conv.updated_at,
            participants: (participantMap.get(conv.id) || []).map(p => ({
                id: p.userId,
                username: p.username,
                fullName: p.fullName,
                avatarUrl: p.avatarUrl,
            })),
            lastMessage: conv.last_message_id ? {
                id: conv.last_message_id,
                content: conv.last_message_content,
                senderId: conv.last_message_sender_id,
                createdAt: conv.last_message_created_at!,
                type: conv.last_message_type,
            } : null,
            unreadCount: unreadMap.get(conv.id) || 0,
        }));

        return { success: true, conversations: result };
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

        // Insert message
        const [newMessage] = await db
            .insert(messages)
            .values({
                conversationId,
                senderId: user.id,
                content: content?.trim() || null,
                type,
            })
            .returning();

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

        // Update conversation timestamp (trigger handles this, but explicit is faster)
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
            .set({ lastReadAt: new Date() })
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

        const results = searchResults.map(m => ({
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
        }));

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

        // Get all user's conversations with their last read times
        const participants = await db
            .select({
                conversationId: conversationParticipants.conversationId,
                lastReadAt: conversationParticipants.lastReadAt,
            })
            .from(conversationParticipants)
            .where(eq(conversationParticipants.userId, user.id));

        if (participants.length === 0) {
            return { success: true, count: 0 };
        }

        // Count unread messages across all conversations
        let totalUnread = 0;
        for (const p of participants) {
            const [result] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(messages)
                .where(
                    and(
                        eq(messages.conversationId, p.conversationId),
                        isNull(messages.deletedAt),
                        ne(messages.senderId, user.id),
                        p.lastReadAt ? gt(messages.createdAt, p.lastReadAt) : undefined
                    )
                );
            totalUnread += result?.count || 0;
        }

        return { success: true, count: totalUnread };
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

