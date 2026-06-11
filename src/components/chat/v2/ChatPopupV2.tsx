'use client';

import dynamic from 'next/dynamic';
import { MessageSquare } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';

const PopupMessagesWorkspace = dynamic(
    () => import('./MessagesWorkspaceV2').then((mod) => mod.MessagesWorkspaceV2),
    {
        ssr: false,
        loading: () => (
            <div className="flex h-full w-full items-center justify-center bg-card text-sm text-muted-foreground">
                Loading messages...
            </div>
        ),
    },
);

export function ChatPopupV2() {
    const pathname = usePathname();
    const popupOpen = useMessagesV2UiStore((state) => state.popupOpen);
    const popupMinimized = useMessagesV2UiStore((state) => state.popupMinimized);
    const setPopupOpen = useMessagesV2UiStore((state) => state.setPopupOpen);
    const setPopupMinimized = useMessagesV2UiStore((state) => state.setPopupMinimized);

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
                aria-label="Open messages"
            >
                <MessageSquare className="h-6 w-6" />
            </button>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 z-50 md:bottom-6 md:right-6">


            <div
                className="h-[min(640px,calc(100dvh-5.5rem))] w-[min(400px,calc(100vw-1.5rem))] min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card ring-1 ring-black/[0.02]"
                style={{ boxShadow: 'var(--msg-shadow-lg, 0 24px 60px rgba(15,23,42,0.18))', animation: 'message-appear 240ms ease-out' }}
            >
                <PopupMessagesWorkspace mode="popup" />
            </div>
        </div>
    );
}
