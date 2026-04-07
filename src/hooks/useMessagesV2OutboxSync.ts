'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sendConversationMessageV2 } from '@/app/actions/messaging/v2';
import { replaceOptimisticThreadMessage, upsertInboxConversation, upsertThreadConversation, upsertThreadMessage } from '@/lib/messages/v2-cache';
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
                    });
                    continue;
                }

                inFlightIdsRef.current.add(item.clientMessageId);
                markItem(item.clientMessageId, { state: 'sending' });
                try {
                    const result = await sendConversationMessageV2({
                        conversationId: item.conversationId,
                        targetUserId: item.targetUserId ?? null,
                        content: item.content,
                        attachments: item.attachments,
                        clientMessageId: item.clientMessageId,
                        replyToMessageId: item.replyToMessageId ?? null,
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
                        } else if (result.conversation) {
                            upsertInboxConversation(queryClient, result.conversation);
                        }
                        continue;
                    }

                    const nextAttempts = item.attempts + 1;
                    markItem(item.clientMessageId, {
                        attempts: nextAttempts,
                        state: 'failed',
                        nextRetryAt: Date.now() + getRetryDelay(nextAttempts),
                        error: result.error || 'retry_failed',
                    });
                } catch (error) {
                    const nextAttempts = item.attempts + 1;
                    markItem(item.clientMessageId, {
                        attempts: nextAttempts,
                        state: 'failed',
                        nextRetryAt: Date.now() + getRetryDelay(nextAttempts),
                        error: error instanceof Error ? error.message : String(error) || 'exception_failed',
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
