export type MessageDeliveryState =
    | 'sending'
    | 'queued'
    | 'sent'
    | 'delivered'
    | 'read'
    | 'failed';

export interface DeliveryCounts {
    total: number;
    delivered: number;
    read: number;
}

type DeliveryMetadata = Record<string, unknown> | null | undefined;

export function withDeliveryMetadata(
    metadata: DeliveryMetadata,
    state: MessageDeliveryState,
    deliveryCounts?: DeliveryCounts,
): Record<string, unknown> {
    return {
        ...(metadata || {}),
        deliveryState: state,
        ...(deliveryCounts ? { deliveryCounts } : {}),
    };
}

export function deriveReceiptDeliveryState(params: {
    recipientCount: number;
    deliveredCount: number;
    readCount: number;
    legacyRead?: boolean;
}) {
    const counts: DeliveryCounts = {
        total: Math.max(0, params.recipientCount),
        delivered: Math.max(0, params.deliveredCount),
        read: Math.max(0, params.readCount),
    };

    let state: Extract<MessageDeliveryState, 'sent' | 'delivered' | 'read'> = 'sent';
    if (counts.read > 0 || params.legacyRead) {
        state = 'read';
    } else if (counts.delivered > 0) {
        state = 'delivered';
    }

    return { state, counts };
}

export function getDeliveryStateFromMetadata(
    metadata: DeliveryMetadata,
): MessageDeliveryState | null {
    if (!metadata || typeof metadata !== 'object') {
        return null;
    }

    const deliveryState = metadata.deliveryState;
    return typeof deliveryState === 'string'
        ? deliveryState as MessageDeliveryState
        : null;
}

export function getDeliveryCountsFromMetadata(
    metadata: DeliveryMetadata,
): DeliveryCounts | null {
    if (!metadata || typeof metadata !== 'object') {
        return null;
    }

    const counts = metadata.deliveryCounts;
    if (!counts || typeof counts !== 'object') {
        return null;
    }

    const typedCounts = counts as {
        total?: number;
        delivered?: number;
        read?: number;
    };
    const total = typeof typedCounts.total === 'number' ? typedCounts.total : null;
    const delivered = typeof typedCounts.delivered === 'number' ? typedCounts.delivered : null;
    const read = typeof typedCounts.read === 'number' ? typedCounts.read : null;

    if (total === null || delivered === null || read === null) {
        return null;
    }

    return { total, delivered, read };
}

export function getLastMessageDeliveryState(
    lastMessage: { metadata?: DeliveryMetadata } | null | undefined,
) {
    return getDeliveryStateFromMetadata(lastMessage?.metadata);
}
