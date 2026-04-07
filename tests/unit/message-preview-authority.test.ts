import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildConversationLastMessageSnapshot,
    buildConversationParticipantPreview,
    shouldReplaceConversationLastMessage,
} from '@/lib/messages/preview-authority';

test('buildConversationParticipantPreview derives structured previews canonically', () => {
    const preview = buildConversationParticipantPreview({
        id: 'message-1',
        content: null,
        type: 'system',
        senderId: 'user-1',
        createdAt: '2026-04-07T10:00:00.000Z',
        metadata: {
            structured: {
                kind: 'project_invite',
                version: 1,
                layout: 'minimal_card',
                title: 'Project invite',
                summary: 'Join Alpha Project',
                contextChips: [],
                entityRefs: {},
                stateSnapshot: { status: 'pending', label: 'Pending' },
            },
        },
    });

    assert.deepEqual(preview, {
        lastMessageAt: new Date('2026-04-07T10:00:00.000Z'),
        lastMessageId: 'message-1',
        lastMessagePreview: 'Join Alpha Project',
        lastMessageType: 'project_invite',
        lastMessageSenderId: 'user-1',
    });
});

test('buildConversationLastMessageSnapshot normalizes a thread preview snapshot', () => {
    const snapshot = buildConversationLastMessageSnapshot({
        id: 'message-2',
        content: 'Hey there',
        type: 'text',
        senderId: 'user-2',
        createdAt: '2026-04-07T10:02:00.000Z',
        metadata: null,
    });

    assert.equal(snapshot?.id, 'message-2');
    assert.equal(snapshot?.content, 'Hey there');
    assert.equal(snapshot?.senderId, 'user-2');
    assert.equal(snapshot?.type, 'text');
    assert.equal(snapshot?.createdAt.toISOString(), '2026-04-07T10:02:00.000Z');
});

test('shouldReplaceConversationLastMessage preserves chronological authority', () => {
    const current = buildConversationLastMessageSnapshot({
        id: 'message-2',
        content: 'Current',
        type: 'text',
        senderId: 'user-2',
        createdAt: '2026-04-07T10:02:00.000Z',
        metadata: null,
    });

    assert.equal(shouldReplaceConversationLastMessage(current, {
        id: 'message-1',
        content: 'Older',
        type: 'text',
        senderId: 'user-1',
        createdAt: '2026-04-07T10:01:00.000Z',
        metadata: null,
    }), false);

    assert.equal(shouldReplaceConversationLastMessage(current, {
        id: 'message-3',
        content: 'Newer',
        type: 'text',
        senderId: 'user-3',
        createdAt: '2026-04-07T10:03:00.000Z',
        metadata: null,
    }), true);
});
