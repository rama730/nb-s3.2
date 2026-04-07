'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type InboxTab = 'chats' | 'applications' | 'projects';

interface MessagesV2UiState {
    popupOpen: boolean;
    popupMinimized: boolean;
    activeTab: InboxTab;
    selectedConversationId: string | null;
    draftsByConversation: Record<string, string>;
    setPopupOpen: (open: boolean) => void;
    setPopupMinimized: (minimized: boolean) => void;
    setActiveTab: (tab: InboxTab) => void;
    setSelectedConversationId: (conversationId: string | null) => void;
    setDraft: (conversationId: string, value: string) => void;
    clearDraft: (conversationId: string) => void;
}

export const useMessagesV2UiStore = create<MessagesV2UiState>()(
    persist(
        (set) => ({
            popupOpen: false,
            popupMinimized: false,
            activeTab: 'chats',
            selectedConversationId: null,
            draftsByConversation: {},
            setPopupOpen: (popupOpen) => set({ popupOpen }),
            setPopupMinimized: (popupMinimized) => set({ popupMinimized }),
            setActiveTab: (activeTab) => set({ activeTab }),
            setSelectedConversationId: (selectedConversationId) => set({ selectedConversationId }),
            setDraft: (conversationId, value) =>
                set((state) => ({
                    draftsByConversation: {
                        ...state.draftsByConversation,
                        [conversationId]: value,
                    },
                })),
            clearDraft: (conversationId) =>
                set((state) => {
                    const nextDrafts = { ...state.draftsByConversation };
                    delete nextDrafts[conversationId];
                    return { draftsByConversation: nextDrafts };
                }),
        }),
        {
            name: 'messages-v2-ui',
            version: 1,
            migrate: (persisted: unknown, version: number) => {
                if (version === 0 || !persisted || typeof persisted !== 'object') {
                    return {
                        popupOpen: false,
                        popupMinimized: false,
                        activeTab: 'chats',
                        draftsByConversation: {},
                    };
                }
                return persisted as Partial<MessagesV2UiState>;
            },
            partialize: (state) => ({
                popupOpen: state.popupOpen,
                popupMinimized: state.popupMinimized,
                activeTab: state.activeTab,
                draftsByConversation: state.draftsByConversation,
            }),
            onRehydrateStorage: () => (state) => {
                if (!state) return;
                // Prune drafts older than 30 days by capping total count.
                // We can't track per-draft timestamps without a schema change,
                // so cap to 50 entries as a safety valve against unbounded growth.
                const drafts = state.draftsByConversation;
                const keys = Object.keys(drafts);
                if (keys.length > 50) {
                    const pruned: Record<string, string> = {};
                    // Keep the last 50 entries (most recently written)
                    for (const key of keys.slice(-50)) {
                        pruned[key] = drafts[key];
                    }
                    state.draftsByConversation = pruned;
                }
            },
        },
    ),
);
