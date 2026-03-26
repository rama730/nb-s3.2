import test from 'node:test';
import assert from 'node:assert/strict';

import { enqueuePendingPresenceEvent } from '@/lib/realtime/presence-client';

test('enqueuePendingPresenceEvent coalesces typing events to the latest state', () => {
    const queue = enqueuePendingPresenceEvent([], {
        type: 'typing',
        isTyping: true,
        profile: null,
    });

    const nextQueue = enqueuePendingPresenceEvent(queue, {
        type: 'typing',
        isTyping: false,
        profile: null,
    });

    assert.equal(nextQueue.length, 1);
    assert.deepEqual(nextQueue[0], {
        type: 'typing',
        isTyping: false,
        profile: null,
    });
});

test('enqueuePendingPresenceEvent keeps the latest cursor frame only once', () => {
    const queue = enqueuePendingPresenceEvent([], {
        type: 'cursor',
        frame: 'frame-a',
    });

    const nextQueue = enqueuePendingPresenceEvent(queue, {
        type: 'cursor',
        frame: 'frame-b',
    });

    assert.equal(nextQueue.length, 1);
    assert.deepEqual(nextQueue[0], {
        type: 'cursor',
        frame: 'frame-b',
    });
});

test('enqueuePendingPresenceEvent ignores heartbeat events while preserving queued updates', () => {
    const queue = enqueuePendingPresenceEvent([], {
        type: 'typing',
        isTyping: true,
        profile: null,
    });

    const nextQueue = enqueuePendingPresenceEvent(queue, {
        type: 'heartbeat',
    });

    assert.equal(nextQueue.length, 1);
    assert.deepEqual(nextQueue[0], {
        type: 'typing',
        isTyping: true,
        profile: null,
    });
});
