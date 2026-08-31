import assert from 'node:assert/strict';
import test from 'node:test';

import type { MessageWithSender } from '@/app/actions/messaging';
import { buildMessageThreadModel } from '@/lib/messages/thread-items';

function message(id: string, senderId: string, createdAt: string): MessageWithSender {
    return {
        id,
        conversationId: 'conversation-1',
        senderId,
        clientMessageId: null,
        content: `message ${id}`,
        type: 'text',
        metadata: {},
        replyTo: null,
        createdAt: new Date(createdAt),
        editedAt: null,
        deletedAt: null,
        sender: null,
        attachments: [],
    };
}

test('message thread model groups messages by day and marks unread messages without UI source-text contracts', () => {
    const model = buildMessageThreadModel({
        conversationId: 'conversation-1',
        viewerId: 'viewer-1',
        viewerUnreadCount: 2,
        messages: [
            message('m1', 'viewer-1', '2026-07-07T12:00:00.000Z'),
            message('m2', 'peer-1', '2026-07-08T12:00:00.000Z'),
            message('m3', 'peer-1', '2026-07-08T12:01:00.000Z'),
        ],
    });

    assert.deepEqual(model.unreadMessageIds, ['m2', 'm3']);
    assert.deepEqual(model.items.map((item) => item.type), [
        'date',
        'message',
        'date',
        'unread-divider',
        'message',
        'message',
    ]);
    assert.equal(model.items.find((item) => item.type === 'unread-divider')?.id, 'unread-divider-conversation-1');
});
