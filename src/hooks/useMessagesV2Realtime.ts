'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { MessageWithSender } from '@/app/actions/messaging';
import { playMessageSound } from '@/lib/messages/notification-sound';
import {
    getConversationSummariesV2,
    getConversationSummaryV2,
    getConversationThreadPageV2,
} from '@/app/actions/messaging/v2';
import type { MessagesInboxPageV2 } from '@/app/actions/messaging/v2';
import {
    getCachedInboxConversationIds,
    hasCachedThreadMessage,
    hideThreadMessageForViewer,
    isCachedConversationLastMessage,
    patchConversationLastMessageFromMessage,
    patchThreadConversation,
    patchThreadMessage,
    patchThreadMessages,
    replaceThreadSnapshot,
    upsertInboxConversation,
    upsertThreadMessage,
    upsertThreadConversation,
} from '@/lib/messages/v2-cache';
import {
    isRealtimeTerminalStatus,
    subscribeActiveResource,
} from '@/lib/realtime/subscriptions';
import { isMessagingDenormalizedInboxRealtimeEnabled } from '@/lib/features/messages';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRealtime } from '@/components/providers/RealtimeProvider';
import { useMessagesV2OutboxStore } from '@/stores/messagesV2OutboxStore';
import { queryKeys } from '@/lib/query-keys';
import {
    buildViewerSenderIdentity,
    resolveRealtimeMessageSender,
    type RealtimeSenderIdentity,
} from '@/lib/messages/realtime-sender';
import { withReactionSummaryMetadata } from '@/lib/messages/reactions';
import { buildMessageAttachmentAccessUrl } from '@/lib/messages/attachment-access';

const FALLBACK_REFRESH_DEBOUNCE_MS = 220;
const THREAD_MESSAGE_SYNC_DEBOUNCE_MS = 16;

type MessageReadWatermark = Pick<MessageWithSender, 'id' | 'createdAt'>;

function compareMessageWatermarks(left: MessageReadWatermark, right: MessageReadWatermark) {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
}

function getPayloadConversationId(payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) {
    const nextId = payload.new?.conversation_id;
    if (typeof nextId === 'string' && nextId.length > 0) return nextId;
    const previousId = payload.old?.conversation_id;
    return typeof previousId === 'string' && previousId.length > 0 ? previousId : null;
}

function getPayloadMessageId(payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) {
    const nextId = payload.new?.id;
    if (typeof nextId === 'string' && nextId.length > 0) return nextId;
    const previousId = payload.old?.id;
    return typeof previousId === 'string' && previousId.length > 0 ? previousId : null;
}

function getPayloadHiddenMessageId(payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) {
    const nextId = payload.new?.message_id;
    if (typeof nextId === 'string' && nextId.length > 0) return nextId;
    const previousId = payload.old?.message_id;
    return typeof previousId === 'string' && previousId.length > 0 ? previousId : null;
}

function getPayloadClientMessageId(payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) {
    const next = payload.new?.client_message_id;
    if (typeof next === 'string' && next.length > 0) return next;
    const previous = payload.old?.client_message_id;
    return typeof previous === 'string' && previous.length > 0 ? previous : null;
}

function removeOutboxItemIfPresent(clientMessageId: string | null | undefined) {
    if (!clientMessageId) return;
    const outboxState = useMessagesV2OutboxStore.getState();
    if (outboxState.items.some((item) => item.clientMessageId === clientMessageId)) {
        outboxState.removeItem(clientMessageId);
    }
}

function getPayloadField(
    payload: { new?: Record<string, unknown>; old?: Record<string, unknown> },
    scope: 'new' | 'old',
    field: string,
) {
    return payload[scope]?.[field];
}

function getPayloadStringField(
    payload: { new?: Record<string, unknown>; old?: Record<string, unknown> },
    scope: 'new' | 'old',
    field: string,
) {
    const value = getPayloadField(payload, scope, field);
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function getPayloadNumberField(
    payload: { new?: Record<string, unknown>; old?: Record<string, unknown> },
    scope: 'new' | 'old',
    field: string,
) {
    const value = getPayloadField(payload, scope, field);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getPayloadDateField(
    payload: { new?: Record<string, unknown>; old?: Record<string, unknown> },
    scope: 'new' | 'old',
    field: string,
) {
    const value = getPayloadField(payload, scope, field);
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
        return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getPayloadMetadataField(
    payload: { new?: Record<string, unknown>; old?: Record<string, unknown> },
    scope: 'new' | 'old',
) {
    const metadata = getPayloadField(payload, scope, 'metadata');
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata as Record<string, unknown>
        : {};
}

function hasOwnMetadataField(metadata: Record<string, unknown>, field: string) {
    return Object.prototype.hasOwnProperty.call(metadata, field);
}

function hasRealtimeReactionSummaryChange(payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) {
    return hasOwnMetadataField(getPayloadMetadataField(payload, 'new'), 'reactionSummary')
        || hasOwnMetadataField(getPayloadMetadataField(payload, 'old'), 'reactionSummary');
}

function mergeRealtimeMessageMetadata(
    currentMetadata: Record<string, unknown> | null | undefined,
    nextMetadata: Record<string, unknown> | null | undefined,
    options?: { preserveReactionSummary?: boolean },
) {
    const current = { ...(currentMetadata || {}) };
    const merged = {
        ...current,
        ...(nextMetadata || {}),
    };

    if (!options?.preserveReactionSummary) {
        return merged;
    }

    if (hasOwnMetadataField(current, 'reactionSummary')) {
        merged.reactionSummary = current.reactionSummary;
    } else {
        delete merged.reactionSummary;
    }

    return merged;
}

function getCachedThreadSenderCandidates(
    queryClient: QueryClient,
    conversationId: string,
) {
    const threadData = queryClient.getQueryData<{
        pages?: Array<{
            conversation?: {
                participants?: RealtimeSenderIdentity[] | null;
            } | null;
            messages?: MessageWithSender[] | null;
        }>;
    }>(queryKeys.messages.v2.thread(conversationId));

    const threadParticipants = threadData?.pages?.[0]?.conversation?.participants ?? [];
    const threadMessages = threadData?.pages?.flatMap((page) => page.messages ?? []) ?? [];
    if (threadParticipants.length > 0 || threadMessages.length > 0) {
        return {
            participants: threadParticipants,
            messages: threadMessages,
        };
    }

    const inboxQueries = queryClient.getQueriesData<{
        pages?: MessagesInboxPageV2[];
    }>({
        queryKey: ['chat-v2', 'inbox'] as const,
    });

    for (const [, data] of inboxQueries) {
        for (const page of data?.pages ?? []) {
            const conversation = page.conversations.find((entry) => entry.id === conversationId);
            if (conversation?.participants?.length) {
                return {
                    participants: conversation.participants,
                    messages: [] as MessageWithSender[],
                };
            }
        }
    }

    return {
        participants: [] as RealtimeSenderIdentity[],
        messages: [] as MessageWithSender[],
    };
}

function buildThreadMessageFromRealtimePayload(params: {
    conversationId: string;
    payload: { new?: Record<string, unknown>; old?: Record<string, unknown> };
    sender: MessageWithSender['sender'];
}): MessageWithSender | null {
    const createdAt = getPayloadDateField(params.payload, 'new', 'created_at');
    if (!createdAt) {
        return null;
    }

    const messageId = getPayloadMessageId(params.payload);
    if (!messageId) {
        return null;
    }

    const replyToMessageId = getPayloadStringField(params.payload, 'new', 'reply_to_message_id');
    const type = getPayloadStringField(params.payload, 'new', 'type');
    const metadata = (params.payload.new?.metadata && typeof params.payload.new.metadata === 'object')
        ? params.payload.new.metadata as Record<string, unknown>
        : {};

    const rawAttachments = Array.isArray(metadata.attachments)
        ? (metadata.attachments as Array<Record<string, unknown>>)
        : [];

    const isMediaMessage = type === 'image' || type === 'video' || type === 'file';
    // If it's a media message without embedded metadata attachments, fall back to snapshot sync
    if (isMediaMessage && rawAttachments.length === 0) {
        return null;
    }

    const replyPreview = (metadata.replyPreview && typeof metadata.replyPreview === 'object')
        ? (metadata.replyPreview as MessageWithSender['replyTo'])
        : null;

    // If it has a reply target but no embedded replyPreview, fall back to snapshot sync
    if (replyToMessageId && !replyPreview) {
        return null;
    }

    const attachments: MessageWithSender['attachments'] = rawAttachments.map((att) => {
        const id = String(att.id || '');
        const attType = (att.type as 'image' | 'video' | 'file') || 'file';
        return {
            id,
            type: attType,
            url: buildMessageAttachmentAccessUrl(id),
            filename: String(att.filename || 'attachment'),
            sizeBytes: typeof att.sizeBytes === 'number' ? att.sizeBytes : null,
            mimeType: String(att.mimeType || ''),
            thumbnailUrl: typeof att.thumbnailUrl === 'string'
                ? att.thumbnailUrl
                : (attType === 'image' ? buildMessageAttachmentAccessUrl(id, { preview: true }) : null),
            width: typeof att.width === 'number' ? att.width : null,
            height: typeof att.height === 'number' ? att.height : null,
        };
    });

    return {
        id: messageId,
        conversationId: params.conversationId,
        senderId: getPayloadStringField(params.payload, 'new', 'sender_id'),
        clientMessageId: getPayloadClientMessageId(params.payload),
        content: typeof params.payload.new?.content === 'string' || params.payload.new?.content === null
            ? params.payload.new?.content as string | null
            : null,
        type: (type ?? 'text') as MessageWithSender['type'],
        metadata,
        replyTo: replyPreview,
        createdAt,
        editedAt: getPayloadDateField(params.payload, 'new', 'edited_at'),
        deletedAt: getPayloadDateField(params.payload, 'new', 'deleted_at'),
        sender: params.sender,
        attachments,
    };
}

function shouldPlayParticipantUpdateSound(params: {
    payload: { new?: Record<string, unknown>; old?: Record<string, unknown> };
    activeConversationId: string | null;
}) {
    if (typeof document === 'undefined' || !document.hidden) {
        return false;
    }

    const conversationId = getPayloadConversationId(params.payload);
    if (!conversationId || conversationId === params.activeConversationId) {
        return false;
    }

    const nextLastMessageId = getPayloadStringField(params.payload, 'new', 'last_message_id');
    const previousLastMessageId = getPayloadStringField(params.payload, 'old', 'last_message_id');
    if (nextLastMessageId && nextLastMessageId !== previousLastMessageId) {
        return true;
    }

    const nextUnreadCount = getPayloadNumberField(params.payload, 'new', 'unread_count');
    const previousUnreadCount = getPayloadNumberField(params.payload, 'old', 'unread_count');
    return nextUnreadCount !== null && previousUnreadCount !== null && nextUnreadCount > previousUnreadCount;
}

function getCachedConversationSnapshot(
    queryClient: QueryClient,
    conversationId: string,
) {
    const threadData = queryClient.getQueryData<{
        pages?: Array<{
            conversation?: {
                id: string;
                unreadCount: number;
                lastReadAt?: Date | string | null;
                lastReadMessageId?: string | null;
                lastMessage?: { id: string; createdAt: Date | string | null } | null;
            } | null;
        }>;
    }>(queryKeys.messages.v2.thread(conversationId));
    const threadConversation = threadData?.pages?.[0]?.conversation;
    if (threadConversation) return threadConversation;

    const inboxQueries = queryClient.getQueriesData<{
        pages?: MessagesInboxPageV2[];
    }>({ queryKey: ['chat-v2', 'inbox'] as const });
    for (const [, data] of inboxQueries) {
        for (const page of data?.pages ?? []) {
            const conversation = page.conversations.find((entry) => entry.id === conversationId);
            if (conversation) return conversation;
        }
    }
    return null;
}

function compareReadWatermarks(
    current: { lastReadAt?: Date | string | null; lastReadMessageId?: string | null } | null | undefined,
    next: { lastReadAt?: Date | string | null; lastReadMessageId?: string | null } | null | undefined,
) {
    const currentMs = current?.lastReadAt ? new Date(current.lastReadAt).getTime() : 0;
    const nextMs = next?.lastReadAt ? new Date(next.lastReadAt).getTime() : 0;
    const safeCurrentMs = Number.isNaN(currentMs) ? 0 : currentMs;
    const safeNextMs = Number.isNaN(nextMs) ? 0 : nextMs;
    if (safeCurrentMs !== safeNextMs) {
        return safeCurrentMs - safeNextMs;
    }
    return 0;
}

function isLastMessageAfterReadWatermark(
    lastMessage: { id: string; createdAt: Date | string | null } | null | undefined,
    readWatermark: { lastReadAt?: Date | string | null; lastReadMessageId?: string | null } | null | undefined,
) {
    if (!lastMessage?.createdAt) return false;
    const messageMs = new Date(lastMessage.createdAt).getTime();
    const readMs = readWatermark?.lastReadAt ? new Date(readWatermark.lastReadAt).getTime() : 0;
    const safeMessageMs = Number.isNaN(messageMs) ? 0 : messageMs;
    const safeReadMs = Number.isNaN(readMs) ? 0 : readMs;
    if (safeMessageMs <= 0) return false;
    if (safeReadMs <= 0) return true;
    if (safeMessageMs !== safeReadMs) {
        return safeMessageMs > safeReadMs;
    }
    return false;
}

type MessagesRealtimeOptions = boolean | {
    inbox?: boolean;
    activeThread?: boolean;
};

const ENABLE_MESSAGES_REALTIME_TRACE =
    process.env.NODE_ENV !== 'production'
    || process.env.NEXT_PUBLIC_MESSAGES_REALTIME_TRACE === '1';

function normalizeMessagesRealtimeOptions(options: MessagesRealtimeOptions) {
    if (typeof options === 'boolean') {
        return { inbox: options, activeThread: options };
    }
    return {
        inbox: options.inbox ?? false,
        activeThread: options.activeThread ?? false,
    };
}

function traceMessagesRealtimeChannel(
    action: 'subscribe' | 'unsubscribe',
    payload: {
        scope: 'inbox' | 'active-thread';
        conversationId?: string | null;
        tables: ReadonlyArray<string>;
    },
) {
    if (!ENABLE_MESSAGES_REALTIME_TRACE) return;
    const detail = {
        action,
        route: typeof window === 'undefined' ? null : window.location.pathname,
        scope: payload.scope,
        conversationId: payload.conversationId ?? null,
        tables: payload.tables,
    };
    console.debug('[messages-v2] realtime_channel', detail);
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
        performance.mark(`messages-v2:realtime:${payload.scope}:${action}`);
    }
}

export function useMessagesV2Realtime(
    activeConversationId: string | null,
    options: MessagesRealtimeOptions,
) {
    const queryClient = useQueryClient();
    const { user, session, isLoading } = useAuth();
    const { isMessagingConnected, messagingStatus, subscribeMessagingNotifications } = useRealtime();
    const userId = user?.id ?? null;
    const realtimeToken = session?.access_token ?? null;
    const requestedRealtime = normalizeMessagesRealtimeOptions(options);
    const denormalizedInboxRealtimeEnabled = isMessagingDenormalizedInboxRealtimeEnabled(userId);
    const realtimeAvailable = Boolean(userId) && Boolean(realtimeToken) && !isLoading;
    const inboxRealtimeEnabled = requestedRealtime.inbox && realtimeAvailable;
    const activeThreadRealtimeEnabled = requestedRealtime.activeThread && realtimeAvailable;
    const [activeThreadConnected, setActiveThreadConnected] = useState(true);
    const inboxRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const threadRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const summaryRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeThreadConnectionTokenRef = useRef(0);
    const activeConversationIdRef = useRef(activeConversationId);
    const pendingConversationRefreshRef = useRef(new Map<string, boolean>());
    const pendingThreadMessageEventsRef = useRef(new Map<string, 'INSERT' | 'UPDATE' | 'DELETE' | 'REFRESH'>());
    const threadMessageSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const participantReadWatermarksRef = useRef(new Map<string, MessageReadWatermark>());

    useEffect(() => {
        activeConversationIdRef.current = activeConversationId;
    }, [activeConversationId]);

    const refreshThreadSnapshot = useCallback(async (conversationId: string) => {
        const result = await getConversationThreadPageV2(conversationId, undefined, 30);
        if (!result.success || !result.page) {
            return;
        }

        replaceThreadSnapshot(queryClient, conversationId, result.page);
        queryClient.setQueriesData(
            { queryKey: ['chat-v2', 'capabilities', conversationId] as const },
            () => result.page?.capability,
        );
    }, [queryClient]);

    const refreshTrackedConversations = useCallback(async (conversationIds?: ReadonlyArray<string>) => {
        const ids = Array.from(new Set(
            (conversationIds?.length ? conversationIds : getCachedInboxConversationIds(queryClient))
                .filter(Boolean),
        ));
        if (ids.length === 0) return;

        const result = await getConversationSummariesV2(ids);
        if (!result.success || !result.conversations) {
            await Promise.all(ids.map(async (conversationId) => {
                await getConversationSummaryV2(conversationId).then((summaryResult) => {
                    if (!summaryResult.success || !summaryResult.conversation) return;
                    upsertInboxConversation(queryClient, summaryResult.conversation);
                    if (conversationId === activeConversationIdRef.current) {
                        upsertThreadConversation(queryClient, summaryResult.conversation);
                        queryClient.setQueriesData(
                            { queryKey: ['chat-v2', 'capabilities', conversationId] as const },
                            () => summaryResult.conversation?.capability,
                        );
                    }
                });
            }));
            return;
        }

        for (const conversation of result.conversations) {
            upsertInboxConversation(queryClient, conversation);
            if (conversation.id === activeConversationIdRef.current) {
                upsertThreadConversation(queryClient, conversation);
                queryClient.setQueriesData(
                    { queryKey: ['chat-v2', 'capabilities', conversation.id] as const },
                    () => conversation.capability,
                );
            }
        }
    }, [queryClient]);

    const scheduleInboxRefresh = useCallback(() => {
        if (inboxRefreshTimerRef.current) return;
        inboxRefreshTimerRef.current = setTimeout(() => {
            inboxRefreshTimerRef.current = null;
            void refreshTrackedConversations();
        }, FALLBACK_REFRESH_DEBOUNCE_MS);
    }, [refreshTrackedConversations]);

    const scheduleThreadRefresh = useCallback((conversationId: string | null) => {
        if (!conversationId || threadRefreshTimerRef.current) return;
        threadRefreshTimerRef.current = setTimeout(() => {
            threadRefreshTimerRef.current = null;
            void refreshThreadSnapshot(conversationId);
        }, FALLBACK_REFRESH_DEBOUNCE_MS);
    }, [refreshThreadSnapshot]);

    const refreshMessageReactionSummary = useCallback(async (conversationId: string, messageId: string) => {
        try {
            const { getMessageReactions } = await import('@/app/actions/messaging/features');
            const result = await getMessageReactions([messageId]);
            if (!result.success) {
                scheduleThreadRefresh(conversationId);
                return;
            }

            const reactionSummary = result.reactions?.[messageId] ?? [];
            let patchedMessage: MessageWithSender | null = null;
            patchThreadMessage(queryClient, conversationId, messageId, (current) => {
                patchedMessage = {
                    ...current,
                    metadata: withReactionSummaryMetadata(
                        (current.metadata || {}) as Record<string, unknown>,
                        reactionSummary,
                    ),
                };
                return patchedMessage;
            });

            if (patchedMessage && isCachedConversationLastMessage(queryClient, conversationId, messageId)) {
                patchConversationLastMessageFromMessage(queryClient, conversationId, patchedMessage);
            }
        } catch (error) {
            console.error('[messages-v2] failed to refresh message reactions', {
                conversationId,
                messageId,
                error,
            });
            scheduleThreadRefresh(conversationId);
        }
    }, [queryClient, scheduleThreadRefresh]);

    const refreshConversationSummary = useCallback(async (
        conversationId: string,
        options?: { syncThread?: boolean },
    ) => {
        const result = await getConversationSummaryV2(conversationId);
        if (!result.success || !result.conversation) {
            scheduleInboxRefresh();
            if (options?.syncThread) scheduleThreadRefresh(conversationId);
            return null;
        }

        const cachedConversation = getCachedConversationSnapshot(queryClient, conversationId);
        if (
            cachedConversation
            && result.conversation.unreadCount > cachedConversation.unreadCount
            && compareReadWatermarks(cachedConversation, result.conversation) >= 0
            && !isLastMessageAfterReadWatermark(result.conversation.lastMessage, cachedConversation)
        ) {
            console.debug('[messages-v2] read_summary_ignored_stale', {
                conversationId,
                previousUnread: cachedConversation.unreadCount,
                nextUnread: result.conversation.unreadCount,
                cachedReadMessageId: cachedConversation.lastReadMessageId ?? null,
                summaryReadMessageId: result.conversation.lastReadMessageId ?? null,
            });
            return cachedConversation as typeof result.conversation;
        }

        if (options?.syncThread) {
            upsertThreadConversation(queryClient, result.conversation);
            const latestMessageId = result.conversation.lastMessage?.id ?? null;
            if (latestMessageId && !hasCachedThreadMessage(queryClient, conversationId, latestMessageId)) {
                scheduleThreadRefresh(conversationId);
            }
            queryClient.setQueriesData(
                { queryKey: ['chat-v2', 'capabilities', conversationId] as const },
                () => result.conversation?.capability,
            );
        } else {
            upsertInboxConversation(queryClient, result.conversation);
        }

        return result.conversation;
    }, [queryClient, scheduleInboxRefresh, scheduleThreadRefresh]);

    const scheduleConversationSummaryRefresh = useCallback((
        conversationId: string,
        options?: { syncThread?: boolean },
    ) => {
        const shouldSyncThread = Boolean(options?.syncThread);
        const existing = pendingConversationRefreshRef.current.get(conversationId) ?? false;
        pendingConversationRefreshRef.current.set(conversationId, existing || shouldSyncThread);

        if (summaryRefreshTimerRef.current) return;
        summaryRefreshTimerRef.current = setTimeout(() => {
            summaryRefreshTimerRef.current = null;
            const pending = Array.from(pendingConversationRefreshRef.current.entries());
            pendingConversationRefreshRef.current.clear();
            void Promise.all(
                pending.map(([pendingConversationId, syncThread]) =>
                    refreshConversationSummary(pendingConversationId, { syncThread }),
                ),
            );
        }, FALLBACK_REFRESH_DEBOUNCE_MS);
    }, [refreshConversationSummary]);

    // Wave 1: surgical cache update when a delivery/read receipt arrives.
    // Bumps the per-message deliveryCounts and derives the deliveryState so
    // the UI ticks advance within ~100 ms without a full thread refetch.
    const applyReceiptPatch = useCallback(
        (
            conversationId: string,
            messageId: string,
            kind: 'delivered' | 'read',
        ) => {
            let patchedMessage: MessageWithSender | null = null;
            patchThreadMessage(queryClient, conversationId, messageId, (message) => {
                const metadata = (message.metadata || {}) as Record<string, unknown>;
                const currentCounts = (metadata.deliveryCounts as { total?: number; delivered?: number; read?: number } | undefined) ?? {};
                const total = typeof currentCounts.total === 'number' ? currentCounts.total : 0;
                const prevDelivered = typeof currentCounts.delivered === 'number' ? currentCounts.delivered : 0;
                const prevRead = typeof currentCounts.read === 'number' ? currentCounts.read : 0;

                const nextDelivered = kind === 'delivered' || kind === 'read'
                    ? Math.max(prevDelivered, Math.min(total || prevDelivered + 1, prevDelivered + 1))
                    : prevDelivered;
                const nextRead = kind === 'read' ? Math.min(total || prevRead + 1, prevRead + 1) : prevRead;

                // Never downgrade. If a read receipt arrives after a later
                // event, keep the stronger state.
                const currentState = metadata.deliveryState as string | undefined;
                let nextState: 'sent' | 'delivered' | 'read' = 'sent';
                if (nextRead > 0 || currentState === 'read') nextState = 'read';
                else if (nextDelivered > 0 || currentState === 'delivered') nextState = 'delivered';

                patchedMessage = {
                    ...message,
                    metadata: {
                        ...metadata,
                        deliveryState: nextState,
                        deliveryCounts: {
                            total,
                            delivered: nextDelivered,
                            read: nextRead,
                        },
                    },
                };
                return patchedMessage;
            });

            if (patchedMessage && isCachedConversationLastMessage(queryClient, conversationId, messageId)) {
                patchConversationLastMessageFromMessage(queryClient, conversationId, patchedMessage);
            }
        },
        [queryClient],
    );

    const applyParticipantReadWatermark = useCallback((
        conversationId: string,
        participantId: string,
        messageId: string,
    ) => {
        if (!userId) return;
        const thread = queryClient.getQueryData<{ pages?: Array<{ messages?: MessageWithSender[] }> }>(
            queryKeys.messages.v2.thread(conversationId),
        );
        const watermark = thread?.pages
            ?.flatMap((page) => page.messages ?? [])
            .find((message) => message.id === messageId);
        if (!watermark) return;

        const key = `${conversationId}:${participantId}`;
        const previous = participantReadWatermarksRef.current.get(key);
        if (previous && compareMessageWatermarks(watermark, previous) <= 0) return;
        participantReadWatermarksRef.current.set(key, {
            id: watermark.id,
            createdAt: watermark.createdAt,
        });

        // ponytail: participant watermarks are the native fallback when a
        // receipt event is missed; the direct receipt stream remains primary.
        patchThreadMessages(
            queryClient,
            conversationId,
            (message) => message.senderId === userId
                && compareMessageWatermarks(message, watermark) <= 0
                && (!previous || compareMessageWatermarks(message, previous) > 0),
            (message) => {
                const metadata = (message.metadata || {}) as Record<string, unknown>;
                if (metadata.deliveryState === 'read') return message;
                const counts = (metadata.deliveryCounts as {
                    total?: number;
                    delivered?: number;
                    read?: number;
                } | undefined) ?? {};
                const read = Math.max(1, typeof counts.read === 'number' ? counts.read : 0);
                return {
                    ...message,
                    metadata: {
                        ...metadata,
                        deliveryState: 'read',
                        deliveryCounts: {
                            total: typeof counts.total === 'number' ? counts.total : 0,
                            delivered: Math.max(read, typeof counts.delivered === 'number' ? counts.delivered : 0),
                            read,
                        },
                    },
                };
            },
        );
    }, [queryClient, userId]);

    const flushPendingThreadMessageEvents = useCallback((conversationId: string) => {
        const pendingEntries = Array.from(pendingThreadMessageEventsRef.current.entries());
        pendingThreadMessageEventsRef.current.clear();
        if (pendingEntries.length === 0) {
            return;
        }

        const shouldRefreshSummary = pendingEntries.some(([messageId]) =>
            messageId === '__refresh__'
            || isCachedConversationLastMessage(queryClient, conversationId, messageId),
        );

        if (shouldRefreshSummary) {
            scheduleConversationSummaryRefresh(conversationId, {
                syncThread: conversationId === activeConversationIdRef.current,
            });
        }

        void refreshThreadSnapshot(conversationId);
    }, [queryClient, refreshThreadSnapshot, scheduleConversationSummaryRefresh]);

    const queueThreadMessageSync = useCallback((
        conversationId: string,
        payload: { new?: Record<string, unknown>; old?: Record<string, unknown>; eventType?: 'INSERT' | 'UPDATE' | 'DELETE' },
    ) => {
        const messageId = getPayloadMessageId(payload);
        const eventType = payload.eventType ?? 'REFRESH';

        if (!messageId || eventType === 'DELETE') {
            pendingThreadMessageEventsRef.current.set('__refresh__', eventType);
        } else {
            const existingEvent = pendingThreadMessageEventsRef.current.get(messageId);
            pendingThreadMessageEventsRef.current.set(
                messageId,
                existingEvent === 'INSERT' ? 'INSERT' : eventType,
            );
        }

        if (threadMessageSyncTimerRef.current) {
            return;
        }

        threadMessageSyncTimerRef.current = setTimeout(() => {
            threadMessageSyncTimerRef.current = null;
            flushPendingThreadMessageEvents(conversationId);
        }, THREAD_MESSAGE_SYNC_DEBOUNCE_MS);
    }, [flushPendingThreadMessageEvents]);

    useEffect(() => {
        if (!inboxRealtimeEnabled || !userId || !realtimeToken) {
            return;
        }

        const unsubscribe = subscribeMessagingNotifications((event) => {
            const currentActiveId = activeConversationIdRef.current;
            if (event.kind === 'conversation_participant') {
                const conversationId = getPayloadConversationId(event.payload);
                if (conversationId) {
                    if (shouldPlayParticipantUpdateSound({
                        payload: event.payload,
                        activeConversationId: currentActiveId,
                    })) {
                        playMessageSound();
                    }
                } else {
                    scheduleInboxRefresh();
                }
                return;
            }

            const hiddenConversationId = getPayloadConversationId(event.payload);
            const messageId = getPayloadHiddenMessageId(event.payload);
            if (hiddenConversationId) {
                scheduleConversationSummaryRefresh(hiddenConversationId, {
                    syncThread: hiddenConversationId === currentActiveId,
                });
            } else {
                scheduleInboxRefresh();
            }

            if (!currentActiveId || !messageId || !hasCachedThreadMessage(queryClient, currentActiveId, messageId)) {
                return;
            }

            hideThreadMessageForViewer(queryClient, currentActiveId, messageId);
            if (isCachedConversationLastMessage(queryClient, currentActiveId, messageId)) {
                scheduleConversationSummaryRefresh(currentActiveId, { syncThread: true });
            }
        });

        traceMessagesRealtimeChannel('subscribe', {
            scope: 'inbox',
            tables: ['conversation_participants', 'hidden_messages'],
        });

        return () => {
            unsubscribe();
            traceMessagesRealtimeChannel('unsubscribe', {
                scope: 'inbox',
                tables: ['conversation_participants', 'hidden_messages'],
            });
        };
    }, [
        denormalizedInboxRealtimeEnabled,
        inboxRealtimeEnabled,
        queryClient,
        realtimeToken,
        refreshTrackedConversations,
        scheduleConversationSummaryRefresh,
        scheduleInboxRefresh,
        subscribeMessagingNotifications,
        userId,
    ]);

    useEffect(() => {
        if (!activeThreadRealtimeEnabled || !activeConversationId || !realtimeToken || activeConversationId.startsWith('draft:')) {
            activeThreadConnectionTokenRef.current += 1;
            setActiveThreadConnected(true);
            return;
        }

        const supabase = createClient();
        const connectionToken = activeThreadConnectionTokenRef.current + 1;
        activeThreadConnectionTokenRef.current = connectionToken;
        setActiveThreadConnected(true);
        let cancelled = false;
        let channel: ReturnType<typeof subscribeActiveResource> | null = null;

        void (async () => {
            await supabase.realtime.setAuth(realtimeToken);
            if (cancelled || activeThreadConnectionTokenRef.current !== connectionToken) {
                return;
            }

            channel = subscribeActiveResource({
                supabase,
                resourceType: 'conversation',
                resourceId: activeConversationId,
                bindings: [
                    {
                        event: '*',
                        table: 'messages',
                        filter: `conversation_id=eq.${activeConversationId}`,
                        handler: (payload) => {
                            const isSoftDelete = payload.eventType === 'UPDATE' && Boolean(getPayloadDateField(payload, 'new', 'deleted_at'));

                            if (payload.eventType === 'DELETE' || isSoftDelete) {
                                const deletedMessageId = getPayloadMessageId(payload);
                                if (deletedMessageId) {
                                    const deletedAt = isSoftDelete
                                        ? getPayloadDateField(payload, 'new', 'deleted_at')
                                        : new Date();

                                    patchThreadMessage(queryClient, activeConversationId, deletedMessageId, (current) => ({
                                        ...current,
                                        deletedAt,
                                    }));
                                    const cached = queryClient.getQueryData<{ pages?: Array<{ messages?: MessageWithSender[] }> }>(
                                        queryKeys.messages.v2.thread(activeConversationId),
                                    );
                                    let deletedMessage: MessageWithSender | undefined;
                                    if (cached?.pages) {
                                        for (const page of cached.pages) {
                                            for (const message of page.messages ?? []) {
                                                if (message.id === deletedMessageId) {
                                                    deletedMessage = message;
                                                    break;
                                                }
                                            }
                                            if (deletedMessage) break;
                                        }
                                    }
                                    if (deletedMessage) {
                                        patchConversationLastMessageFromMessage(queryClient, activeConversationId, {
                                            ...deletedMessage,
                                            content: null,
                                            deletedAt,
                                        });
                                    }
                                }
                                return;
                            }

                            const nextMessage = buildThreadMessageFromRealtimePayload({
                                conversationId: activeConversationId,
                                payload,
                                sender: resolveRealtimeMessageSender({
                                    senderId: getPayloadStringField(payload, 'new', 'sender_id'),
                                    viewerIdentity: buildViewerSenderIdentity(user),
                                    ...getCachedThreadSenderCandidates(queryClient, activeConversationId),
                                }),
                            });
                            if (!nextMessage) {
                                // Keep the optimistic outbox row visible until
                                // the fallback snapshot can hydrate the full
                                // server message (attachments, replies, etc.).
                                queueThreadMessageSync(activeConversationId, payload);
                                return;
                            }

                            if (payload.eventType === 'INSERT') {
                                if (!hasCachedThreadMessage(queryClient, activeConversationId, nextMessage.id)) {
                                    upsertThreadMessage(queryClient, activeConversationId, nextMessage);
                                }
                                removeOutboxItemIfPresent(nextMessage.clientMessageId);
                                patchConversationLastMessageFromMessage(
                                    queryClient,
                                    activeConversationId,
                                    nextMessage,
                                    { incrementUnreadCount: nextMessage.senderId !== userId }
                                );
                                return;
                            }

                            if (!hasCachedThreadMessage(queryClient, activeConversationId, nextMessage.id)) {
                                queueThreadMessageSync(activeConversationId, payload);
                                return;
                            }

                            const reactionSummaryChanged = hasRealtimeReactionSummaryChange(payload);
                            let patchedMessage: MessageWithSender | null = null;
                            patchThreadMessage(queryClient, activeConversationId, nextMessage.id, (current) => {
                                patchedMessage = {
                                    ...current,
                                    content: nextMessage.content,
                                    type: nextMessage.type,
                                    metadata: mergeRealtimeMessageMetadata(
                                        (current.metadata || {}) as Record<string, unknown>,
                                        (nextMessage.metadata || {}) as Record<string, unknown>,
                                        { preserveReactionSummary: reactionSummaryChanged },
                                    ),
                                    editedAt: nextMessage.editedAt,
                                    deletedAt: nextMessage.deletedAt,
                                };
                                return patchedMessage;
                            });

                            if (isCachedConversationLastMessage(queryClient, activeConversationId, nextMessage.id)) {
                                patchConversationLastMessageFromMessage(
                                    queryClient,
                                    activeConversationId,
                                    patchedMessage ?? nextMessage,
                                );
                            }

                            if (reactionSummaryChanged) {
                                void refreshMessageReactionSummary(activeConversationId, nextMessage.id);
                            }
                        },
                    },
                    {
                        event: '*',
                        table: 'conversation_participants',
                        filter: `conversation_id=eq.${activeConversationId}`,
                        handler: (payload) => {
                            if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
                                const participantUserId = getPayloadStringField(payload, 'new', 'user_id');
                                const lastReadMessageId = getPayloadStringField(payload, 'new', 'last_read_message_id');
                                if (participantUserId === userId) {
                                    const rawUnread = getPayloadField(payload, 'new', 'unread_count');
                                    const nextUnreadCount = typeof rawUnread === 'number' ? rawUnread : undefined;
                                    if (typeof nextUnreadCount === 'number') {
                                        patchThreadConversation(queryClient, activeConversationId, (conv) => ({
                                            ...conv,
                                            unreadCount: nextUnreadCount,
                                        }));
                                    }
                                } else if (
                                    payload.eventType === 'UPDATE'
                                    && participantUserId
                                    && lastReadMessageId
                                ) {
                                    applyParticipantReadWatermark(
                                        activeConversationId,
                                        participantUserId,
                                        lastReadMessageId,
                                    );
                                }
                            }
                            // The global MessageAttentionProvider owns unread
                            // aggregation. This active-thread listener only owns
                            // its local conversation cache.
                        },
                    },
                    // Subscribe to INSERT/UPDATE/DELETE on message_reactions scoped
                    // to the active conversation. Own reactions are handled
                    // optimistically by useToggleReaction and skipped here.
                    {
                        event: '*',
                        table: 'message_reactions',
                        filter: `conversation_id=eq.${activeConversationId}`,
                        handler: (payload) => {
                            const scope = payload.eventType === 'DELETE' ? 'old' : 'new';
                            const reactionUserId = getPayloadStringField(payload, scope, 'user_id');
                            if (!reactionUserId || reactionUserId === userId) return;
                            const messageId = getPayloadStringField(payload, scope, 'message_id');
                            if (!messageId || !hasCachedThreadMessage(queryClient, activeConversationId, messageId)) return;
                            void refreshMessageReactionSummary(activeConversationId, messageId);
                        },
                    },
                    // Wave 1: listen for per-message delivery + read receipts
                    // so the sender's tick advances live (✓ → ✓✓ → blue ✓✓).
                    {
                        event: 'INSERT',
                        table: 'message_delivery_receipts',
                        filter: `conversation_id=eq.${activeConversationId}`,
                        handler: (payload) => {
                            const messageId = getPayloadStringField(payload, 'new', 'message_id');
                            if (messageId) {
                                applyReceiptPatch(activeConversationId, messageId, 'delivered');
                            }
                        },
                    },
                    {
                        event: 'INSERT',
                        table: 'message_read_receipts',
                        filter: `conversation_id=eq.${activeConversationId}`,
                        handler: (payload) => {
                            const messageId = getPayloadStringField(payload, 'new', 'message_id');
                            if (messageId) {
                                applyReceiptPatch(activeConversationId, messageId, 'read');
                            }
                        },
                    },
                    // Multiplexed: message_work_links changes for active thread (eliminates redundant channel)
                    {
                        event: '*',
                        table: 'message_work_links',
                        filter: `source_conversation_id=eq.${activeConversationId}`,
                        handler: () => {
                            void queryClient.invalidateQueries({
                                queryKey: ['chat-v2', 'linked-work', activeConversationId],
                                exact: false,
                            });
                        },
                    },
                ],
                onStatus: (status) => {
                    if (activeThreadConnectionTokenRef.current !== connectionToken) {
                        return;
                    }

                    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
                        setActiveThreadConnected(true);
                        return;
                    }

                    if (isRealtimeTerminalStatus(status)) {
                        setActiveThreadConnected(false);
                    }
                },
            });
            traceMessagesRealtimeChannel('subscribe', {
                scope: 'active-thread',
                conversationId: activeConversationId,
                tables: [
                    'messages',
                    'conversation_participants',
                    'message_reactions',
                    'message_delivery_receipts',
                    'message_read_receipts',
                ],
            });
        })().catch((error) => {
            console.error('[messages-v2] failed to initialize active thread realtime', error);
            if (activeThreadConnectionTokenRef.current === connectionToken) {
                setActiveThreadConnected(false);
            }
        });

        return () => {
            cancelled = true;
            activeThreadConnectionTokenRef.current += 1;
            setActiveThreadConnected(true);
            if (channel) {
                supabase.removeChannel(channel);
                traceMessagesRealtimeChannel('unsubscribe', {
                    scope: 'active-thread',
                    conversationId: activeConversationId,
                    tables: [
                        'messages',
                        'conversation_participants',
                        'message_reactions',
                        'message_delivery_receipts',
                        'message_read_receipts',
                    ],
                });
            }
        };
    }, [
        activeConversationId,
        activeThreadRealtimeEnabled,
        applyParticipantReadWatermark,
        applyReceiptPatch,
        denormalizedInboxRealtimeEnabled,
        queueThreadMessageSync,
        queryClient,
        realtimeToken,
        refreshMessageReactionSummary,
        scheduleInboxRefresh,
        scheduleConversationSummaryRefresh,
    ]);

    useEffect(() => {
        pendingThreadMessageEventsRef.current.clear();
        participantReadWatermarksRef.current.clear();
        if (threadMessageSyncTimerRef.current) {
            clearTimeout(threadMessageSyncTimerRef.current);
            threadMessageSyncTimerRef.current = null;
        }
    }, [activeConversationId]);

    useEffect(() => {
        return () => {
            if (inboxRefreshTimerRef.current) {
                clearTimeout(inboxRefreshTimerRef.current);
            }
            if (threadRefreshTimerRef.current) {
                clearTimeout(threadRefreshTimerRef.current);
            }
            if (summaryRefreshTimerRef.current) {
                clearTimeout(summaryRefreshTimerRef.current);
                summaryRefreshTimerRef.current = null;
            }
            if (threadMessageSyncTimerRef.current) {
                clearTimeout(threadMessageSyncTimerRef.current);
                threadMessageSyncTimerRef.current = null;
            }
            pendingConversationRefreshRef.current.clear();
            pendingThreadMessageEventsRef.current.clear();
        };
    }, []);

    return useMemo(() => ({
        inboxRealtimeConnected: isMessagingConnected,
        activeThreadConnected,
        isDegraded:
            (requestedRealtime.inbox && messagingStatus === 'disconnected')
            || (requestedRealtime.activeThread && Boolean(activeConversationId) && !activeThreadConnected),
    }), [
        activeConversationId,
        activeThreadConnected,
        isMessagingConnected,
        messagingStatus,
        requestedRealtime.activeThread,
        requestedRealtime.inbox,
    ]);
}
