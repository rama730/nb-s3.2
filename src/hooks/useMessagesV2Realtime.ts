'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { playMessageSound } from '@/lib/messages/notification-sound';
import {
    getConversationSummaryV2,
    getConversationThreadPageV2,
    getUnreadSummaryV2,
} from '@/app/actions/messaging/v2';
import {
    getCachedInboxConversationIds,
    hasCachedThreadMessage,
    hideThreadMessageForViewer,
    isCachedConversationLastMessage,
    replaceThreadSnapshot,
    setUnreadSummary,
    upsertInboxConversation,
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
                            scheduleConversationSummaryRefresh(conversationId, { syncThread: conversationId === currentActiveId });
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
                            queueThreadMessageSync(activeConversationId, payload);
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
                                scheduleThreadRefresh(activeConversationId);
                            }
                            scheduleUnreadRefresh();
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
        bufferEvent,
        denormalizedInboxRealtimeEnabled,
        flushPendingThreadMessageEvents,
        queueThreadMessageSync,
        realtimeEnabled,
        realtimeToken,
        scheduleInboxRefresh,
        scheduleConversationSummaryRefresh,
        scheduleUnreadRefresh,
        scheduleThreadRefresh,
    ]);

    useEffect(() => {
        pendingThreadMessageEventsRef.current.clear();
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
