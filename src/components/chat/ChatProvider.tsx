'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useChatStore } from '@/stores/chatStore';
import { useChatRealtime } from '@/hooks/useChatRealtime';
import { ChatPopup } from './ChatPopup';

// ============================================================================
// CHAT PROVIDER
// Wraps app at root layout to manage chat state and realtime subscriptions
// ============================================================================

interface ChatProviderProps {
    children: React.ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
    const { user, isLoading } = useAuth();
    const initialize = useChatStore(state => state.initialize);
    const flushOutbox = useChatStore(state => state.flushOutbox);
    const refreshMessages = useChatStore(state => state.refreshMessages);
    const refreshConversations = useChatStore(state => state.refreshConversations);
    const isConnected = useChatStore(state => state.isConnected);
    const activeConversationId = useChatStore(state => state.activeConversationId);
    const lastMediaRefreshRef = useRef<Map<string, number>>(new Map());

    // Initialize chat when user is available
    useEffect(() => {
        if (user && !isLoading) {
            initialize();
            void flushOutbox();
        }
    }, [user, isLoading, initialize, flushOutbox]);

    useEffect(() => {
        if (!user) return;

        const onOnline = () => {
            void flushOutbox();
        };

        const timer = window.setInterval(() => {
            void flushOutbox();
        }, 10_000);

        window.addEventListener('online', onOnline);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('online', onOnline);
        };
    }, [user, flushOutbox]);

    // Fallback sync when websocket is temporarily disconnected.
    // Keeps message delivery near-real-time without heavy polling.
    useEffect(() => {
        if (!user || isConnected) return;

        const timer = window.setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            void refreshConversations();
            if (activeConversationId) {
                void refreshMessages(activeConversationId);
            }
        }, 5000);

        return () => {
            window.clearInterval(timer);
        };
    }, [user, isConnected, activeConversationId, refreshConversations, refreshMessages]);

    // Refresh signed attachment URLs for the active conversation only.
    // Keeps media valid on long-lived tabs without reloading the whole app.
    useEffect(() => {
        if (!user) return;

        const timer = window.setInterval(() => {
            // Read fresh state inside the interval to avoid stale closures
            const state = useChatStore.getState();
            const convId = state.activeConversationId;
            if (!convId) return;
            const cache = state.messagesByConversation[convId];
            if (!cache?.messages?.length) return;

            const hasAttachment = cache.messages.some(
                (message) => Array.isArray(message.attachments) && message.attachments.length > 0
            );
            if (!hasAttachment) return;

            const now = Date.now();
            const lastRefresh = lastMediaRefreshRef.current.get(convId) || 0;
            if (now - lastRefresh < 4 * 60 * 1000) return;

            lastMediaRefreshRef.current.set(convId, now);
            void refreshMessages(convId);
        }, 60 * 1000);

        return () => {
            window.clearInterval(timer);
        };
    }, [user, refreshMessages]);

    // Setup realtime subscription
    useChatRealtime(user?.id || null);

    return (
        <>
            {children}
            {/* Chat popup is always mounted for persistence */}
            {user && <ChatPopup />}
        </>
    );
}
