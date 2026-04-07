'use client';

import { useAuth } from '@/hooks/useAuth';
import { ChatPopupV2 } from './v2/ChatPopupV2';
import { useMessagesV2OutboxSync } from '@/hooks/useMessagesV2OutboxSync';

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
    useMessagesV2OutboxSync(Boolean(user) && !isLoading);

    return (
        <>
            {children}
            {user && !isLoading && <ChatPopupV2 />}
        </>
    );
}
