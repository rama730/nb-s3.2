'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useChatStore } from '@/stores/chatStore';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { ConversationRefreshReason, MessageRefreshReason } from '@/lib/realtime/refresh-reasons';

// ============================================================================
// REALTIME CHAT HOOK - FINAL OPTIMIZED ARCHITECTURE
// Pure Performance | Zero Redundancy | Robust State Sync
// ============================================================================

export function useChatRealtime(userId: string | null) {
    const channelRef = useRef<RealtimeChannel | null>(null);
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastConversationRefreshAtRef = useRef(0);
    const messageRefreshTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const pendingConversationReasonsRef = useRef<Set<ConversationRefreshReason>>(new Set());
    const pendingMessageReasonsRef = useRef<Map<string, Set<MessageRefreshReason>>>(new Map());
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const [reconnectNonce, setReconnectNonce] = useState(0);

    // Store Selectors (Stable references)
    const setConnected = useChatStore(state => state.setConnected);
    const checkActiveConnectionStatus = useChatStore(state => state.checkActiveConnectionStatus);

    const scheduleConversationRefresh = useCallback((reason: ConversationRefreshReason) => {
        pendingConversationReasonsRef.current.add(reason);
        if (refreshTimerRef.current) return;
        const elapsed = Date.now() - lastConversationRefreshAtRef.current;
        const delay = elapsed >= 600 ? 140 : 600 - elapsed;
        // Burst protection: collapse rapid participant updates into one refresh.
        refreshTimerRef.current = setTimeout(() => {
            refreshTimerRef.current = null;
            lastConversationRefreshAtRef.current = Date.now();
            pendingConversationReasonsRef.current.clear();
            void useChatStore.getState().refreshConversations();
        }, delay);
    }, []);

    const scheduleMessageRefresh = useCallback((conversationId: string | null | undefined, reason: MessageRefreshReason) => {
        if (!conversationId) return;

        const state = useChatStore.getState();
        const isActive = state.activeConversationId === conversationId;
        const hasCache = Boolean(state.messagesByConversation[conversationId]);
        if (!isActive && !hasCache) return;

        const reasonsForConversation = pendingMessageReasonsRef.current.get(conversationId) || new Set<MessageRefreshReason>();
        reasonsForConversation.add(reason);
        pendingMessageReasonsRef.current.set(conversationId, reasonsForConversation);

        const existingTimer = messageRefreshTimersRef.current.get(conversationId);
        if (existingTimer) return;

        const timer = setTimeout(() => {
            messageRefreshTimersRef.current.delete(conversationId);
            const nextState = useChatStore.getState();
            const stillActive = nextState.activeConversationId === conversationId;
            const stillCached = Boolean(nextState.messagesByConversation[conversationId]);
            if (!stillActive && !stillCached) return;

            void nextState.refreshMessages(conversationId);

            pendingMessageReasonsRef.current.delete(conversationId);
        }, 180);

        messageRefreshTimersRef.current.set(conversationId, timer);
    }, []);

    const findConversationIdByMessageId = useCallback((messageId?: string | null) => {
        if (!messageId) return null;

        const state = useChatStore.getState();
        for (const [conversationId, cache] of Object.entries(state.messagesByConversation)) {
            if (cache.messages.some(message => message.id === messageId)) {
                return conversationId;
            }
        }
        return null;
    }, []);
    // ------------------------------------------------------------------------
    // Main Subscription Effect
    // ------------------------------------------------------------------------
    useEffect(() => {
        if (!userId) {
            setConnected(false);
            return;
        }

        const supabase = createClient();
        type DbChangePayload = {
            new?: Record<string, unknown>;
            old?: Record<string, unknown>;
        };

        const toNumber = (value: unknown) => {
            if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
            if (typeof value === 'string') {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : 0;
            }
            return 0;
        };

        const handleParticipantUpdate = (payload: DbChangePayload) => {
            const conversationId = (payload?.new?.conversation_id || payload?.old?.conversation_id) as string | undefined;
            if (!conversationId) return;

            const newUnread = toNumber(payload?.new?.unread_count ?? payload?.new?.unreadCount);
            const oldUnread = toNumber(payload?.old?.unread_count ?? payload?.old?.unreadCount);
            const unreadChanged = newUnread !== oldUnread;
            const membershipChanged =
                payload?.new?.archived_at !== payload?.old?.archived_at ||
                payload?.new?.muted !== payload?.old?.muted ||
                payload?.new?.conversation_id !== payload?.old?.conversation_id;

            if (membershipChanged) {
                scheduleConversationRefresh('participant_membership');
            } else if (unreadChanged) {
                scheduleConversationRefresh('participant_unread_delta');
            }

            const state = useChatStore.getState();
            if (state.activeConversationId === conversationId && newUnread > 0) {
                void state.markAsRead(conversationId);
            }
        };

        const handleMessageInsert = (payload: DbChangePayload) => {
            const conversationId = payload?.new?.conversation_id as string | undefined;
            if (payload?.new) {
                useChatStore.getState()._handleNewMessage(payload.new, userId);
            }
            if (!conversationId) return;
            const state = useChatStore.getState();
            const isActive = state.activeConversationId === conversationId;
            const hasCache = Boolean(state.messagesByConversation[conversationId]);
            if (!isActive && !hasCache) {
                scheduleConversationRefresh('message_unknown');
            }
            if (isActive) {
                void state.markAsRead(conversationId);
            }
        };

        const handleMessageUpdate = (payload: DbChangePayload) => {
            const conversationId = (payload?.new?.conversation_id || payload?.old?.conversation_id) as string | undefined;
            const messageId = (payload?.new?.id || payload?.old?.id) as string | undefined;
            if (payload?.new) {
                useChatStore.getState()._handleMessageUpdate(payload.new);
            }
            if (!conversationId || !messageId) return;

            const state = useChatStore.getState();
            const cache = state.messagesByConversation[conversationId];
            const hasLocalMessage = Boolean(cache?.messages.some(message => message.id === messageId));
            if (!hasLocalMessage) {
                scheduleMessageRefresh(conversationId, 'message_update_miss');
            }
        };

        const handleAttachmentChange = (payload: DbChangePayload) => {
            const messageId = (payload?.new?.message_id || payload?.old?.message_id) as string | undefined;
            const conversationId = findConversationIdByMessageId(messageId);
            scheduleMessageRefresh(conversationId, 'attachment_change');
        };

        const handleMessageVisibilityChange = (payload: DbChangePayload) => {
            const messageId = (payload?.new?.message_id || payload?.old?.message_id) as string | undefined;
            const conversationId = findConversationIdByMessageId(messageId);
            scheduleMessageRefresh(conversationId, 'visibility_change');
            scheduleConversationRefresh('visibility_change');
        };

        const scheduleReconnect = (reason: string) => {
            if (reconnectTimerRef.current) return;
            const backoffMs = Math.min(10_000, 800 * Math.max(1, reconnectAttemptsRef.current + 1));
            reconnectTimerRef.current = setTimeout(() => {
                reconnectTimerRef.current = null;
                reconnectAttemptsRef.current += 1;
                setReconnectNonce((value) => value + 1);
            }, backoffMs);
            setConnected(false, `Realtime disconnected (${reason}). Reconnecting...`);
        };

        const channel = supabase.channel(`user-${userId}-${reconnectNonce}`)
            // 1. Conversation updates scoped to the authenticated user only.
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${userId}` },
                handleParticipantUpdate
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${userId}` },
                handleParticipantUpdate
            )
            // 2. Message stream (receiver + sender updates under RLS)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                handleMessageInsert
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'messages' },
                handleMessageUpdate
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'message_attachments' },
                handleAttachmentChange
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'message_edit_logs' },
                handleMessageVisibilityChange
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'message_hidden_for_users', filter: `user_id=eq.${userId}` },
                handleMessageVisibilityChange
            )
            // 2. Connection Status
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'connections', filter: `requester_id=eq.${userId}` },
                () => checkActiveConnectionStatus()
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'connections', filter: `addressee_id=eq.${userId}` },
                () => checkActiveConnectionStatus()
            )
            .subscribe((status: string) => {
                if (status === 'SUBSCRIBED') {
                    reconnectAttemptsRef.current = 0;
                    if (reconnectTimerRef.current) {
                        clearTimeout(reconnectTimerRef.current);
                        reconnectTimerRef.current = null;
                    }
                    setConnected(true);
                    return;
                }
                if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    scheduleReconnect(status.toLowerCase());
                }
            });

        channelRef.current = channel;
        const messageRefreshTimers = messageRefreshTimersRef.current;
        const pendingConversationReasons = pendingConversationReasonsRef.current;
        const pendingMessageReasons = pendingMessageReasonsRef.current;

        // Cleanup
        return () => {
            setConnected(false);
            if (refreshTimerRef.current) {
                clearTimeout(refreshTimerRef.current);
                refreshTimerRef.current = null;
            }
            pendingConversationReasons.clear();
            messageRefreshTimers.forEach(clearTimeout);
            messageRefreshTimers.clear();
            pendingMessageReasons.clear();
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
        };
    }, [
        userId,
        setConnected,
        scheduleConversationRefresh,
        scheduleMessageRefresh,
        findConversationIdByMessageId,
        checkActiveConnectionStatus,
        reconnectNonce,
    ]);

    return null;
}
