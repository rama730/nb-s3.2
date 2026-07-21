'use client';

import { recordDeliveryReceipts } from '@/app/actions/messaging';
import { useMessageReceiptBuffer } from './useMessageReceiptBuffer';

const DELIVERY_FLUSH_INTERVAL_MS = 250;

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
