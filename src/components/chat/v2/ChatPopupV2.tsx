'use client';

import { ChevronDown, MessageSquare } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useUnreadSummary } from '@/hooks/useMessagesV2';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';
import { MessagesWorkspaceV2 } from './MessagesWorkspaceV2';

export function ChatPopupV2() {
    const pathname = usePathname();
    const popupOpen = useMessagesV2UiStore((state) => state.popupOpen);
    const popupMinimized = useMessagesV2UiStore((state) => state.popupMinimized);
    const selectedConversationId = useMessagesV2UiStore((state) => state.selectedConversationId);
    const setPopupOpen = useMessagesV2UiStore((state) => state.setPopupOpen);
    const setPopupMinimized = useMessagesV2UiStore((state) => state.setPopupMinimized);
    const unreadQuery = useUnreadSummary();
    const totalUnread = unreadQuery.data ?? 0;

    if (pathname.startsWith('/messages')) return null;

    if (!popupOpen || popupMinimized) {
        return (
            <button
                type="button"
                onClick={() => {
                    setPopupOpen(true);
                    setPopupMinimized(false);
                }}
                className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full app-accent-solid shadow-lg transition-all hover:scale-105 hover:bg-primary/90"
                aria-label={totalUnread > 0 ? `Open messages, ${totalUnread} unread` : 'Open messages'}
            >
                <MessageSquare className="h-6 w-6" />
                {totalUnread > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
                        {totalUnread > 9 ? '9+' : totalUnread}
                    </span>
                )}
            </button>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 z-50 md:bottom-6 md:right-6">
            {!selectedConversationId ? (
                <div className="absolute right-4 top-4 z-10">
                    <button
                        type="button"
                        onClick={() => setPopupMinimized(true)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200/80 bg-white/95 text-zinc-500 shadow-[0_8px_24px_rgba(15,23,42,0.16)] backdrop-blur transition-colors hover:bg-white hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950/95 dark:hover:bg-zinc-950 dark:hover:text-zinc-100"
                        aria-label="Collapse messages"
                    >
                        <ChevronDown className="h-4 w-4" />
                    </button>
                </div>
            ) : null}

            <div className="h-[min(680px,calc(100dvh-5.5rem))] w-[min(420px,calc(100vw-1.5rem))] overflow-hidden rounded-[30px] border border-zinc-200/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.18)] ring-1 ring-black/[0.02] dark:border-zinc-800/80 dark:bg-zinc-950">
                <MessagesWorkspaceV2 mode="popup" />
            </div>
        </div>
    );
}
