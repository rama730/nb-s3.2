'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sendConversationMessageV2, sendStructuredConversationMessageV2 } from '@/app/actions/messaging/v2';
import {
    patchConversationLastMessageFromMessage,
    replaceOptimisticThreadMessage,
    upsertInboxConversation,
    upsertThreadConversation,
} from '@/lib/messages/v2-cache';
import { useMessagesV2OutboxStore } from '@/stores/messagesV2OutboxStore';

function getRetryDelay(attempt: number) {
    return Math.min(60_000, 1_000 * (2 ** Math.min(6, attempt)));
}

const MAX_RETRY_ATTEMPTS = 20;
const FLUSH_INTERVAL_MS = 10_000;

export function useMessagesV2OutboxSync(enabled: boolean) {
    const queryClient = useQueryClient();
    const storeRef = useRef(useMessagesV2OutboxStore.getState());
    const inFlightIdsRef = useRef(new Set<string>());

    // Keep storeRef current without triggering effect re-runs.
    useEffect(() => {
        return useMessagesV2OutboxStore.subscribe((state) => {
            storeRef.current = state;
        });
    }, []);

    // Requeue any items stuck in 'sending' state on mount (app crash recovery).
    useEffect(() => {
        if (!enabled) return;
        storeRef.current.requeueSendingItems(Date.now());
    }, [enabled]);

    // Stable flush loop — does NOT depend on `items` to avoid effect churn.
    useEffect(() => {
        if (!enabled) return;

        let cancelled = false;

        const flush = async () => {
            const { items, markItem, removeItem } = storeRef.current;
            const now = Date.now();
            const eligible = items
                .filter((item) =>
                    item.state !== 'sending'
                    && item.attempts < MAX_RETRY_ATTEMPTS
                    && item.nextRetryAt <= now
                    && !inFlightIdsRef.current.has(item.clientMessageId),
                )
                .sort((a, b) => a.createdAt - b.createdAt);

            for (const item of eligible) {
                if (cancelled) return;

                // Permanently fail items that exceeded max retries.
                if (item.attempts >= MAX_RETRY_ATTEMPTS) {
                    markItem(item.clientMessageId, {
                        state: 'failed',
                        error: 'Max retries exceeded. Please resend manually.',
                        nextRetryAt: Number.MAX_SAFE_INTEGER,
                    });
                    continue;
                }

                inFlightIdsRef.current.add(item.clientMessageId);
                markItem(item.clientMessageId, { state: 'sending' });
                try {
                    const result = item.mode === 'structured' && item.structuredAction
                        ? await sendStructuredConversationMessageV2({
                            conversationId: item.conversationId,
                            targetUserId: item.targetUserId ?? null,
                            clientMessageId: item.clientMessageId,
                            kind: item.structuredAction.kind,
                            title: item.structuredAction.title ?? null,
                            summary: item.structuredAction.summary,
                            note: item.structuredAction.note ?? null,
                            projectId: item.structuredAction.projectId ?? null,
                            taskId: item.structuredAction.taskId ?? null,
                            fileId: item.structuredAction.fileId ?? null,
                            profileId: item.structuredAction.profileId ?? null,
                            amount: item.structuredAction.amount ?? null,
                            unit: item.structuredAction.unit ?? null,
                            dueAt: item.structuredAction.dueAt ?? null,
                            completed: item.structuredAction.completed ?? null,
                            blocked: item.structuredAction.blocked ?? null,
                            next: item.structuredAction.next ?? null,
                            contextChips: item.contextChips ?? [],
                        })
                        : await sendConversationMessageV2({
                            conversationId: item.conversationId,
                            targetUserId: item.targetUserId ?? null,
                            content: item.content,
                            attachments: item.attachments,
                            clientMessageId: item.clientMessageId,
                            replyToMessageId: item.replyToMessageId ?? null,
                            contextChips: item.contextChips ?? [],
                        });

                    if (result.success && result.conversationId) {
                        removeItem(item.clientMessageId);
                        if (result.conversation) {
                            upsertThreadConversation(queryClient, result.conversation);
                        }
                        if (result.message) {
                            replaceOptimisticThreadMessage(
                                queryClient,
                                result.conversationId,
                                item.clientMessageId,
                                result.message,
                                result.conversation ?? null,
                            );
                            patchConversationLastMessageFromMessage(queryClient, result.conversationId, result.message);
                        } else if (result.conversation) {
                            upsertInboxConversation(queryClient, result.conversation);
                        }
                        continue;
                    }

                    const nextAttempts = item.attempts + 1;
                    const exhaustedRetries = nextAttempts >= MAX_RETRY_ATTEMPTS;
                    markItem(item.clientMessageId, {
                        attempts: nextAttempts,
                        state: 'failed',
                        nextRetryAt: exhaustedRetries
                            ? Number.MAX_SAFE_INTEGER
                            : Date.now() + getRetryDelay(nextAttempts),
                        error: exhaustedRetries
                            ? 'Max retries exceeded. Please resend manually.'
                            : result.error || 'retry_failed',
                    });
                } catch (error) {
                    const nextAttempts = item.attempts + 1;
                    const exhaustedRetries = nextAttempts >= MAX_RETRY_ATTEMPTS;
                    markItem(item.clientMessageId, {
                        attempts: nextAttempts,
                        state: 'failed',
                        nextRetryAt: exhaustedRetries
                            ? Number.MAX_SAFE_INTEGER
                            : Date.now() + getRetryDelay(nextAttempts),
                        error: exhaustedRetries
                            ? 'Max retries exceeded. Please resend manually.'
                            : error instanceof Error ? error.message : String(error) || 'exception_failed',
                    });
                } finally {
                    inFlightIdsRef.current.delete(item.clientMessageId);
                }
            }
        };

        void flush();
        const timer = window.setInterval(() => {
            void flush();
        }, FLUSH_INTERVAL_MS);

        const onOnline = () => {
            void flush();
        };
        window.addEventListener('online', onOnline);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
            window.removeEventListener('online', onOnline);
        };
    }, [enabled, queryClient]);
}
