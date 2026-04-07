'use server';

import { createClient } from '@/lib/supabase/server';
import { resolvePrivacyRelationships } from '@/lib/privacy/resolver';
import { getInboxApplicationsAction } from '@/app/actions/applications';
import { db } from '@/lib/db';
import {
    conversationParticipants,
    conversations,
    messageHiddenForUsers,
    messages,
    projectMembers,
    projects,
    roleApplications,
} from '@/lib/db/schema';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
    ConversationWithDetails,
    MessageWithSender,
    ProjectGroupConversation,
    UploadedAttachment,
    deleteMessage,
    editMessage,
    getConversationById,
    getConversations,
    getMessageContext,
    getMessages,
    getOrCreateDMConversation,
    getPinnedMessages,
    getProjectGroups,
    getUnreadCount,
    markConversationAsRead,
    searchMessages,
    sendMessage,
    sendMessageWithAttachments,
    setConversationArchived,
    setConversationMuted,
    setMessagePinned,
} from '@/app/actions/messaging';
import { APPLICATION_BANNER_HIDE_AFTER_MS } from '@/lib/chat/banner-lifecycle';

type ConnectionStatus = 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'blocked' | 'open';

export interface ConversationCapabilityV2 {
    conversationType: ConversationWithDetails['type'];
    status: ConnectionStatus;
    canSend: boolean;
    blocked: boolean;
    messagePrivacy: 'everyone' | 'connections' | 'nobody' | 'mutuals_only' | null;
    isConnected: boolean;
    isPendingIncoming: boolean;
    isPendingOutgoing: boolean;
    canInvite: boolean;
    connectionId: string | null;
    hasActiveApplication?: boolean;
    isApplicant?: boolean;
    isCreator?: boolean;
    activeApplicationId?: string | null;
    activeApplicationStatus?: 'pending' | 'accepted' | 'rejected' | 'project_deleted' | null;
    activeProjectId?: string | null;
}

export interface InboxConversationV2 extends ConversationWithDetails {
    capability: ConversationCapabilityV2;
}

export interface MessagesInboxPageV2 {
    conversations: InboxConversationV2[];
    hasMore: boolean;
    nextCursor: string | null;
}

export interface MessageThreadPageV2 {
    conversation: InboxConversationV2;
    capability: ConversationCapabilityV2;
    messages: MessageWithSender[];
    pinnedMessages: MessageWithSender[];
    hasMore: boolean;
    nextCursor: string | null;
}

interface ActiveApplicationRowV2 {
    id: string;
    applicantId: string;
    creatorId: string;
    status: 'pending' | 'accepted' | 'rejected' | 'project_deleted';
    projectId: string | null;
    updatedAt: Date;
}

async function getAuthUser() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    return user;
}

function getDefaultCapability(conversationType: ConversationWithDetails['type']): ConversationCapabilityV2 {
    if (conversationType === 'dm') {
        return {
            conversationType,
            status: 'none',
            canSend: false,
            blocked: false,
            messagePrivacy: 'connections',
            isConnected: false,
            isPendingIncoming: false,
            isPendingOutgoing: false,
            canInvite: false,
            connectionId: null,
            hasActiveApplication: false,
            isApplicant: false,
            isCreator: false,
            activeApplicationId: null,
            activeApplicationStatus: null,
            activeProjectId: null,
        };
    }

    return {
        conversationType,
        status: 'connected',
        canSend: true,
        blocked: false,
        messagePrivacy: null,
        isConnected: true,
        isPendingIncoming: false,
        isPendingOutgoing: false,
        canInvite: false,
        connectionId: null,
        hasActiveApplication: false,
        isApplicant: false,
        isCreator: false,
        activeApplicationId: null,
        activeApplicationStatus: null,
        activeProjectId: null,
    };
}

function isFreshApplicationState(activeApplication: ActiveApplicationRowV2 | null) {
    if (!activeApplication) return false;
    if (activeApplication.status === 'pending') return true;
    const updatedAtMs = new Date(activeApplication.updatedAt).getTime();
    return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs <= APPLICATION_BANNER_HIDE_AFTER_MS;
}

function buildDmCapabilityFromState(params: {
    viewerId: string;
    privacy: Awaited<ReturnType<typeof resolvePrivacyRelationships>> extends Map<string, infer T> ? T | null : never;
    activeApplication: ActiveApplicationRowV2 | null;
}): ConversationCapabilityV2 {
    const { viewerId, privacy, activeApplication } = params;
    const blocked = Boolean(privacy?.blockedByTarget || privacy?.blockedByViewer);
    const hasApplicationGate = isFreshApplicationState(activeApplication);

    if (hasApplicationGate && activeApplication) {
        return {
            conversationType: 'dm',
            status: 'open',
            canSend: !blocked,
            blocked,
            messagePrivacy: (privacy?.messagePrivacy as ConversationCapabilityV2['messagePrivacy']) ?? 'connections',
            isConnected: Boolean(privacy?.isConnected),
            isPendingIncoming: Boolean(privacy?.hasPendingIncomingRequest),
            isPendingOutgoing: Boolean(privacy?.hasPendingOutgoingRequest),
            canInvite: !blocked,
            connectionId: privacy?.latestConnectionId ?? null,
            hasActiveApplication: true,
            isApplicant: activeApplication.applicantId === viewerId,
            isCreator: activeApplication.creatorId === viewerId,
            activeApplicationId: activeApplication.id,
            activeApplicationStatus: activeApplication.status,
            activeProjectId: activeApplication.projectId,
        };
    }

    if (blocked) {
        return {
            conversationType: 'dm',
            status: 'blocked',
            canSend: false,
            blocked: true,
            messagePrivacy: (privacy?.messagePrivacy as ConversationCapabilityV2['messagePrivacy']) ?? 'connections',
            isConnected: false,
            isPendingIncoming: false,
            isPendingOutgoing: false,
            canInvite: false,
            connectionId: privacy?.latestConnectionId ?? null,
            hasActiveApplication: false,
            isApplicant: false,
            isCreator: false,
            activeApplicationId: null,
            activeApplicationStatus: null,
            activeProjectId: null,
        };
    }

    const status: ConnectionStatus = privacy?.isConnected
        ? 'connected'
        : privacy?.hasPendingOutgoingRequest
            ? (privacy?.canSendMessage ? 'open' : 'pending_sent')
            : privacy?.hasPendingIncomingRequest
                ? 'open'
                : privacy?.canSendMessage
                    ? 'open'
                    : 'none';

    return {
        conversationType: 'dm',
        status,
        canSend: status === 'connected' || status === 'open',
        blocked: false,
        messagePrivacy: (privacy?.messagePrivacy as ConversationCapabilityV2['messagePrivacy']) ?? 'connections',
        isConnected: Boolean(privacy?.isConnected),
        isPendingIncoming: Boolean(privacy?.hasPendingIncomingRequest),
        isPendingOutgoing: Boolean(privacy?.hasPendingOutgoingRequest),
        canInvite: status === 'connected' || status === 'open',
        connectionId: privacy?.latestConnectionId ?? null,
        hasActiveApplication: false,
        isApplicant: false,
        isCreator: false,
        activeApplicationId: null,
        activeApplicationStatus: null,
        activeProjectId: null,
    };
}

async function getLatestApplicationsByOtherUser(
    viewerId: string,
    otherUserIds: string[],
): Promise<Map<string, ActiveApplicationRowV2>> {
    const normalizedIds = Array.from(new Set(otherUserIds.filter(Boolean)));
    if (normalizedIds.length === 0) return new Map();

    const rows = await db
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
            or(
                and(eq(roleApplications.applicantId, viewerId), inArray(roleApplications.creatorId, normalizedIds)),
                and(eq(roleApplications.creatorId, viewerId), inArray(roleApplications.applicantId, normalizedIds)),
            ),
        )
        .orderBy(desc(roleApplications.updatedAt), desc(roleApplications.id));

    const byOtherUser = new Map<string, ActiveApplicationRowV2>();
    for (const row of rows) {
        const otherUserId = row.applicantId === viewerId ? row.creatorId : row.applicantId;
        if (!otherUserId || byOtherUser.has(otherUserId)) continue;
        byOtherUser.set(otherUserId, row as ActiveApplicationRowV2);
    }

    return byOtherUser;
}

async function buildConversationCapabilitiesBatch(
    viewerId: string,
    inboxConversations: ConversationWithDetails[],
): Promise<Map<string, ConversationCapabilityV2>> {
    const byConversationId = new Map<string, ConversationCapabilityV2>();
    const directMessages = inboxConversations.filter(
        (conversation) => conversation.type === 'dm' && conversation.participants[0]?.id,
    );

    for (const conversation of inboxConversations) {
        if (conversation.type !== 'dm') {
            byConversationId.set(conversation.id, getDefaultCapability(conversation.type));
        }
    }

    if (directMessages.length === 0) return byConversationId;

    const targetUserIds = directMessages
        .map((conversation) => conversation.participants[0]?.id)
        .filter(Boolean) as string[];

    const [privacyMap, activeApplicationsByUser] = await Promise.all([
        resolvePrivacyRelationships(viewerId, targetUserIds),
        getLatestApplicationsByOtherUser(viewerId, targetUserIds),
    ]);

    for (const conversation of directMessages) {
        const targetUserId = conversation.participants[0]?.id;
        if (!targetUserId) {
            byConversationId.set(conversation.id, getDefaultCapability('dm'));
            continue;
        }

        const privacy = privacyMap.get(targetUserId) ?? null;
        const activeApplication = activeApplicationsByUser.get(targetUserId) ?? null;
        byConversationId.set(
            conversation.id,
            buildDmCapabilityFromState({
                viewerId,
                privacy,
                activeApplication,
            }),
        );
    }

    return byConversationId;
}

async function buildConversationCapability(
    viewerId: string,
    conversation: ConversationWithDetails,
): Promise<ConversationCapabilityV2> {
    const capabilities = await buildConversationCapabilitiesBatch(viewerId, [conversation]);
    return capabilities.get(conversation.id) ?? getDefaultCapability(conversation.type);
}

async function getProjectGroupConversationById(
    viewerId: string,
    conversationId: string,
): Promise<ConversationWithDetails | null> {
    const rows = await db.execute<{
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
        unread_count: number;
    }>(sql`
        SELECT
            c.id as conversation_id,
            p.id as project_id,
            p.title as project_title,
            p.slug as project_slug,
            p.cover_image as project_cover_image,
            c.updated_at,
            cp.unread_count,
            lm.id as last_message_id,
            lm.content as last_message_content,
            lm.sender_id as last_message_sender_id,
            lm.created_at as last_message_created_at,
            lm.type as last_message_type
        FROM ${projects} p
        INNER JOIN ${conversations} c ON c.id = p.conversation_id
        INNER JOIN ${projectMembers} pm ON pm.project_id = p.id AND pm.user_id = ${viewerId}
        INNER JOIN ${conversationParticipants} cp ON cp.conversation_id = c.id AND cp.user_id = ${viewerId}
        LEFT JOIN LATERAL (
            SELECT m.id, m.content, m.sender_id, m.created_at, m.type
            FROM ${messages} m
            WHERE m.conversation_id = c.id
            AND m.deleted_at IS NULL
            AND NOT EXISTS (
                SELECT 1
                FROM ${messageHiddenForUsers} h
                WHERE h.message_id = m.id
                AND h.user_id = ${viewerId}
            )
            ORDER BY m.created_at DESC
            LIMIT 1
        ) lm ON true
        WHERE p.conversation_id = ${conversationId}
        LIMIT 1
    `);

    const row = Array.from(rows)[0];
    if (!row) return null;

    return {
        id: row.conversation_id,
        type: 'project_group',
        updatedAt: row.last_message_created_at ?? row.updated_at,
        participants: [],
        lastMessage: row.last_message_id
            ? {
                id: row.last_message_id,
                content: row.last_message_content,
                senderId: row.last_message_sender_id,
                createdAt: row.last_message_created_at ?? row.updated_at,
                type: row.last_message_type,
            }
            : null,
        unreadCount: row.unread_count || 0,
    };
}

async function getConversationSummarySourceV2(
    viewerId: string,
    conversationId: string,
): Promise<ConversationWithDetails | null> {
    const base = await getConversationById(conversationId);
    if (base.success && base.conversation) {
        return base.conversation;
    }

    return getProjectGroupConversationById(viewerId, conversationId);
}

async function hydrateConversationSummariesV2(
    viewerId: string,
    conversationsToHydrate: ConversationWithDetails[],
): Promise<InboxConversationV2[]> {
    if (conversationsToHydrate.length === 0) return [];
    const capabilitiesByConversation = await buildConversationCapabilitiesBatch(viewerId, conversationsToHydrate);
    return conversationsToHydrate.map((conversation) => ({
        ...conversation,
        capability: capabilitiesByConversation.get(conversation.id) ?? getDefaultCapability(conversation.type),
    }));
}

export async function getInboxPageV2(
    limit: number = 20,
    cursor?: string,
): Promise<{ success: boolean; error?: string; page?: MessagesInboxPageV2 }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const result = await getConversations(limit, cursor);
        if (!result.success || !result.conversations) {
            return { success: false, error: result.error || 'Failed to fetch inbox' };
        }

        const conversations = await hydrateConversationSummariesV2(user.id, result.conversations);

        return {
            success: true,
            page: {
                conversations,
                hasMore: Boolean(result.hasMore),
                nextCursor: result.nextCursor ?? null,
            },
        };
    } catch (error) {
        console.error('Error fetching inbox page v2:', error);
        return { success: false, error: 'Failed to fetch inbox' };
    }
}

export async function getConversationSummaryV2(
    conversationId: string,
): Promise<{ success: boolean; error?: string; conversation?: InboxConversationV2 }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const summary = await getConversationSummaryV2Internal(user.id, conversationId);
        if (!summary) {
            return { success: false, error: 'Conversation not found' };
        }

        return { success: true, conversation: summary };
    } catch (error) {
        console.error('Error fetching conversation summary v2:', error);
        return { success: false, error: 'Failed to fetch conversation summary' };
    }
}

async function getConversationSummaryV2Internal(
    viewerId: string,
    conversationId: string,
): Promise<InboxConversationV2 | null> {
    const summary = await getConversationSummarySourceV2(viewerId, conversationId);
    if (!summary) return null;
    const [hydrated] = await hydrateConversationSummariesV2(viewerId, [summary]);
    return hydrated ?? null;
}

export async function getConversationThreadPageV2(
    conversationId: string,
    cursor?: string,
    limit: number = 30,
): Promise<{ success: boolean; error?: string; page?: MessageThreadPageV2 }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const [conversationSummary, messageResult, pinnedResult] = await Promise.all([
            getConversationSummarySourceV2(user.id, conversationId),
            getMessages(conversationId, cursor, limit),
            getPinnedMessages(conversationId, 3),
        ]);

        if (!conversationSummary) {
            return { success: false, error: 'Conversation not found' };
        }
        if (!messageResult.success) {
            return { success: false, error: messageResult.error || 'Failed to fetch messages' };
        }

        const [conversation] = await hydrateConversationSummariesV2(user.id, [conversationSummary]);
        const pinnedMessages = pinnedResult.success ? (pinnedResult.messages ?? []) : [];

        return {
            success: true,
            page: {
                conversation,
                capability: conversation.capability,
                messages: messageResult.messages ?? [],
                pinnedMessages,
                hasMore: Boolean(messageResult.hasMore),
                nextCursor: messageResult.nextCursor ?? null,
            },
        };
    } catch (error) {
        console.error('Error fetching conversation thread page v2:', error);
        return { success: false, error: 'Failed to fetch conversation thread' };
    }
}

export async function getConversationCapabilityV2(params: {
    conversationId?: string | null;
    userId?: string | null;
}): Promise<{ success: boolean; error?: string; capability?: ConversationCapabilityV2 }> {
    try {
        const viewer = await getAuthUser();
        if (!viewer) return { success: false, error: 'Not authenticated' };

        if (params.conversationId) {
            const conversation = await getConversationSummarySourceV2(viewer.id, params.conversationId);
            if (!conversation) {
                return { success: false, error: 'Conversation not found' };
            }
            const [hydratedConversation] = await hydrateConversationSummariesV2(viewer.id, [conversation]);
            return {
                success: true,
                capability: hydratedConversation?.capability ?? getDefaultCapability(conversation.type),
            };
        }

        if (!params.userId) {
            return { success: false, error: 'Missing conversation context' };
        }

        const dmCandidate: ConversationWithDetails = {
            id: `draft:${params.userId}`,
            type: 'dm',
            updatedAt: new Date(),
            participants: [{ id: params.userId, username: null, fullName: null, avatarUrl: null }],
            lastMessage: null,
            unreadCount: 0,
        };

        return {
            success: true,
            capability: await buildConversationCapability(viewer.id, dmCandidate),
        };
    } catch (error) {
        console.error('Error fetching conversation capability v2:', error);
        return { success: false, error: 'Failed to fetch conversation capability' };
    }
}

export async function ensureDirectConversationV2(
    targetUserId: string,
): Promise<{ success: boolean; error?: string; conversationId?: string; conversation?: InboxConversationV2 }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const ensured = await getOrCreateDMConversation(targetUserId);
        if (!ensured.success || !ensured.conversationId) {
            return { success: false, error: ensured.error || 'Failed to open conversation' };
        }

        const hydrated = await getConversationSummarySourceV2(user.id, ensured.conversationId);
        if (!hydrated) {
            return { success: false, error: 'Failed to hydrate conversation' };
        }

        const [conversation] = await hydrateConversationSummariesV2(user.id, [hydrated]);
        return { success: true, conversationId: ensured.conversationId, conversation };
    } catch (error) {
        console.error('Error ensuring direct conversation v2:', error);
        return { success: false, error: 'Failed to open conversation' };
    }
}

export async function sendConversationMessageV2(params: {
    conversationId?: string | null;
    targetUserId?: string | null;
    content: string;
    attachments?: UploadedAttachment[];
    clientMessageId?: string;
    replyToMessageId?: string | null;
}): Promise<{
    success: boolean;
    error?: string;
    conversationId?: string;
    message?: MessageWithSender;
    conversation?: InboxConversationV2;
    deduped?: boolean;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        let conversationId = params.conversationId ?? null;
        if (!conversationId) {
            if (!params.targetUserId) {
                return { success: false, error: 'Missing conversation target' };
            }
            const ensured = await ensureDirectConversationV2(params.targetUserId);
            if (!ensured.success || !ensured.conversationId) {
                return { success: false, error: ensured.error || 'Failed to open conversation' };
            }
            conversationId = ensured.conversationId;
        }

        const attachments = params.attachments ?? [];
        const result = attachments.length > 0
            ? await sendMessageWithAttachments(
                conversationId,
                params.content,
                attachments,
                {
                    clientMessageId: params.clientMessageId,
                    replyToMessageId: params.replyToMessageId ?? null,
                },
            )
            : await sendMessage(
                conversationId,
                params.content,
                'text',
                undefined,
                {
                    clientMessageId: params.clientMessageId,
                    replyToMessageId: params.replyToMessageId ?? null,
                },
            );

        const conversation = result.success
            ? await getConversationSummaryV2Internal(user.id, conversationId)
            : null;

        return {
            success: result.success,
            error: result.error,
            conversationId,
            message: result.message,
            conversation: conversation ?? undefined,
            deduped: result.deduped,
        };
    } catch (error) {
        console.error('Error sending conversation message v2:', error);
        return { success: false, error: 'Failed to send message' };
    }
}

export async function markConversationReadV2(
    conversationId: string,
    lastReadMessageId?: string,
) {
    return markConversationAsRead(conversationId, lastReadMessageId);
}

export async function setConversationArchivedV2(conversationId: string, archived: boolean) {
    return setConversationArchived(conversationId, archived);
}

export async function setConversationMutedV2(conversationId: string, muted: boolean) {
    return setConversationMuted(conversationId, muted);
}

export async function setMessagePinnedV2(messageId: string, pinned: boolean) {
    return setMessagePinned(messageId, pinned);
}

export async function editMessageV2(messageId: string, content: string) {
    return editMessage(messageId, content);
}

export async function deleteMessageV2(messageId: string, mode: 'me' | 'everyone' = 'me') {
    return deleteMessage(messageId, mode);
}

export async function getUnreadSummaryV2(): Promise<{ success: boolean; error?: string; count?: number }> {
    return getUnreadCount();
}

export async function getApplicationsInboxPageV2(limit: number = 20, offset: number = 0) {
    return getInboxApplicationsAction(limit, offset);
}

export async function getProjectGroupsPageV2(limit: number = 20, offset: number = 0) {
    return getProjectGroups(limit, offset);
}

export async function searchMessagesV2(query: string) {
    return searchMessages(query);
}

export async function getMessageContextV2(conversationId: string, messageId: string) {
    return getMessageContext(conversationId, messageId);
}
