'use client';

import { useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useChatStore } from '@/stores/chatStore';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ============================================================================
// REALTIME CHAT HOOK - FINAL OPTIMIZED ARCHITECTURE
// Pure Performance | Zero Redundancy | Robust State Sync
// ============================================================================

export function useChatRealtime(userId: string | null) {
    const channelRef = useRef<RealtimeChannel | null>(null);
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const messageRefreshTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    // Store Selectors (Stable references)
    const setConnected = useChatStore(state => state.setConnected);
    const checkActiveConnectionStatus = useChatStore(state => state.checkActiveConnectionStatus);

    const scheduleConversationRefresh = useCallback(() => {
        if (refreshTimerRef.current) return;

        // Burst protection: collapse rapid participant updates into one refresh.
        refreshTimerRef.current = setTimeout(() => {
            refreshTimerRef.current = null;
            void useChatStore.getState().refreshConversations();
        }, 150);
    }, []);

    const scheduleMessageRefresh = useCallback((conversationId?: string | null) => {
        if (!conversationId) return;

        const existingTimer = messageRefreshTimersRef.current.get(conversationId);
        if (existingTimer) return;

        const timer = setTimeout(() => {
            messageRefreshTimersRef.current.delete(conversationId);
            const state = useChatStore.getState();
            const isActive = state.activeConversationId === conversationId;
            const hasCache = Boolean(state.messagesByConversation[conversationId]);

            if (!isActive && !hasCache) return;

            void state.refreshMessages(conversationId);
            if (isActive) {
                void state.markAsRead(conversationId);
            }
        }, 120);

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
        console.log('[REALTIME] Initializing Optimized Connection...');

        const handleParticipantUpdate = (payload: any) => {
            const conversationId = (payload?.new?.conversation_id || payload?.old?.conversation_id) as string | undefined;
            scheduleConversationRefresh();
            scheduleMessageRefresh(conversationId);

            if (!conversationId) return;

            const state = useChatStore.getState();
            if (state.activeConversationId === conversationId) {
                void state.markAsRead(conversationId);
            }
        };

        const handleMessageInsert = (payload: any) => {
            const conversationId = payload?.new?.conversation_id as string | undefined;
            if (payload?.new) {
                useChatStore.getState()._handleNewMessage(payload.new, userId);
            }
            scheduleMessageRefresh(conversationId);
        };

        const handleMessageUpdate = (payload: any) => {
            const conversationId = (payload?.new?.conversation_id || payload?.old?.conversation_id) as string | undefined;
            if (payload?.new) {
                useChatStore.getState()._handleMessageUpdate(payload.new);
            }
            scheduleMessageRefresh(conversationId);
        };

        const handleAttachmentChange = (payload: any) => {
            const messageId = (payload?.new?.message_id || payload?.old?.message_id) as string | undefined;
            const conversationId = findConversationIdByMessageId(messageId);
            scheduleMessageRefresh(conversationId);
        };

        const handleMessageVisibilityChange = (payload: any) => {
            const messageId = (payload?.new?.message_id || payload?.old?.message_id) as string | undefined;
            const conversationId = findConversationIdByMessageId(messageId);
            scheduleMessageRefresh(conversationId);
            scheduleConversationRefresh();
        };

        const channel = supabase.channel(`user-${userId}`)
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
                if (status === 'SUBSCRIBED') setConnected(true);
                else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setConnected(false);
            });

        channelRef.current = channel;

        // Cleanup
        return () => {
            const messageRefreshTimers = messageRefreshTimersRef.current;
            setConnected(false);
            if (refreshTimerRef.current) {
                clearTimeout(refreshTimerRef.current);
                refreshTimerRef.current = null;
            }
            messageRefreshTimers.forEach(clearTimeout);
            messageRefreshTimers.clear();
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
    ]);

    return null;
}
