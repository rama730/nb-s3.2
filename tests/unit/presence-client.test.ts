import test from 'node:test';
import assert from 'node:assert/strict';

import {
    enqueuePendingPresenceEvent,
    getPresenceRoomCountForTests,
    isPresenceTokenRequestRetryable,
    resetPresenceClientForTests,
    subscribePresenceRoom,
} from '@/lib/realtime/presence-client';

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

test('isPresenceTokenRequestRetryable stops reconnect storms for configuration failures', () => {
    assert.equal(
        isPresenceTokenRequestRetryable(500, 'Presence service is not configured for this environment.'),
        false
    );
    assert.equal(
        isPresenceTokenRequestRetryable(500, 'PRESENCE_TOKEN_SECRET is required to issue presence room tokens'),
        false
    );
    assert.equal(
        isPresenceTokenRequestRetryable(500, 'Failed to issue presence room token'),
        true
    );
    assert.equal(
        isPresenceTokenRequestRetryable(429, 'Presence token rate limit exceeded'),
        true
    );
});

test('subscribePresenceRoom reuses the same room during strict-mode style remounts', async () => {
    resetPresenceClientForTests();

    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    const originalWebSocket = globalThis.WebSocket;

    let fetchCount = 0;
    const sentMessages: string[] = [];

    class FakeWebSocket {
        static OPEN = 1;
        static CONNECTING = 0;
        static CLOSED = 3;
        readyState = FakeWebSocket.CONNECTING;
        onopen: (() => void) | null = null;
        onmessage: ((message: { data: string }) => void) | null = null;
        onerror: (() => void) | null = null;
        onclose: (() => void) | null = null;

        constructor(_url: string) {
            setTimeout(() => {
                this.readyState = FakeWebSocket.OPEN;
                this.onopen?.();
            }, 0);
        }

        send(payload: string) {
            sentMessages.push(payload);
        }

        close() {
            this.readyState = FakeWebSocket.CLOSED;
            this.onclose?.();
        }
    }

    globalThis.fetch = async () => {
        fetchCount += 1;
        return new Response(
            JSON.stringify({
                ok: true,
                data: {
                    token: "presence-token",
                    wsUrl: "ws://presence.test/ws",
                },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
        );
    };
    globalThis.window = { location: { protocol: "https:", hostname: "edge.test" } } as Window & typeof globalThis;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    try {
        const first = subscribePresenceRoom({
            roomType: "workspace",
            roomId: "project-1",
        });
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.equal(fetchCount, 1);
        assert.equal(getPresenceRoomCountForTests(), 1);
        assert.equal(sentMessages.length > 0, true);
        assert.deepEqual(JSON.parse(sentMessages[0]!), {
            type: 'auth',
            token: 'presence-token',
        });

        first.unsubscribe();

        const second = subscribePresenceRoom({
            roomType: "workspace",
            roomId: "project-1",
        });
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.equal(fetchCount, 1);
        assert.equal(getPresenceRoomCountForTests(), 1);

        second.unsubscribe();
        await new Promise((resolve) => setTimeout(resolve, 1_700));

        assert.equal(getPresenceRoomCountForTests(), 0);
    } finally {
        resetPresenceClientForTests();
        globalThis.fetch = originalFetch;
        globalThis.window = originalWindow;
        globalThis.WebSocket = originalWebSocket;
    }
});
