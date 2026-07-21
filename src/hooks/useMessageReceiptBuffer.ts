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

export function useMessageReceiptBuffer({
    viewerId,
    conversationId,
    flushIntervalMs,
    requireVisibleDocument = false,
    recordReceipts,
}: UseMessageReceiptBufferOptions) {
    const bufferRef = useRef<Set<string>>(new Set());
    const flushedRef = useRef<Set<string>>(new Set());
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const flush = useCallback(async () => {
        if (bufferRef.current.size === 0) return;
        if (requireVisibleDocument && typeof document !== 'undefined' && document.hidden) return;

        const ids = Array.from(bufferRef.current);
        bufferRef.current.clear();

        try {
            await recordReceipts(ids);
            for (const id of ids) {
                flushedRef.current.add(id);
            }
        } catch {
            for (const id of ids) {
                bufferRef.current.add(id);
            }
        }
    }, [recordReceipts, requireVisibleDocument]);

    useEffect(() => {
        if (!viewerId || !isReceiptEligibleConversationId(conversationId)) return;

        bufferRef.current.clear();
        flushedRef.current.clear();
        timerRef.current = setInterval(flush, flushIntervalMs);
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            if (bufferRef.current.size > 0) {
                const ids = Array.from(bufferRef.current);
                bufferRef.current.clear();
                void recordReceipts(ids).catch(() => {});
            }
        };
    }, [conversationId, flush, flushIntervalMs, recordReceipts, viewerId]);

    const enqueueReceipts = useCallback(
        (messages: MessageReceiptTarget[]) => {
            if (!viewerId) return;
            for (const message of messages) {
                if (message.senderId === viewerId) continue;
                if (flushedRef.current.has(message.id) || bufferRef.current.has(message.id)) continue;
                bufferRef.current.add(message.id);
            }
        },
        [viewerId],
    );

    return { enqueueReceipts };
}
