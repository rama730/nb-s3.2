'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UploadedAttachment } from '@/app/actions/messaging';
import type { MessageContextChip } from '@/lib/messages/structured';

export type MessagesV2DeliveryState = 'queued' | 'sending' | 'sent' | 'failed';
export type MessagesV2OutboxMode = 'plain' | 'structured';

export interface MessagesV2OutboxStructuredAction {
    kind: 'project_invite' | 'feedback_request' | 'availability_request' | 'task_approval' | 'rate_share' | 'handoff_summary';
    title?: string | null;
    summary: string;
    note?: string | null;
    projectId?: string | null;
    taskId?: string | null;
    fileId?: string | null;
    profileId?: string | null;
    amount?: string | null;
    unit?: string | null;
    dueAt?: string | null;
    completed?: string | null;
    blocked?: string | null;
    next?: string | null;
}

export interface MessagesV2OutboxItem {
    clientMessageId: string;
    conversationId: string;
    targetUserId?: string | null;
    mode?: MessagesV2OutboxMode;
    content: string;
    attachments: UploadedAttachment[];
    replyToMessageId?: string | null;
    contextChips?: MessageContextChip[];
    structuredAction?: MessagesV2OutboxStructuredAction | null;
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
        patch: Partial<Pick<MessagesV2OutboxItem, 'attempts' | 'nextRetryAt' | 'state' | 'error' | 'conversationId' | 'contextChips' | 'structuredAction'>>,
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
            version: 2,
            migrate: (persisted: unknown, version: number) => {
                if (!persisted || typeof persisted !== 'object') {
                    return { items: [] };
                }
                const next = persisted as MessagesV2OutboxState;
                const normalizedItems = Array.isArray(next.items) ? next.items : [];

                switch (version) {
                    case 0:
                    case 1:
                        return {
                            ...next,
                            items: normalizedItems.map((item) => ({
                                ...item,
                                mode: item.mode ?? (item.structuredAction ? 'structured' : 'plain'),
                                contextChips: item.contextChips ?? [],
                                structuredAction: item.structuredAction ?? null,
                            })),
                        } satisfies MessagesV2OutboxState;
                    case 2:
                    default:
                        // Future versions can branch here without reprocessing already-migrated state.
                        return {
                            ...next,
                            items: normalizedItems,
                        } satisfies MessagesV2OutboxState;
                }
            },
        },
    ),
);
