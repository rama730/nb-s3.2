'use client';

import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { ChatPopupV2 } from './v2/ChatPopupV2';
import { useMessagesV2OutboxSync } from '@/hooks/useMessagesV2OutboxSync';
import { usePublishOnlinePresence } from '@/hooks/usePublishOnlinePresence';

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
    const active = Boolean(user) && !isLoading;
    useMessagesV2OutboxSync(active);
    usePublishOnlinePresence();

    useEffect(() => {
        if (!active) return;

        let interval: number | null = null;
        const heartbeat = () => {
            void fetch('/api/v1/presence/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                keepalive: true,
            });
        };
        const start = () => {
            if (interval !== null) return;
            heartbeat();
            interval = window.setInterval(heartbeat, 4 * 60_000);
        };
        const stop = () => {
            if (interval === null) return;
            window.clearInterval(interval);
            interval = null;
        };
        const onVisibilityChange = () => {
            if (document.hidden) stop();
            else start();
        };

        if (!document.hidden) start();
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [active, user?.id]);

    return (
        <>
            {children}
            {active && <ChatPopupV2 />}
        </>
    );
}
