'use client';

import { useCallback, useEffect, useRef } from 'react';
import { recordDeliveryReceipts } from '@/app/actions/messaging';
import { subscribePresenceRoom } from '@/lib/realtime/presence-client';

/**
 * useDeliveryAcks — when the recipient's client receives new messages via
 * realtime, push the message IDs into a FIFO buffer that flushes to
 * `recordDeliveryReceipts` every FLUSH_INTERVAL_MS.
 *
 * Wave 2 Step 11: also broadcasts a `delivered` event on the conversation
 * presence room so the sender's tick advances within ~100 ms, before the
 * postgres_changes INSERT from the receipt table propagates.
 *
 * This drives the WhatsApp-style double gray tick (✓✓) on the sender side.
 * The delivery receipt is "the recipient's client has received the message".
 */

const FLUSH_INTERVAL_MS = 250;

export function useDeliveryAcks(
    viewerId: string | null,
    conversationId: string | null,
) {
    const bufferRef = useRef<Set<string>>(new Set());
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const presenceRef = useRef<ReturnType<typeof subscribePresenceRoom> | null>(null);

    // Wave 2 Step 11: maintain a viewer-only subscription to the conversation
    // presence room so we can broadcast delivered receipts via it.
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

        const ids = Array.from(bufferRef.current);
        bufferRef.current.clear();

        // Broadcast via presence for sub-100 ms latency (fire-and-forget;
        // the DB write below provides durability).
        presenceRef.current?.send({ type: 'delivered', messageIds: ids });

        try {
            await recordDeliveryReceipts(ids);
        } catch {
            // Re-add failed IDs so they are retried on next flush
            for (const id of ids) {
                bufferRef.current.add(id);
            }
        }
    }, []);

    // Start/stop the flush timer
    useEffect(() => {
        if (!viewerId) return;

        timerRef.current = setInterval(flush, FLUSH_INTERVAL_MS);
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            // Best-effort flush on unmount
            if (bufferRef.current.size > 0) {
                const ids = Array.from(bufferRef.current);
                bufferRef.current.clear();
                presenceRef.current?.send({ type: 'delivered', messageIds: ids });
                void recordDeliveryReceipts(ids).catch(() => {});
            }
        };
    }, [viewerId, flush]);

    /**
     * Acknowledge delivery for a batch of message IDs.
     * Call this when new messages from OTHER senders arrive via realtime.
     */
    const ackDelivery = useCallback(
        (messageIds: Array<{ id: string; senderId: string | null }>) => {
            if (!viewerId) return;
            for (const msg of messageIds) {
                // Skip own messages — only ack messages from others
                if (msg.senderId === viewerId) continue;
                bufferRef.current.add(msg.id);
            }
        },
        [viewerId],
    );

    return { ackDelivery };
}
