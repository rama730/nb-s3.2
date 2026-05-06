'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { MessageWithSender } from '@/app/actions/messaging';
import { playMessageSound } from '@/lib/messages/notification-sound';
import {
    getConversationSummaryV2,
    getConversationThreadPageV2,
    getUnreadSummaryV2,
} from '@/app/actions/messaging/v2';
import type { MessagesInboxPageV2 } from '@/app/actions/messaging/v2';
import {
    getCachedInboxConversationIds,
    hasCachedThreadMessage,
    hideThreadMessageForViewer,
    isCachedConversationLastMessage,
    patchConversationLastMessageFromMessage,
    patchThreadMessage,
    replaceThreadSnapshot,
    setUnreadSummary,
    upsertInboxConversation,
    upsertThreadMessage,
    upsertThreadConversation,
} from '@/lib/messages/v2-cache';
import {
    isRealtimeTerminalStatus,
    subscribeActiveResource,
    subscribeMessagingNotifications,
} from '@/lib/realtime/subscriptions';
import { isMessagingDenormalizedInboxRealtimeEnabled } from '@/lib/features/messages';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { subscribePresenceRoom } from '@/lib/realtime/presence-client';
import { useMessagesV2OutboxStore } from '@/stores/messagesV2OutboxStore';
import { queryKeys } from '@/lib/query-keys';
import {
    buildViewerSenderIdentity,
    resolveRealtimeMessageSender,
    type RealtimeSenderIdentity,
} from '@/lib/messages/realtime-sender';
import { withReactionSummaryMetadata } from '@/lib/messages/reactions';

const FALLBACK_REFRESH_DEBOUNCE_MS = 220;

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

function getPayloadStringField(
    payload: { new?: Record<string, unknown>; old?: Record<string, unknown> },
    scope: 'new' | 'old',
    field: string,
) {
    const value = payload[scope]?.[field];
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function getPayloadNumberField(
    payload: { new?: Record<string, unknown>; old?: Record<string, unknown> },
    scope: 'new' | 'old',
    field: string,
) {
    const value = payload[scope]?.[field];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getPayloadDateField(
    payload: { new?: Record<string, unknown>; old?: Record<string, unknown> },
    scope: 'new' | 'old',
    field: string,
) {
    const value = payload[scope]?.[field];
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
    const metadata = payload[scope]?.metadata;
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
    if (replyToMessageId || type === 'image' || type === 'video' || type === 'file') {
        return null;
    }

    const metadata = params.payload.new?.metadata;
    return {
        id: messageId,
        conversationId: params.conversationId,
        senderId: getPayloadStringField(params.payload, 'new', 'sender_id'),
        clientMessageId: getPayloadClientMessageId(params.payload),
        content: typeof params.payload.new?.content === 'string' || params.payload.new?.content === null
            ? params.payload.new?.content as string | null
            : null,
        type: (type ?? 'text') as MessageWithSender['type'],
        metadata: metadata && typeof metadata === 'object'
            ? metadata as Record<string, unknown>
            : {},
        replyTo: null,
        createdAt,
        editedAt: getPayloadDateField(params.payload, 'new', 'edited_at'),
        deletedAt: getPayloadDateField(params.payload, 'new', 'deleted_at'),
        sender: params.sender,
        attachments: [],
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

function hasPendingReadCommit(queryClient: QueryClient) {
    return queryClient
        .getQueriesData<{ requestId: string } | null>({
            queryKey: ['chat-v2', 'read-commit-state'] as const,
        })
        .some(([, state]) => Boolean(state?.requestId));
}

export function useMessagesV2Realtime(
    activeConversationId: string | null,
    enabled: boolean,
) {
    const queryClient = useQueryClient();
    const { user, session, isLoading } = useAuth();
    const userId = user?.id ?? null;
    const realtimeToken = session?.access_token ?? null;
    const denormalizedInboxRealtimeEnabled = isMessagingDenormalizedInboxRealtimeEnabled(userId);
    const realtimeEnabled = enabled && Boolean(userId) && Boolean(realtimeToken) && !isLoading;
    const [inboxRealtimeConnected, setInboxRealtimeConnected] = useState(true);
    const [activeThreadConnected, setActiveThreadConnected] = useState(true);
    const inboxRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const threadRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const unreadRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const summaryRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inboxConnectionTokenRef = useRef(0);
    const activeThreadConnectionTokenRef = useRef(0);
    const activeConversationIdRef = useRef(activeConversationId);
    const pendingConversationRefreshRef = useRef(new Map<string, boolean>());
    const eventBufferRef = useRef<Array<() => void>>([]);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingThreadMessageEventsRef = useRef(new Map<string, 'INSERT' | 'UPDATE' | 'DELETE' | 'REFRESH'>());
    const threadMessageSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        activeConversationIdRef.current = activeConversationId;
    }, [activeConversationId]);

    const bufferEvent = useCallback((handler: () => void) => {
        eventBufferRef.current.push(handler);
        if (flushTimerRef.current) return;
        flushTimerRef.current = setTimeout(() => {
            const batch = eventBufferRef.current.splice(0);
            flushTimerRef.current = null;
            for (const fn of batch) fn();
        }, 200);
    }, []);

    const refreshUnreadSummary = useCallback(async () => {
        const result = await getUnreadSummaryV2();
        if (result.success && typeof result.count === 'number') {
            const cachedCount = queryClient.getQueryData<number | undefined>(queryKeys.messages.v2.unread()) ?? 0;
            if (result.count > cachedCount && hasPendingReadCommit(queryClient)) {
                console.debug('[messages-v2] read_summary_ignored_stale', {
                    previousUnread: cachedCount,
                    nextUnread: result.count,
                    source: 'unread-summary',
                });
                return;
            }
            setUnreadSummary(queryClient, result.count);
        }
    }, [queryClient]);

    const scheduleUnreadRefresh = useCallback(() => {
        if (unreadRefreshTimerRef.current) return;
        unreadRefreshTimerRef.current = setTimeout(() => {
            unreadRefreshTimerRef.current = null;
            void refreshUnreadSummary();
        }, FALLBACK_REFRESH_DEBOUNCE_MS);
    }, [refreshUnreadSummary]);

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

        await Promise.all(ids.map(async (conversationId) => {
            await getConversationSummaryV2(conversationId).then((result) => {
                if (!result.success || !result.conversation) return;
                upsertInboxConversation(queryClient, result.conversation);
                if (conversationId === activeConversationIdRef.current) {
                    upsertThreadConversation(queryClient, result.conversation);
                    queryClient.setQueriesData(
                        { queryKey: ['chat-v2', 'capabilities', conversationId] as const },
                        () => result.conversation?.capability,
                    );
                }
            });
        }));
    }, [queryClient]);

    const scheduleInboxRefresh = useCallback(() => {
        if (inboxRefreshTimerRef.current) return;
        inboxRefreshTimerRef.current = setTimeout(() => {
            inboxRefreshTimerRef.current = null;
            void refreshTrackedConversations();
            void refreshUnreadSummary();
        }, FALLBACK_REFRESH_DEBOUNCE_MS);
    }, [refreshTrackedConversations, refreshUnreadSummary]);

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
        }, FALLBACK_REFRESH_DEBOUNCE_MS);
    }, [flushPendingThreadMessageEvents]);

    useEffect(() => {
        if (!realtimeEnabled || !userId || !realtimeToken) {
            inboxConnectionTokenRef.current += 1;
            setInboxRealtimeConnected(true);
            return;
        }

        const supabase = createClient();
        const connectionToken = inboxConnectionTokenRef.current + 1;
        inboxConnectionTokenRef.current = connectionToken;
        setInboxRealtimeConnected(true);
        let cancelled = false;
        let channel: ReturnType<typeof subscribeMessagingNotifications> | null = null;

        void (async () => {
            await supabase.realtime.setAuth(realtimeToken);
            if (cancelled || inboxConnectionTokenRef.current !== connectionToken) {
                return;
            }

            channel = subscribeMessagingNotifications({
                supabase,
                userId,
                onEvent: (event) => {
                    const currentActiveId = activeConversationIdRef.current;
                    if (event.kind === 'conversation_participant') {
                        const conversationId = getPayloadConversationId(event.payload);
                        if (conversationId && denormalizedInboxRealtimeEnabled) {
                            scheduleConversationSummaryRefresh(conversationId);
                            scheduleUnreadRefresh();
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

                    if (event.kind === 'connection') {
                        bufferEvent(() => void refreshTrackedConversations());
                        if (currentActiveId) {
                            bufferEvent(() => void refreshConversationSummary(currentActiveId, { syncThread: true }));
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

                    if (!currentActiveId || !messageId) {
                        return;
                    }

                    if (!hasCachedThreadMessage(queryClient, currentActiveId, messageId)) {
                        return;
                    }

                    hideThreadMessageForViewer(queryClient, currentActiveId, messageId);
                    if (isCachedConversationLastMessage(queryClient, currentActiveId, messageId)) {
                        scheduleConversationSummaryRefresh(currentActiveId, { syncThread: true });
                    }
                },
                onStatus: (status) => {
                    if (inboxConnectionTokenRef.current !== connectionToken) {
                        return;
                    }

                    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
                        setInboxRealtimeConnected(true);
                        return;
                    }

                    if (isRealtimeTerminalStatus(status)) {
                        setInboxRealtimeConnected(false);
                    }
                },
            });
        })().catch((error) => {
            console.error('[messages-v2] failed to initialize inbox realtime', error);
            if (inboxConnectionTokenRef.current === connectionToken) {
                setInboxRealtimeConnected(false);
            }
        });

        return () => {
            cancelled = true;
            inboxConnectionTokenRef.current += 1;
            setInboxRealtimeConnected(true);
            if (channel) {
                supabase.removeChannel(channel);
            }
        };
    }, [
        bufferEvent,
        denormalizedInboxRealtimeEnabled,
        realtimeEnabled,
        queryClient,
        realtimeToken,
        refreshTrackedConversations,
        scheduleConversationSummaryRefresh,
        scheduleUnreadRefresh,
        scheduleInboxRefresh,
        userId,
    ]);

    useEffect(() => {
        if (!realtimeEnabled || !activeConversationId || !realtimeToken) {
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
                            if (payload.eventType === 'DELETE') {
                                queueThreadMessageSync(activeConversationId, payload);
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
                                patchConversationLastMessageFromMessage(queryClient, activeConversationId, nextMessage);
                                return;
                            }

                            if (!hasCachedThreadMessage(queryClient, activeConversationId, nextMessage.id) || nextMessage.deletedAt) {
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
                        handler: () => {
                            if (denormalizedInboxRealtimeEnabled) {
                                scheduleConversationSummaryRefresh(activeConversationId, { syncThread: true });
                            } else {
                                scheduleInboxRefresh();
                            }
                            scheduleUnreadRefresh();
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
            }
        };
    }, [
        activeConversationId,
        applyReceiptPatch,
        denormalizedInboxRealtimeEnabled,
        queueThreadMessageSync,
        queryClient,
        realtimeEnabled,
        realtimeToken,
        refreshMessageReactionSummary,
        scheduleInboxRefresh,
        scheduleConversationSummaryRefresh,
        scheduleUnreadRefresh,
    ]);

    useEffect(() => {
        pendingThreadMessageEventsRef.current.clear();
        if (threadMessageSyncTimerRef.current) {
            clearTimeout(threadMessageSyncTimerRef.current);
            threadMessageSyncTimerRef.current = null;
        }
    }, [activeConversationId]);

    // Wave 2 Step 11: subscribe to the active conversation's presence room
    // and listen for `receipt.broadcast` events. When a peer's client signals
    // delivered or read, immediately patch the thread cache so the sender's
    // delivery tick advances within ~100 ms — before postgres_changes fires.
    // This is purely additive; the postgres_changes subscriber in the effect
    // above provides durability (idempotent re-application is safe since
    // applyReceiptPatch never downgrades state).
    useEffect(() => {
        if (!realtimeEnabled || !activeConversationId || !userId) return;

        const subscription = subscribePresenceRoom({
            roomType: 'conversation',
            roomId: activeConversationId,
            role: 'viewer',
            onEvent: (event) => {
                if (event.type !== 'receipt.broadcast') return;
                if (event.roomId !== activeConversationId) return;

                const kind = event.receiptType;
                for (const messageId of event.messageIds) {
                    applyReceiptPatch(activeConversationId, messageId, kind);
                }
            },
        });

        return () => {
            subscription.unsubscribe();
        };
    }, [activeConversationId, applyReceiptPatch, realtimeEnabled, userId]);

    useEffect(() => {
        return () => {
            if (inboxRefreshTimerRef.current) {
                clearTimeout(inboxRefreshTimerRef.current);
            }
            if (threadRefreshTimerRef.current) {
                clearTimeout(threadRefreshTimerRef.current);
            }
            if (unreadRefreshTimerRef.current) {
                clearTimeout(unreadRefreshTimerRef.current);
            }
            if (summaryRefreshTimerRef.current) {
                clearTimeout(summaryRefreshTimerRef.current);
                summaryRefreshTimerRef.current = null;
            }
            if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
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
        inboxRealtimeConnected,
        activeThreadConnected,
        isDegraded: enabled && (!inboxRealtimeConnected || (Boolean(activeConversationId) && !activeThreadConnected)),
    }), [activeConversationId, activeThreadConnected, enabled, inboxRealtimeConnected]);
}
