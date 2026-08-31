'use client';

import { recordDeliveryReceipts } from '@/app/actions/messaging';
import { useMessageReceiptBuffer } from './useMessageReceiptBuffer';

// A short window turns burst delivery events into one idempotent database
// write without making the delivered indicator feel delayed.
const DELIVERY_FLUSH_INTERVAL_MS = 120;

export function useDeliveryAcks(
    viewerId: string | null,
    conversationId: string | null,
) {
    const { enqueueReceipts } = useMessageReceiptBuffer({
        viewerId,
        conversationId,
        flushIntervalMs: DELIVERY_FLUSH_INTERVAL_MS,
        recordReceipts: recordDeliveryReceipts,
    });

    return { ackDelivery: enqueueReceipts };
}
