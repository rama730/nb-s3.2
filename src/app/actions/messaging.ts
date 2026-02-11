'use server';

import { db } from '@/lib/db';
import {
    conversations,
    dmPairs,
    conversationParticipants,
    messages,
    messageAttachments,
    attachmentUploads,
    messageHiddenForUsers,
    messageEditLogs,
    profiles,
    connections,
    roleApplications,
} from '@/lib/db/schema';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { eq, and, desc, lt, gt, ne, isNull, inArray, sql, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

// ============================================================================
// TYPES
// ============================================================================

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

export interface MessageWithSender {
    id: string;
    conversationId: string;
    senderId: string | null;
    clientMessageId?: string | null;
    content: string | null;
    type: 'text' | 'image' | 'video' | 'file' | 'system' | null;
    metadata: Record<string, unknown>;
    replyTo: {
        id: string;
        content: string | null;
        type: 'text' | 'image' | 'video' | 'file' | 'system' | null;
        senderId: string | null;
        senderName: string | null;
        deletedAt: Date | null;
    } | null;
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
    deduped?: boolean;
}

// ============================================================================
// HELPER: Get authenticated user
// ============================================================================

async function getAuthUser() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

async function isDirectMessagingAllowed(viewerId: string, otherUserId: string): Promise<{ allowed: boolean; error?: string }> {
    const [targetProfile, relation, recentApplication] = await Promise.all([
        db
            .select({ messagePrivacy: profiles.messagePrivacy })
            .from(profiles)
            .where(eq(profiles.id, otherUserId))
            .limit(1),
        db
            .select({
                status: connections.status,
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
            })
            .from(connections)
            .where(
                or(
                    and(eq(connections.requesterId, viewerId), eq(connections.addresseeId, otherUserId)),
                    and(eq(connections.requesterId, otherUserId), eq(connections.addresseeId, viewerId))
                )
            )
            .orderBy(desc(connections.updatedAt))
            .limit(1),
        db
            .select({ id: roleApplications.id })
            .from(roleApplications)
            .where(
                or(
                    and(eq(roleApplications.applicantId, viewerId), eq(roleApplications.creatorId, otherUserId)),
                    and(eq(roleApplications.applicantId, otherUserId), eq(roleApplications.creatorId, viewerId))
                )
            )
            .orderBy(desc(roleApplications.createdAt))
            .limit(1),
    ]);

    if (targetProfile.length === 0) {
        return { allowed: false, error: 'User not found' };
    }

    const connection = relation[0];
    if (connection?.status === 'blocked') {
        return { allowed: false, error: 'Messaging is blocked' };
    }

    if (recentApplication.length > 0) {
        return { allowed: true };
    }

    if (connection?.status === 'accepted') {
        return { allowed: true };
    }

    const privacy = targetProfile[0].messagePrivacy || 'connections';
    if (privacy === 'everyone') {
        return { allowed: true };
    }

    const hasIncomingPending =
        connection?.status === 'pending' &&
        connection.addresseeId === viewerId;

    if (hasIncomingPending) {
        return { allowed: true };
    }

    return { allowed: false, error: 'You can only message your connections' };
}

const MAX_MESSAGES_PER_MINUTE = 120;
const ATTACHMENTS_BUCKET = 'chat-attachments';
const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 60 * 15;
const MESSAGE_EDIT_WINDOW_MINUTES = 15;
const MAX_MESSAGE_CONTENT_LENGTH = 4000;

type ReplyPreview = NonNullable<MessageWithSender['replyTo']>;
type MessageDeliveryState = 'sending' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

function parseMessageSearchQuery(query: string) {
    const tokens = query
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    let fromFilter: string | null = null;
    let hasFilter: 'image' | 'video' | 'file' | 'code' | null = null;
    let inFilter: 'project_group' | null = null;
    let isPinned = false;
    const textTokens: string[] = [];

    for (const token of tokens) {
        const lower = token.toLowerCase();
        if (lower.startsWith('from:') && lower.length > 5) {
            fromFilter = lower.slice(5);
            continue;
        }
        if (lower.startsWith('has:')) {
            const kind = lower.slice(4);
            if (kind === 'image' || kind === 'video' || kind === 'file' || kind === 'code') {
                hasFilter = kind;
                continue;
            }
        }
        if (lower === 'is:pinned') {
            isPinned = true;
            continue;
        }
        if (lower === 'in:project' || lower === 'in:project-group') {
            inFilter = 'project_group';
            continue;
        }
        textTokens.push(token);
    }

    return {
        textQuery: textTokens.join(' ').trim(),
        fromFilter,
        hasFilter,
        inFilter,
        isPinned,
    };
}

function extractMessageMentions(content: string) {
    const usernames = new Set<string>();
    const roleMentions = new Set<string>();
    const mentionRegex = /(^|\s)@([a-zA-Z0-9_]{2,32})/g;
    let match: RegExpExecArray | null;

    while ((match = mentionRegex.exec(content)) !== null) {
        const raw = match[2].toLowerCase();
        if (['all', 'qa', 'design', 'dev', 'frontend', 'backend', 'product'].includes(raw)) {
            roleMentions.add(raw);
        } else {
            usernames.add(raw);
        }
    }

    return {
        mentionedUsernames: Array.from(usernames),
        mentionRoles: Array.from(roleMentions),
    };
}

function withDeliveryMetadata(
    metadata: Record<string, unknown> | null | undefined,
    state: MessageDeliveryState
): Record<string, unknown> {
    return {
        ...(metadata || {}),
        deliveryState: state,
    };
}

async function validateSendRateLimit(senderId: string): Promise<{ allowed: boolean; error?: string }> {
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const sentRecently = await db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(
            and(
                eq(messages.senderId, senderId),
                gt(messages.createdAt, oneMinuteAgo)
            )
        );

    const count = Number(sentRecently[0]?.count || 0);
    if (count >= MAX_MESSAGES_PER_MINUTE) {
        return { allowed: false, error: 'Rate limit exceeded. Please slow down and try again.' };
    }
    return { allowed: true };
}

async function findExistingMessageByClientKey(
    conversationId: string,
    senderId: string,
    clientMessageId?: string | null
) {
    if (!clientMessageId) return null;

    const existing = await db
        .select({
            id: messages.id,
            conversationId: messages.conversationId,
            senderId: messages.senderId,
            replyToMessageId: messages.replyToMessageId,
            clientMessageId: messages.clientMessageId,
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
                eq(messages.conversationId, conversationId),
                eq(messages.senderId, senderId),
                eq(messages.clientMessageId, clientMessageId),
                isNull(messages.deletedAt)
            )
        )
        .orderBy(desc(messages.createdAt))
        .limit(1);

    return existing[0] || null;
}

async function validateReplyTarget(
    conversationId: string,
    viewerId: string,
    replyToMessageId?: string | null
): Promise<ReplyPreview | null> {
    if (!replyToMessageId) return null;

    const [reply] = await db
        .select({
            id: messages.id,
            conversationId: messages.conversationId,
            senderId: messages.senderId,
            content: messages.content,
            type: messages.type,
            deletedAt: messages.deletedAt,
            username: profiles.username,
            fullName: profiles.fullName,
        })
        .from(messages)
        .leftJoin(profiles, eq(messages.senderId, profiles.id))
        .where(
            and(
                eq(messages.id, replyToMessageId),
                eq(messages.conversationId, conversationId)
            )
        )
        .limit(1);

    if (!reply) {
        throw new Error('Reply target not found in this conversation');
    }

    const hidden = await db
        .select({ id: messageHiddenForUsers.id })
        .from(messageHiddenForUsers)
        .where(
            and(
                eq(messageHiddenForUsers.messageId, replyToMessageId),
                eq(messageHiddenForUsers.userId, viewerId)
            )
        )
        .limit(1);

    if (hidden.length > 0) {
        throw new Error('Reply target is hidden for this user');
    }

    return {
        id: reply.id,
        content: reply.content,
        type: reply.type as ReplyPreview['type'],
        senderId: reply.senderId,
        senderName: reply.fullName || reply.username || null,
        deletedAt: reply.deletedAt,
    };
}

async function getReplyPreviewMap(
    conversationId: string,
    viewerId: string,
    replyIds: string[]
) {
    const uniqueReplyIds = Array.from(new Set(replyIds.filter(Boolean)));
    if (uniqueReplyIds.length === 0) return new Map<string, ReplyPreview>();

    const hiddenRows = await db
        .select({ messageId: messageHiddenForUsers.messageId })
        .from(messageHiddenForUsers)
        .where(
            and(
                eq(messageHiddenForUsers.userId, viewerId),
                inArray(messageHiddenForUsers.messageId, uniqueReplyIds)
            )
        );
    const hiddenSet = new Set(hiddenRows.map((row) => row.messageId));

    const rows = await db
        .select({
            id: messages.id,
            conversationId: messages.conversationId,
            senderId: messages.senderId,
            content: messages.content,
            type: messages.type,
            deletedAt: messages.deletedAt,
            username: profiles.username,
            fullName: profiles.fullName,
        })
        .from(messages)
        .leftJoin(profiles, eq(messages.senderId, profiles.id))
        .where(
            and(
                eq(messages.conversationId, conversationId),
                inArray(messages.id, uniqueReplyIds)
            )
        );

    const previewMap = new Map<string, ReplyPreview>();
    for (const row of rows) {
        if (hiddenSet.has(row.id)) continue;
        previewMap.set(row.id, {
            id: row.id,
            content: row.content,
            type: row.type as ReplyPreview['type'],
            senderId: row.senderId,
            senderName: row.fullName || row.username || null,
            deletedAt: row.deletedAt,
        });
    }
    return previewMap;
}

type AttachmentRowForResolution = {
    id: string;
    type: string;
    storagePath: string | null;
    url: string;
    filename: string;
    sizeBytes: number | null;
    mimeType: string | null;
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
};

type NormalizedAttachmentInput = UploadedAttachment & {
    storagePath: string;
    signedUrl: string;
    thumbnailUrl: string | null;
};

function buildImageThumbnailUrl(signedUrl: string): string {
    return signedUrl.replace('/object/sign/', '/render/image/sign/') + '&width=240&height=240&resize=cover';
}

function extractStoragePathFromAttachmentUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        const pathMarkers = [
            '/object/sign/chat-attachments/',
            '/render/image/sign/chat-attachments/',
        ];

        for (const marker of pathMarkers) {
            const markerIndex = parsed.pathname.indexOf(marker);
            if (markerIndex < 0) continue;
            const encodedPath = parsed.pathname.slice(markerIndex + marker.length);
            return decodeURIComponent(encodedPath);
        }

        return null;
    } catch {
        return null;
    }
}

async function resolveSignedAttachmentUrls(paths: string[]): Promise<Map<string, string>> {
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
    if (uniquePaths.length === 0) return new Map();

    const buildSignedMap = async (source: 'admin' | 'user') => {
        const client = source === 'admin' ? await createAdminClient() : await createClient();
        const { data, error } = await client.storage
            .from(ATTACHMENTS_BUCKET)
            .createSignedUrls(uniquePaths, ATTACHMENT_SIGNED_URL_TTL_SECONDS);

        if (error || !data) {
            throw error || new Error(`Signed URL generation failed (${source})`);
        }

        const signedByPath = new Map<string, string>();
        data.forEach((item, index) => {
            const path = item.path || uniquePaths[index];
            if (path && item.signedUrl) {
                signedByPath.set(path, item.signedUrl);
            }
        });
        return signedByPath;
    };

    try {
        return await buildSignedMap('admin');
    } catch (error) {
        console.error('Failed to generate signed attachment URLs with admin client:', error);
        try {
            return await buildSignedMap('user');
        } catch (fallbackError) {
            console.error('Failed to generate signed attachment URLs with user client:', fallbackError);
            return new Map();
        }
    }
}

async function hydrateAttachmentUrls(attachmentRows: AttachmentRowForResolution[]) {
    if (attachmentRows.length === 0) return [];

    const pathByAttachmentId = new Map<string, string | null>();
    for (const attachment of attachmentRows) {
        const derivedPath = attachment.storagePath || extractStoragePathFromAttachmentUrl(attachment.url);
        pathByAttachmentId.set(attachment.id, derivedPath);
    }

    const signedByPath = await resolveSignedAttachmentUrls(
        attachmentRows
            .map((attachment) => pathByAttachmentId.get(attachment.id))
            .filter((value): value is string => Boolean(value))
    );

    return attachmentRows.map((attachment) => {
        const resolvedPath = pathByAttachmentId.get(attachment.id);
        const resolvedUrl = resolvedPath
            ? signedByPath.get(resolvedPath) || attachment.url
            : attachment.url;

        const resolvedThumbnail =
            attachment.type === 'image'
                ? (resolvedPath && resolvedUrl
                    ? buildImageThumbnailUrl(resolvedUrl)
                    : (attachment.thumbnailUrl || (resolvedUrl ? buildImageThumbnailUrl(resolvedUrl) : null)))
                : attachment.thumbnailUrl;

        return {
            id: attachment.id,
            type: attachment.type as 'image' | 'video' | 'file',
            url: resolvedUrl,
            filename: attachment.filename,
            sizeBytes: attachment.sizeBytes,
            mimeType: attachment.mimeType,
            thumbnailUrl: resolvedThumbnail,
            width: attachment.width,
            height: attachment.height,
        };
    });
}

function resolveAttachmentStoragePath(input: { storagePath?: string | null; url?: string | null }) {
    return input.storagePath || extractStoragePathFromAttachmentUrl(input.url || null);
}

async function normalizeUploadedAttachmentsForCommit(
    attachments: UploadedAttachment[]
): Promise<{ attachments?: NormalizedAttachmentInput[]; error?: string }> {
    if (attachments.length === 0) return { attachments: [] };

    const normalizedWithPath = attachments.map((attachment) => {
        const storagePath = resolveAttachmentStoragePath(attachment);
        return { attachment, storagePath };
    });

    if (normalizedWithPath.some((item) => !item.storagePath)) {
        return { error: 'One or more attachments are missing storage references. Please re-upload and try again.' };
    }

    const paths = normalizedWithPath.map((item) => item.storagePath!) as string[];
    const signedByPath = await resolveSignedAttachmentUrls(paths);

    if (signedByPath.size !== paths.length) {
        return { error: 'Some attachments are not ready yet. Please retry in a moment.' };
    }

    return {
        attachments: normalizedWithPath.map(({ attachment, storagePath }) => {
            const signedUrl = signedByPath.get(storagePath!)!;
            return {
                ...attachment,
                storagePath: storagePath!,
                signedUrl,
                thumbnailUrl: attachment.type === 'image'
                    ? buildImageThumbnailUrl(signedUrl)
                    : (attachment.thumbnailUrl || null),
            };
        }),
    };
}

async function markAttachmentUploadsCommitted(
    tx: any,
    userId: string,
    clientUploadIds: string[]
) {
    if (clientUploadIds.length === 0) return;

    await tx
        .update(attachmentUploads)
        .set({
            status: 'committed',
            error: null,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(attachmentUploads.userId, userId),
                inArray(attachmentUploads.clientUploadId, clientUploadIds)
            )
        );
}

async function validateAttachmentOwnershipForConversation(
    userId: string,
    conversationId: string,
    clientUploadIds: string[]
): Promise<{ ok: boolean; error?: string }> {
    if (clientUploadIds.length === 0) return { ok: true };

    const rows = await db
        .select({
            clientUploadId: attachmentUploads.clientUploadId,
            status: attachmentUploads.status,
            conversationId: attachmentUploads.conversationId,
        })
        .from(attachmentUploads)
        .where(
            and(
                eq(attachmentUploads.userId, userId),
                inArray(attachmentUploads.clientUploadId, clientUploadIds)
            )
        );

    if (rows.length !== clientUploadIds.length) {
        return { ok: false, error: 'Some attachments are missing or inaccessible.' };
    }

    for (const row of rows) {
        if (row.status !== 'uploaded' && row.status !== 'committed') {
            return { ok: false, error: 'Some attachments are not ready yet. Please retry in a moment.' };
        }
        if (row.conversationId && row.conversationId !== conversationId) {
            return { ok: false, error: 'Attachment conversation mismatch detected.' };
        }
    }

    return { ok: true };
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

        const permission = await isDirectMessagingAllowed(user.id, otherUserId);
        if (!permission.allowed) {
            return { success: false, error: permission.error || 'Messaging is not allowed' };
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

                // Re-open for current user if previously archived.
                await tx
                    .update(conversationParticipants)
                    .set({ archivedAt: null })
                    .where(
                        and(
                            eq(conversationParticipants.conversationId, existing[0].conversationId),
                            eq(conversationParticipants.userId, user.id)
                        )
                    );

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

        const [cursorAtRaw, cursorConversationIdRaw] = cursor ? cursor.split('|') : [];
        const parsedCursorAt = cursorAtRaw ? new Date(cursorAtRaw) : cursor ? new Date(cursor) : undefined;
        const cursorAt = parsedCursorAt && !Number.isNaN(parsedCursorAt.getTime()) ? parsedCursorAt : undefined;
        const cursorConversationId = cursorConversationIdRaw || undefined;

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
                type: details.type as 'dm' | 'group' | 'project_group',
                updatedAt: userConv.sort_at || userConv.last_message_at || userConv.updated_at || new Date(),
                lifecycleState: details.last_message_id ? 'active' : 'draft',
                muted: Boolean(userConv.muted),
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
            nextCursor: hasMore
                ? `${paginatedConvs[paginatedConvs.length - 1].sort_at.toISOString()}|${paginatedConvs[paginatedConvs.length - 1].conversation_id}`
                : undefined
        };
    } catch (error) {
        console.error('Error fetching conversations:', error);
        return { success: false, error: 'Failed to fetch conversations' };
    }
}

// ============================================================================
// GET SINGLE CONVERSATION DETAILS (SSOT HYDRATION)
// ============================================================================

export async function getConversationById(
    conversationId: string
): Promise<{ success: boolean; error?: string; conversation?: ConversationWithDetails }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

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
    } catch (error) {
        console.error('Error fetching conversation by id:', error);
        return { success: false, error: 'Failed to fetch conversation' };
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

        const [conversationMeta] = await db
            .select({ type: conversations.type })
            .from(conversations)
            .where(eq(conversations.id, conversationId))
            .limit(1);

        let otherParticipantLastReadAt: Date | null = null;
        if (conversationMeta?.type === 'dm') {
            const [otherParticipant] = await db
                .select({ lastReadAt: conversationParticipants.lastReadAt })
                .from(conversationParticipants)
                .where(
                    and(
                        eq(conversationParticipants.conversationId, conversationId),
                        ne(conversationParticipants.userId, user.id)
                    )
                )
                .limit(1);
            otherParticipantLastReadAt = otherParticipant?.lastReadAt || null;
        }

        // Build query
        const query = db
            .select({
                id: messages.id,
                conversationId: messages.conversationId,
                senderId: messages.senderId,
                replyToMessageId: messages.replyToMessageId,
                clientMessageId: messages.clientMessageId,
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
                        lt(messages.createdAt, new Date(cursor)),
                        sql`NOT EXISTS (
                            SELECT 1
                            FROM ${messageHiddenForUsers} h
                            WHERE h.message_id = ${messages.id}
                            AND h.user_id = ${user.id}
                        )`
                    )
                    : and(
                        eq(messages.conversationId, conversationId),
                        sql`NOT EXISTS (
                            SELECT 1
                            FROM ${messageHiddenForUsers} h
                            WHERE h.message_id = ${messages.id}
                            AND h.user_id = ${user.id}
                        )`
                    )
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
        const replyPreviewMap = await getReplyPreviewMap(
            conversationId,
            user.id,
            paginatedMessages.map((message) => message.replyToMessageId).filter(Boolean) as string[]
        );

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

        const resolvedAttachmentMap = new Map<
            string,
            Awaited<ReturnType<typeof hydrateAttachmentUrls>>
        >();
        await Promise.all(
            Array.from(attachmentMap.entries()).map(async ([messageId, rows]) => {
                const resolved = await hydrateAttachmentUrls(rows as AttachmentRowForResolution[]);
                resolvedAttachmentMap.set(messageId, resolved);
            })
        );

        // Build result (reverse to show oldest first in UI)
        const result: MessageWithSender[] = paginatedMessages.reverse().map((m) => {
            const baseMetadata = (m.metadata || {}) as Record<string, unknown>;
            let deliveryState = baseMetadata.deliveryState as MessageDeliveryState | undefined;

            if (m.senderId === user.id && conversationMeta?.type === 'dm' && !deliveryState) {
                deliveryState =
                    otherParticipantLastReadAt && m.createdAt <= otherParticipantLastReadAt
                        ? 'read'
                        : 'delivered';
            }

            return {
                id: m.id,
                conversationId: m.conversationId,
                senderId: m.senderId,
                replyTo: m.replyToMessageId ? replyPreviewMap.get(m.replyToMessageId) || null : null,
                clientMessageId: m.clientMessageId,
                content: m.content,
                type: m.type as MessageWithSender['type'],
                metadata: deliveryState ? withDeliveryMetadata(baseMetadata, deliveryState) : baseMetadata,
                createdAt: m.createdAt,
                editedAt: m.editedAt,
                deletedAt: m.deletedAt,
                sender: m.senderId ? senderMap.get(m.senderId) || null : null,
                attachments: resolvedAttachmentMap.get(m.id) || [],
            };
        });

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
    attachmentIds?: string[],
    options?: { clientMessageId?: string; replyToMessageId?: string | null }
): Promise<SendMessageResult> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const clientMessageId = options?.clientMessageId?.trim() || undefined;
        const replyToMessageId = options?.replyToMessageId?.trim() || undefined;

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

        const [conversationRecord] = await db
            .select({ type: conversations.type })
            .from(conversations)
            .where(eq(conversations.id, conversationId))
            .limit(1);

        if (!conversationRecord) {
            return { success: false, error: 'Conversation not found' };
        }

        if (conversationRecord.type === 'dm') {
            const [otherParticipant] = await db
                .select({ userId: conversationParticipants.userId })
                .from(conversationParticipants)
                .where(
                    and(
                        eq(conversationParticipants.conversationId, conversationId),
                        ne(conversationParticipants.userId, user.id)
                    )
                )
                .limit(1);

            if (!otherParticipant) {
                return { success: false, error: 'Invalid conversation participants' };
            }

            const permission = await isDirectMessagingAllowed(user.id, otherParticipant.userId);
            if (!permission.allowed) {
                return { success: false, error: permission.error || 'Messaging is not allowed' };
            }
        }

        // Validate content
        if (!content?.trim() && (!attachmentIds || attachmentIds.length === 0)) {
            return { success: false, error: 'Message cannot be empty' };
        }
        if ((content?.trim() || '').length > MAX_MESSAGE_CONTENT_LENGTH) {
            return { success: false, error: `Message too long. Maximum is ${MAX_MESSAGE_CONTENT_LENGTH} characters.` };
        }

        const normalizedContent = content?.trim() || '';
        const mentions = extractMessageMentions(normalizedContent);
        const replyPreview = await validateReplyTarget(
            conversationId,
            user.id,
            replyToMessageId
        );

        const rateLimit = await validateSendRateLimit(user.id);
        if (!rateLimit.allowed) {
            return { success: false, error: rateLimit.error };
        }

        const existing = await findExistingMessageByClientKey(conversationId, user.id, clientMessageId);
        if (existing) {
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

            return {
                success: true,
                deduped: true,
                message: {
                    id: existing.id,
                    conversationId: existing.conversationId,
                    senderId: existing.senderId,
                    replyTo: existing.replyToMessageId
                        ? (await getReplyPreviewMap(conversationId, user.id, [existing.replyToMessageId])).get(existing.replyToMessageId) || null
                        : null,
                    clientMessageId: existing.clientMessageId,
                    content: existing.content,
                    type: existing.type as MessageWithSender['type'],
                    metadata: withDeliveryMetadata(existing.metadata as Record<string, unknown>, 'sent'),
                    createdAt: existing.createdAt,
                    editedAt: existing.editedAt,
                    deletedAt: existing.deletedAt,
                    sender: senderProfile || null,
                    attachments: [],
                },
            };
        }

        // Use transaction for atomic message send and response hydration.
        const { newMessage, senderProfile } = await db.transaction(async (tx) => {
            const [msg] = await tx
                .insert(messages)
                .values({
                    conversationId,
                    senderId: user.id,
                    replyToMessageId: replyToMessageId || null,
                    clientMessageId: clientMessageId || null,
                    content: content?.trim() || null,
                    type,
                    metadata: withDeliveryMetadata({
                        version: 3,
                        ...(clientMessageId ? { clientMessageId } : {}),
                        ...(replyToMessageId ? { replyToMessageId } : {}),
                        ...(mentions.mentionedUsernames.length > 0
                            ? { mentionedUsernames: mentions.mentionedUsernames }
                            : {}),
                        ...(mentions.mentionRoles.length > 0
                            ? { mentionRoles: mentions.mentionRoles }
                            : {}),
                        ...(normalizedContent.includes('```') ? { hasCode: true } : {}),
                    }, 'sent'),
                })
                .returning();

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

            return { newMessage: msg, senderProfile: profile };
        });

        revalidatePath('/messages');

        return {
            success: true,
            message: {
                id: newMessage.id,
                conversationId: newMessage.conversationId,
                senderId: newMessage.senderId,
                replyTo: replyPreview,
                clientMessageId: newMessage.clientMessageId,
                content: newMessage.content,
                type: newMessage.type as MessageWithSender['type'],
                metadata: withDeliveryMetadata(newMessage.metadata as Record<string, unknown>, 'sent'),
                createdAt: newMessage.createdAt,
                editedAt: newMessage.editedAt,
                deletedAt: newMessage.deletedAt,
                sender: senderProfile || null,
                attachments: [],
            },
        };
    } catch (error) {
        console.error('Error sending message:', error);
        try {
            const user = await getAuthUser();
            const existing = user
                ? await findExistingMessageByClientKey(
                    conversationId,
                    user.id,
                    options?.clientMessageId
                )
                : null;
            if (existing) {
                const viewerId = user!.id;
                const [senderProfile] = await db
                    .select({
                        id: profiles.id,
                        username: profiles.username,
                        fullName: profiles.fullName,
                        avatarUrl: profiles.avatarUrl,
                    })
                    .from(profiles)
                    .where(eq(profiles.id, viewerId))
                    .limit(1);

                return {
                    success: true,
                    deduped: true,
                    message: {
                        id: existing.id,
                        conversationId: existing.conversationId,
                        senderId: existing.senderId,
                        replyTo: existing.replyToMessageId
                            ? (await getReplyPreviewMap(conversationId, viewerId, [existing.replyToMessageId])).get(existing.replyToMessageId) || null
                            : null,
                        clientMessageId: existing.clientMessageId,
                        content: existing.content,
                        type: existing.type as MessageWithSender['type'],
                        metadata: withDeliveryMetadata(existing.metadata as Record<string, unknown>, 'sent'),
                        createdAt: existing.createdAt,
                        editedAt: existing.editedAt,
                        deletedAt: existing.deletedAt,
                        sender: senderProfile || null,
                        attachments: [],
                    },
                };
            }
        } catch {
            // Ignore fallback failures, surface canonical error below.
        }
        return { success: false, error: 'Failed to send message' };
    }
}

// ============================================================================
// MARK CONVERSATION AS READ
// ============================================================================

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

        let watermarkMessage:
            | { id: string; createdAt: Date }
            | null = null;

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
                unreadCount: 0, // Reset denormalized counter
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

// ============================================================================
// ARCHIVE / UNARCHIVE CONVERSATION (Participant scoped)
// ============================================================================

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
        const { textQuery, fromFilter, hasFilter, inFilter, isPinned } = parseMessageSearchQuery(query);
        if (!textQuery && !fromFilter && !hasFilter && !inFilter && !isPinned) {
            return { success: true, results: [] };
        }
        const normalizedQuery = textQuery;
        const searchPattern = normalizedQuery ? `%${normalizedQuery}%` : null;
        const internalLimit = Math.min(200, Math.max(limit * 6, 40));

        // Get user's conversations first
        const userConversations = await db
            .select({
                conversationId: conversationParticipants.conversationId,
                type: conversations.type,
            })
            .from(conversationParticipants)
            .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
            .where(eq(conversationParticipants.userId, user.id));

        if (userConversations.length === 0) {
            return { success: true, results: [] };
        }

        const conversationIds = userConversations
            .filter((conversation) => {
                if (!inFilter) return true;
                return conversation.type === inFilter;
            })
            .map(c => c.conversationId);
        if (conversationIds.length === 0) {
            return { success: true, results: [] };
        }

        const textPredicate = normalizedQuery
            ? sql`(
                to_tsvector('english', coalesce(${messages.content}, '')) @@ websearch_to_tsquery('english', ${normalizedQuery})
                OR ${messages.content} ILIKE ${searchPattern}
            )`
            : sql`true`;
        const hasPredicate = hasFilter === 'code'
            ? sql`${messages.content} ILIKE ${'%```%'}`
            : (hasFilter ? eq(messages.type, hasFilter) : sql`true`);
        const pinnedPredicate = isPinned
            ? sql`coalesce(${messages.metadata}->>'pinned', 'false') = 'true'`
            : sql`true`;

        // Search using full-text search
        const searchResults = await db
            .select({
                id: messages.id,
                conversationId: messages.conversationId,
                senderId: messages.senderId,
                clientMessageId: messages.clientMessageId,
                content: messages.content,
                type: messages.type,
                metadata: messages.metadata,
                createdAt: messages.createdAt,
                editedAt: messages.editedAt,
                deletedAt: messages.deletedAt,
                rank: sql<number>`
                    ts_rank_cd(
                        to_tsvector('english', coalesce(${messages.content}, '')),
                        websearch_to_tsquery('english', ${normalizedQuery})
                    )
                `,
            })
            .from(messages)
            .where(
                and(
                    inArray(messages.conversationId, conversationIds),
                    sql`${messages.deletedAt} IS NULL`,
                    sql`NOT EXISTS (
                        SELECT 1
                        FROM ${messageHiddenForUsers} h
                            WHERE h.message_id = ${messages.id}
                            AND h.user_id = ${user.id}
                        )`,
                    textPredicate,
                    hasPredicate,
                    pinnedPredicate
                )
            )
            .orderBy(desc(sql`
                CASE
                    WHEN ${normalizedQuery || ''} = '' THEN 0
                    ELSE ts_rank_cd(
                        to_tsvector('english', coalesce(${messages.content}, '')),
                        websearch_to_tsquery('english', ${normalizedQuery || ''})
                    )
                END
            `), desc(messages.createdAt))
            .limit(internalLimit);

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
                muted: conversationParticipants.muted,
            })
            .from(conversationParticipants)
            .innerJoin(profiles, eq(profiles.id, conversationParticipants.userId))
            .where(inArray(conversationParticipants.conversationId, resultConversationIds));

        // 3. Build Maps
        const detailsMap = new Map(Array.from(conversationsWithLastMessage).map((c: any) => [c.id, c]));
        const participantMap = new Map<string, typeof allParticipants>();

        const selfUnreadMap = new Map<string, number>();
        const selfMutedMap = new Map<string, boolean>();

        for (const p of allParticipants) {
            if (!participantMap.has(p.conversationId)) {
                participantMap.set(p.conversationId, []);
            }
            if (p.userId !== user.id) {
                participantMap.get(p.conversationId)!.push(p);
            } else {
                // Capture my unread count for this conversation
                selfUnreadMap.set(p.conversationId, p.unreadCount || 0);
                selfMutedMap.set(p.conversationId, Boolean(p.muted));
            }
        }

        const results = searchResults.map(m => {
            const details = detailsMap.get(m.conversationId);
            const participants = participantMap.get(m.conversationId) || [];

            // Build full conversation object
            const conversation: ConversationWithDetails = {
                id: m.conversationId,
                type: details?.type as 'dm' | 'group' | 'project_group' || 'dm',
                updatedAt: details?.updated_at || new Date(),
                lifecycleState: details?.last_message_id ? 'active' : 'draft',
                muted: selfMutedMap.get(m.conversationId) || false,
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
                    replyTo: null,
                    clientMessageId: m.clientMessageId,
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
        }).filter((item) => {
            if (!fromFilter) return true;
            const sender = item.message.sender;
            const senderText = `${sender?.fullName || ''} ${sender?.username || ''}`.toLowerCase();
            return senderText.includes(fromFilter);
        }).slice(0, limit);

        return { success: true, results };
    } catch (error) {
        console.error('Error searching messages:', error);
        return { success: false, error: 'Failed to search messages' };
    }
}

// ============================================================================
// EDIT / DELETE MESSAGE ACTIONS
// ============================================================================

export async function editMessage(
    messageId: string,
    nextContent: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const normalizedContent = nextContent.trim();
        if (!normalizedContent) {
            return { success: false, error: 'Message cannot be empty' };
        }
        if (normalizedContent.length > MAX_MESSAGE_CONTENT_LENGTH) {
            return { success: false, error: `Message too long. Maximum is ${MAX_MESSAGE_CONTENT_LENGTH} characters.` };
        }

        const [messageRow] = await db
            .select({
                id: messages.id,
                senderId: messages.senderId,
                content: messages.content,
                createdAt: messages.createdAt,
                deletedAt: messages.deletedAt,
            })
            .from(messages)
            .where(eq(messages.id, messageId))
            .limit(1);

        if (!messageRow) return { success: false, error: 'Message not found' };
        if (messageRow.senderId !== user.id) return { success: false, error: 'Not authorized' };
        if (messageRow.deletedAt) return { success: false, error: 'Cannot edit deleted message' };

        const editWindowMs = MESSAGE_EDIT_WINDOW_MINUTES * 60 * 1000;
        if (Date.now() - messageRow.createdAt.getTime() > editWindowMs) {
            return { success: false, error: `Edit window expired (${MESSAGE_EDIT_WINDOW_MINUTES} minutes)` };
        }

        const currentContent = messageRow.content || '';
        if (currentContent === normalizedContent) {
            return { success: true };
        }

        await db.transaction(async (tx) => {
            await tx
                .insert(messageEditLogs)
                .values({
                    messageId: messageRow.id,
                    editorId: user.id,
                    previousContent: messageRow.content,
                    nextContent: normalizedContent,
                });

            await tx
                .update(messages)
                .set({
                    content: normalizedContent,
                    editedAt: new Date(),
                })
                .where(eq(messages.id, messageRow.id));
        });

        revalidatePath('/messages');
        return { success: true };
    } catch (error) {
        console.error('Error editing message:', error);
        return { success: false, error: 'Failed to edit message' };
    }
}

export async function deleteMessage(
    messageId: string,
    scope: 'me' | 'everyone' = 'everyone'
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const [messageRow] = await db
            .select({
                id: messages.id,
                conversationId: messages.conversationId,
                senderId: messages.senderId,
                metadata: messages.metadata,
                deletedAt: messages.deletedAt,
            })
            .from(messages)
            .where(eq(messages.id, messageId))
            .limit(1);

        if (!messageRow) return { success: false, error: 'Message not found' };

        const [membership] = await db
            .select({ id: conversationParticipants.id })
            .from(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, messageRow.conversationId),
                    eq(conversationParticipants.userId, user.id)
                )
            )
            .limit(1);

        if (!membership) {
            return { success: false, error: 'Not authorized' };
        }

        if (scope === 'me') {
            await db
                .insert(messageHiddenForUsers)
                .values({
                    messageId: messageRow.id,
                    userId: user.id,
                })
                .onConflictDoNothing({
                    target: [messageHiddenForUsers.messageId, messageHiddenForUsers.userId],
                });

            revalidatePath('/messages');
            return { success: true };
        }

        if (messageRow.senderId !== user.id) {
            return { success: false, error: 'Only sender can unsend for everyone' };
        }

        if (messageRow.deletedAt) {
            return { success: true };
        }

        await db
            .update(messages)
            .set({
                deletedAt: new Date(),
                content: null,
                metadata: {
                    ...(messageRow.metadata || {}),
                    deletionScope: 'everyone',
                    deletedBy: user.id,
                },
            })
            .where(eq(messages.id, messageRow.id));

        revalidatePath('/messages');
        return { success: true };
    } catch (error) {
        console.error('Error deleting message:', error);
        return { success: false, error: 'Failed to delete message' };
    }
}

// ============================================================================
// PINNED MESSAGES
// ============================================================================

export async function getPinnedMessages(
    conversationId: string,
    limit: number = 3
): Promise<{ success: boolean; error?: string; messages?: MessageWithSender[] }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const [membership] = await db
            .select({ id: conversationParticipants.id })
            .from(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    eq(conversationParticipants.userId, user.id)
                )
            )
            .limit(1);

        if (!membership) {
            return { success: false, error: 'Not authorized' };
        }

        const rows = await db
            .select({
                id: messages.id,
                conversationId: messages.conversationId,
                senderId: messages.senderId,
                clientMessageId: messages.clientMessageId,
                replyToMessageId: messages.replyToMessageId,
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
                    eq(messages.conversationId, conversationId),
                    isNull(messages.deletedAt),
                    sql`coalesce(${messages.metadata}->>'pinned', 'false') = 'true'`,
                    sql`NOT EXISTS (
                        SELECT 1
                        FROM ${messageHiddenForUsers} h
                        WHERE h.message_id = ${messages.id}
                        AND h.user_id = ${user.id}
                    )`
                )
            )
            .orderBy(
                desc(sql`coalesce((${messages.metadata}->>'pinnedAt')::timestamptz, ${messages.createdAt})`)
            )
            .limit(limit);

        if (rows.length === 0) {
            return { success: true, messages: [] };
        }

        const senderIds = [...new Set(rows.map((row) => row.senderId).filter(Boolean))] as string[];
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
        const senderMap = new Map(senderProfiles.map((sender) => [sender.id, sender]));

        const replyPreviewMap = await getReplyPreviewMap(
            conversationId,
            user.id,
            rows.map((row) => row.replyToMessageId).filter(Boolean) as string[]
        );

        const messageIds = rows.map((row) => row.id);
        const attachments = await db
            .select()
            .from(messageAttachments)
            .where(inArray(messageAttachments.messageId, messageIds));
        const attachmentsByMessage = new Map<string, typeof attachments>();
        for (const attachment of attachments) {
            if (!attachmentsByMessage.has(attachment.messageId)) {
                attachmentsByMessage.set(attachment.messageId, []);
            }
            attachmentsByMessage.get(attachment.messageId)!.push(attachment);
        }

        const hydrated = new Map<string, Awaited<ReturnType<typeof hydrateAttachmentUrls>>>();
        await Promise.all(
            Array.from(attachmentsByMessage.entries()).map(async ([messageId, values]) => {
                hydrated.set(messageId, await hydrateAttachmentUrls(values as AttachmentRowForResolution[]));
            })
        );

        return {
            success: true,
            messages: rows.map((row) => ({
                id: row.id,
                conversationId: row.conversationId,
                senderId: row.senderId,
                replyTo: row.replyToMessageId ? replyPreviewMap.get(row.replyToMessageId) || null : null,
                clientMessageId: row.clientMessageId,
                content: row.content,
                type: row.type as MessageWithSender['type'],
                metadata: withDeliveryMetadata(row.metadata as Record<string, unknown>, 'sent'),
                createdAt: row.createdAt,
                editedAt: row.editedAt,
                deletedAt: row.deletedAt,
                sender: row.senderId ? senderMap.get(row.senderId) || null : null,
                attachments: hydrated.get(row.id) || [],
            })),
        };
    } catch (error) {
        console.error('Error fetching pinned messages:', error);
        return { success: false, error: 'Failed to fetch pinned messages' };
    }
}

export async function setMessagePinned(
    messageId: string,
    pinned: boolean
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const [messageRow] = await db
            .select({
                id: messages.id,
                conversationId: messages.conversationId,
                metadata: messages.metadata,
                deletedAt: messages.deletedAt,
            })
            .from(messages)
            .where(eq(messages.id, messageId))
            .limit(1);

        if (!messageRow || messageRow.deletedAt) {
            return { success: false, error: 'Message not found' };
        }

        const [membership] = await db
            .select({ id: conversationParticipants.id })
            .from(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, messageRow.conversationId),
                    eq(conversationParticipants.userId, user.id)
                )
            )
            .limit(1);

        if (!membership) {
            return { success: false, error: 'Not authorized' };
        }

        const metadata = (messageRow.metadata || {}) as Record<string, unknown>;
        const nextMetadata = pinned
            ? {
                ...metadata,
                pinned: true,
                pinnedAt: new Date().toISOString(),
                pinnedBy: user.id,
            }
            : {
                ...metadata,
                pinned: false,
                pinnedAt: null,
                pinnedBy: null,
            };

        await db
            .update(messages)
            .set({ metadata: nextMetadata })
            .where(eq(messages.id, messageRow.id));

        revalidatePath('/messages');
        return { success: true };
    } catch (error) {
        console.error('Error setting message pin state:', error);
        return { success: false, error: 'Failed to update pin state' };
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
            .where(
                and(
                    eq(conversationParticipants.userId, user.id),
                    isNull(conversationParticipants.archivedAt)
                )
            );

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
    storagePath: string;
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
        const clientUploadIdRaw = formData.get('clientUploadId');
        const clientUploadId =
            typeof clientUploadIdRaw === 'string' && clientUploadIdRaw.trim().length > 0
                ? clientUploadIdRaw.trim()
                : (typeof crypto !== 'undefined' && 'randomUUID' in crypto
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const conversationIdRaw = formData.get('conversationId');
        const conversationId =
            typeof conversationIdRaw === 'string' && conversationIdRaw !== 'new' && conversationIdRaw.length > 0
                ? conversationIdRaw
                : null;

        // Track upload lifecycle for reliability and post-mortem diagnostics.
        await db
            .insert(attachmentUploads)
            .values({
                userId: user.id,
                clientUploadId,
                conversationId,
                filename: file.name,
                mimeType: file.type || null,
                sizeBytes: file.size,
                status: 'uploading',
                error: null,
                updatedAt: new Date(),
                expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
            })
            .onConflictDoUpdate({
                target: [attachmentUploads.userId, attachmentUploads.clientUploadId],
                set: {
                    conversationId,
                    filename: file.name,
                    mimeType: file.type || null,
                    sizeBytes: file.size,
                    status: 'uploading',
                    error: null,
                    updatedAt: new Date(),
                    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
                },
            });

        // Validate file size (50MB max)
        const MAX_SIZE = 50 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            await db
                .update(attachmentUploads)
                .set({
                    status: 'failed',
                    error: 'File too large. Maximum size is 50MB.',
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(attachmentUploads.userId, user.id),
                        eq(attachmentUploads.clientUploadId, clientUploadId)
                    )
                );
            return { success: false, error: 'File too large. Maximum size is 50MB.' };
        }

        const mimeType = (file.type || '').toLowerCase();
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const allowedDocumentMimes = new Set([
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
        ]);
        const allowedDocumentExtensions = new Set(['pdf', 'doc', 'docx', 'txt']);
        const isAllowedMime =
            mimeType.startsWith('image/') ||
            mimeType.startsWith('video/') ||
            allowedDocumentMimes.has(mimeType);
        const isAllowedByExtension = allowedDocumentExtensions.has(ext);

        if (!isAllowedMime && !isAllowedByExtension) {
            await db
                .update(attachmentUploads)
                .set({
                    status: 'failed',
                    error: 'Unsupported file type',
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(attachmentUploads.userId, user.id),
                        eq(attachmentUploads.clientUploadId, clientUploadId)
                    )
                );
            return {
                success: false,
                error: 'Unsupported file type. Please upload image, video, PDF, DOC, DOCX, or TXT files.',
            };
        }

        // Determine file type
        let fileType: 'image' | 'video' | 'file' = 'file';
        if (mimeType.startsWith('image/')) {
            fileType = 'image';
        } else if (mimeType.startsWith('video/')) {
            fileType = 'video';
        }

        // Generate unique filename
        const timestamp = Date.now();
        const uniqueName = `${timestamp}-${Math.random().toString(36).substring(7)}.${ext || 'bin'}`;
        const storagePath = `${user.id}/${uniqueName}`;

        // Upload with user-scoped client for RLS-compliant write.
        const supabase = await createClient();
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from(ATTACHMENTS_BUCKET)
            .upload(storagePath, file, {
                contentType: mimeType || undefined,
                upsert: false,
            });

        if (uploadError) {
            console.error('Storage upload error:', uploadError);
            await db
                .update(attachmentUploads)
                .set({
                    status: 'failed',
                    error: uploadError.message || 'Failed to upload file',
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(attachmentUploads.userId, user.id),
                        eq(attachmentUploads.clientUploadId, clientUploadId)
                    )
                );
            return { success: false, error: 'Failed to upload file' };
        }

        // Generate short-lived URL for optimistic rendering in sender UI.
        // Durable source-of-truth is storagePath persisted with the message.
        const signedByPath = await resolveSignedAttachmentUrls([storagePath]);
        const signedUrl = signedByPath.get(storagePath);
        if (!signedUrl) {
            await db
                .update(attachmentUploads)
                .set({
                    status: 'failed',
                    error: 'Failed to generate file URL',
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(attachmentUploads.userId, user.id),
                        eq(attachmentUploads.clientUploadId, clientUploadId)
                    )
                );
            return { success: false, error: 'Failed to generate file URL' };
        }

        // Generate thumbnail URL for images
        let thumbnailUrl: string | null = null;
        if (fileType === 'image') {
            thumbnailUrl = buildImageThumbnailUrl(signedUrl);
        }

        const attachment: UploadedAttachment = {
            id: clientUploadId,
            storagePath,
            type: fileType,
            url: signedUrl,
            filename: file.name,
            sizeBytes: file.size,
            mimeType: mimeType || 'application/octet-stream',
            thumbnailUrl,
            width: null,
            height: null,
        };

        await db
            .update(attachmentUploads)
            .set({
                status: 'uploaded',
                storagePath,
                error: null,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(attachmentUploads.userId, user.id),
                    eq(attachmentUploads.clientUploadId, clientUploadId)
                )
            );

        return { success: true, attachment };
    } catch (error) {
        console.error('Error uploading attachment:', error);
        return { success: false, error: 'Failed to upload attachment' };
    }
}

export async function cancelAttachmentUpload(
    clientUploadId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        if (!clientUploadId?.trim()) return { success: false, error: 'Invalid upload id' };

        await db
            .update(attachmentUploads)
            .set({
                status: 'canceled',
                error: null,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(attachmentUploads.userId, user.id),
                    eq(attachmentUploads.clientUploadId, clientUploadId.trim())
                )
            );

        return { success: true };
    } catch (error) {
        console.error('Error canceling attachment upload:', error);
        return { success: false, error: 'Failed to cancel upload' };
    }
}

// ============================================================================
// SEND MESSAGE WITH ATTACHMENTS
// ============================================================================

export async function sendMessageWithAttachments(
    conversationId: string,
    content: string,
    attachments: UploadedAttachment[],
    options?: { clientMessageId?: string; replyToMessageId?: string | null }
): Promise<SendMessageResult> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const clientMessageId = options?.clientMessageId?.trim() || undefined;
        const replyToMessageId = options?.replyToMessageId?.trim() || undefined;

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

        const [conversationRecord] = await db
            .select({ type: conversations.type })
            .from(conversations)
            .where(eq(conversations.id, conversationId))
            .limit(1);

        if (!conversationRecord) {
            return { success: false, error: 'Conversation not found' };
        }

        if (conversationRecord.type === 'dm') {
            const [otherParticipant] = await db
                .select({ userId: conversationParticipants.userId })
                .from(conversationParticipants)
                .where(
                    and(
                        eq(conversationParticipants.conversationId, conversationId),
                        ne(conversationParticipants.userId, user.id)
                    )
                )
                .limit(1);

            if (!otherParticipant) {
                return { success: false, error: 'Invalid conversation participants' };
            }

            const permission = await isDirectMessagingAllowed(user.id, otherParticipant.userId);
            if (!permission.allowed) {
                return { success: false, error: permission.error || 'Messaging is not allowed' };
            }
        }

        // Validate content
        if (!content?.trim() && attachments.length === 0) {
            return { success: false, error: 'Message cannot be empty' };
        }
        if ((content?.trim() || '').length > MAX_MESSAGE_CONTENT_LENGTH) {
            return { success: false, error: `Message too long. Maximum is ${MAX_MESSAGE_CONTENT_LENGTH} characters.` };
        }

        const normalizedContent = content?.trim() || '';
        const mentions = extractMessageMentions(normalizedContent);
        const replyPreview = await validateReplyTarget(
            conversationId,
            user.id,
            replyToMessageId
        );

        const rateLimit = await validateSendRateLimit(user.id);
        if (!rateLimit.allowed) {
            return { success: false, error: rateLimit.error };
        }

        const existing = await findExistingMessageByClientKey(conversationId, user.id, clientMessageId);
        if (existing) {
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

            const existingAttachments = await db
                .select()
                .from(messageAttachments)
                .where(eq(messageAttachments.messageId, existing.id));
            const hydratedExistingAttachments = await hydrateAttachmentUrls(
                existingAttachments as AttachmentRowForResolution[]
            );

            return {
                success: true,
                deduped: true,
                message: {
                    id: existing.id,
                    conversationId: existing.conversationId,
                    senderId: existing.senderId,
                    replyTo: existing.replyToMessageId
                        ? (await getReplyPreviewMap(conversationId, user.id, [existing.replyToMessageId])).get(existing.replyToMessageId) || null
                        : null,
                    clientMessageId: existing.clientMessageId,
                    content: existing.content,
                    type: existing.type as MessageWithSender['type'],
                    metadata: withDeliveryMetadata(existing.metadata as Record<string, unknown>, 'sent'),
                    createdAt: existing.createdAt,
                    editedAt: existing.editedAt,
                    deletedAt: existing.deletedAt,
                    sender: senderProfile || null,
                    attachments: hydratedExistingAttachments,
                },
            };
        }

        const attachmentOwnership = await validateAttachmentOwnershipForConversation(
            user.id,
            conversationId,
            attachments.map((attachment) => attachment.id)
        );
        if (!attachmentOwnership.ok) {
            return { success: false, error: attachmentOwnership.error };
        }

        const normalizedCommit = await normalizeUploadedAttachmentsForCommit(attachments);
        if (!normalizedCommit.attachments) {
            return { success: false, error: normalizedCommit.error || 'Attachments are not ready yet' };
        }
        const committedAttachments = normalizedCommit.attachments;

        // Determine message type based on attachments
        let messageType: 'text' | 'image' | 'video' | 'file' = 'text';
        if (committedAttachments.length > 0) {
            const primaryAttachment = committedAttachments[0];
            messageType = primaryAttachment.type;
        }

        const { newMessage, senderProfile, persistedAttachments } = await db.transaction(async (tx) => {
            const [msg] = await tx
                .insert(messages)
                .values({
                    conversationId,
                    senderId: user.id,
                    replyToMessageId: replyToMessageId || null,
                    clientMessageId: clientMessageId || null,
                    content: content?.trim() || null,
                    type: messageType,
                    metadata: withDeliveryMetadata({
                        version: 3,
                        ...(clientMessageId ? { clientMessageId } : {}),
                        ...(replyToMessageId ? { replyToMessageId } : {}),
                        ...(mentions.mentionedUsernames.length > 0
                            ? { mentionedUsernames: mentions.mentionedUsernames }
                            : {}),
                        ...(mentions.mentionRoles.length > 0
                            ? { mentionRoles: mentions.mentionRoles }
                            : {}),
                        ...(normalizedContent.includes('```') ? { hasCode: true } : {}),
                    }, 'sent'),
                })
                .returning();

            let insertedAttachments: Array<typeof messageAttachments.$inferSelect> = [];
            if (committedAttachments.length > 0) {
                insertedAttachments = await tx
                    .insert(messageAttachments)
                    .values(
                        committedAttachments.map(att => ({
                            messageId: msg.id,
                            storagePath: att.storagePath || null,
                            type: att.type,
                            url: att.signedUrl,
                            filename: att.filename,
                            sizeBytes: att.sizeBytes,
                            mimeType: att.mimeType,
                            thumbnailUrl: att.thumbnailUrl,
                            width: att.width,
                            height: att.height,
                        }))
                    )
                    .returning();
            }

            await markAttachmentUploadsCommitted(
                tx,
                user.id,
                committedAttachments.map((attachment) => attachment.id)
            );

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

            return { newMessage: msg, senderProfile: profile, persistedAttachments: insertedAttachments };
        });

        revalidatePath('/messages');
        const hydratedAttachments = await hydrateAttachmentUrls(
            persistedAttachments as AttachmentRowForResolution[]
        );

        return {
            success: true,
            message: {
                id: newMessage.id,
                conversationId: newMessage.conversationId,
                senderId: newMessage.senderId,
                replyTo: replyPreview,
                clientMessageId: newMessage.clientMessageId,
                content: newMessage.content,
                type: newMessage.type as MessageWithSender['type'],
                metadata: withDeliveryMetadata(newMessage.metadata as Record<string, unknown>, 'sent'),
                createdAt: newMessage.createdAt,
                editedAt: newMessage.editedAt,
                deletedAt: newMessage.deletedAt,
                sender: senderProfile || null,
                attachments: hydratedAttachments,
            },
        };
    } catch (error) {
        console.error('Error sending message with attachments:', error);
        try {
            const user = await getAuthUser();
            const existing = user
                ? await findExistingMessageByClientKey(
                    conversationId,
                    user.id,
                    options?.clientMessageId
                )
                : null;
            if (existing) {
                const viewerId = user!.id;
                const [senderProfile] = await db
                    .select({
                        id: profiles.id,
                        username: profiles.username,
                        fullName: profiles.fullName,
                        avatarUrl: profiles.avatarUrl,
                    })
                    .from(profiles)
                    .where(eq(profiles.id, viewerId))
                    .limit(1);
                const existingAttachments = await db
                    .select()
                    .from(messageAttachments)
                    .where(eq(messageAttachments.messageId, existing.id));
                const hydratedExistingAttachments = await hydrateAttachmentUrls(
                    existingAttachments as AttachmentRowForResolution[]
                );

                return {
                    success: true,
                    deduped: true,
                    message: {
                        id: existing.id,
                        conversationId: existing.conversationId,
                        senderId: existing.senderId,
                        replyTo: existing.replyToMessageId
                            ? (await getReplyPreviewMap(conversationId, viewerId, [existing.replyToMessageId])).get(existing.replyToMessageId) || null
                            : null,
                        clientMessageId: existing.clientMessageId,
                        content: existing.content,
                        type: existing.type as MessageWithSender['type'],
                        metadata: withDeliveryMetadata(existing.metadata as Record<string, unknown>, 'sent'),
                        createdAt: existing.createdAt,
                        editedAt: existing.editedAt,
                        deletedAt: existing.deletedAt,
                        sender: senderProfile || null,
                        attachments: hydratedExistingAttachments,
                    },
                };
            }
        } catch {
            // Ignore fallback failures, surface canonical error below.
        }
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
