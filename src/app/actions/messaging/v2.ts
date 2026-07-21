'use server';

import { getAuthUser } from '@/lib/supabase/auth-user';
import { resolvePrivacyRelationships } from '@/lib/privacy/resolver';
import { db } from '@/lib/db';
import {
    conversationParticipants,
    conversations,
    profiles,
    projectMembers,
    projects,
    roleApplications,
} from '@/lib/db/schema';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
    ConversationWithDetails,
    MessageWithSender,
    UploadedAttachment,
    getConversations,
    hydrateConversationLastMessageDeliveryMetadata,
    getMessages,
    getOrCreateDMConversation,
    getPinnedMessages,
    sendMessageWithAttachments,
    sendStructuredMessageActionV2,
    resolveMessageWorkflowActionV2,
} from '@/app/actions/messaging';
import type { MessageContextChip } from '@/lib/messages/structured';
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
    activeApplicationStatus?: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'proposed' | 'project_deleted' | null;
    activeProjectId?: string | null;
}

export interface InboxConversationV2 extends ConversationWithDetails {
    lastReadAt: Date | null;
    lastReadMessageId: string | null;
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
        last_message_preview: string | null;
        last_message_sender_id: string | null;
        last_message_at: Date | null;
        last_message_type: string | null;
        unread_count: number;
        last_read_at: Date | null;
        last_read_message_id: string | null;
    }>(sql`
        SELECT
            c.id as conversation_id,
            p.id as project_id,
            p.title as project_title,
            p.slug as project_slug,
            p.cover_image as project_cover_image,
            c.updated_at,
            cp.unread_count,
            cp.last_read_at,
            cp.last_read_message_id,
            cp.last_message_id,
            cp.last_message_preview,
            cp.last_message_sender_id,
            cp.last_message_at,
            cp.last_message_type
        FROM ${projects} p
        INNER JOIN ${conversations} c ON c.id = p.conversation_id
        INNER JOIN ${projectMembers} pm ON pm.project_id = p.id AND pm.user_id = ${viewerId}
        INNER JOIN ${conversationParticipants} cp ON cp.conversation_id = c.id AND cp.user_id = ${viewerId}
        WHERE p.conversation_id = ${conversationId}
        LIMIT 1
    `);

    const row = Array.from(rows)[0];
    if (!row) return null;

    const [conversation] = await hydrateConversationLastMessageDeliveryMetadata(viewerId, [{
        id: row.conversation_id,
        type: 'project_group',
        updatedAt: row.last_message_at ?? row.updated_at,
        participants: [],
        lastMessage: row.last_message_id
            ? {
                id: row.last_message_id,
                content: row.last_message_preview,
                senderId: row.last_message_sender_id,
                createdAt: row.last_message_at ?? row.updated_at,
                type: row.last_message_type,
            }
            : null,
        unreadCount: row.unread_count || 0,
        lastReadAt: row.last_read_at ?? null,
        lastReadMessageId: row.last_read_message_id ?? null,
    }]);

    return conversation ?? null;
}

async function getConversationSummarySourceV2(
    viewerId: string,
    conversationId: string,
): Promise<ConversationWithDetails | null> {
    const summaries = await getConversationSummarySourcesV2(viewerId, [conversationId]);
    return summaries[0] ?? null;
}

async function getConversationSummarySourcesV2(
    viewerId: string,
    conversationIds: string[],
): Promise<ConversationWithDetails[]> {
    const normalizedIds = Array.from(new Set(conversationIds.filter(Boolean))).slice(0, 50);
    if (normalizedIds.length === 0) return [];

    const rows = Array.from(await db.execute<{
        id: string;
        type: 'dm' | 'group' | 'project_group';
        updated_at: Date;
        archived_at: Date | null;
        muted: boolean | null;
        unread_count: number;
        last_read_at: Date | null;
        last_read_message_id: string | null;
        last_message_id: string | null;
        last_message_preview: string | null;
        last_message_sender_id: string | null;
        last_message_at: Date | null;
        last_message_type: string | null;
    }>(sql`
        SELECT
            c.id,
            c.type,
            c.updated_at,
            cp.archived_at,
            cp.muted,
            cp.unread_count,
            cp.last_read_at,
            cp.last_read_message_id,
            cp.last_message_id,
            cp.last_message_preview,
            cp.last_message_sender_id,
            cp.last_message_at,
            cp.last_message_type
        FROM ${conversations} c
        INNER JOIN ${conversationParticipants} cp
            ON cp.conversation_id = c.id
           AND cp.user_id = ${viewerId}
        WHERE c.id IN ${normalizedIds}
    `));

    const nonProjectRows = rows.filter((row) => row.type !== 'project_group');
    const nonProjectIds = nonProjectRows.map((row) => row.id);
    const participantRows = nonProjectIds.length > 0
        ? await db
            .select({
                conversationId: conversationParticipants.conversationId,
                userId: conversationParticipants.userId,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
            })
            .from(conversationParticipants)
            .innerJoin(profiles, eq(profiles.id, conversationParticipants.userId))
            .where(inArray(conversationParticipants.conversationId, nonProjectIds))
        : [];

    const participantMap = new Map<string, typeof participantRows>();
    for (const participant of participantRows) {
        if (!participantMap.has(participant.conversationId)) {
            participantMap.set(participant.conversationId, []);
        }
        if (participant.userId !== viewerId) {
            participantMap.get(participant.conversationId)!.push(participant);
        }
    }

    const nonProjectConversations: ConversationWithDetails[] = nonProjectRows.map((row) => ({
        id: row.id,
        type: row.type,
        updatedAt: row.last_message_at ?? row.updated_at,
        lifecycleState: row.archived_at ? 'archived' : row.last_message_id ? 'active' : 'draft',
        muted: Boolean(row.muted),
        participants: (participantMap.get(row.id) ?? []).map((participant) => ({
            id: participant.userId,
            username: participant.username,
            fullName: participant.fullName,
            avatarUrl: participant.avatarUrl,
        })),
        lastMessage: row.last_message_id
            ? {
                id: row.last_message_id,
                content: row.last_message_preview,
                senderId: row.last_message_sender_id,
                createdAt: row.last_message_at ?? row.updated_at,
                type: row.last_message_type,
            }
            : null,
        unreadCount: row.unread_count || 0,
        lastReadAt: row.last_read_at ?? null,
        lastReadMessageId: row.last_read_message_id ?? null,
    }));

    const hydratedNonProject = await hydrateConversationLastMessageDeliveryMetadata(
        viewerId,
        nonProjectConversations,
    );
    const projectGroupIds = rows
        .filter((row) => row.type === 'project_group')
        .map((row) => row.id);
    const projectGroupConversations = await Promise.all(
        projectGroupIds.map((conversationId) => getProjectGroupConversationById(viewerId, conversationId)),
    );

    const byId = new Map<string, ConversationWithDetails>();
    for (const conversation of hydratedNonProject) {
        byId.set(conversation.id, conversation);
    }
    for (const conversation of projectGroupConversations) {
        if (conversation) byId.set(conversation.id, conversation);
    }

    return normalizedIds
        .map((conversationId) => byId.get(conversationId) ?? null)
        .filter((conversation): conversation is ConversationWithDetails => conversation !== null);
}

async function hydrateConversationSummariesV2(
    viewerId: string,
    conversationsToHydrate: ConversationWithDetails[],
): Promise<InboxConversationV2[]> {
    if (conversationsToHydrate.length === 0) return [];
    const capabilitiesByConversation = await buildConversationCapabilitiesBatch(viewerId, conversationsToHydrate);
    return conversationsToHydrate.map((conversation) => ({
        ...conversation,
        lastReadAt: conversation.lastReadAt ?? null,
        lastReadMessageId: conversation.lastReadMessageId ?? null,
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

export async function getConversationSummariesV2(
    conversationIds: string[],
): Promise<{ success: boolean; error?: string; conversations?: InboxConversationV2[] }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const summaries = await getConversationSummarySourcesV2(user.id, conversationIds);
        const conversations = await hydrateConversationSummariesV2(user.id, summaries);

        return { success: true, conversations };
    } catch (error) {
        console.error('Error fetching conversation summaries v2:', error);
        return { success: false, error: 'Failed to fetch conversation summaries' };
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
                conversation: conversation!,
                capability: conversation!.capability,
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

export async function ensureDirectConversationV2(
    targetUserId: string,
): Promise<{ success: boolean; error?: string; conversationId?: string; conversation?: InboxConversationV2 }> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        // Fetch target user's profile info for the draft conversation
        const [targetProfile] = await db
            .select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(eq(profiles.id, targetUserId))
            .limit(1);

        if (!targetProfile) {
            return { success: false, error: 'User not found' };
        }

        const ensured = await getOrCreateDMConversation(targetProfile.id);
        if (!ensured.success || !ensured.conversationId) {
            return { success: false, error: ensured.error || 'Failed to open conversation' };
        }

        const conversationSummary = await getConversationSummarySourceV2(user.id, ensured.conversationId);
        if (!conversationSummary) {
            return { success: false, error: 'Conversation not found' };
        }

        const [conversation] = await hydrateConversationSummariesV2(user.id, [conversationSummary]);
        if (!conversation) {
            return { success: false, error: 'Failed to load conversation' };
        }

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
    contextChips?: MessageContextChip[];
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
        let targetUserId = params.targetUserId ?? null;

        // Handle draft conversation IDs — extract targetUserId and create the real conversation
        if (conversationId && conversationId.startsWith('draft:')) {
            targetUserId = targetUserId || conversationId.slice('draft:'.length);
            conversationId = null;
        }

        if (!conversationId) {
            if (!targetUserId) {
                return { success: false, error: 'Missing conversation target' };
            }
            // Create the actual database conversation on first message send
            const ensured = await getOrCreateDMConversation(targetUserId);
            if (!ensured.success || !ensured.conversationId) {
                return { success: false, error: ensured.error || 'Failed to open conversation' };
            }
            conversationId = ensured.conversationId;
        }

        const attachments = params.attachments ?? [];
        const result = await sendMessageWithAttachments(
            conversationId,
            params.content,
            attachments,
            {
                clientMessageId: params.clientMessageId,
                replyToMessageId: params.replyToMessageId ?? null,
                contextChips: params.contextChips ?? [],
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

export async function sendStructuredConversationMessageV2(params: Parameters<typeof sendStructuredMessageActionV2>[0]): Promise<{
    success: boolean;
    error?: string;
    conversationId?: string;
    message?: MessageWithSender;
    conversation?: InboxConversationV2;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const result = await sendStructuredMessageActionV2(params);
        if (!result.success || !result.conversationId) {
            return { success: false, error: result.error || 'Failed to send structured message' };
        }

        const conversation = await getConversationSummaryV2Internal(user.id, result.conversationId);
        return {
            success: true,
            conversationId: result.conversationId,
            message: result.message,
            conversation: conversation ?? undefined,
        };
    } catch (error) {
        console.error('Error sending structured conversation message v2:', error);
        return { success: false, error: 'Failed to send structured message' };
    }
}

export async function resolveConversationWorkflowV2(params: Parameters<typeof resolveMessageWorkflowActionV2>[0]): Promise<{
    success: boolean;
    error?: string;
    conversationId?: string;
    message?: MessageWithSender;
    bridgeMessage?: MessageWithSender | null;
    conversation?: InboxConversationV2;
}> {
    try {
        const user = await getAuthUser();
        if (!user) return { success: false, error: 'Not authenticated' };

        const result = await resolveMessageWorkflowActionV2(params);
        if (!result.success || !result.conversationId) {
            return { success: false, error: result.error || 'Failed to resolve workflow' };
        }

        const conversation = await getConversationSummaryV2Internal(user.id, result.conversationId);
        return {
            success: true,
            conversationId: result.conversationId,
            message: result.message,
            bridgeMessage: result.bridgeMessage ?? null,
            conversation: conversation ?? undefined,
        };
    } catch (error) {
        console.error('Error resolving workflow v2:', error);
        return { success: false, error: 'Failed to resolve workflow' };
    }
}
