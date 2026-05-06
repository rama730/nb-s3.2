import assert from 'node:assert/strict';
import test from 'node:test';

import type { MessageWithSender } from '@/app/actions/messaging';
import {
    createMessageThreadAnchorState,
    reduceAtBottomChange,
    reduceScrollToLatest,
    reduceUserScrollIntent,
    resolveLatestMessageTransition,
    shouldLoadOlderMessages,
} from '@/hooks/useMessageThreadAnchor';

function message(id: string, senderId: string | null = 'peer'): MessageWithSender {
    return {
        id,
        conversationId: 'conversation-1',
        senderId,
        clientMessageId: null,
        content: `message ${id}`,
        type: 'text',
        metadata: {},
        replyTo: null,
        createdAt: new Date('2026-04-26T10:00:00.000Z'),
        editedAt: null,
        deletedAt: null,
        sender: null,
        attachments: [],
    } as unknown as MessageWithSender;
}

test('message thread anchor scrolls to the first latest message in latest mode', () => {
    const state = createMessageThreadAnchorState(false);

    const transition = resolveLatestMessageTransition({
        state,
        latestMessage: message('m1'),
        previousLatestMessageId: null,
        viewerId: 'viewer-1',
    });

    assert.equal(transition.scroll, 'auto');
    assert.deepEqual(transition.state, reduceScrollToLatest());
});

test('temporary virtualizer bottom loss keeps sticky follow active for peer messages', () => {
    const state = reduceAtBottomChange(createMessageThreadAnchorState(false), false);

    const transition = resolveLatestMessageTransition({
        state,
        latestMessage: message('m2'),
        previousLatestMessageId: 'm1',
        viewerId: 'viewer-1',
    });

    assert.equal(state.followBottom, true);
    assert.equal(state.isAtLatest, true);
    assert.equal(transition.scroll, 'auto');
    assert.deepEqual(transition.state, reduceScrollToLatest());
});

test('bottom pixel jitter does not show jump affordance while latest item is visible', () => {
    const state = createMessageThreadAnchorState(false);

    const transition = reduceAtBottomChange(state, false, true);

    assert.deepEqual(transition, state);
});

test('manual upward scroll stops peer auto-follow and counts unread messages', () => {
    const state = reduceUserScrollIntent(createMessageThreadAnchorState(false), 'up');

    const transition = resolveLatestMessageTransition({
        state,
        latestMessage: message('m2'),
        previousLatestMessageId: 'm1',
        viewerId: 'viewer-1',
    });

    assert.equal(transition.scroll, false);
    assert.equal(transition.state.mode, 'manual');
    assert.equal(transition.state.followBottom, false);
    assert.equal(transition.state.unreadBelow, 1);
});

test('own message always returns the thread to latest mode', () => {
    const state = {
        ...reduceUserScrollIntent(createMessageThreadAnchorState(false), 'up'),
        unreadBelow: 2,
    };

    const transition = resolveLatestMessageTransition({
        state,
        latestMessage: message('m2', 'viewer-1'),
        previousLatestMessageId: 'm1',
        viewerId: 'viewer-1',
    });

    assert.equal(transition.scroll, 'auto');
    assert.deepEqual(transition.state, reduceScrollToLatest());
});

test('focused conversations do not auto-jump before the focus target is handled', () => {
    const state = createMessageThreadAnchorState(true);

    const transition = resolveLatestMessageTransition({
        state,
        latestMessage: message('m1'),
        previousLatestMessageId: null,
        viewerId: 'viewer-1',
    });

    assert.equal(transition.scroll, false);
    assert.deepEqual(transition.state, state);
});

test('history pagination is gated behind manual or focused navigation', () => {
    const latestState = createMessageThreadAnchorState(false);
    const manualState = reduceUserScrollIntent(latestState, 'up');
    const focusedState = createMessageThreadAnchorState(true);

    assert.equal(shouldLoadOlderMessages(latestState), false);
    assert.equal(shouldLoadOlderMessages(manualState), true);
    assert.equal(shouldLoadOlderMessages(focusedState), true);
});
