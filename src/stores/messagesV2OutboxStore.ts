'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UploadedAttachment } from '@/app/actions/messaging';

export type MessagesV2DeliveryState = 'queued' | 'sending' | 'sent' | 'failed';

export interface MessagesV2OutboxItem {
    clientMessageId: string;
    conversationId: string;
    targetUserId?: string | null;
    content: string;
    attachments: UploadedAttachment[];
    replyToMessageId?: string | null;
    createdAt: number;
    attempts: number;
    nextRetryAt: number;
    state: MessagesV2DeliveryState;
    error?: string;
}

interface MessagesV2OutboxState {
    items: MessagesV2OutboxItem[];
    upsertItem: (item: MessagesV2OutboxItem) => void;
    removeItem: (clientMessageId: string) => void;
    requeueSendingItems: (nextRetryAt: number) => void;
    markItem: (
        clientMessageId: string,
        patch: Partial<Pick<MessagesV2OutboxItem, 'attempts' | 'nextRetryAt' | 'state' | 'error' | 'conversationId'>>,
    ) => void;
}

export const useMessagesV2OutboxStore = create<MessagesV2OutboxState>()(
    persist(
        (set) => ({
            items: [],
            upsertItem: (item) =>
                set((state) => {
                    const existingIndex = state.items.findIndex((current) => current.clientMessageId === item.clientMessageId);
                    if (existingIndex === -1) {
                        return { items: [...state.items, item] };
                    }
                    const nextItems = [...state.items];
                    nextItems[existingIndex] = { ...nextItems[existingIndex], ...item };
                    return { items: nextItems };
                }),
            removeItem: (clientMessageId) =>
                set((state) => ({
                    items: state.items.filter((item) => item.clientMessageId !== clientMessageId),
                })),
            requeueSendingItems: (nextRetryAt) =>
                set((state) => ({
                    items: state.items.map((item) =>
                        item.state === 'sending'
                            ? {
                                ...item,
                                state: 'queued',
                                nextRetryAt,
                            }
                            : item,
                    ),
                })),
            markItem: (clientMessageId, patch) =>
                set((state) => ({
                    items: state.items.map((item) =>
                        item.clientMessageId === clientMessageId ? { ...item, ...patch } : item,
                    ),
                })),
        }),
        {
            name: 'messages-v2-outbox',
            version: 1,
            migrate: (persisted: unknown, version: number) => {
                if (version === 0 || !persisted || typeof persisted !== 'object') {
                    return { items: [] };
                }
                return persisted as MessagesV2OutboxState;
            },
        },
    ),
);
