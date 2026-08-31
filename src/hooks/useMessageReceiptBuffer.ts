'use client';

import { useCallback, useEffect, useRef } from 'react';

type MessageReceiptTarget = {
    id: string;
    senderId: string | null;
};

type UseMessageReceiptBufferOptions = {
    viewerId: string | null;
    conversationId: string | null;
    flushIntervalMs: number;
    requireVisibleDocument?: boolean;
    recordReceipts: (messageIds: string[]) => Promise<{ success: boolean; error?: string }>;
};

function isReceiptEligibleConversationId(conversationId: string | null): conversationId is string {
    return Boolean(conversationId && !conversationId.startsWith('draft:'));
}

const globalFlushedReceipts = new Set<string>();
const globalInFlightReceipts = new Set<string>();

export function useMessageReceiptBuffer({
    viewerId,
    conversationId,
    flushIntervalMs,
    requireVisibleDocument = false,
    recordReceipts,
}: UseMessageReceiptBufferOptions) {
    const bufferRef = useRef<Set<string>>(new Set());
    const flushedRef = useRef<Set<string>>(globalFlushedReceipts);
    const inFlightRef = useRef<Set<string>>(globalInFlightReceipts);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flush = useCallback(async () => {
        if (bufferRef.current.size === 0) return;
        if (requireVisibleDocument && typeof document !== 'undefined' && document.hidden) return;

        const ids = Array.from(bufferRef.current);
        bufferRef.current.clear();
        for (const id of ids) {
            inFlightRef.current.add(id);
        }

        try {
            const result = await recordReceipts(ids);
            if (!result.success) {
                throw new Error(result.error || 'Receipt write failed');
            }
            for (const id of ids) {
                flushedRef.current.add(id);
                inFlightRef.current.delete(id);
            }
        } catch {
            for (const id of ids) {
                inFlightRef.current.delete(id);
                bufferRef.current.add(id);
            }
        }
    }, [recordReceipts, requireVisibleDocument]);

    useEffect(() => {
        if (!viewerId || !isReceiptEligibleConversationId(conversationId)) return;

        bufferRef.current.clear();
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            bufferRef.current.clear();
        };
    }, [conversationId, viewerId]);

    const enqueueReceipts = useCallback(
        (messages: MessageReceiptTarget[]) => {
            if (!viewerId) return;
            for (const message of messages) {
                if (message.senderId === viewerId) continue;
                if (
                    flushedRef.current.has(message.id)
                    || inFlightRef.current.has(message.id)
                    || bufferRef.current.has(message.id)
                ) continue;
                bufferRef.current.add(message.id);
            }
            if (bufferRef.current.size > 0 && flushIntervalMs <= 0) {
                void flush();
                return;
            }
            if (bufferRef.current.size > 0 && !timerRef.current) {
                timerRef.current = setTimeout(() => {
                    timerRef.current = null;
                    void flush();
                }, flushIntervalMs);
            }
        },
        [flush, flushIntervalMs, viewerId],
    );

    return { enqueueReceipts };
}
