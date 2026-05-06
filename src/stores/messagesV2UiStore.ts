'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    MESSAGE_ATTENTION_CLEAR_MS,
    mergeMessageAttention,
    type MessageAttentionState,
} from '@/lib/messages/attention';

type InboxTab = 'chats' | 'applications' | 'projects';

interface MessagesV2UiState {
    popupOpen: boolean;
    popupMinimized: boolean;
    activeTab: InboxTab;
    selectedConversationId: string | null;
    highlightedConversationId: string | null;
    messageAttentionByConversation: Record<string, MessageAttentionState>;
    messageAttentionSuppressedUntilByConversation: Record<string, number>;
    draftsByConversation: Record<string, string>;
    setPopupOpen: (open: boolean) => void;
    setPopupMinimized: (minimized: boolean) => void;
    setActiveTab: (tab: InboxTab) => void;
    setSelectedConversationId: (conversationId: string | null) => void;
    setHighlightedConversationId: (conversationId: string | null) => void;
    openPopupConversationList: (options?: { highlightConversationId?: string | null }) => void;
    upsertMessageAttention: (conversationId: string, attention: MessageAttentionState) => void;
    clearMessageAttention: (conversationId: string) => void;
    clearMessageAttentionSmooth: (conversationIds: string | string[]) => void;
    setDraft: (conversationId: string, value: string) => void;
    clearDraft: (conversationId: string) => void;
}

const attentionClearTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useMessagesV2UiStore = create<MessagesV2UiState>()(
    persist(
        (set) => ({
            popupOpen: false,
            popupMinimized: false,
            activeTab: 'chats',
            selectedConversationId: null,
            highlightedConversationId: null,
            messageAttentionByConversation: {},
            messageAttentionSuppressedUntilByConversation: {},
            draftsByConversation: {},
            setPopupOpen: (popupOpen) => set({ popupOpen }),
            setPopupMinimized: (popupMinimized) => set({ popupMinimized }),
            setActiveTab: (activeTab) => set({ activeTab }),
            setSelectedConversationId: (selectedConversationId) => set({ selectedConversationId }),
            setHighlightedConversationId: (highlightedConversationId) => set({ highlightedConversationId }),
            openPopupConversationList: (options) => set({
                popupOpen: true,
                popupMinimized: false,
                activeTab: 'chats',
                selectedConversationId: null,
                highlightedConversationId: options?.highlightConversationId ?? null,
            }),
            upsertMessageAttention: (conversationId, attention) =>
                set((state) => {
                    const suppressedUntil = state.messageAttentionSuppressedUntilByConversation[conversationId] ?? 0;
                    if (attention.source === 'startup-sync' && suppressedUntil > Date.now()) {
                        return {};
                    }
                    const timer = attentionClearTimers.get(conversationId);
                    if (timer) {
                        clearTimeout(timer);
                        attentionClearTimers.delete(conversationId);
                    }
                    const nextSuppressed = { ...state.messageAttentionSuppressedUntilByConversation };
                    delete nextSuppressed[conversationId];
                    return {
                        messageAttentionSuppressedUntilByConversation: nextSuppressed,
                        messageAttentionByConversation: {
                            ...state.messageAttentionByConversation,
                            [conversationId]: mergeMessageAttention(
                                state.messageAttentionByConversation[conversationId],
                                attention,
                            ),
                        },
                    };
                }),
            clearMessageAttention: (conversationId) =>
                set((state) => {
                    const next = { ...state.messageAttentionByConversation };
                    delete next[conversationId];
                    const timer = attentionClearTimers.get(conversationId);
                    if (timer) {
                        clearTimeout(timer);
                        attentionClearTimers.delete(conversationId);
                    }
                    return {
                        highlightedConversationId: state.highlightedConversationId === conversationId
                            ? null
                            : state.highlightedConversationId,
                        messageAttentionSuppressedUntilByConversation: {
                            ...state.messageAttentionSuppressedUntilByConversation,
                            [conversationId]: Date.now() + 5_000,
                        },
                        messageAttentionByConversation: next,
                    };
                }),
            clearMessageAttentionSmooth: (conversationIds) => {
                const ids = Array.isArray(conversationIds) ? conversationIds : [conversationIds];
                const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
                if (uniqueIds.length === 0) return;
                set((state) => {
                    const next = { ...state.messageAttentionByConversation };
                    const nextSuppressed = { ...state.messageAttentionSuppressedUntilByConversation };
                    const suppressedUntil = Date.now() + 5_000;
                    for (const conversationId of uniqueIds) {
                        nextSuppressed[conversationId] = suppressedUntil;
                        const existing = next[conversationId];
                        if (existing) {
                            next[conversationId] = {
                                ...existing,
                                clearing: true,
                                updatedAt: Date.now(),
                            };
                        }
                    }
                    return {
                        messageAttentionByConversation: next,
                        messageAttentionSuppressedUntilByConversation: nextSuppressed,
                    };
                });
                for (const conversationId of uniqueIds) {
                    const timer = attentionClearTimers.get(conversationId);
                    if (timer) clearTimeout(timer);
                    attentionClearTimers.set(conversationId, setTimeout(() => {
                        attentionClearTimers.delete(conversationId);
                        set((state) => {
                            const next = { ...state.messageAttentionByConversation };
                            delete next[conversationId];
                            return {
                                highlightedConversationId: state.highlightedConversationId === conversationId
                                    ? null
                                    : state.highlightedConversationId,
                                messageAttentionSuppressedUntilByConversation: {
                                    ...state.messageAttentionSuppressedUntilByConversation,
                                    [conversationId]: Date.now() + 5_000,
                                },
                                messageAttentionByConversation: next,
                            };
                        });
                    }, MESSAGE_ATTENTION_CLEAR_MS));
                }
            },
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
                        highlightedConversationId: null,
                        messageAttentionByConversation: {},
                        messageAttentionSuppressedUntilByConversation: {},
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
