'use server';

import { db } from '@/lib/db';
import {
    conversations,
    dmPairs,
    connections,
    conversationParticipants,
    messages,
    messageWorkflowItems,
    messageAttachments,
    messageReactions,
    messageReadReceipts,
    messageDeliveryReceipts,
    attachmentUploads,
    messageHiddenForUsers,
    messageEditLogs,
    messagePins,
    profiles,
    projectMembers,
    projects,
    roleApplications,
} from '@/lib/db/schema';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/supabase/auth-user';
import { eq, and, asc, desc, lt, lte, gt, ne, isNull, inArray, sql, or } from 'drizzle-orm';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { runInFlightDeduped } from '@/lib/utils/inflight-dedupe';
import { resolvePrivacyRelationship } from '@/lib/privacy/resolver';
import { recordPrivacyReadEvent } from '@/lib/privacy/audit';
import {
    buildReactionSummaryByMessage,
    withReactionSummaryMetadata,
} from '@/lib/messages/reactions';
import {
    type MessageContextChip,
    type PrivateFollowUpSnapshot,
    withMessageContextChipsMetadata,
    withPrivateFollowUpMetadata,
    getStructuredMessageSearchKind,
} from '@/lib/messages/structured';
import { buildConversationParticipantPreview } from '@/lib/messages/preview-authority';
import {
    refreshConversationParticipantPreviews,
} from '@/lib/messages/preview-refresh';
import { buildMessageAttachmentAccessUrl } from '@/lib/messages/attachment-access';
import { resolveAttachmentStoragePath } from '@/lib/messages/attachment-storage-path';
import {
    MESSAGE_MEDIA_PREVIEW_MAX_WIDTH,
    normalizeMediaDimensions,
} from '@/lib/messages/media-metadata';
import { isTemporaryMessageId } from '@/lib/messages/utils';
import { emitMessageBurstNotifications } from '@/lib/notifications/emitters';
import {
    markConversationNotificationsRead,
    markMessageBurstSourceDeleted,
    markMessageReactionSourceDeleted,
} from '@/lib/notifications/service';
import { logger } from '@/lib/logger';
import { getMessageThreadReadScope } from '@/lib/messages/thread-read-scope';
import { recordMessageSearch } from '@/lib/messages/observability';
import { buildConversationDisplay } from '@/lib/messages/conversation-display';
import {
    deriveReceiptDeliveryState,
    type DeliveryCounts,
    type MessageDeliveryState,
    withDeliveryMetadata,
} from '@/lib/messages/delivery-state';
import {
    ATTACHMENT_UPLOAD_MAX_FILE_BYTES,
    normalizeAndValidateFileSize,
    normalizeAndValidateMimeType,
    validateUploadedFileMagicBytes,
} from '@/lib/upload/security';
import { isUuid } from '@/lib/validations/uuid';
import { APPLICATION_BANNER_HIDE_AFTER_MS } from '@/lib/chat/banner-lifecycle';
import {
    deleteMessageSchema,
    editMessageSchema,
} from '@/lib/validations/messaging';

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
        metadata?: Record<string, unknown> | null;
    } | null;
    unreadCount: number;
    lastReadAt?: Date | null;
    lastReadMessageId?: string | null;
    displayTitle?: string;
    displayAvatarUrl?: string | null;
    displaySubtitle?: string;
    reactionPreview?: {
        messageId: string;
        actorUserId: string;
        emoji: string;
        createdAt: Date;
    } | null;
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
        metadata?: Record<string, unknown> | null;
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

async function getConversationMembershipId(
    conversationId: string,
    userId: string,
): Promise<string | null> {
    const [membership] = await db
        .select({ id: conversationParticipants.id })
        .from(conversationParticipants)
        .where(
            and(
                eq(conversationParticipants.conversationId, conversationId),
                eq(conversationParticipants.userId, userId),
            ),
        )
        .limit(1);

    return membership?.id ?? null;
}

async function assertDirectMessageReadable(viewerId: string, otherUserId: string): Promise<{ ok: boolean; error?: string }> {
    const privacy = await resolvePrivacyRelationship(viewerId, otherUserId);
    if (!privacy || privacy.blockedByViewer || privacy.blockedByTarget) {
        return { ok: false, error: 'Conversation not found' };
    }
    return { ok: true };
}

export async function isDirectMessagingAllowed(viewerId: string, otherUserId: string): Promise<{ allowed: boolean; error?: string }> {
    const [privacy, recentApplication] = await Promise.all([
        resolvePrivacyRelationship(viewerId, otherUserId),
        db
            .select({
                id: roleApplications.id,
                status: roleApplications.status,
                updatedAt: roleApplications.updatedAt,
            })
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

    if (!privacy) {
        return { allowed: false, error: 'User not found' };
    }

    if (privacy.blockedByViewer || privacy.blockedByTarget) {
        return { allowed: false, error: 'Messaging is blocked' };
    }

    const application = recentApplication[0];
    const applicationUpdatedAt = application?.updatedAt
        ? new Date(application.updatedAt).getTime()
        : Number.NaN;
    const hasFreshApplication = Boolean(
        application
        && (
            application.status === 'pending'
            || (Number.isFinite(applicationUpdatedAt)
                && Date.now() - applicationUpdatedAt <= APPLICATION_BANNER_HIDE_AFTER_MS)
        ),
    );
    if (hasFreshApplication) {
        return { allowed: true };
    }

    if (privacy.canSendMessage) {
        return { allowed: true };
    }

    return { allowed: false, error: 'You can only message your connections' };
}

const ATTACHMENTS_BUCKET = 'chat-attachments';
const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 60 * 15;
const MESSAGE_EDIT_WINDOW_MINUTES = 15;
const MAX_MESSAGE_CONTENT_LENGTH = 4000;
const MAX_SEARCH_TEXT_QUERY_LENGTH = 256;
const SEARCH_CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;

type ReplyPreview = NonNullable<MessageWithSender['replyTo']>;

function sanitizeMessageSearchText(input: string): string {
    return input
        .replace(SEARCH_CONTROL_CHARS_REGEX, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_SEARCH_TEXT_QUERY_LENGTH);
}

function parseMessageSearchQuery(query: string) {
    const tokens = query
        .trim()
        .match(/(?:[^\s":]+:)?(?:"[^"]*"|[^\s]+)/gu) ?? [];
    let fromFilter: string | null = null;
    let hasFilter: 'image' | 'video' | 'file' | 'code' | null = null;
    let inFilter: 'project_group' | null = null;
    let kindFilter: ReturnType<typeof getStructuredMessageSearchKind> = null;
    let hasChip = false;
    let isPinned = false;
    const textTokens: string[] = [];

    for (const token of tokens) {
        const lower = token.toLowerCase();
        if (lower.startsWith('from:') && lower.length > 5) {
            const normalizedFrom = sanitizeMessageSearchText(
                token
                    .slice(5)
                    .replace(/^"|"$/g, '')
                    .normalize('NFKC'),
            )
                .toLocaleLowerCase()
                .slice(0, 80);
            if (normalizedFrom) fromFilter = normalizedFrom;
            continue;
        }
        if (lower.startsWith('has:')) {
            const kind = lower.slice(4);
            if (kind === 'image' || kind === 'video' || kind === 'file' || kind === 'code') {
                hasFilter = kind;
                continue;
            }
            if (kind === 'chip' || kind === 'chips') {
                hasChip = true;
                continue;
            }
        }
        if (lower.startsWith('kind:') && lower.length > 5) {
            kindFilter = getStructuredMessageSearchKind(lower.slice(5));
            if (kindFilter) {
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
        textQuery: sanitizeMessageSearchText(textTokens.join(' ').trim()),
        fromFilter,
        hasFilter,
        inFilter,
        kindFilter,
        hasChip,
        isPinned,
    };
}

type MessageSearchCursor = {
    rank: number;
    createdAt: string;
    id: string;
};

function decodeMessageSearchCursor(cursor: string | null | undefined): MessageSearchCursor | null {
    if (!cursor) return null;
    try {
        const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<MessageSearchCursor>;
        const createdAt = typeof parsed.createdAt === 'string' ? new Date(parsed.createdAt) : null;
        if (
            typeof parsed.rank !== 'number'
            || !Number.isFinite(parsed.rank)
            || !createdAt
            || Number.isNaN(createdAt.getTime())
            || typeof parsed.id !== 'string'
            || !isUuid(parsed.id)
        ) {
            return null;
        }
        return {
            rank: parsed.rank,
            createdAt: createdAt.toISOString(),
            id: parsed.id,
        };
    } catch {
        return null;
    }
}

function encodeMessageSearchCursor(cursor: MessageSearchCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function extractMessageMentions(content: string) {
    const usernames = new Set<string>();
    const roleMentions = new Set<string>();
    const mentionRegex = /(^|\s)@([a-zA-Z0-9_]{2,32})/g;
    let match: RegExpExecArray | null;

    while ((match = mentionRegex.exec(content)) !== null) {
        const raw = match[2]!.toLowerCase();
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

async function getReactionSummaryMap(
    messageIds: ReadonlyArray<string>,
    viewerId: string,
): Promise<Map<string, ReturnType<typeof buildReactionSummaryByMessage>[string]>> {
    const uniqueMessageIds = Array.from(new Set(messageIds.filter(Boolean)));
    if (uniqueMessageIds.length === 0) {
        return new Map();
    }

    const rows = await db
        .select({
            messageId: messageReactions.messageId,
            emoji: messageReactions.emoji,
            userId: messageReactions.userId,
        })
        .from(messageReactions)
        .where(inArray(messageReactions.messageId, uniqueMessageIds));

    return new Map(Object.entries(buildReactionSummaryByMessage(rows, viewerId)));
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
            metadata: messages.metadata,
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
        metadata: (reply.metadata || {}) as Record<string, unknown>,
    };
}

async function getReplyPreviewMap(
    conversationId: string,
    viewerId: string,
    replyIds: string[]
) {
    const uniqueReplyIds = Array.from(new Set(replyIds.filter(Boolean)));
    if (uniqueReplyIds.length === 0) return new Map<string, ReplyPreview>();

    const [hiddenRows, rows] = await Promise.all([
        db
            .select({ messageId: messageHiddenForUsers.messageId })
            .from(messageHiddenForUsers)
            .where(
                and(
                    eq(messageHiddenForUsers.userId, viewerId),
                    inArray(messageHiddenForUsers.messageId, uniqueReplyIds),
                ),
            ),
        db
            .select({
                id: messages.id,
                conversationId: messages.conversationId,
                senderId: messages.senderId,
                content: messages.content,
                type: messages.type,
                metadata: messages.metadata,
                deletedAt: messages.deletedAt,
                username: profiles.username,
                fullName: profiles.fullName,
            })
            .from(messages)
            .leftJoin(profiles, eq(messages.senderId, profiles.id))
            .where(
                and(
                    eq(messages.conversationId, conversationId),
                    inArray(messages.id, uniqueReplyIds),
                ),
            ),
    ]);
    const hiddenSet = new Set(hiddenRows.map((row) => row.messageId));

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
            metadata: (row.metadata || {}) as Record<string, unknown>,
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

type HydratableMessageRow = {
    id: string;
    conversationId: string;
    senderId: string | null;
    replyToMessageId: string | null;
    clientMessageId: string | null;
    content: string | null;
    type: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    editedAt: Date | null;
    deletedAt: Date | null;
};

async function hydrateConversationMessages(params: {
    rows: HydratableMessageRow[];
    conversationId: string;
    viewerId: string;
    conversationType: ConversationWithDetails['type'] | null | undefined;
    otherParticipantLastReadAt: Date | null;
}) {
    const { rows, conversationId, viewerId, conversationType, otherParticipantLastReadAt } = params;
    if (rows.length === 0) return [] as MessageWithSender[];

    const senderIds = [...new Set(rows.map((message) => message.senderId).filter(Boolean))] as string[];
    const messageIds = rows.map((message) => message.id);
    const senderMessageIds = rows
        .filter((message) => message.senderId === viewerId)
        .map((message) => message.id);
    const senderProfilesPromise = senderIds.length > 0
        ? db
            .select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(inArray(profiles.id, senderIds))
        : Promise.resolve([]);
    const replyPreviewMapPromise = getReplyPreviewMap(
        conversationId,
        viewerId,
        rows.map((message) => message.replyToMessageId).filter(Boolean) as string[],
    );
    const attachmentListPromise = db
        .select()
        .from(messageAttachments)
        .where(inArray(messageAttachments.messageId, messageIds));
    const reactionSummaryMapPromise = getReactionSummaryMap(messageIds, viewerId);
    const privateFollowUpRowsPromise = db
        .select({
            id: messageWorkflowItems.id,
            messageId: messageWorkflowItems.messageId,
            status: messageWorkflowItems.status,
            payload: messageWorkflowItems.payload,
            dueAt: messageWorkflowItems.dueAt,
            updatedAt: messageWorkflowItems.updatedAt,
        })
        .from(messageWorkflowItems)
        .where(
            and(
                inArray(messageWorkflowItems.messageId, messageIds),
                eq(messageWorkflowItems.creatorId, viewerId),
                eq(messageWorkflowItems.scope, 'private'),
                eq(messageWorkflowItems.kind, 'follow_up'),
            ),
        )
        .orderBy(desc(messageWorkflowItems.updatedAt), desc(messageWorkflowItems.createdAt));
    const recipientCountPromise = senderMessageIds.length > 0
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    ne(conversationParticipants.userId, viewerId),
                ),
            )
        : Promise.resolve([]);
    const receiptRowsPromise = senderMessageIds.length > 0
        ? Promise.all([
            db
                .select({
                    messageId: messageDeliveryReceipts.messageId,
                    count: sql<number>`count(*)::int`,
                })
                .from(messageDeliveryReceipts)
                .where(inArray(messageDeliveryReceipts.messageId, senderMessageIds))
                .groupBy(messageDeliveryReceipts.messageId),
            db
                .select({
                    messageId: messageReadReceipts.messageId,
                    count: sql<number>`count(*)::int`,
                })
                .from(messageReadReceipts)
                .where(inArray(messageReadReceipts.messageId, senderMessageIds))
                .groupBy(messageReadReceipts.messageId),
        ])
        : Promise.resolve([[], []] as const);
    const [
        senderProfiles,
        replyPreviewMap,
        attachmentList,
        reactionSummaryMap,
        privateFollowUpRows,
        recipientRows,
        [deliveryRows, readRows],
    ] = await Promise.all([
        senderProfilesPromise,
        replyPreviewMapPromise,
        attachmentListPromise,
        reactionSummaryMapPromise,
        privateFollowUpRowsPromise,
        recipientCountPromise,
        receiptRowsPromise,
    ]);

    const senderMap = new Map(senderProfiles.map((sender) => [sender.id, sender]));
    const attachmentMap = new Map<string, typeof attachmentList>();
    for (const attachment of attachmentList) {
        if (!attachmentMap.has(attachment.messageId)) {
            attachmentMap.set(attachment.messageId, []);
        }
        attachmentMap.get(attachment.messageId)!.push(attachment);
    }

    const resolvedAttachmentMap = new Map<
        string,
        Awaited<ReturnType<typeof hydrateAttachmentUrls>>
    >();
    await Promise.all(
        Array.from(attachmentMap.entries()).map(async ([messageId, values]) => {
            resolvedAttachmentMap.set(messageId, await hydrateAttachmentUrls(values as AttachmentRowForResolution[]));
        }),
    );

    const privateFollowUpByMessageId = new Map<string, PrivateFollowUpSnapshot>();
    for (const row of privateFollowUpRows) {
        if (!row.messageId) {
            continue;
        }
        if (privateFollowUpByMessageId.has(row.messageId)) {
            continue;
        }
        const payload = (row.payload || {}) as Record<string, unknown>;
        privateFollowUpByMessageId.set(row.messageId, {
            workflowItemId: row.id,
            status: row.status,
            note: typeof payload.note === 'string' ? payload.note : null,
            dueAt: row.dueAt ? row.dueAt.toISOString() : null,
            preview: typeof payload.preview === 'string' ? payload.preview : null,
        });
    }

    // ────────────────────────────────────────────────────────────────────────
    // Delivery-state computation from receipt tables (Wave 1)
    //
    // For the sender's own messages, derive the delivery state:
    //   sent (1 ✓) → delivered (✓✓ gray) → read (✓✓ blue)
    //
    // DM: single recipient — any delivery receipt → delivered, read receipt → read
    // Group/project_group: counts across all non-sender participants
    // ────────────────────────────────────────────────────────────────────────
    const recipientCount = recipientRows[0]?.count ?? 0;
    const deliveryCountMap = new Map(deliveryRows.map((row) => [row.messageId, row.count] as const));
    const readCountMap = new Map(readRows.map((row) => [row.messageId, row.count] as const));

    return rows.map((messageRow) => {
        const baseMetadata = withPrivateFollowUpMetadata(
            withReactionSummaryMetadata(
                (messageRow.metadata || {}) as Record<string, unknown>,
                reactionSummaryMap.get(messageRow.id) || [],
            ),
            privateFollowUpByMessageId.get(messageRow.id) || null,
        );

        // Compute delivery state for the sender's own messages
        let deliveryState: MessageDeliveryState | undefined;
        let deliveryCounts: DeliveryCounts | undefined;

        if (messageRow.senderId === viewerId) {
            const deliveredCount = deliveryCountMap.get(messageRow.id) ?? 0;
            const readCount = readCountMap.get(messageRow.id) ?? 0;

            // Also honour the legacy watermark for backwards-compat with
            // messages that existed before the receipt tables were populated.
            const legacyRead = conversationType === 'dm'
                && Boolean(otherParticipantLastReadAt && messageRow.createdAt <= otherParticipantLastReadAt);
            const derivedDeliveryState = deriveReceiptDeliveryState({
                recipientCount,
                deliveredCount,
                readCount,
                legacyRead,
            });
            deliveryState = derivedDeliveryState.state;
            deliveryCounts = derivedDeliveryState.counts;
        }

        return {
            id: messageRow.id,
            conversationId: messageRow.conversationId,
            senderId: messageRow.senderId,
            replyTo: messageRow.replyToMessageId ? replyPreviewMap.get(messageRow.replyToMessageId) || null : null,
            clientMessageId: messageRow.clientMessageId,
            content: messageRow.content,
            type: messageRow.type as MessageWithSender['type'],
            metadata: deliveryState
                ? withDeliveryMetadata(baseMetadata, deliveryState, deliveryCounts)
                : baseMetadata,
            createdAt: messageRow.createdAt,
            editedAt: messageRow.editedAt,
            deletedAt: messageRow.deletedAt,
            sender: messageRow.senderId ? senderMap.get(messageRow.senderId) || null : null,
            attachments: resolvedAttachmentMap.get(messageRow.id) || [],
        } satisfies MessageWithSender;
    });
}

type ConversationLastMessagePreview = {
    id: string;
    type: ConversationWithDetails['type'];
    lastMessage: {
        id: string;
        senderId: string | null;
        createdAt: Date;
        metadata?: Record<string, unknown> | null;
    } | null;
};

export async function hydrateConversationLastMessageDeliveryMetadata<
    TConversation extends ConversationLastMessagePreview,
>(
    viewerId: string,
    conversationsToHydrate: TConversation[],
): Promise<TConversation[]> {
    const authoredConversations = conversationsToHydrate.filter((conversation) =>
        conversation.lastMessage?.senderId === viewerId,
    );
    if (authoredConversations.length === 0) {
        return conversationsToHydrate;
    }

    const messageIds = Array.from(new Set(
        authoredConversations
            .map((conversation) => conversation.lastMessage?.id ?? null)
            .filter(Boolean),
    )) as string[];
    const conversationIds = Array.from(new Set(authoredConversations.map((conversation) => conversation.id)));
    const dmConversationIds = authoredConversations
        .filter((conversation) => conversation.type === 'dm')
        .map((conversation) => conversation.id);

    const [recipientRows, deliveryRows, readRows, dmOtherParticipantRows] = await Promise.all([
        db
            .select({
                conversationId: conversationParticipants.conversationId,
                count: sql<number>`count(*)::int`,
            })
            .from(conversationParticipants)
            .where(
                and(
                    inArray(conversationParticipants.conversationId, conversationIds),
                    ne(conversationParticipants.userId, viewerId),
                ),
            )
            .groupBy(conversationParticipants.conversationId),
        db
            .select({
                messageId: messageDeliveryReceipts.messageId,
                count: sql<number>`count(*)::int`,
            })
            .from(messageDeliveryReceipts)
            .where(inArray(messageDeliveryReceipts.messageId, messageIds))
            .groupBy(messageDeliveryReceipts.messageId),
        db
            .select({
                messageId: messageReadReceipts.messageId,
                count: sql<number>`count(*)::int`,
            })
            .from(messageReadReceipts)
            .where(inArray(messageReadReceipts.messageId, messageIds))
            .groupBy(messageReadReceipts.messageId),
        dmConversationIds.length > 0
            ? db
                .select({
                    conversationId: conversationParticipants.conversationId,
                    lastReadAt: conversationParticipants.lastReadAt,
                })
                .from(conversationParticipants)
                .where(
                    and(
                        inArray(conversationParticipants.conversationId, dmConversationIds),
                        ne(conversationParticipants.userId, viewerId),
                    ),
                )
            : Promise.resolve([] as Array<{
                conversationId: string;
                lastReadAt: Date | null;
            }>),
    ]);

    const recipientCountByConversationId = new Map(
        recipientRows.map((row) => [row.conversationId, row.count] as const),
    );
    const deliveredCountByMessageId = new Map(
        deliveryRows.map((row) => [row.messageId, row.count] as const),
    );
    const readCountByMessageId = new Map(
        readRows.map((row) => [row.messageId, row.count] as const),
    );
    const otherParticipantLastReadAtByConversationId = new Map(
        dmOtherParticipantRows.map((row) => [row.conversationId, row.lastReadAt] as const),
    );

    return conversationsToHydrate.map((conversation) => {
        const lastMessage = conversation.lastMessage;
        if (!lastMessage || lastMessage.senderId !== viewerId) {
            return conversation;
        }

        const derivedDeliveryState = deriveReceiptDeliveryState({
            recipientCount: recipientCountByConversationId.get(conversation.id) ?? 0,
            deliveredCount: deliveredCountByMessageId.get(lastMessage.id) ?? 0,
            readCount: readCountByMessageId.get(lastMessage.id) ?? 0,
            legacyRead: conversation.type === 'dm'
                && Boolean(
                    otherParticipantLastReadAtByConversationId.get(conversation.id)
                    && lastMessage.createdAt <= otherParticipantLastReadAtByConversationId.get(conversation.id)!,
                ),
        });

        return {
            ...conversation,
            lastMessage: {
                ...lastMessage,
                metadata: withDeliveryMetadata(
                    lastMessage.metadata,
                    derivedDeliveryState.state,
                    derivedDeliveryState.counts,
                ),
            },
        };
    });
}

async function readLatestVisibleConversationPreview(
    conversationId: string,
    userId: string,
): Promise<ConversationWithDetails['lastMessage']> {
    const [latestMessage] = await db
        .select({
            id: messages.id,
            content: messages.content,
            type: messages.type,
            metadata: messages.metadata,
            createdAt: messages.createdAt,
            senderId: messages.senderId,
        })
        .from(messages)
        .where(
            and(
                eq(messages.conversationId, conversationId),
                isNull(messages.deletedAt),
                sql`NOT EXISTS (
                    SELECT 1
                    FROM ${messageHiddenForUsers} h
                    WHERE h.message_id = ${messages.id}
                      AND h.user_id = ${userId}
                )`,
            ),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(1);

    return latestMessage
        ? {
            id: latestMessage.id,
            content: latestMessage.content,
            senderId: latestMessage.senderId,
            createdAt: latestMessage.createdAt,
            type: latestMessage.type,
            metadata: latestMessage.metadata as Record<string, unknown> | null,
        }
        : null;
}

async function reconcileConversationLastMessagePreviews(
    viewerId: string,
    conversationRows: ConversationWithDetails[],
): Promise<ConversationWithDetails[]> {
    const lastMessageIds = Array.from(new Set(
        conversationRows
            .map((conversation) => conversation.lastMessage?.id ?? null)
            .filter(Boolean),
    )) as string[];
    if (lastMessageIds.length === 0) {
        return conversationRows;
    }

    const visibleRows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
            and(
                inArray(messages.id, lastMessageIds),
                isNull(messages.deletedAt),
                sql`NOT EXISTS (
                    SELECT 1
                    FROM ${messageHiddenForUsers} h
                    WHERE h.message_id = ${messages.id}
                      AND h.user_id = ${viewerId}
                )`,
            ),
        );
    const visibleLastMessageIds = new Set(visibleRows.map((row) => row.id));
    const staleConversationIds = Array.from(new Set(
        conversationRows.flatMap((conversation) =>
            conversation.lastMessage && !visibleLastMessageIds.has(conversation.lastMessage.id)
                ? [conversation.id]
                : [],
        ),
    ));
    if (staleConversationIds.length === 0) {
        return conversationRows;
    }

    const refreshedEntries = await Promise.all(staleConversationIds.map(async (conversationId) => {
        const latestMessage = await readLatestVisibleConversationPreview(conversationId, viewerId);
        
        await db.update(conversationParticipants)
            .set(buildConversationParticipantPreview(latestMessage))
            .where(and(
                eq(conversationParticipants.conversationId, conversationId),
                eq(conversationParticipants.userId, viewerId)
            ));

        return [
            conversationId,
            latestMessage,
        ] as const;
    }));
    const refreshedLastMessageByConversationId = new Map(refreshedEntries);

    return conversationRows.map((conversation) => {
        if (!refreshedLastMessageByConversationId.has(conversation.id)) {
            return conversation;
        }
        const lastMessage = refreshedLastMessageByConversationId.get(conversation.id) ?? null;
        return {
            ...conversation,
            updatedAt: lastMessage?.createdAt ?? conversation.updatedAt,
            lifecycleState: lastMessage
                ? 'active'
                : conversation.lifecycleState === 'archived'
                    ? 'archived'
                    : 'draft',
            lastMessage,
        };
    });
}

function sortConversationsByLatestActivity<TConversation extends ConversationWithDetails>(
    conversationRows: TConversation[],
): TConversation[] {
    return [...conversationRows].sort((left, right) => {
        const leftMs = left.updatedAt instanceof Date ? left.updatedAt.getTime() : new Date(left.updatedAt).getTime();
        const rightMs = right.updatedAt instanceof Date ? right.updatedAt.getTime() : new Date(right.updatedAt).getTime();
        const activityDiff = (Number.isFinite(rightMs) ? rightMs : 0) - (Number.isFinite(leftMs) ? leftMs : 0);
        if (activityDiff !== 0) return activityDiff;
        return right.id.localeCompare(left.id);
    });
}

function compareReadWatermark(
    left: { id: string | null; createdAt: Date | null },
    right: { id: string | null; createdAt: Date | null },
) {
    const leftEpoch = left.createdAt instanceof Date ? left.createdAt.getTime() : 0;
    const rightEpoch = right.createdAt instanceof Date ? right.createdAt.getTime() : 0;
    if (leftEpoch !== rightEpoch) {
        return leftEpoch - rightEpoch;
    }
    if (left.id && right.id && left.id !== right.id) {
        return left.id.localeCompare(right.id);
    }
    if (left.id && !right.id) return 1;
    if (!left.id && right.id) return -1;
    return 0;
}

function shouldAdvanceReadWatermark(
    current: { id: string | null; createdAt: Date | null },
    next: { id: string; createdAt: Date } | null,
) {
    if (!next) return !current.createdAt;
    if (!current.createdAt) return true;
    return compareReadWatermark(next, current) > 0;
}

function buildUnreadAfterReadWatermarkPredicate(
    conversationId: string,
    lastReadMessageId: string | null | undefined,
    lastReadAt: Date | null | undefined,
) {
    if (lastReadMessageId) {
        const fallbackReadAt = (lastReadAt ?? new Date(0)).toISOString();
        const watermarkCreatedAt = sql`COALESCE(
            (
                SELECT created_at
                FROM ${messages}
                WHERE id = ${lastReadMessageId}
                  AND conversation_id = ${conversationId}
            ),
            CAST(${fallbackReadAt} AS timestamptz)
        )`;

        return sql`(
            ${messages.createdAt} > ${watermarkCreatedAt}
            OR (
                ${messages.createdAt} = ${watermarkCreatedAt}
                AND ${messages.id} > ${lastReadMessageId}
            )
        )`;
    }

    if (lastReadAt) {
        return gt(messages.createdAt, lastReadAt);
    }

    return null;
}

type NormalizedAttachmentInput = UploadedAttachment & {
    storagePath: string;
};

function buildImageThumbnailUrl(signedUrl: string): string {
    return signedUrl.replace('/object/sign/', '/render/image/sign/')
        + `&width=${MESSAGE_MEDIA_PREVIEW_MAX_WIDTH}&resize=contain&format=origin`;
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

    return attachmentRows.map((attachment) => {
        const resolvedUrl = buildMessageAttachmentAccessUrl(attachment.id);
        const resolvedThumbnail = attachment.type === 'image'
            ? buildMessageAttachmentAccessUrl(attachment.id, { preview: true })
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

async function normalizeUploadedAttachmentsForCommit(
    attachments: UploadedAttachment[],
    userId: string
): Promise<{ attachments?: NormalizedAttachmentInput[]; error?: string }> {
    if (attachments.length === 0) return { attachments: [] };
    if (attachments.length > 12) {
        return { error: 'A message can contain at most 12 attachments.' };
    }

    const uniqueUploadIds = new Set(attachments.map((attachment) => attachment.id.trim()));
    if (
        uniqueUploadIds.size !== attachments.length
        || Array.from(uniqueUploadIds).some((id) => id.length < 1 || id.length > 160)
    ) {
        return { error: 'One or more attachment upload references are invalid.' };
    }

    const normalizedWithPath = attachments.map((attachment) => {
        const storagePath = resolveAttachmentStoragePath(attachment);
        return { attachment, storagePath };
    });

    if (normalizedWithPath.some((item) => !item.storagePath)) {
        return { error: 'One or more attachments are missing storage references. Please re-upload and try again.' };
    }

    if (normalizedWithPath.some((item) => !item.storagePath?.startsWith(`${userId}/`))) {
        return { error: 'You do not have permission to attach one or more of these files.' };
    }

    return {
        attachments: normalizedWithPath.map(({ attachment, storagePath }) => ({
            ...attachment,
            id: attachment.id.trim(),
            storagePath: storagePath!,
        })),
    };
}

async function claimAttachmentUploadsForMessage(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    userId: string,
    conversationId: string,
    attachments: NormalizedAttachmentInput[],
) {
    if (attachments.length === 0) return [];
    const clientUploadIds = attachments.map((attachment) => attachment.id);

    // Claim only fresh uploaded sessions. A committed upload is never reusable;
    // idempotent send retries are resolved by clientMessageId before this path.
    const claimed = await tx
        .update(attachmentUploads)
        .set({
            status: 'committed',
            conversationId,
            error: null,
            updatedAt: new Date(),
        })
        .where(and(
            eq(attachmentUploads.userId, userId),
            inArray(attachmentUploads.clientUploadId, clientUploadIds),
            eq(attachmentUploads.status, 'uploaded'),
            or(
                isNull(attachmentUploads.conversationId),
                eq(attachmentUploads.conversationId, conversationId),
            ),
        ))
        .returning({
            clientUploadId: attachmentUploads.clientUploadId,
            storagePath: attachmentUploads.storagePath,
            filename: attachmentUploads.filename,
            mimeType: attachmentUploads.mimeType,
            sizeBytes: attachmentUploads.sizeBytes,
        });

    if (claimed.length !== attachments.length) {
        throw new Error('ATTACHMENT_CLAIM_MISMATCH');
    }

    const inputById = new Map(attachments.map((attachment) => [attachment.id, attachment] as const));
    return claimed.map((upload) => {
        const input = inputById.get(upload.clientUploadId);
        if (!input || !upload.storagePath || input.storagePath !== upload.storagePath) {
            throw new Error('ATTACHMENT_PATH_MISMATCH');
        }
        const mimeType = upload.mimeType || input.mimeType || 'application/octet-stream';
        const type: UploadedAttachment['type'] = mimeType.startsWith('image/')
            ? 'image'
            : mimeType.startsWith('video/')
                ? 'video'
                : 'file';
        return {
            ...input,
            type,
            storagePath: upload.storagePath,
            filename: upload.filename,
            mimeType,
            sizeBytes: upload.sizeBytes ?? input.sizeBytes,
        };
    });
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
                    { conversationId: newConversation!.id, userId: user.id },
                    { conversationId: newConversation!.id, userId: otherUserId },
                ])
                .onConflictDoNothing({
                    target: [conversationParticipants.conversationId, conversationParticipants.userId],
                });

            await tx.insert(dmPairs).values({
                userLow: low,
                userHigh: high,
                conversationId: newConversation!.id,
            });

            return newConversation!.id;
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
    cursor?: string,
    scope: 'active' | 'archived' = 'active',
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
        const parsedCursorAt = cursorAtRaw ? new Date(cursorAtRaw) : undefined;
        const cursorAt = parsedCursorAt && !Number.isNaN(parsedCursorAt.getTime()) ? parsedCursorAt : undefined;
        const cursorConversationId =
            cursorConversationIdRaw && isUuid(cursorConversationIdRaw)
                ? cursorConversationIdRaw
                : undefined;
        if (cursor && (!cursorAt || !cursorConversationId)) {
            return { success: false, error: 'Invalid conversation cursor' };
        }
        if (scope !== 'active' && scope !== 'archived') {
            return { success: false, error: 'Invalid conversation scope' };
        }
        const safeLimit = Math.max(1, Math.min(limit, 100));
        const dedupeKey = `messages:conversations:${user.id}:${scope}:${safeLimit}:${cursorAt?.toISOString() ?? ''}:${cursorConversationId ?? ''}`;

        return await runInFlightDeduped(dedupeKey, async () => {
            const userConversations = await db.execute<{
                conversation_id: string;
                type: 'dm' | 'group' | 'project_group';
                unread_count: number;
                last_message_at: Date | null;
                last_message_id: string | null;
                last_message_preview: string | null;
                last_message_sender_id: string | null;
                last_message_type: string | null;
                last_reaction_at: Date | null;
                last_reaction_message_id: string | null;
                last_reaction_emoji: string | null;
                last_reaction_actor_id: string | null;
                last_read_at: Date | null;
                last_read_message_id: string | null;
                updated_at: Date;
                sort_at: Date;
                archived_at: Date | null;
                muted: boolean | null;
                project_title: string | null;
                project_cover_image: string | null;
            }>(sql`
                SELECT 
                    cp.conversation_id,
                    c.type,
                    cp.unread_count,
                    cp.last_message_at,
                    cp.last_message_id,
                    cp.last_message_preview,
                    cp.last_message_sender_id,
                    cp.last_message_type,
                    cp.last_reaction_at,
                    cp.last_reaction_message_id,
                    cp.last_reaction_emoji,
                    cp.last_reaction_actor_id,
                    cp.last_read_at,
                    cp.last_read_message_id,
                    c.updated_at,
                    cp.archived_at,
                    cp.muted,
                    p.title AS project_title,
                    p.cover_image AS project_cover_image,
                    cp.last_message_at AS sort_at
                FROM ${conversationParticipants} cp
                INNER JOIN ${conversations} c ON c.id = cp.conversation_id
                LEFT JOIN ${projects} p ON p.conversation_id = c.id
                WHERE cp.user_id = ${user.id}
                ${scope === 'archived'
                    ? sql`AND cp.archived_at IS NOT NULL`
                    : sql`AND cp.archived_at IS NULL`}
                ${scope === 'archived' ? sql`` : sql`AND c.type != 'project_group'`}
                AND cp.last_message_id IS NOT NULL
                ${cursorAt ? sql`
                    AND (
                        cp.last_message_at < ${cursorAt.toISOString()}
                        ${cursorConversationId ? sql`OR (
                            cp.last_message_at = ${cursorAt.toISOString()}
                            AND cp.conversation_id < ${cursorConversationId}
                        )` : sql``}
                    )
                ` : sql``}
                ORDER BY cp.last_message_at DESC, cp.conversation_id DESC
                LIMIT ${safeLimit + 1}
            `);

            const userConvArray = Array.from(userConversations);
            const hasMore = userConvArray.length > safeLimit;
            const paginatedConvs = userConvArray.slice(0, safeLimit);

            if (paginatedConvs.length === 0) {
                return { success: true, conversations: [], hasMore: false };
            }

        const conversationIds = paginatedConvs.map((conversation) => conversation.conversation_id);

        // QUERY 2: Get all participants for these conversations
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
        const result: ConversationWithDetails[] = paginatedConvs.map((userConv) => {
            return {
                id: userConv.conversation_id,
                type: userConv.type,
                updatedAt: userConv.sort_at || userConv.last_message_at || userConv.updated_at || new Date(),
                lifecycleState: scope === 'archived'
                    ? 'archived'
                    : userConv.last_message_id
                        ? 'active'
                        : 'draft',
                muted: Boolean(userConv.muted),
                displayTitle: userConv.project_title ?? undefined,
                displayAvatarUrl: userConv.project_cover_image,
                displaySubtitle: userConv.type === 'project_group' ? 'Project' : undefined,
                participants: (participantMap.get(userConv.conversation_id) || []).map(p => ({
                    id: p.userId,
                    username: p.username,
                    fullName: p.fullName,
                    avatarUrl: p.avatarUrl,
                })),
                lastMessage: userConv.last_message_id ? {
                    id: userConv.last_message_id,
                    content: userConv.last_message_preview,
                    senderId: userConv.last_message_sender_id,
                    createdAt: userConv.last_message_at || userConv.updated_at || new Date(),
                    type: userConv.last_message_type,
                } : null,
                unreadCount: userConv.unread_count || 0, // O(1) Read from denormalized column
                lastReadAt: userConv.last_read_at ?? null,
                lastReadMessageId: userConv.last_read_message_id ?? null,
                reactionPreview: userConv.last_reaction_at
                    && userConv.last_reaction_message_id
                    && userConv.last_reaction_emoji
                    && userConv.last_reaction_actor_id
                    ? {
                        messageId: userConv.last_reaction_message_id,
                        actorUserId: userConv.last_reaction_actor_id,
                        emoji: userConv.last_reaction_emoji,
                        createdAt: userConv.last_reaction_at,
                    }
                    : null,
            };
        }).filter(Boolean) as ConversationWithDetails[];
        const hydratedResult = await hydrateConversationLastMessageDeliveryMetadata(user.id, result);

            return {
                success: true,
                conversations: hydratedResult,
                hasMore,
                nextCursor: hasMore
                    ? `${paginatedConvs[paginatedConvs.length - 1]!.sort_at.toISOString()}|${paginatedConvs[paginatedConvs.length - 1]!.conversation_id}`
                    : undefined
            };
        });
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
        const scopedViewer = getMessageThreadReadScope(conversationId);
        const user = scopedViewer ? { id: scopedViewer.viewerId } : await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const safeLimit = Math.max(1, Math.min(100, limit));
        const [cursorAtRaw, cursorMessageIdRaw] = cursor ? cursor.split('|') : [];
        const parsedCursorAt = cursorAtRaw ? new Date(cursorAtRaw) : undefined;
        const cursorAt = parsedCursorAt && !Number.isNaN(parsedCursorAt.getTime()) ? parsedCursorAt : undefined;
        const cursorMessageId = cursorMessageIdRaw && isUuid(cursorMessageIdRaw)
            ? cursorMessageIdRaw
            : undefined;
        if (cursor && (!cursorAt || !cursorMessageId)) {
            return { success: false, error: 'Invalid message cursor' };
        }
        const cursorKey = cursorAt ? `${cursorAt.toISOString()}|${cursorMessageId || ''}` : 'head';
        return await runInFlightDeduped(
            `messages:list:${user.id}:${conversationId}:${cursorKey}:${safeLimit}`,
            async () => {

        let conversationMeta: { type: typeof conversations.$inferSelect.type } | undefined = scopedViewer
            ? { type: scopedViewer.conversationType }
            : undefined;

        let dmOtherParticipantId: string | null = scopedViewer?.otherParticipantId ?? null;
        if (!scopedViewer) {
            const participantMembershipId = await getConversationMembershipId(conversationId, user.id);
            if (!participantMembershipId) {
                return { success: false, error: 'Not a participant of this conversation' };
            }
            [conversationMeta] = await db
                .select({ type: conversations.type })
                .from(conversations)
                .where(eq(conversations.id, conversationId))
                .limit(1);
        }

        if (!scopedViewer && conversationMeta?.type === 'dm') {
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
                return { success: false, error: 'Conversation not found' };
            }
            dmOtherParticipantId = otherParticipant.userId;

            const readability = await assertDirectMessageReadable(user.id, otherParticipant.userId);
            if (!readability.ok) {
                return { success: false, error: readability.error || 'Conversation not found' };
            }
        }

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

        const visibilityPredicate = sql`NOT EXISTS (
            SELECT 1
            FROM ${messageHiddenForUsers} h
            WHERE h.message_id = ${messages.id}
            AND h.user_id = ${user.id}
        )`;
        const cursorPredicate = cursorAt
            ? (cursorMessageId
                ? or(
                    lt(messages.createdAt, cursorAt),
                    and(eq(messages.createdAt, cursorAt), lt(messages.id, cursorMessageId))
                )
                : lt(messages.createdAt, cursorAt))
            : undefined;

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
                cursorPredicate
                    ? and(
                        eq(messages.conversationId, conversationId),
                        cursorPredicate,
                        visibilityPredicate
                    )
                    : and(
                        eq(messages.conversationId, conversationId),
                        visibilityPredicate
                    )
            )
            .orderBy(desc(messages.createdAt), desc(messages.id))
            .limit(safeLimit + 1);

        const messageList = await query;
        const hasMore = messageList.length > safeLimit;
        const paginatedMessages = messageList.slice(0, safeLimit);
        const nextCursorMessage = hasMore ? paginatedMessages[paginatedMessages.length - 1] : null;

        if (paginatedMessages.length === 0) {
            return { success: true, messages: [], hasMore: false };
        }

        const result = await hydrateConversationMessages({
            rows: paginatedMessages.reverse() as HydratableMessageRow[],
            conversationId,
            viewerId: user.id,
            conversationType: conversationMeta?.type as ConversationWithDetails['type'] | undefined,
            otherParticipantLastReadAt,
        });

        if (dmOtherParticipantId) {
            await recordPrivacyReadEvent({
                subjectUserId: dmOtherParticipantId,
                viewerUserId: user.id,
                eventType: 'message_history_read',
                route: 'messaging.history',
                metadata: {
                    conversationId,
                    count: result.length,
                },
            });
        }

        return {
            success: true,
            messages: result,
            hasMore,
            nextCursor: nextCursorMessage
                ? `${nextCursorMessage.createdAt.toISOString()}|${nextCursorMessage.id}`
                : undefined,
        };
            }
        );
    } catch (error) {
        console.error('Error fetching messages:', error);
        return { success: false, error: 'Failed to fetch messages' };
    }
}

// ============================================================================
// GET MESSAGE CONTEXT (single-message fallback for reply focus navigation)
// ============================================================================

export async function getMessageContext(
    conversationId: string,
    messageId: string,
): Promise<{
    success: boolean;
    error?: string;
    available: boolean;
    message?: MessageWithSender;
    messages?: MessageWithSender[];
    anchorMessageId?: string;
    hasOlderContext?: boolean;
    hasNewerContext?: boolean;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated', available: false };

        return await runInFlightDeduped(
            `messages:context:${user.id}:${conversationId}:${messageId}`,
            async () => {
                const [participant] = await db
                    .select({ id: conversationParticipants.id })
                    .from(conversationParticipants)
                    .where(
                        and(
                            eq(conversationParticipants.conversationId, conversationId),
                            eq(conversationParticipants.userId, user.id)
                        )
                    )
                    .limit(1);

                if (!participant) {
                    return { success: false, error: 'Not a participant of this conversation', available: false };
                }

                const [messageRow] = await db
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
                            eq(messages.id, messageId),
                            eq(messages.conversationId, conversationId)
                        )
                    )
                    .limit(1);

                if (!messageRow) {
                    return { success: true, available: false };
                }

                const [hidden] = await db
                    .select({ id: messageHiddenForUsers.id })
                    .from(messageHiddenForUsers)
                    .where(
                        and(
                            eq(messageHiddenForUsers.messageId, messageId),
                            eq(messageHiddenForUsers.userId, user.id)
                        )
                    )
                    .limit(1);
                if (hidden) {
                    return { success: true, available: false };
                }

                const [conversationMeta] = await db
                    .select({ type: conversations.type })
                    .from(conversations)
                    .where(eq(conversations.id, conversationId))
                    .limit(1);

                if (conversationMeta?.type === 'dm') {
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
                        return { success: false, error: 'Conversation not found', available: false };
                    }

                    const readability = await assertDirectMessageReadable(user.id, otherParticipant.userId);
                    if (!readability.ok) {
                        return { success: false, error: readability.error || 'Conversation not found', available: false };
                    }
                }

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

                const visibilityPredicate = sql`NOT EXISTS (
                    SELECT 1
                    FROM ${messageHiddenForUsers} h
                    WHERE h.message_id = ${messages.id}
                    AND h.user_id = ${user.id}
                )`;
                const olderRowsDesc = await db
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
                            visibilityPredicate,
                            or(
                                lt(messages.createdAt, messageRow.createdAt),
                                and(eq(messages.createdAt, messageRow.createdAt), lt(messages.id, messageRow.id)),
                            ),
                        ),
                    )
                    .orderBy(desc(messages.createdAt), desc(messages.id))
                    .limit(4);

                const newerRowsAsc = await db
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
                            visibilityPredicate,
                            or(
                                gt(messages.createdAt, messageRow.createdAt),
                                and(eq(messages.createdAt, messageRow.createdAt), gt(messages.id, messageRow.id)),
                            ),
                        ),
                    )
                    .orderBy(asc(messages.createdAt), asc(messages.id))
                    .limit(4);

                const contextRows = [
                    ...olderRowsDesc.reverse(),
                    messageRow,
                    ...newerRowsAsc,
                ] as HydratableMessageRow[];
                const hydratedContext = await hydrateConversationMessages({
                    rows: contextRows,
                    conversationId,
                    viewerId: user.id,
                    conversationType: conversationMeta?.type as ConversationWithDetails['type'] | undefined,
                    otherParticipantLastReadAt,
                });
                const hydrated = hydratedContext.find((message) => message.id === messageRow.id);

                if (!hydrated) {
                    return { success: true, available: false };
                }

                return {
                    success: true,
                    available: true,
                    message: hydrated,
                    messages: hydratedContext,
                    anchorMessageId: messageRow.id,
                    hasOlderContext: olderRowsDesc.length > 0,
                    hasNewerContext: newerRowsAsc.length > 0,
                };
            }
        );
    } catch (error) {
        console.error('Error fetching message context:', error);
        return { success: false, error: 'Failed to fetch message context', available: false };
    }
}

// ============================================================================
// SEND MESSAGE
// ============================================================================

async function consumeDirectMessageTargetRateLimit(viewerId: string, targetUserId: string) {
    return consumeRateLimit(`msg-target:${viewerId}:${targetUserId}`, 60, 300);
}

// ============================================================================
// MARK CONVERSATION AS READ
// ============================================================================

export async function markConversationAsRead(
    conversationId: string,
    lastReadMessageId?: string
): Promise<{
    success: boolean;
    error?: string;
    conversationId?: string;
    unreadCount?: number;
    lastReadAt?: Date | null;
    lastReadMessageId?: string | null;
    serverAppliedAt?: string;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const requestId = `${conversationId}:${user.id}:${Date.now()}`;
        logger.info('read_commit_requested', {
            module: 'messaging',
            conversationId,
            userId: user.id,
            requestId,
        });
        const serverLastReadMessageId = isTemporaryMessageId(lastReadMessageId)
            ? undefined
            : lastReadMessageId;

        const result = await db.transaction(async (tx) => {
            const [membership] = await tx
                .select({
                    id: conversationParticipants.id,
                    lastReadMessageId: conversationParticipants.lastReadMessageId,
                    lastReadAt: conversationParticipants.lastReadAt,
                    unreadCount: conversationParticipants.unreadCount,
                })
                .from(conversationParticipants)
                .where(
                    and(
                        eq(conversationParticipants.conversationId, conversationId),
                        eq(conversationParticipants.userId, user.id)
                    )
                )
                .limit(1)
                .for('update');

            if (!membership) {
                return { ok: false as const, error: 'Not a participant of this conversation' };
            }

            // ponytail: repeated visibility/read observers commonly submit the
            // same watermark. Once this row is already clear, no database
            // recount, participant write, or notification write is needed.
            if (
                serverLastReadMessageId
                && membership.lastReadMessageId === serverLastReadMessageId
                && (membership.unreadCount ?? 0) === 0
            ) {
                return {
                    ok: true as const,
                    membership,
                    updatedMembership: membership,
                    shouldClearNotifications: false,
                };
            }

            let watermarkMessage:
                | { id: string; createdAt: Date }
                | null = null;

            if (serverLastReadMessageId) {
                const [explicit] = await tx
                    .select({ id: messages.id, createdAt: messages.createdAt })
                    .from(messages)
                    .where(
                        and(
                            eq(messages.id, serverLastReadMessageId),
                            eq(messages.conversationId, conversationId),
                            isNull(messages.deletedAt)
                        )
                    )
                    .limit(1);

                if (!explicit) {
                    return { ok: false as const, error: 'Read watermark message not found' };
                }
                watermarkMessage = explicit;
            } else {
                const [latest] = await tx
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
                    .orderBy(desc(messages.createdAt), desc(messages.id))
                    .limit(1);

                watermarkMessage = latest || null;
            }

            const shouldAdvanceWatermark = shouldAdvanceReadWatermark(
                {
                    id: membership.lastReadMessageId ?? null,
                    createdAt: membership.lastReadAt ?? null,
                },
                watermarkMessage,
            );
            const nextLastReadAt = watermarkMessage
                ? shouldAdvanceWatermark
                    ? watermarkMessage.createdAt
                    : membership.lastReadAt
                : membership.lastReadAt ?? new Date();
            const nextLastReadMessageId = watermarkMessage
                ? shouldAdvanceWatermark
                    ? watermarkMessage.id
                    : membership.lastReadMessageId ?? watermarkMessage.id
                : membership.lastReadMessageId ?? null;

            if (!shouldAdvanceWatermark && (membership.unreadCount ?? 0) === 0) {
                return {
                    ok: true as const,
                    membership,
                    updatedMembership: membership,
                    shouldClearNotifications: false,
                };
            }

            if (watermarkMessage && shouldAdvanceWatermark) {
                const previousReadAt = membership.lastReadAt ?? new Date(0);
                const previousReadId =
                    membership.lastReadMessageId ?? '00000000-0000-0000-0000-000000000000';
                await tx.execute(sql`
                    INSERT INTO ${messageReadReceipts} (
                        message_id,
                        conversation_id,
                        user_id,
                        read_at
                    )
                    SELECT
                        message.id,
                        ${conversationId},
                        ${user.id},
                        now()
                    FROM ${messages} message
                    WHERE message.conversation_id = ${conversationId}
                      AND message.deleted_at IS NULL
                      AND message.sender_id IS DISTINCT FROM ${user.id}
                      AND (message.created_at, message.id) > (
                        ${previousReadAt.toISOString()},
                        ${previousReadId}::uuid
                      )
                      AND (message.created_at, message.id) <= (
                        ${watermarkMessage.createdAt instanceof Date ? watermarkMessage.createdAt.toISOString() : watermarkMessage.createdAt},
                        ${watermarkMessage.id}::uuid
                      )
                      AND NOT EXISTS (
                        SELECT 1
                        FROM ${messageHiddenForUsers} hidden
                        WHERE hidden.message_id = message.id
                          AND hidden.user_id = ${user.id}
                      )
                    ON CONFLICT (message_id, user_id) DO NOTHING
                `);
            }

            const predicates = [
                eq(messages.conversationId, conversationId),
                or(isNull(messages.senderId), ne(messages.senderId, user.id)),
                isNull(messages.deletedAt),
                sql`NOT EXISTS (
                    SELECT 1
                    FROM ${messageHiddenForUsers} h
                    WHERE h.message_id = ${messages.id}
                      AND h.user_id = ${user.id}
                )`,
            ];
            const unreadAfterWatermark = buildUnreadAfterReadWatermarkPredicate(
                conversationId,
                nextLastReadMessageId,
                nextLastReadAt,
            );
            if (unreadAfterWatermark) predicates.push(unreadAfterWatermark);

            const [row] = await tx
                .select({ count: sql<number>`COUNT(*)::int` })
                .from(messages)
                .where(and(...predicates));
            const finalUnreadCount = Number(row?.count ?? 0);

            const [updatedMembership] = await tx
                .update(conversationParticipants)
                .set({
                    lastReadAt: nextLastReadAt,
                    lastReadMessageId: nextLastReadMessageId,
                    unreadCount: finalUnreadCount,
                })
                .where(eq(conversationParticipants.id, membership.id))
                .returning({
                    unreadCount: conversationParticipants.unreadCount,
                    lastReadAt: conversationParticipants.lastReadAt,
                    lastReadMessageId: conversationParticipants.lastReadMessageId,
                });

            return {
                ok: true as const,
                membership,
                updatedMembership,
                shouldClearNotifications:
                    (membership.unreadCount ?? 0) > 0
                    && (updatedMembership?.unreadCount ?? 0) === 0,
            };
        });

        if (!result.ok) {
            return { success: false, error: result.error };
        }
        const updatedMembership = result.updatedMembership;

        if (result.shouldClearNotifications) {
            try {
                await markConversationNotificationsRead(user.id, conversationId);
            } catch (error) {
                logger.error('messages.mark_notifications_read_failed', {
                    module: 'messaging',
                    conversationId,
                    userId: user.id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        logger.info('read_commit_applied', {
            module: 'messaging',
            conversationId,
            userId: user.id,
            requestId,
            previousCount: result.membership.unreadCount ?? 0,
            count: updatedMembership?.unreadCount ?? 0,
            status: 'success',
        });

        return {
            success: true,
            conversationId,
            unreadCount: updatedMembership?.unreadCount ?? 0,
            lastReadAt: updatedMembership?.lastReadAt ?? null,
            lastReadMessageId: updatedMembership?.lastReadMessageId ?? null,
            serverAppliedAt: new Date().toISOString(),
        };
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
    limit: number = 20,
    cursor?: string | null,
): Promise<{
    success: boolean;
    error?: string;
    errorCode?: 'INVALID_QUERY' | 'INVALID_CURSOR' | 'RATE_LIMITED' | 'SEARCH_FAILED';
    nextCursor?: string | null;
    results?: Array<{
        message: MessageWithSender;
        conversationId: string;
        displayTitle: string;
        displayAvatarUrl: string | null;
        conversationType: ConversationWithDetails['type'];
        contextLabel: string;
        matchedSnippet: string;
        attachmentSummary: {
            count: number;
            filename: string | null;
        };
    }>;
}> {
    const searchStartedAt = Date.now();
    const queryLength = Array.from(query?.normalize('NFKC') ?? '').length;
    const completeSearch = <T extends {
        success: boolean;
        errorCode?: 'INVALID_QUERY' | 'INVALID_CURSOR' | 'RATE_LIMITED' | 'SEARCH_FAILED';
        nextCursor?: string | null;
        results?: Array<unknown>;
    }>(result: T): T => {
        const resultCount = result.results?.length ?? 0;
        const outcome = result.success
            ? (resultCount > 0 ? 'success' : 'empty')
            : result.errorCode === 'RATE_LIMITED'
                ? 'rate_limited'
                : result.errorCode === 'INVALID_QUERY' || result.errorCode === 'INVALID_CURSOR'
                    ? 'invalid'
                    : 'error';
        recordMessageSearch({
            queryLength,
            durationMs: Date.now() - searchStartedAt,
            resultCount,
            outcome,
            errorCode: result.errorCode,
            hasMore: Boolean(result.nextCursor),
        });
        return result;
    };

    try {
        const user = await getAuthUser();
        if (!user) return completeSearch({ success: false, error: 'Not authenticated' });

        const normalizedInput = sanitizeMessageSearchText(query?.normalize('NFKC') ?? '');
        if (!normalizedInput) {
            return completeSearch({ success: true, results: [], nextCursor: null });
        }
        const { textQuery, fromFilter, hasFilter, inFilter, kindFilter, hasChip, isPinned } =
            parseMessageSearchQuery(normalizedInput);
        if (!textQuery && !fromFilter && !hasFilter && !inFilter && !kindFilter && !hasChip && !isPinned) {
            return completeSearch({ success: true, results: [], nextCursor: null });
        }

        if (textQuery && Array.from(textQuery).length < 2) {
            return completeSearch({
                success: false,
                error: 'Enter at least two characters to search message history.',
                errorCode: 'INVALID_QUERY',
            });
        }

        const parsedLimit = Number.isFinite(limit) ? Math.trunc(limit) : NaN;
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
            return completeSearch({
                success: false,
                error: 'Invalid search page size.',
                errorCode: 'INVALID_QUERY',
            });
        }
        const pageSize = Math.min(parsedLimit, 50);
        const decodedCursor = decodeMessageSearchCursor(cursor);
        if (cursor && !decodedCursor) {
            return completeSearch({
                success: false,
                error: 'Invalid search cursor.',
                errorCode: 'INVALID_CURSOR',
            });
        }

        const searchRate = await consumeRateLimit(`message-search:${user.id}`, 90, 60, {
            failMode: 'stale_or_shed',
        });
        if (!searchRate.allowed) {
            return completeSearch({
                success: false,
                error: 'Message search is temporarily busy. Please try again shortly.',
                errorCode: 'RATE_LIMITED',
            });
        }

        const normalizedQuery = textQuery;
        const searchPattern = normalizedQuery ? `%${normalizedQuery}%` : null;
        const rankExpression = normalizedQuery
            ? sql<number>`ts_rank_cd(
                ${messages.searchDocument},
                websearch_to_tsquery('simple', ${normalizedQuery})
            )`
            : sql<number>`0::real`;

        const conversationScopePredicate = sql`EXISTS (
            SELECT 1
            FROM ${conversationParticipants} search_cp
            INNER JOIN ${conversations} search_c
                ON search_c.id = search_cp.conversation_id
            LEFT JOIN ${dmPairs} search_dp
                ON search_dp.conversation_id = search_c.id
            WHERE search_cp.conversation_id = ${messages.conversationId}
              AND search_cp.user_id = ${user.id}
              AND search_cp.archived_at IS NULL
              ${inFilter ? sql`AND search_c.type = ${inFilter}` : sql``}
              AND (
                  search_c.type <> 'dm'
                  OR (
                      search_dp.conversation_id IS NOT NULL
                      AND NOT EXISTS (
                          SELECT 1
                          FROM ${connections} blocked_connection
                          WHERE blocked_connection.status = 'blocked'
                            AND (
                                (
                                    blocked_connection.requester_id = search_dp.user_low
                                    AND blocked_connection.addressee_id = search_dp.user_high
                                )
                                OR (
                                    blocked_connection.requester_id = search_dp.user_high
                                    AND blocked_connection.addressee_id = search_dp.user_low
                                )
                            )
                      )
                  )
              )
        )`;

        const textPredicate = normalizedQuery
            ? sql`(
                ${messages.searchDocument} @@ websearch_to_tsquery('simple', ${normalizedQuery})
                OR ${messages.content} ILIKE ${searchPattern}
                OR coalesce(${messages.metadata} #>> '{structured,summary}', '') ILIKE ${searchPattern}
                OR coalesce(${messages.metadata} #>> '{structured,title}', '') ILIKE ${searchPattern}
                OR EXISTS (
                    SELECT 1
                    FROM ${messageAttachments} search_attachment
                    WHERE search_attachment.message_id = ${messages.id}
                      AND search_attachment.filename ILIKE ${searchPattern}
                )
            )`
            : sql`true`;
        const hasPredicate = hasFilter === 'code'
            ? sql`${messages.content} ILIKE ${'%```%'}`
            : (hasFilter
                ? sql`EXISTS (
                    SELECT 1
                    FROM ${messageAttachments} typed_attachment
                    WHERE typed_attachment.message_id = ${messages.id}
                      AND typed_attachment.type = ${hasFilter}
                )`
                : sql`true`);
        const kindPredicate = kindFilter
            ? sql`coalesce(${messages.metadata} #>> '{structured,kind}', '') = ${kindFilter}`
            : sql`true`;
        const chipPredicate = hasChip
            ? sql`(
                (jsonb_typeof(${messages.metadata} #> '{structured,contextChips}') = 'array' AND jsonb_array_length(${messages.metadata} #> '{structured,contextChips}') > 0)
                OR
                (jsonb_typeof(${messages.metadata} #> '{contextChips}') = 'array' AND jsonb_array_length(${messages.metadata} #> '{contextChips}') > 0)
            )`
            : sql`true`;
        const pinnedPredicate = isPinned
            ? sql`EXISTS (
                SELECT 1
                FROM ${messagePins} search_pin
                WHERE search_pin.message_id = ${messages.id}
                  AND search_pin.conversation_id = ${messages.conversationId}
            )`
            : sql`true`;
        const fromPredicate = fromFilter
            ? sql`EXISTS (
                SELECT 1
                FROM ${profiles} search_sender
                WHERE search_sender.id = ${messages.senderId}
                  AND (
                      lower(coalesce(search_sender.full_name, '')) LIKE ${`%${fromFilter}%`}
                      OR lower(coalesce(search_sender.username, '')) LIKE ${`%${fromFilter}%`}
                      OR search_sender.id::text = ${fromFilter}
                  )
            )`
            : sql`true`;
        const cursorPredicate = decodedCursor
            ? sql`(
                ${rankExpression} < ${decodedCursor.rank}
                OR (
                    ${rankExpression} = ${decodedCursor.rank}
                    AND ${messages.createdAt} < ${new Date(decodedCursor.createdAt)}
                )
                OR (
                    ${rankExpression} = ${decodedCursor.rank}
                    AND ${messages.createdAt} = ${new Date(decodedCursor.createdAt)}
                    AND ${messages.id} < ${decodedCursor.id}
                )
            )`
            : sql`true`;

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
                rank: rankExpression,
                attachmentCount: sql<number>`(
                    SELECT count(*)::integer
                    FROM ${messageAttachments} search_attachment_count
                    WHERE search_attachment_count.message_id = ${messages.id}
                )`,
                attachmentFilename: sql<string | null>`(
                    SELECT min(search_attachment_name.filename)
                    FROM ${messageAttachments} search_attachment_name
                    WHERE search_attachment_name.message_id = ${messages.id}
                )`,
            })
            .from(messages)
            .where(
                and(
                    conversationScopePredicate,
                    sql`${messages.deletedAt} IS NULL`,
                    sql`NOT EXISTS (
                        SELECT 1
                        FROM ${messageHiddenForUsers} h
                            WHERE h.message_id = ${messages.id}
                            AND h.user_id = ${user.id}
                    )`,
                    textPredicate,
                    hasPredicate,
                    kindPredicate,
                    chipPredicate,
                    pinnedPredicate,
                    fromPredicate,
                    cursorPredicate,
                )
            )
            .orderBy(desc(rankExpression), desc(messages.createdAt), desc(messages.id))
            .limit(pageSize + 1);

        if (searchResults.length === 0) {
            return completeSearch({ success: true, results: [], nextCursor: null });
        }

        const pageRows = searchResults.slice(0, pageSize);
        const hasMore = searchResults.length > pageSize;
        const senderIds = [...new Set(pageRows.map(m => m.senderId).filter(Boolean))] as string[];
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
        const resultConversationIds = [...new Set(pageRows.map(m => m.conversationId))];
        const conversationRows = await db
            .select({
                id: conversations.id,
                type: conversations.type,
                projectTitle: projects.title,
            })
            .from(conversations)
            .leftJoin(projects, eq(projects.conversationId, conversations.id))
            .where(inArray(conversations.id, resultConversationIds));
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
            .where(inArray(conversationParticipants.conversationId, resultConversationIds));

        const conversationMap = new Map(conversationRows.map((conversation) => [conversation.id, conversation]));
        const participantMap = new Map<string, typeof allParticipants>();

        for (const p of allParticipants) {
            if (!participantMap.has(p.conversationId)) {
                participantMap.set(p.conversationId, []);
            }
            if (p.userId !== user.id) {
                participantMap.get(p.conversationId)!.push(p);
            }
        }
        const results = pageRows.map(m => {
            const conversation = conversationMap.get(m.conversationId);
            const participants = participantMap.get(m.conversationId) ?? [];
            const conversationType = (conversation?.type ?? 'dm') as ConversationWithDetails['type'];
            const display = buildConversationDisplay({
                type: conversationType,
                participants,
                projectTitle: conversation?.projectTitle,
            });
            const structuredMetadata = (m.metadata ?? {}) as Record<string, unknown>;
            const structured = structuredMetadata.structured;
            const structuredRecord = structured && typeof structured === 'object'
                ? structured as Record<string, unknown>
                : null;
            const fallbackSnippet = typeof structuredRecord?.summary === 'string'
                ? structuredRecord.summary
                : typeof structuredRecord?.title === 'string'
                    ? structuredRecord.title
                    : m.attachmentFilename || 'Attachment';
            return {
                conversationId: m.conversationId,
                displayTitle: display.title,
                displayAvatarUrl: display.avatarUrl,
                conversationType,
                contextLabel: display.subtitle,
                matchedSnippet: m.content?.trim() || fallbackSnippet,
                attachmentSummary: {
                    count: m.attachmentCount,
                    filename: m.attachmentFilename,
                },
                message: {
                    id: m.id,
                    conversationId: m.conversationId,
                    senderId: m.senderId,
                    replyTo: null,
                    clientMessageId: m.clientMessageId,
                    content: m.content,
                    type: m.type as MessageWithSender['type'],
                    metadata: structuredMetadata,
                    createdAt: m.createdAt,
                    editedAt: m.editedAt,
                    deletedAt: m.deletedAt,
                    sender: m.senderId ? senderMap.get(m.senderId) || null : null,
                    attachments: [],
                },
            };
        });
        const lastRow = pageRows.at(-1);

        return completeSearch({
            success: true,
            results,
            nextCursor: hasMore && lastRow
                ? encodeMessageSearchCursor({
                    rank: Number(lastRow.rank),
                    createdAt: lastRow.createdAt.toISOString(),
                    id: lastRow.id,
                })
                : null,
        });
    } catch (error) {
        console.error('Error searching messages:', error);
        return completeSearch({
            success: false,
            error: 'Failed to search messages',
            errorCode: 'SEARCH_FAILED',
        });
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
        const parsed = editMessageSchema.safeParse({ messageId, content: nextContent });
        if (!parsed.success) {
            return { success: false, error: 'Invalid message update' };
        }

        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const { allowed: editRlOk } = await consumeRateLimit(`msg:${user.id}`, 120, 60);
        if (!editRlOk) return { success: false, error: 'Rate limit exceeded' };

        const normalizedContent = parsed.data.content;

        const result = await db.transaction(async (tx) => {
            const [messageRow] = await tx
                .select({
                    id: messages.id,
                    conversationId: messages.conversationId,
                    senderId: messages.senderId,
                    content: messages.content,
                    createdAt: messages.createdAt,
                    deletedAt: messages.deletedAt,
                })
                .from(messages)
                .where(eq(messages.id, parsed.data.messageId))
                .limit(1)
                .for('update');

            if (!messageRow) return { success: false as const, error: 'Message not found' };
            if (messageRow.senderId !== user.id) return { success: false as const, error: 'Not authorized' };
            if (messageRow.deletedAt) return { success: false as const, error: 'Cannot edit deleted message' };

            const editWindowMs = MESSAGE_EDIT_WINDOW_MINUTES * 60 * 1000;
            if (Date.now() - messageRow.createdAt.getTime() > editWindowMs) {
                return {
                    success: false as const,
                    error: `Edit window expired (${MESSAGE_EDIT_WINDOW_MINUTES} minutes)`,
                };
            }

            if ((messageRow.content || '') === normalizedContent) {
                return { success: true as const };
            }

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
                .where(
                    and(
                        eq(messages.id, messageRow.id),
                        eq(messages.senderId, user.id),
                        isNull(messages.deletedAt),
                    ),
                );

            await tx.execute(sql`
                SELECT app_private.nb_reconcile_conversation_participants(
                    ${messageRow.conversationId}::uuid,
                    NULL::uuid
                )
            `);

            return { success: true as const };
        });
        return result;
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
        const parsed = deleteMessageSchema.safeParse({ messageId, scope });
        if (!parsed.success) {
            return { success: false, error: 'Invalid message deletion' };
        }

        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const { allowed: delRlOk } = await consumeRateLimit(`msg:${user.id}`, 120, 60);
        if (!delRlOk) return { success: false, error: 'Rate limit exceeded' };

        return await db.transaction(async (tx) => {
            const [messageRow] = await tx
                .select({
                    id: messages.id,
                    conversationId: messages.conversationId,
                    senderId: messages.senderId,
                    deletedAt: messages.deletedAt,
                })
                .from(messages)
                .where(eq(messages.id, parsed.data.messageId))
                .limit(1)
                .for('update');

            if (!messageRow) return { success: false, error: 'Message not found' };

            const [membership] = await tx
                .select({ id: conversationParticipants.id })
                .from(conversationParticipants)
                .where(
                    and(
                        eq(conversationParticipants.conversationId, messageRow.conversationId),
                        eq(conversationParticipants.userId, user.id),
                    ),
                )
                .limit(1);

            if (!membership) return { success: false, error: 'Not authorized' };

            if (parsed.data.scope === 'me') {
                await tx
                    .insert(messageHiddenForUsers)
                    .values({ messageId: messageRow.id, userId: user.id })
                    .onConflictDoNothing({
                        target: [messageHiddenForUsers.messageId, messageHiddenForUsers.userId],
                    });

                await tx.execute(sql`
                    SELECT app_private.nb_reconcile_conversation_participants(
                        ${messageRow.conversationId}::uuid,
                        ${user.id}::uuid
                    )
                `);
                return { success: true };
            }

            if (messageRow.senderId !== user.id) {
                return { success: false, error: 'Only sender can unsend for everyone' };
            }

            if (!messageRow.deletedAt) {
                await tx
                    .update(messages)
                    .set({
                        deletedAt: new Date(),
                        content: null,
                        metadata: sql`
                            jsonb_set(
                                jsonb_set(
                                    COALESCE(${messages.metadata}, '{}'::jsonb),
                                    '{deletionScope}',
                                    '"everyone"'::jsonb,
                                    true
                                ),
                                '{deletedBy}',
                                to_jsonb(${user.id}::text),
                                true
                            )
                        `,
                    })
                    .where(
                        and(
                            eq(messages.id, messageRow.id),
                            eq(messages.senderId, user.id),
                            isNull(messages.deletedAt),
                        ),
                    );

                await markMessageBurstSourceDeleted(
                    messageRow.conversationId,
                    messageRow.id,
                    tx,
                );
                await markMessageReactionSourceDeleted(
                    messageRow.conversationId,
                    messageRow.id,
                    tx,
                );
                await tx
                    .update(conversationParticipants)
                    .set({
                        lastReactionAt: null,
                        lastReactionMessageId: null,
                        lastReactionEmoji: null,
                        lastReactionActorId: null,
                    })
                    .where(and(
                        eq(conversationParticipants.conversationId, messageRow.conversationId),
                        eq(conversationParticipants.lastReactionMessageId, messageRow.id),
                    ));
            }

            await tx.execute(sql`
                SELECT app_private.nb_reconcile_conversation_participants(
                    ${messageRow.conversationId}::uuid,
                    NULL::uuid
                )
            `);
            return { success: true };
        });
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
        const scopedViewer = getMessageThreadReadScope(conversationId);
        const user = scopedViewer ? { id: scopedViewer.viewerId } : await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const safeLimit = Math.max(1, Math.min(20, limit));
        return await runInFlightDeduped(`messages:pinned:${user.id}:${conversationId}:${safeLimit}`, async () => {

        if (!scopedViewer) {
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
            .from(messagePins)
            .innerJoin(
                messages,
                and(
                    eq(messages.id, messagePins.messageId),
                    eq(messages.conversationId, messagePins.conversationId),
                ),
            )
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
            .orderBy(desc(messagePins.pinnedAt), desc(messages.id))
            .limit(safeLimit);

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
        const reactionSummaryMap = await getReactionSummaryMap(messageIds, user.id);

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
                metadata: withDeliveryMetadata(
                    withReactionSummaryMetadata(
                        row.metadata as Record<string, unknown>,
                        reactionSummaryMap.get(row.id) || [],
                    ),
                    'sent',
                ),
                createdAt: row.createdAt,
                editedAt: row.editedAt,
                deletedAt: row.deletedAt,
                sender: row.senderId ? senderMap.get(row.senderId) || null : null,
                attachments: hydrated.get(row.id) || [],
            })),
        };
        });
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

        return await db.transaction(async (tx) => {
            const [messageRow] = await tx
                .select({
                    id: messages.id,
                    conversationId: messages.conversationId,
                    deletedAt: messages.deletedAt,
                })
                .from(messages)
                .innerJoin(
                    conversationParticipants,
                    and(
                        eq(conversationParticipants.conversationId, messages.conversationId),
                        eq(conversationParticipants.userId, user.id),
                    ),
                )
                .where(eq(messages.id, messageId))
                .limit(1);

            if (!messageRow || messageRow.deletedAt) {
                return { success: false, error: 'Message not found' };
            }

            if (pinned) {
                await tx
                    .insert(messagePins)
                    .values({
                        messageId: messageRow.id,
                        conversationId: messageRow.conversationId,
                        pinnedBy: user.id,
                        pinnedAt: new Date(),
                    })
                    .onConflictDoUpdate({
                        target: messagePins.messageId,
                        set: { pinnedBy: user.id, pinnedAt: new Date() },
                    });
            } else {
                await tx.delete(messagePins).where(eq(messagePins.messageId, messageRow.id));
            }

            return { success: true };
        });
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
        const dedupeKey = `messages:unread-count:${user.id}`;

        return await runInFlightDeduped(dedupeKey, async () => {
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
        });
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
    localUrl?: string;
}

export async function uploadAttachment(
    formData: FormData
): Promise<{ success: boolean; error?: string; attachment?: UploadedAttachment }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const file = formData.get('file') as File;
        if (!file) return { success: false, error: 'No file provided' };
        const mediaDimensions = normalizeMediaDimensions(
            formData.get('width'),
            formData.get('height'),
        );
        const clientUploadIdRaw = formData.get('clientUploadId');
        const clientUploadId =
            typeof clientUploadIdRaw === 'string' && clientUploadIdRaw.trim().length > 0
                ? clientUploadIdRaw.trim()
                : (typeof crypto !== 'undefined' && 'randomUUID' in crypto
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        if (clientUploadId.length > 160) {
            return { success: false, error: 'Invalid upload id' };
        }
        const conversationIdRaw = formData.get('conversationId');
        const candidateConversationId = typeof conversationIdRaw === 'string'
            ? conversationIdRaw.trim()
            : '';
        const conversationId = (
            candidateConversationId
            && candidateConversationId !== 'new'
            && !candidateConversationId.startsWith('draft:')
        )
            ? candidateConversationId
            : null;
        if (conversationId && !isUuid(conversationId)) {
            return { success: false, error: 'Invalid conversation' };
        }
        if (conversationId && !await getConversationMembershipId(conversationId, user.id)) {
            return { success: false, error: 'Conversation not found' };
        }

        const maxAttachmentSizeMb = Math.floor(ATTACHMENT_UPLOAD_MAX_FILE_BYTES / (1024 * 1024));
        let normalizedSize = 0;
        try {
            normalizedSize = normalizeAndValidateFileSize(file.size, ATTACHMENT_UPLOAD_MAX_FILE_BYTES);
        } catch {
            return { success: false, error: `File too large. Maximum size is ${maxAttachmentSizeMb}MB.` };
        }

        let mimeType = '';
        try {
            mimeType = normalizeAndValidateMimeType(file.type || 'application/octet-stream');
        } catch {
            return { success: false, error: 'Unsupported file type.' };
        }

        try {
            await validateUploadedFileMagicBytes(file, mimeType);
        } catch {
            return { success: false, error: 'Uploaded file contents do not match the declared type.' };
        }

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

        const uploadSession = await db
            .insert(attachmentUploads)
            .values({
                userId: user.id,
                clientUploadId,
                conversationId,
                filename: file.name,
                mimeType,
                sizeBytes: normalizedSize,
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
                    mimeType,
                    sizeBytes: normalizedSize,
                    status: 'uploading',
                    error: null,
                    storagePath: null,
                    updatedAt: new Date(),
                    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
                },
                setWhere: sql`${attachmentUploads.status} IN ('queued', 'failed', 'canceled', 'expired')`,
            })
            .returning({ id: attachmentUploads.id });
        if (uploadSession.length !== 1) {
            return { success: false, error: 'This upload reference has already been used.' };
        }

        // Generate unique filename
        const timestamp = Date.now();
        const uniqueName = `${timestamp}-${Math.random().toString(36).substring(7)}.${ext || 'bin'}`;
        const storagePath = `${user.id}/${uniqueName}`;

        // Upload with user-scoped client for RLS-compliant write.
        const supabase = await createClient();
        const { error: uploadError } = await supabase.storage
            .from(ATTACHMENTS_BUCKET)
            .upload(storagePath, file, {
                contentType: mimeType || undefined,
                // Object keys are immutable; replacements always receive a new key.
                cacheControl: '31536000',
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
                        eq(attachmentUploads.clientUploadId, clientUploadId),
                        eq(attachmentUploads.status, 'uploading'),
                    )
                );
            return { success: false, error: 'Failed to upload file' };
        }

        // Record the durable object path immediately after Storage succeeds.
        // Signing is an optional presentation step; retention can now always
        // locate and remove the object if anything below fails.
        const uploadedTransition = await db
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
                    eq(attachmentUploads.clientUploadId, clientUploadId),
                    eq(attachmentUploads.status, 'uploading'),
                )
            )
            .returning({ id: attachmentUploads.id });
        if (uploadedTransition.length !== 1) {
            const admin = await createAdminClient();
            await admin.storage.from(ATTACHMENTS_BUCKET).remove([storagePath]);
            return { success: false, error: 'Upload was canceled before it completed.' };
        }

        // Generate short-lived URL for optimistic rendering in sender UI.
        // Durable source-of-truth is storagePath persisted with the message.
        const signedByPath = await resolveSignedAttachmentUrls([storagePath]);
        const signedUrl = signedByPath.get(storagePath);
        if (!signedUrl) {
            await db
                .update(attachmentUploads)
                .set({
                    error: 'Failed to generate file URL',
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(attachmentUploads.userId, user.id),
                        eq(attachmentUploads.clientUploadId, clientUploadId),
                        eq(attachmentUploads.status, 'uploaded'),
                    )
                );
            return { success: false, error: 'Failed to generate file URL' };
        }

        // Generate thumbnail URL for images
        const tinyBase64 = formData.get('tinyBase64');
        let thumbnailUrl: string | null = null;
        if (typeof tinyBase64 === 'string' && tinyBase64.startsWith('data:image/')) {
            thumbnailUrl = tinyBase64;
        } else if (fileType === 'image') {
            thumbnailUrl = buildImageThumbnailUrl(signedUrl);
        }

        const attachment: UploadedAttachment = {
            id: clientUploadId,
            storagePath,
            type: fileType,
            url: signedUrl,
            filename: file.name,
            sizeBytes: normalizedSize,
            mimeType: mimeType || 'application/octet-stream',
            thumbnailUrl,
            width: mediaDimensions?.width ?? null,
            height: mediaDimensions?.height ?? null,
        };

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

        const canceled = await db
            .update(attachmentUploads)
            .set({
                status: 'canceled',
                error: null,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(attachmentUploads.userId, user.id),
                    eq(attachmentUploads.clientUploadId, clientUploadId.trim()),
                    inArray(attachmentUploads.status, ['queued', 'uploading', 'uploaded', 'failed']),
                )
            )
            .returning({
                id: attachmentUploads.id,
                storagePath: attachmentUploads.storagePath,
            });

        if (canceled[0]?.storagePath) {
            const admin = await createAdminClient();
            const { error } = await admin.storage
                .from(ATTACHMENTS_BUCKET)
                .remove([canceled[0].storagePath]);
            if (error) {
                await db
                    .update(attachmentUploads)
                    .set({
                        error: `cleanup_pending:${error.message}`,
                        updatedAt: new Date(),
                    })
                    .where(eq(attachmentUploads.id, canceled[0].id));
            }
        }

        if (canceled.length === 0) {
            const [existing] = await db
                .select({ status: attachmentUploads.status })
                .from(attachmentUploads)
                .where(
                    and(
                        eq(attachmentUploads.userId, user.id),
                        eq(attachmentUploads.clientUploadId, clientUploadId.trim()),
                    ),
                )
                .limit(1);
            if (!existing) return { success: false, error: 'Upload not found' };
            if (existing.status === 'committed') {
                return { success: false, error: 'A sent attachment cannot be canceled.' };
            }
        }

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
    options?: {
        clientMessageId?: string;
        replyToMessageId?: string | null;
        contextChips?: MessageContextChip[];
        messageType?: 'text' | 'image' | 'video' | 'file';
    }
): Promise<SendMessageResult> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const { allowed: msgRlOk } = await consumeRateLimit(`msg:${user.id}`, 120, 60);
        if (!msgRlOk) return { success: false, error: 'Rate limit exceeded' };
        const clientMessageId = options?.clientMessageId?.trim() || undefined;
        const replyToMessageId = options?.replyToMessageId?.trim() || undefined;
        const contextChips = options?.contextChips ?? [];

        // These independent reads previously ran serially for every message.
        const [participantMembershipId, conversationRows] = await Promise.all([
            getConversationMembershipId(conversationId, user.id),
            db
                .select({ type: conversations.type })
                .from(conversations)
                .where(eq(conversations.id, conversationId))
                .limit(1),
        ]);
        const [conversationRecord] = conversationRows;

        if (!participantMembershipId) {
            return { success: false, error: 'Not a participant of this conversation' };
        }

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

            const { allowed: targetRlOk } = await consumeDirectMessageTargetRateLimit(user.id, otherParticipant.userId);
            if (!targetRlOk) {
                return { success: false, error: 'You are messaging this user too quickly. Please slow down.' };
            }
        }

        // Validate content
        if (!content?.trim() && attachments.length === 0) {
            return { success: false, error: 'Message cannot be empty' };
        }
        if ((content?.trim() || '').length > MAX_MESSAGE_CONTENT_LENGTH) {
            return { success: false, error: `Message too long. Maximum is ${MAX_MESSAGE_CONTENT_LENGTH} characters.` };
        }
        if (attachments.length > 12) {
            return { success: false, error: 'A message can contain at most 12 attachments.' };
        }

        const normalizedContent = content?.trim() || '';
        const mentions = extractMessageMentions(normalizedContent);
        // Reply validation and client-message idempotency are independent
        // read-only checks, so neither should wait for the other.
        const [replyPreview, existing] = await Promise.all([
            validateReplyTarget(conversationId, user.id, replyToMessageId),
            findExistingMessageByClientKey(conversationId, user.id, clientMessageId),
        ]);
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

        const normalizedCommit = await normalizeUploadedAttachmentsForCommit(attachments, user.id);
        if (!normalizedCommit.attachments) {
            return { success: false, error: normalizedCommit.error || 'Attachments are not ready yet' };
        }
        const requestedAttachments = normalizedCommit.attachments;
        const primaryAttachment = requestedAttachments[0] ?? null;
        const previewKind = primaryAttachment?.type === 'file'
            && primaryAttachment.mimeType.toLowerCase().startsWith('audio/')
            ? 'voice'
            : primaryAttachment?.type ?? null;

        // Determine message type based on attachments
        let messageType: 'text' | 'image' | 'video' | 'file' = options?.messageType ?? 'text';
        if (requestedAttachments.length > 0) {
            const primaryAttachment = requestedAttachments[0]!;
            messageType = primaryAttachment.type;
        }

        const { newMessage, senderProfile, persistedAttachments, committedAttachments } = await db.transaction(async (tx) => {
            const claimedAttachments = await claimAttachmentUploadsForMessage(
                tx,
                user.id,
                conversationId,
                requestedAttachments,
            );
            if (claimedAttachments[0]) {
                messageType = claimedAttachments[0].type;
            }

            const [msg] = await tx
                .insert(messages)
                .values({
                    conversationId,
                    senderId: user.id,
                    replyToMessageId: replyToMessageId || null,
                    clientMessageId: clientMessageId || null,
                    content: content?.trim() || null,
                    type: messageType,
                    metadata: withDeliveryMetadata(
                        withMessageContextChipsMetadata({
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
                            ...(previewKind ? { previewKind } : {}),
                        }, contextChips),
                        'sent',
                    ),
                })
                .returning();

            let insertedAttachments: Array<typeof messageAttachments.$inferSelect> = [];
            if (claimedAttachments.length > 0) {
                insertedAttachments = await tx
                    .insert(messageAttachments)
                    .values(
                        claimedAttachments.map(att => ({
                            messageId: msg!.id,
                            storagePath: att.storagePath,
                            type: att.type,
                            url: null,
                            filename: att.filename,
                            sizeBytes: att.sizeBytes,
                            mimeType: att.mimeType,
                            thumbnailUrl: null,
                            width: att.width,
                            height: att.height,
                        }))
                    )
                    .returning();
            }

            // ponytail: the insert trigger owns text-message ordering, previews,
            // and unread state. Attachment rows are created after that trigger,
            // so only attachment messages need this richer preview overwrite.
            if (claimedAttachments.length > 0) {
                await tx
                    .update(conversationParticipants)
                    .set(buildConversationParticipantPreview({
                        id: msg!.id,
                        content: msg!.content,
                        type: msg!.type,
                        metadata: msg!.metadata as Record<string, unknown> | null,
                        senderId: msg!.senderId,
                        createdAt: msg!.createdAt,
                        replyToMessageId: msg!.replyToMessageId,
                    }))
                    .where(and(
                        eq(conversationParticipants.conversationId, conversationId),
                        eq(conversationParticipants.lastMessageId, msg!.id),
                    ));
            }

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

            return {
                newMessage: msg,
                senderProfile: profile,
                persistedAttachments: insertedAttachments,
                committedAttachments: claimedAttachments,
            };
        });

        const recipients = await db
            .select({
                userId: conversationParticipants.userId,
                muted: conversationParticipants.muted,
            })
            .from(conversationParticipants)
            .where(
                and(
                    eq(conversationParticipants.conversationId, conversationId),
                    ne(conversationParticipants.userId, user.id),
                    isNull(conversationParticipants.archivedAt),
                ),
            );

        try {
            await emitMessageBurstNotifications({
                recipients,
                actorUserId: user.id,
                actorName: senderProfile?.fullName ?? senderProfile?.username ?? null,
                actorAvatarUrl: senderProfile?.avatarUrl ?? null,
                conversationId,
                sourceMessageId: newMessage!.id,
            });
        } catch (error) {
            logger.error('messages.notification_emit_failed', {
                module: 'messaging',
                conversationId,
                actorUserId: user.id,
                count: recipients.length,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        const committedAttachmentsByPath = new Map(
            committedAttachments.map((attachment) => [attachment.storagePath, attachment] as const),
        );
        const responseAttachments = persistedAttachments.map((attachment) => {
            const committed = attachment.storagePath
                ? committedAttachmentsByPath.get(attachment.storagePath)
                : null;
            const accessUrl = buildMessageAttachmentAccessUrl(attachment.id);

            return {
                id: attachment.id,
                type: attachment.type as 'image' | 'video' | 'file',
                url: accessUrl,
                filename: attachment.filename,
                sizeBytes: attachment.sizeBytes,
                mimeType: attachment.mimeType,
                thumbnailUrl: attachment.type === 'image'
                    ? buildMessageAttachmentAccessUrl(attachment.id, { preview: true })
                    : (committed?.thumbnailUrl || attachment.thumbnailUrl),
                width: attachment.width,
                height: attachment.height,
            };
        });

        return {
            success: true,
            message: {
                id: newMessage!.id,
                conversationId: newMessage!.conversationId,
                senderId: newMessage!.senderId,
                replyTo: replyPreview,
                clientMessageId: newMessage!.clientMessageId,
                content: newMessage!.content,
                type: newMessage!.type as MessageWithSender['type'],
                metadata: withDeliveryMetadata(newMessage!.metadata as Record<string, unknown>, 'sent'),
                createdAt: newMessage!.createdAt,
                editedAt: newMessage!.editedAt,
                deletedAt: newMessage!.deletedAt,
                sender: senderProfile || null,
                attachments: responseAttachments,
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

export interface ProjectGroupConversation {
    id: string; // conversationId
    projectId: string;
    projectTitle: string;
    projectSlug: string | null;
    projectCoverImage: string | null;
    muted?: boolean;
    updatedAt: Date;
    lastMessage: {
        id: string;
        content: string | null;
        senderId: string | null;
        createdAt: Date;
        type: string | null;
        metadata?: Record<string, unknown> | null;
    } | null;
    unreadCount: number;
    memberCount: number;
    members?: Array<{
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
    }>;
}

export async function getProjectGroups(
    limit: number = 20,
    cursor?: string | null
): Promise<{
    success: boolean;
    error?: string;
    projectGroups?: ProjectGroupConversation[];
    hasMore?: boolean;
    nextCursor?: string | null;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };
        const safeLimit = Number.isFinite(limit)
            ? Math.min(Math.max(Math.trunc(limit), 1), 100)
            : 20;
        const [cursorAtRaw, cursorConversationIdRaw] = cursor ? cursor.split('|') : [];
        const cursorAt = cursorAtRaw ? new Date(cursorAtRaw) : null;
        const cursorConversationId = cursorConversationIdRaw && isUuid(cursorConversationIdRaw)
            ? cursorConversationIdRaw
            : null;
        if (cursor && (!cursorAt || Number.isNaN(cursorAt.getTime()) || !cursorConversationId)) {
            return { success: false, error: 'Invalid project conversation cursor' };
        }

        // OPTIMIZED: Single query fetching project details, member counts, last message, AND unread counts
        // Uses the denormalized 'unread_count' from conversation_participants for O(1) performance
        const projectGroupsResult = await db.execute<{
            conversation_id: string;
            project_id: string;
            project_title: string;
            project_slug: string | null;
            project_cover_image: string | null;
            updated_at: Date;
            muted: boolean;
            last_message_id: string | null;
            last_message_preview: string | null;
            last_message_sender_id: string | null;
            last_message_at: Date | null;
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
                    cp.unread_count,
                    cp.muted,
                    cp.last_message_id,
                    cp.last_message_preview,
                    cp.last_message_sender_id,
                    cp.last_message_at,
                    cp.last_message_type
                FROM ${projects} p
                INNER JOIN ${projectMembers} pm ON pm.project_id = p.id
                INNER JOIN ${conversations} c ON c.id = p.conversation_id
                INNER JOIN ${conversationParticipants} cp ON cp.conversation_id = p.conversation_id AND cp.user_id = ${user.id}
                WHERE pm.user_id = ${user.id}
                AND p.conversation_id IS NOT NULL
                AND cp.archived_at IS NULL
                ${cursorAt && cursorConversationId
                    ? sql`AND (
                        COALESCE(cp.last_message_at, c.updated_at) < ${cursorAt}
                        OR (
                            COALESCE(cp.last_message_at, c.updated_at) = ${cursorAt}
                            AND c.id < ${cursorConversationId}
                        )
                    )`
                    : sql``}
                ORDER BY COALESCE(cp.last_message_at, c.updated_at) DESC, c.id DESC
                LIMIT ${safeLimit + 1}
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
                up.muted,
                up.last_message_id,
                up.last_message_preview,
                up.last_message_sender_id,
                up.last_message_at,
                up.last_message_type,
                COALESCE(mc.member_count, 1) as member_count,
                COALESCE(up.unread_count, 0) as unread_count
            FROM user_projects up
            LEFT JOIN member_counts mc ON mc.project_id = up.project_id
            ORDER BY COALESCE(up.last_message_at, up.updated_at) DESC, up.conversation_id DESC
        `);

        const projectArray = Array.from(projectGroupsResult);
        const hasMore = projectArray.length > safeLimit;
        const paginatedProjects = projectArray.slice(0, safeLimit);
        const paginatedProjectIds = paginatedProjects.map((project) => project.project_id);

        const memberPreviewRows = paginatedProjects.length > 0
            ? await db.execute<{
                project_id: string;
                id: string;
                username: string | null;
                full_name: string | null;
                avatar_url: string | null;
            }>(sql`
                WITH ranked_members AS (
                    SELECT
                        ${projectMembers.projectId} AS project_id,
                        ${profiles.id} AS id,
                        ${profiles.username} AS username,
                        ${profiles.fullName} AS full_name,
                        ${profiles.avatarUrl} AS avatar_url,
                        row_number() OVER (
                            PARTITION BY ${projectMembers.projectId}
                            ORDER BY ${projectMembers.joinedAt} ASC, ${projectMembers.userId} ASC
                        ) AS member_rank
                    FROM ${projectMembers}
                    INNER JOIN ${profiles} ON ${profiles.id} = ${projectMembers.userId}
                    WHERE ${projectMembers.projectId} IN (${sql.join(
                        paginatedProjectIds.map((projectId) => sql`${projectId}`),
                        sql`, `,
                    )})
                )
                SELECT
                    project_id,
                    id,
                    username,
                    full_name,
                    avatar_url
                FROM ranked_members
                WHERE member_rank <= 3
                ORDER BY project_id ASC, member_rank ASC
            `)
            : [];
        const membersByProjectId = new Map<string, ProjectGroupConversation['members']>();
        for (const row of memberPreviewRows) {
            const existingMembers = membersByProjectId.get(row.project_id) ?? [];
            if (existingMembers.length >= 3) {
                continue;
            }
            membersByProjectId.set(row.project_id, [
                ...existingMembers,
                {
                    id: row.id,
                    username: row.username,
                    fullName: row.full_name,
                    avatarUrl: row.avatar_url,
                },
            ]);
        }

        // No separate unread count query needed anymore!

        // Build result
        const result: ProjectGroupConversation[] = paginatedProjects.map((proj) => ({
            id: proj.conversation_id,
            projectId: proj.project_id,
            projectTitle: proj.project_title,
            projectSlug: proj.project_slug,
            projectCoverImage: proj.project_cover_image,
            muted: proj.muted,
            updatedAt: proj.updated_at,
            lastMessage: proj.last_message_id ? {
                id: proj.last_message_id,
                content: proj.last_message_preview,
                senderId: proj.last_message_sender_id,
                createdAt: proj.last_message_at ?? proj.updated_at ?? new Date(),
                type: proj.last_message_type,
            } : null,
            unreadCount: proj.unread_count || 0,
            memberCount: proj.member_count || 1,
            members: membersByProjectId.get(proj.project_id) ?? [],
        }));
        const hydratedProjectGroups = await hydrateConversationLastMessageDeliveryMetadata(
            user.id,
            result.map((project) => ({
                ...project,
                type: 'project_group' as const,
            })),
        );

        const lastProject = paginatedProjects.at(-1);
        return {
            success: true,
            projectGroups: hydratedProjectGroups.map(({ type: _type, ...project }) => project),
            hasMore,
            nextCursor: hasMore && lastProject
                ? `${(lastProject.last_message_at ?? lastProject.updated_at).toISOString()}|${lastProject.conversation_id}`
                : null,
        };
    } catch (error) {
        console.error('Error fetching project groups:', error);
        return { success: false, error: 'Failed to fetch project groups' };
    }
}
