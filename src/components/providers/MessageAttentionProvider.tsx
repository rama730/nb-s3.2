"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getUnreadCount } from "@/app/actions/messaging";
import { getConversationSummariesV2 } from "@/app/actions/messaging/v2";
import { useAuth } from "@/hooks/useAuth";
import { shouldRefreshInboxSummary, shouldRefreshUnreadSummary } from "@/lib/messages/unread-realtime";
import { hasCachedInboxData, upsertInboxConversation } from "@/lib/messages/v2-cache";
import { queryKeys } from "@/lib/query-keys";
import { useRealtime } from "@/components/providers/RealtimeProvider";

type MessageAttentionContextValue = {
    unreadCount: number;
    hasUnreadMessages: boolean;
};

const EMPTY_MESSAGE_ATTENTION: MessageAttentionContextValue = {
    unreadCount: 0,
    hasUnreadMessages: false,
};

function getParticipantConversationId(payload: unknown) {
    if (!payload || typeof payload !== "object") return null;
    const conversationId = (payload as Record<string, unknown>).conversation_id;
    return typeof conversationId === "string" ? conversationId : null;
}

const MessageAttentionContext = createContext<MessageAttentionContextValue>(EMPTY_MESSAGE_ATTENTION);

/**
 * Keeps the small, authoritative message unread summary available without
 * loading the inbox or the chat popup.
 */
export function MessageAttentionProvider({ children }: { children: React.ReactNode }) {
    const queryClient = useQueryClient();
    const { user, isAuthenticated } = useAuth();
    const { isMessagingConnected, subscribeMessagingNotifications } = useRealtime();
    const refreshTimerRef = useRef<number | null>(null);
    const inboxRefreshTimerRef = useRef<number | null>(null);
    const hasCachedSummaryRef = useRef(false);
    const activeUserIdRef = useRef<string | null>(user?.id ?? null);
    const participantStatesRef = useRef(new Map<string, string>());
    const inboxParticipantStatesRef = useRef(new Map<string, string>());
    const pendingInboxConversationIdsRef = useRef(new Set<string>());
    const enabled = Boolean(isAuthenticated && user?.id);
    // ponytail: this key participates in effects below, so it must not create
    // a new array on each query-driven render.
    const unreadQueryKey = useMemo(() => queryKeys.messages.v2.unread(), []);

    const unreadQuery = useQuery<number>({
        queryKey: unreadQueryKey,
        enabled,
        queryFn: async () => {
            const result = await getUnreadCount();
            if (!result.success || typeof result.count !== "number") {
                throw new Error(result.error || "Failed to load unread message count");
            }
            return Math.max(0, result.count);
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
    });

    useEffect(() => {
        const nextUserId = user?.id ?? null;
        if (activeUserIdRef.current === nextUserId) return;
        activeUserIdRef.current = nextUserId;
        hasCachedSummaryRef.current = false;
        participantStatesRef.current.clear();
        inboxParticipantStatesRef.current.clear();
        pendingInboxConversationIdsRef.current.clear();
        if (inboxRefreshTimerRef.current) {
            window.clearTimeout(inboxRefreshTimerRef.current);
            inboxRefreshTimerRef.current = null;
        }
        // ponytail: this cache key predates user-scoped query keys; reset it on
        // identity changes instead of duplicating every existing cache mutation.
        void queryClient.resetQueries({ queryKey: unreadQueryKey });
    }, [queryClient, unreadQueryKey, user?.id]);

    useEffect(() => {
        hasCachedSummaryRef.current = unreadQuery.dataUpdatedAt > 0;
    }, [unreadQuery.dataUpdatedAt]);

    const scheduleRefresh = useCallback(() => {
        if (!enabled || refreshTimerRef.current) return;
        refreshTimerRef.current = window.setTimeout(() => {
            refreshTimerRef.current = null;
            void queryClient.invalidateQueries({ queryKey: unreadQueryKey });
        }, 180);
    }, [enabled, queryClient, unreadQueryKey]);

    const scheduleInboxRefresh = useCallback((conversationId?: string | null) => {
        if (!enabled || !hasCachedInboxData(queryClient)) return;
        // A reconnect has no single affected conversation. Mark the cached list
        // stale so its next visible observer performs one authoritative fetch.
        if (!conversationId) {
            void queryClient.invalidateQueries({ queryKey: ["chat-v2", "inbox"] });
            return;
        }
        pendingInboxConversationIdsRef.current.add(conversationId);
        if (inboxRefreshTimerRef.current) return;

        inboxRefreshTimerRef.current = window.setTimeout(() => {
            inboxRefreshTimerRef.current = null;
            const conversationIds = Array.from(pendingInboxConversationIdsRef.current);
            pendingInboxConversationIdsRef.current.clear();
            void getConversationSummariesV2(conversationIds).then((result) => {
                if (!result.success) return;
                for (const conversation of result.conversations ?? []) {
                    upsertInboxConversation(queryClient, conversation);
                }
            }).catch(() => {
                // The next focus/reconnect reconciliation will retry; a failed
                // background sync must never interrupt message attention.
            });
        }, 180);
    }, [enabled, queryClient]);

    useEffect(() => {
        if (!enabled) {
            hasCachedSummaryRef.current = false;
            participantStatesRef.current.clear();
            inboxParticipantStatesRef.current.clear();
            pendingInboxConversationIdsRef.current.clear();
            if (inboxRefreshTimerRef.current) {
                window.clearTimeout(inboxRefreshTimerRef.current);
                inboxRefreshTimerRef.current = null;
            }
            queryClient.removeQueries({ queryKey: unreadQueryKey });
            return;
        }

        return subscribeMessagingNotifications((event) => {
            if (shouldRefreshUnreadSummary(event, participantStatesRef.current)) {
                scheduleRefresh();
            }
            if (shouldRefreshInboxSummary(event, inboxParticipantStatesRef.current)) {
                scheduleInboxRefresh(
                    getParticipantConversationId(event.payload.new)
                    ?? getParticipantConversationId(event.payload.old),
                );
            }
        });
    }, [enabled, queryClient, scheduleInboxRefresh, scheduleRefresh, subscribeMessagingNotifications, unreadQueryKey]);

    useEffect(() => {
        // The initial query is already in flight when the channel first joins.
        // Reconciliations are only needed after a previously populated channel reconnects.
        if (isMessagingConnected && hasCachedSummaryRef.current) {
            scheduleRefresh();
            scheduleInboxRefresh();
        }
    }, [isMessagingConnected, scheduleInboxRefresh, scheduleRefresh]);

    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") scheduleRefresh();
        };
        const onOnline = () => scheduleRefresh();
        document.addEventListener("visibilitychange", onVisibilityChange);
        window.addEventListener("online", onOnline);
        return () => {
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.removeEventListener("online", onOnline);
        };
    }, [scheduleRefresh]);

    useEffect(() => () => {
        if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
        if (inboxRefreshTimerRef.current) window.clearTimeout(inboxRefreshTimerRef.current);
    }, []);

    const value = useMemo<MessageAttentionContextValue>(() => {
        const unreadCount = enabled ? Math.max(0, unreadQuery.data ?? 0) : 0;
        return { unreadCount, hasUnreadMessages: unreadCount > 0 };
    }, [enabled, unreadQuery.data]);

    return (
        <MessageAttentionContext.Provider value={value}>
            {children}
        </MessageAttentionContext.Provider>
    );
}

export function useMessageAttention() {
    return useContext(MessageAttentionContext);
}
