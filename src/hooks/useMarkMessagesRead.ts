'use client';

import { recordReadReceipts } from '@/app/actions/messaging';
import { useMessageReceiptBuffer } from './useMessageReceiptBuffer';

const READ_FLUSH_INTERVAL_MS = 600;

export function useMarkMessagesRead(
    conversationId: string | null,
    viewerId: string | null,
) {
    const { enqueueReceipts } = useMessageReceiptBuffer({
        viewerId,
        conversationId,
        flushIntervalMs: READ_FLUSH_INTERVAL_MS,
        requireVisibleDocument: true,
        recordReceipts: recordReadReceipts,
    });

    return { markRead: enqueueReceipts };
}
