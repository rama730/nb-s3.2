'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { playMessageSound } from '@/lib/messages/notification-sound';
import {
    getConversationSummaryV2,
    getConversationThreadPageV2,
    getMessageContextV2,
    getUnreadSummaryV2,
} from '@/app/actions/messaging/v2';
import {
    getCachedInboxConversationIds,
    hasCachedThreadMessage,
    hideThreadMessageForViewer,
    removeThreadMessage,
    replaceThreadSnapshot,
    setUnreadSummary,
    upsertInboxConversation,
    upsertThreadConversation,
    upsertThreadMessage,
} from '@/lib/messages/v2-cache';
import {
    isRealtimeTerminalStatus,
    subscribeActiveResource,
    subscribeMessagingNotifications,
} from '@/lib/realtime/subscriptions';
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

export function useMessagesV2Realtime(
    activeConversationId: string | null,
    trackedConversationIds: ReadonlyArray<string> = [],
    enabled: boolean,
) {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const userId = user?.id ?? null;
    const [inboxRealtimeConnected, setInboxRealtimeConnected] = useState(true);
    const [activeThreadConnected, setActiveThreadConnected] = useState(true);
    const inboxRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const threadRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inboxConnectionTokenRef = useRef(0);
    const activeThreadConnectionTokenRef = useRef(0);
    const activeConversationIdRef = useRef(activeConversationId);
    activeConversationIdRef.current = activeConversationId;
    const eventBufferRef = useRef<Array<() => void>>([]);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const bufferEvent = useCallback((handler: () => void) => {
        eventBufferRef.current.push(handler);
        if (flushTimerRef.current) return;
        flushTimerRef.current = setTimeout(() => {
            const batch = eventBufferRef.current.splice(0);
            flushTimerRef.current = null;
            for (const fn of batch) fn();
        }, 200);
    }, []);

    const inboxConversationIds = useMemo(
        () => Array.from(new Set(
            trackedConversationIds.filter((conversationId) =>
                Boolean(conversationId) && conversationId !== activeConversationId,
            ),
        )),
        [activeConversationId, trackedConversationIds],
    );

    const refreshUnreadSummary = useCallback(async () => {
        const result = await getUnreadSummaryV2();
        if (result.success && typeof result.count === 'number') {
            setUnreadSummary(queryClient, result.count);
        }
    }, [queryClient]);

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

    const syncThreadMessage = useCallback(async (conversationId: string, messageId: string) => {
        const result = await getMessageContextV2(conversationId, messageId);
        if (!result.success) {
            scheduleThreadRefresh(conversationId);
            return;
        }

        if (!result.available || !result.message) {
            removeThreadMessage(queryClient, conversationId, messageId);
            void refreshConversationSummary(conversationId, { syncThread: conversationId === activeConversationIdRef.current });
            return;
        }

        upsertThreadMessage(queryClient, conversationId, result.message);
        await refreshConversationSummary(conversationId, { syncThread: conversationId === activeConversationIdRef.current });
    }, [queryClient, refreshConversationSummary, scheduleThreadRefresh]);

    useEffect(() => {
        if (!enabled || !userId) {
            inboxConnectionTokenRef.current += 1;
            setInboxRealtimeConnected(true);
            return;
        }

        const supabase = createClient();
        const connectionToken = inboxConnectionTokenRef.current + 1;
        inboxConnectionTokenRef.current = connectionToken;
        setInboxRealtimeConnected(true);

        const channel = subscribeMessagingNotifications({
            supabase,
            userId,
            onEvent: (event) => {
                const currentActiveId = activeConversationIdRef.current;
                if (event.kind === 'conversation_participant') {
                    const conversationId = getPayloadConversationId(event.payload);
                    if (conversationId) {
                        bufferEvent(() => void refreshConversationSummary(conversationId, { syncThread: conversationId === currentActiveId }));
                        bufferEvent(() => void refreshUnreadSummary());
                        // Play notification sound for new messages when tab is hidden
                        if (conversationId !== currentActiveId && typeof document !== 'undefined' && document.hidden) {
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

                scheduleInboxRefresh();
                const messageId = getPayloadHiddenMessageId(event.payload);
                if (!currentActiveId || !messageId) {
                    // Play notification sound for new messages when tab is hidden
                    if (typeof document !== 'undefined' && document.hidden) {
                        playMessageSound();
                    }
                    return;
                }

                if (!hasCachedThreadMessage(queryClient, currentActiveId, messageId)) {
                    return;
                }

                hideThreadMessageForViewer(queryClient, currentActiveId, messageId);
                bufferEvent(() => void refreshConversationSummary(currentActiveId, { syncThread: true }));
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

        return () => {
            inboxConnectionTokenRef.current += 1;
            setInboxRealtimeConnected(true);
            supabase.removeChannel(channel);
        };
    }, [
        bufferEvent,
        enabled,
        queryClient,
        refreshTrackedConversations,
        refreshUnreadSummary,
        refreshConversationSummary,
        scheduleInboxRefresh,
        userId,
    ]);

    useEffect(() => {
        if (!enabled || !activeConversationId) {
            activeThreadConnectionTokenRef.current += 1;
            setActiveThreadConnected(true);
            return;
        }

        const supabase = createClient();
        const connectionToken = activeThreadConnectionTokenRef.current + 1;
        activeThreadConnectionTokenRef.current = connectionToken;
        setActiveThreadConnected(true);
        const channel = subscribeActiveResource({
            supabase,
            resourceType: 'conversation',
            resourceId: activeConversationId,
            bindings: [
                {
                    event: '*',
                    table: 'messages',
                    filter: `conversation_id=eq.${activeConversationId}`,
                    handler: (payload) => {
                        const messageId = getPayloadMessageId(payload);
                        if (!messageId) {
                            scheduleThreadRefresh(activeConversationId);
                            return;
                        }
                        bufferEvent(() => void syncThreadMessage(activeConversationId, messageId));
                    },
                },
                {
                    event: '*',
                    table: 'conversation_participants',
                    filter: `conversation_id=eq.${activeConversationId}`,
                    handler: () => {
                        bufferEvent(() => void refreshConversationSummary(activeConversationId, { syncThread: true }));
                        bufferEvent(() => void refreshUnreadSummary());
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

        return () => {
            activeThreadConnectionTokenRef.current += 1;
            setActiveThreadConnected(true);
            supabase.removeChannel(channel);
        };
    }, [
        activeConversationId,
        bufferEvent,
        enabled,
        refreshUnreadSummary,
        refreshConversationSummary,
        syncThreadMessage,
    ]);

    useEffect(() => {
        if (!enabled || inboxConversationIds.length === 0) return;

        const supabase = createClient();
        const channels = inboxConversationIds.map((conversationId) =>
            subscribeActiveResource({
                supabase,
                resourceType: 'conversation',
                resourceId: `${conversationId}:sidebar`,
                bindings: [
                    {
                        event: '*',
                        table: 'messages',
                        filter: `conversation_id=eq.${conversationId}`,
                        handler: () => {
                            bufferEvent(() => void refreshConversationSummary(conversationId));
                            // Play notification sound for new messages when tab is hidden
                            if (typeof document !== 'undefined' && document.hidden) {
                                playMessageSound();
                            }
                        },
                    },
                ],
            }),
        );

        return () => {
            channels.forEach((channel) => {
                supabase.removeChannel(channel);
            });
        };
    }, [bufferEvent, enabled, inboxConversationIds, refreshConversationSummary]);

    useEffect(() => {
        return () => {
            if (inboxRefreshTimerRef.current) {
                clearTimeout(inboxRefreshTimerRef.current);
            }
            if (threadRefreshTimerRef.current) {
                clearTimeout(threadRefreshTimerRef.current);
            }
            if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
            }
        };
    }, []);

    return useMemo(() => ({
        inboxRealtimeConnected,
        activeThreadConnected,
        isDegraded: enabled && (!inboxRealtimeConnected || (Boolean(activeConversationId) && !activeThreadConnected)),
    }), [activeConversationId, activeThreadConnected, enabled, inboxRealtimeConnected]);
}
