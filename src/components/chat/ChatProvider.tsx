'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { ChatPopupV2 } from './v2/ChatPopupV2';
import { useMessagesV2OutboxSync } from '@/hooks/useMessagesV2OutboxSync';
import { useRealtime } from '@/components/providers/RealtimeProvider';
import { playMessageSound } from '@/lib/messages/notification-sound';
import { queryKeys } from '@/lib/query-keys';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';

interface ChatProviderProps {
    children?: React.ReactNode;
}

const DISABLE_CHAT_IN_E2E = process.env.NEXT_PUBLIC_E2E_AUTH_FALLBACK === "1";

function useGlobalMessageNotifications(enabled: boolean) {
    const { subscribeUserNotifications } = useRealtime();
    const queryClient = useQueryClient();
    const pathname = usePathname();

    useEffect(() => {
        if (!enabled) return;

        return subscribeUserNotifications((event) => {
            if (event.kind !== 'conversation_participant') return;

            // Invalidate/refresh unread count summary
            void queryClient.invalidateQueries({
                queryKey: queryKeys.messages.v2.unread(),
            });

            // Invalidate/refresh conversation list queries so they update
            void queryClient.invalidateQueries({
                queryKey: ['chat-v2', 'inbox'],
            });

            // Check if we should play a notification sound
            const payload = event.payload as { new?: Record<string, unknown>; old?: Record<string, unknown> };
            const conversationId = payload.new?.conversation_id as string | undefined;
            const nextUnread = payload.new?.unread_count as number | undefined;
            const prevUnread = payload.old?.unread_count as number | undefined;

            if (nextUnread !== undefined && prevUnread !== undefined && nextUnread > prevUnread) {
                const selectedConversationId = useMessagesV2UiStore.getState().selectedConversationId;
                const isCurrentActiveChat =
                    conversationId === selectedConversationId &&
                    (pathname.startsWith('/messages') || useMessagesV2UiStore.getState().popupOpen);

                if (!isCurrentActiveChat) {
                    playMessageSound();
                }
            }
        });
    }, [enabled, subscribeUserNotifications, queryClient, pathname]);
}

export function ChatProvider({ children = null }: ChatProviderProps) {
    if (DISABLE_CHAT_IN_E2E) {
        return <>{children}</>;
    }
    return <ChatProviderInner>{children}</ChatProviderInner>;
}

function ChatProviderInner({ children = null }: ChatProviderProps) {
    const { user, isLoading } = useAuth();
    const active = Boolean(user) && !isLoading;
    useMessagesV2OutboxSync(active);
    useGlobalMessageNotifications(active);

    return (
        <>
            {children}
            {active && <ChatPopupV2 />}
        </>
    );
}
