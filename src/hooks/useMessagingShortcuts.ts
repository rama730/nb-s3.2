'use client';

import { useEffect } from 'react';

interface MessagingShortcutCallbacks {
    onEscape?: () => void;
    onNewMessage?: () => void;
    onFocusSearch?: () => void;
    onToggleMute?: () => void;
    onNavigateUp?: () => void;
    onNavigateDown?: () => void;
}

export function useMessagingShortcuts(callbacks: MessagingShortcutCallbacks, enabled = true) {
    useEffect(() => {
        if (!enabled) return;

        const handler = (e: KeyboardEvent) => {
            // Don't capture when in input/textarea (except Escape)
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            if (e.key === 'Escape') {
                callbacks.onEscape?.();
                return;
            }

            if (isInput) return;

            const isMod = e.metaKey || e.ctrlKey;

            if (isMod && e.key === 'n' && callbacks.onNewMessage) {
                e.preventDefault();
                callbacks.onNewMessage();
            } else if (isMod && e.key === 'k' && callbacks.onFocusSearch) {
                e.preventDefault();
                callbacks.onFocusSearch();
            } else if (isMod && e.shiftKey && e.key === 'M' && callbacks.onToggleMute) {
                e.preventDefault();
                callbacks.onToggleMute();
            } else if (e.altKey && e.key === 'ArrowUp' && callbacks.onNavigateUp) {
                e.preventDefault();
                callbacks.onNavigateUp();
            } else if (e.altKey && e.key === 'ArrowDown' && callbacks.onNavigateDown) {
                e.preventDefault();
                callbacks.onNavigateDown();
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [callbacks, enabled]);
}
