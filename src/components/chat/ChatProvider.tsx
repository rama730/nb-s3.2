'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useChatStore } from '@/stores/chatStore';
import { useChatRealtime } from '@/hooks/useChatRealtime';
import { ChatPopup } from './ChatPopup';
import { createVisibilityAwareInterval } from '@/lib/utils/visibility';

interface ChatProviderProps {
    children?: React.ReactNode;
}

const DISABLE_CHAT_IN_E2E = process.env.NEXT_PUBLIC_E2E_AUTH_FALLBACK === "1";

export function ChatProvider({ children = null }: ChatProviderProps) {
    if (DISABLE_CHAT_IN_E2E) {
        return <>{children}</>;
    }
    return <ChatProviderInner>{children}</ChatProviderInner>;
}

function ChatProviderInner({ children = null }: ChatProviderProps) {

    const { user, isLoading } = useAuth();
    const initialize = useChatStore(state => state.initialize);
    const flushOutbox = useChatStore(state => state.flushOutbox);
    const refreshMessages = useChatStore(state => state.refreshMessages);
    const refreshConversations = useChatStore(state => state.refreshConversations);
    const isConnected = useChatStore(state => state.isConnected);
    const activeConversationId = useChatStore(state => state.activeConversationId);
    const activeConversationCache = useChatStore(state =>
        state.activeConversationId ? state.messagesByConversation[state.activeConversationId] : undefined
    );
    const lastMediaRefreshRef = useRef<Map<string, number>>(new Map());

    useEffect(() => {
        if (user && !isLoading) {
            initialize();
            void flushOutbox();
        }
    }, [user, isLoading, initialize, flushOutbox]);

    // Outbox flush with visibility-aware interval
    useEffect(() => {
        if (!user) return;

        const onOnline = () => void flushOutbox();
        window.addEventListener('online', onOnline);

        const cleanup = createVisibilityAwareInterval(() => {
            void flushOutbox();
        }, 10_000);

        return () => {
            cleanup();
            window.removeEventListener('online', onOnline);
        };
    }, [user, flushOutbox]);

    // Fallback sync when websocket is temporarily disconnected
    useEffect(() => {
        if (!user || isConnected) return;

        const cleanup = createVisibilityAwareInterval(() => {
            void refreshConversations();
            if (activeConversationId) {
                void refreshMessages(activeConversationId);
            }
        }, 5000);

        return () => cleanup();
    }, [user, isConnected, activeConversationId, refreshConversations, refreshMessages]);

    // Refresh signed attachment URLs for the active conversation
    useEffect(() => {
        if (!user) return;

        const cleanup = createVisibilityAwareInterval(() => {
            if (!activeConversationId) return;
            const cache = activeConversationCache;
            if (!cache?.messages?.length) return;

            const hasAttachment = cache.messages.some(
                (message) => Array.isArray(message.attachments) && message.attachments.length > 0
            );
            if (!hasAttachment) return;

            const now = Date.now();
            const lastRefresh = lastMediaRefreshRef.current.get(activeConversationId) || 0;
            if (now - lastRefresh < 4 * 60 * 1000) return;

            lastMediaRefreshRef.current.set(activeConversationId, now);
            void refreshMessages(activeConversationId);
        }, 60_000);

        return () => cleanup();
    }, [user, activeConversationId, activeConversationCache, refreshMessages]);

    useChatRealtime(user?.id || null);

    return (
        <>
            {children}
            {user && <ChatPopup />}
        </>
    );
}
