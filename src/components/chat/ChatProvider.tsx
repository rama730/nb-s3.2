'use client';

import { useEffect } from 'react';
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

    // Initialize chat when user is available
    useEffect(() => {
        if (user && !isLoading) {
            initialize();
        }
    }, [user, isLoading, initialize]);

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
