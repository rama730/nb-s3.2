'use client';

import { useEffect } from 'react';
import type { WorkspaceTab } from '@/components/workspace/WorkspaceTabBar';

const ALL_TABS: WorkspaceTab[] = ['overview', 'tasks', 'inbox', 'projects', 'notes', 'activity'];

/**
 * useWorkspaceKeyboard
 *
 * Single global keydown listener for workspace navigation.
 * - Digit 1-6: switch tabs
 * - Escape: close task panel
 * Skips when input/textarea/select is focused.
 */
export function useWorkspaceKeyboard(
    setActiveTab: (tab: WorkspaceTab) => void,
    onEscape: () => void
) {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (document.activeElement?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

            // Tab switching: 1-6
            if (e.key >= '1' && e.key <= '6' && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                const idx = parseInt(e.key) - 1;
                if (idx < ALL_TABS.length) {
                    setActiveTab(ALL_TABS[idx]);
                }
            }

            // Escape: close panel / go back
            if (e.key === 'Escape') {
                onEscape();
            }
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [setActiveTab, onEscape]);
}
