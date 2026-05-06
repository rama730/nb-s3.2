import assert from 'node:assert/strict';
import test from 'node:test';

import {
    deriveMessageAttention,
    extractMessageBurstConversationId,
    getEffectiveMessageAttentionUnreadCount,
    mergeMessageAttention,
} from '@/lib/messages/attention';

test('deriveMessageAttention returns non-numeric attention for unread peer messages', () => {
    const attention = deriveMessageAttention({
        id: 'conversation-1',
        unreadCount: 3,
        lastMessage: { id: 'message-3', senderId: 'peer-1' },
    }, 'viewer-1');

    assert.equal(attention?.conversationId, 'conversation-1');
    assert.equal(attention?.hasNewMessages, true);
    assert.equal(attention?.latestNewMessageId, 'message-3');
    assert.equal(attention?.source, 'startup-sync');
});

test('deriveMessageAttention ignores conversations without new incoming work', () => {
    assert.equal(deriveMessageAttention({
        id: 'conversation-1',
        unreadCount: 0,
        lastMessage: { id: 'message-1', senderId: 'peer-1' },
    }, 'viewer-1'), null);

    assert.equal(deriveMessageAttention({
        id: 'conversation-2',
        unreadCount: 1,
        lastMessage: { id: 'message-2', senderId: 'viewer-1' },
    }, 'viewer-1'), null);
});

test('deriveMessageAttention ignores stale unread counts when latest watermark is already read', () => {
    const byMessageId = {
        id: 'conversation-1',
        unreadCount: 1,
        lastReadMessageId: 'message-2',
        lastMessage: { id: 'message-2', senderId: 'peer-1', createdAt: '2026-05-01T23:51:30.544Z' },
    };
    assert.equal(getEffectiveMessageAttentionUnreadCount(byMessageId, 'viewer-1'), 0);
    assert.equal(deriveMessageAttention(byMessageId, 'viewer-1'), null);

    const byReadTimestamp = {
        id: 'conversation-2',
        unreadCount: 1,
        lastReadAt: '2026-05-01T23:51:30.544Z',
        lastMessage: { id: 'message-3', senderId: 'peer-1', createdAt: '2026-05-01T23:51:30.544Z' },
    };
    assert.equal(getEffectiveMessageAttentionUnreadCount(byReadTimestamp, 'viewer-1'), 0);
    assert.equal(deriveMessageAttention(byReadTimestamp, 'viewer-1'), null);
});

test('mergeMessageAttention preserves the first new message while refreshing the latest marker', () => {
    const current = deriveMessageAttention({
        id: 'conversation-1',
        unreadCount: 1,
        lastMessage: { id: 'message-1', senderId: 'peer-1' },
    }, 'viewer-1', 'notification');
    const next = deriveMessageAttention({
        id: 'conversation-1',
        unreadCount: 2,
        lastMessage: { id: 'message-2', senderId: 'peer-1' },
    }, 'viewer-1', 'realtime');

    assert.ok(current);
    assert.ok(next);
    const merged = mergeMessageAttention(current, next);
    assert.equal(merged.firstNewMessageId, 'message-1');
    assert.equal(merged.latestNewMessageId, 'message-2');
    assert.equal(merged.source, 'notification');
    assert.equal(merged.clearing, false);
});

test('extractMessageBurstConversationId only resolves message burst notifications', () => {
    assert.equal(extractMessageBurstConversationId({
        kind: 'message_burst',
        entityRefs: { conversationId: 'conversation-1' },
    }), 'conversation-1');
    assert.equal(extractMessageBurstConversationId({
        kind: 'task_assigned',
        entityRefs: { conversationId: 'conversation-1' },
    }), null);
});
