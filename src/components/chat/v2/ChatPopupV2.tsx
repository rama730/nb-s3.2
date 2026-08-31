'use client';

import dynamic from 'next/dynamic';
import { MessageSquare } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useMessageAttention } from '@/components/providers/MessageAttentionProvider';
import {
    recordMessagesPopupFocusReturn,
    recordMessagesPopupTransition,
} from '@/lib/messages/observability';
import { InboxListSkeletonV2 } from './MessagesSurfaceSkeletons';

const PopupMessagesWorkspace = dynamic(
    () => import('./MessagesWorkspaceV2').then((mod) => mod.MessagesWorkspaceV2),
    {
        ssr: false,
        loading: () => <InboxListSkeletonV2 surface="popup" />,
    },
);

export function ChatPopupV2() {
    const pathname = usePathname();
    const { user, isLoading } = useAuth();
    const { unreadCount, hasUnreadMessages } = useMessageAttention();
    const popupState = useMessagesV2UiStore((state) => state.popupState);
    const setPopupState = useMessagesV2UiStore((state) => state.setPopupState);
    const launcherRef = useRef<HTMLButtonElement>(null);
    const wasVisibleRef = useRef(false);
    const previousPopupStateRef = useRef(popupState);

    useEffect(() => {
        recordMessagesPopupTransition(previousPopupStateRef.current, popupState);
        previousPopupStateRef.current = popupState;
    }, [popupState]);

    useEffect(() => {
        const visible = popupState === 'open';
        if (wasVisibleRef.current && !visible) {
            const launcher = launcherRef.current;
            launcher?.focus();
            recordMessagesPopupFocusReturn(Boolean(launcher && document.activeElement === launcher));
        }
        wasVisibleRef.current = visible;
    }, [popupState]);

    if (!user || isLoading || pathname.startsWith('/messages')) return null;

    if (popupState !== 'open') {
        return (
            <button
                type="button"
                ref={launcherRef}
                onClick={() => setPopupState('open')}
                className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full app-accent-solid shadow-lg transition-all hover:scale-105 hover:bg-primary/90"
                aria-label={hasUnreadMessages ? `Open messages, ${unreadCount} unread messages` : 'Open messages'}
            >
                <MessageSquare className="h-6 w-6" />
                {hasUnreadMessages ? (
                    <span
                        aria-hidden="true"
                        className="absolute right-0.5 top-0.5 h-3 w-3 rounded-full bg-rose-500 ring-2 ring-background motion-reduce:animate-none"
                    />
                ) : null}
            </button>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 z-50 md:bottom-6 md:right-6">


            <div
                role="complementary"
                aria-label="Messages"
                onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    event.stopPropagation();
                    setPopupState('closed');
                }}
                className="h-[min(640px,calc(100dvh-5.5rem))] w-[min(400px,calc(100vw-1.5rem))] min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card ring-1 ring-black/[0.02]"
                style={{ boxShadow: 'var(--msg-shadow-lg, 0 24px 60px rgba(15,23,42,0.18))', animation: 'message-appear 240ms ease-out' }}
            >
                <PopupMessagesWorkspace mode="popup" />
            </div>
        </div>
    );
}
