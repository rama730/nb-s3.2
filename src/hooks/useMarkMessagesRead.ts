'use client';

import { useCallback, useEffect, useRef } from 'react';
import { recordReadReceipts } from '@/app/actions/messaging';
import { subscribePresenceRoom } from '@/lib/realtime/presence-client';

/**
 * useMarkMessagesRead — buffers incoming message IDs (from other senders)
 * and flushes them to `recordReadReceipts` every FLUSH_INTERVAL_MS.
 *
 * Wave 2 Step 11: also broadcasts a `read` event on the conversation presence
 * room so the sender's tick advances within ~100 ms, before the
 * postgres_changes INSERT from the receipt table propagates.
 *
 * Only fires while the tab is visible and the conversation is active.
 * Used by MessageThreadV2 to drive the blue-tick (✓✓ blue) state
 * for the sender.
 */

const FLUSH_INTERVAL_MS = 600;

export function useMarkMessagesRead(
    conversationId: string | null,
    viewerId: string | null,
) {
    const bufferRef = useRef<Set<string>>(new Set());
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const presenceRef = useRef<ReturnType<typeof subscribePresenceRoom> | null>(null);

    // Wave 2 Step 11: maintain a subscription to the conversation presence
    // room so we can broadcast read receipts for ~100 ms latency gain.
    // The room is already subscribed by useDeliveryAcks for the same
    // conversation — the presence client dedupes identical room sockets, so
    // no extra WS connection is opened.
    useEffect(() => {
        if (!conversationId || typeof window === 'undefined') return;

        const subscription = subscribePresenceRoom({
            roomType: 'conversation',
            roomId: conversationId,
            role: 'viewer',
            onEvent: () => { /* receipt.broadcast consumed by useMessagesV2Realtime */ },
        });
        presenceRef.current = subscription;

        return () => {
            subscription.unsubscribe();
            presenceRef.current = null;
        };
    }, [conversationId]);

    const flush = useCallback(async () => {
        if (bufferRef.current.size === 0) return;
        if (typeof document !== 'undefined' && document.hidden) return;

        const ids = Array.from(bufferRef.current);
        bufferRef.current.clear();

        // Broadcast via presence for sub-100 ms latency (fire-and-forget;
        // the DB write below provides durability).
        presenceRef.current?.send({ type: 'read', messageIds: ids });

        try {
            await recordReadReceipts(ids);
        } catch {
            // Re-add failed IDs so they are retried on next flush
            for (const id of ids) {
                bufferRef.current.add(id);
            }
        }
    }, []);

    // Start/stop the flush timer based on the active conversation
    useEffect(() => {
        if (!conversationId || !viewerId) return;

        timerRef.current = setInterval(flush, FLUSH_INTERVAL_MS);
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            // Flush remaining on unmount (best-effort, no await)
            if (bufferRef.current.size > 0) {
                const ids = Array.from(bufferRef.current);
                bufferRef.current.clear();
                presenceRef.current?.send({ type: 'read', messageIds: ids });
                void recordReadReceipts(ids).catch(() => {});
            }
        };
    }, [conversationId, viewerId, flush]);

    /**
     * Mark a batch of message IDs as read. Filters out own messages.
     * Call this when messages enter the viewport.
     */
    const markRead = useCallback(
        (messageIds: Array<{ id: string; senderId: string | null }>) => {
            if (!viewerId) return;
            for (const msg of messageIds) {
                // Skip own messages — you don't read-receipt yourself
                if (msg.senderId === viewerId) continue;
                bufferRef.current.add(msg.id);
            }
        },
        [viewerId],
    );

    return { markRead };
}
