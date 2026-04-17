import assert from 'node:assert/strict';
import test from 'node:test';

import {
    areConversationPreviewStatesEqual,
    areMessageDeliveryRenderStatesEqual,
} from '@/lib/messages/v2-render-state';

test('conversation preview render state changes when delivery metadata changes', () => {
    const prev = {
        id: 'message-2',
        content: 'latest',
        metadata: {
            deliveryState: 'sent',
            deliveryCounts: { total: 1, delivered: 0, read: 0 },
        },
    };
    const next = {
        ...prev,
        metadata: {
            deliveryState: 'read',
            deliveryCounts: { total: 1, delivered: 1, read: 1 },
        },
    };

    assert.equal(areConversationPreviewStatesEqual(prev, next), false);
});

test('message render state changes when delivery-state changes without content changes', () => {
    const prev = {
        id: 'message-1',
        content: 'hello',
        editedAt: null,
        deletedAt: null,
        metadata: {
            deliveryState: 'sent',
            deliveryCounts: { total: 1, delivered: 0, read: 0 },
        },
    };
    const next = {
        ...prev,
        metadata: {
            deliveryState: 'delivered',
            deliveryCounts: { total: 1, delivered: 1, read: 0 },
        },
    };

    assert.equal(areMessageDeliveryRenderStatesEqual(prev, next), false);
});
