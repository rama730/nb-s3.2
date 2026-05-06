import assert from 'node:assert/strict';
import test from 'node:test';

import type { MessageWithSender } from '@/app/actions/messaging';
import {
    buildMessageThreadGroupHeaderIndexes,
    buildMessageThreadItems,
    buildMessageThreadModel,
} from '@/lib/messages/thread-items';

function message(
    id: string,
    senderId: string | null,
    options: { deleted?: boolean; createdAt?: string } = {},
): MessageWithSender {
    return {
        id,
        conversationId: 'conversation-1',
        senderId,
        clientMessageId: null,
        content: `message ${id}`,
        type: 'text',
        metadata: {},
        replyTo: null,
        createdAt: new Date(options.createdAt ?? '2026-04-26T10:00:00.000Z'),
        editedAt: null,
        deletedAt: options.deleted ? new Date('2026-04-26T10:01:00.000Z') : null,
        sender: null,
        attachments: [],
    } as unknown as MessageWithSender;
}

function unreadDividerCount(items: ReturnType<typeof buildMessageThreadItems>) {
    return items.filter((item) => item.type === 'unread-divider').length;
}

test('thread unread divider ignores deleted and own messages at the tail', () => {
    const items = buildMessageThreadItems({
        conversationId: 'conversation-1',
        viewerId: 'viewer-1',
        viewerUnreadCount: 2,
        messages: [
            message('own-1', 'viewer-1'),
            message('deleted-peer-1', 'peer-1', { deleted: true }),
            message('own-2', 'viewer-1'),
        ],
    });

    assert.equal(unreadDividerCount(items), 0);
});

test('thread unread divider anchors to the first visible unread peer message', () => {
    const model = buildMessageThreadModel({
        conversationId: 'conversation-1',
        viewerId: 'viewer-1',
        viewerUnreadCount: 2,
        messages: [
            message('own-1', 'viewer-1'),
            message('peer-1', 'peer-1'),
            message('own-2', 'viewer-1'),
            message('peer-2', 'peer-1'),
        ],
    });
    const items = model.items;

    const dividerIndex = items.findIndex((item) => item.type === 'unread-divider');
    const nextMessage = items.slice(dividerIndex + 1).find((item) => item.type === 'message');

    assert.notEqual(dividerIndex, -1);
    assert.equal(nextMessage?.id, 'peer-1');
    assert.deepEqual(model.unreadMessageIds, ['peer-1', 'peer-2']);
});

test('thread unread watermark ids include only unread peer and system messages', () => {
    const model = buildMessageThreadModel({
        conversationId: 'conversation-1',
        viewerId: 'viewer-1',
        viewerUnreadCount: 3,
        messages: [
            message('own-1', 'viewer-1', { createdAt: '2026-04-26T10:00:00.000Z' }),
            message('peer-1', 'peer-1', { createdAt: '2026-04-26T10:01:00.000Z' }),
            message('system-1', null, { createdAt: '2026-04-26T10:02:00.000Z' }),
            message('deleted-peer-1', 'peer-1', { createdAt: '2026-04-26T10:03:00.000Z', deleted: true }),
            message('peer-2', 'peer-1', { createdAt: '2026-04-26T10:04:00.000Z' }),
        ],
    });

    assert.deepEqual(model.unreadMessageIds, ['peer-1', 'system-1', 'peer-2']);
});

test('thread unread divider count clamps to visible unread candidates', () => {
    const model = buildMessageThreadModel({
        conversationId: 'conversation-1',
        viewerId: 'viewer-1',
        viewerUnreadCount: 99,
        messages: [
            message('own-1', 'viewer-1', { createdAt: '2026-04-26T10:00:00.000Z' }),
            message('peer-1', 'peer-1', { createdAt: '2026-04-26T10:01:00.000Z' }),
            message('peer-2', 'peer-1', { createdAt: '2026-04-26T10:02:00.000Z' }),
        ],
    });

    const divider = model.items.find((item) => item.type === 'unread-divider');
    assert.equal(divider?.type, 'unread-divider');
    assert.equal(divider?.count, 2);
});

test('thread dates are grouped as virtualizer headers instead of scrollable rows', () => {
    const model = buildMessageThreadModel({
        conversationId: 'conversation-1',
        viewerId: 'viewer-1',
        viewerUnreadCount: 0,
        messages: [
            message('apr-26-1', 'peer-1', { createdAt: '2026-04-26T10:00:00.000Z' }),
            message('apr-26-2', 'viewer-1', { createdAt: '2026-04-26T11:00:00.000Z' }),
            message('apr-27-1', 'peer-1', { createdAt: '2026-04-27T10:00:00.000Z' }),
        ],
    });

    assert.deepEqual(model.groupCounts, [2, 1]);
    assert.equal(model.groups.length, 2);
    assert.equal(model.groups[0].items[0].id, 'apr-26-1');
    assert.equal(model.groups[1].items[0].id, 'apr-27-1');
    assert.equal(model.items.length, 3);
    assert.equal(model.items.some((item) => item.type === 'unread-divider'), false);
});

test('thread model normalizes unordered cache pages before assigning date groups', () => {
    const model = buildMessageThreadModel({
        conversationId: 'conversation-1',
        viewerId: 'viewer-1',
        viewerUnreadCount: 0,
        messages: [
            message('apr-30-2', 'viewer-1', { createdAt: '2026-04-30T11:00:00.000Z' }),
            message('apr-25-1', 'peer-1', { createdAt: '2026-04-25T10:00:00.000Z' }),
            message('apr-30-1', 'peer-1', { createdAt: '2026-04-30T10:00:00.000Z' }),
        ],
    });

    assert.deepEqual(
        model.messages.map((entry) => entry.id),
        ['apr-25-1', 'apr-30-1', 'apr-30-2'],
    );
    assert.deepEqual(model.groupCounts, [1, 2]);
    assert.deepEqual(model.groupHeaderIndexes, [0, 2]);
    assert.deepEqual(model.groupIndexByDataIndex, [0, 1, 1]);
    assert.deepEqual(
        model.groups.map((group) => group.items.map((item) => item.id)),
        [['apr-25-1'], ['apr-30-1', 'apr-30-2']],
    );
});

test('latest same-day messages stay in the newest group after historical pages', () => {
    const model = buildMessageThreadModel({
        conversationId: 'conversation-1',
        viewerId: 'viewer-1',
        viewerUnreadCount: 0,
        messages: [
            message('apr-27-history', 'peer-1', { createdAt: '2026-04-27T10:00:00.000Z' }),
            message('apr-25-history', 'viewer-1', { createdAt: '2026-04-25T10:00:00.000Z' }),
            message('apr-30-peer', 'peer-1', { createdAt: '2026-04-30T15:19:20.000Z' }),
            message('apr-30-own-ok', 'viewer-1', { createdAt: '2026-04-30T15:19:53.000Z' }),
        ],
    });

    assert.deepEqual(
        model.groups.map((group) => group.items.map((item) => item.id)),
        [['apr-25-history'], ['apr-27-history'], ['apr-30-peer', 'apr-30-own-ok']],
    );
    assert.equal(model.groups.at(-1)?.items.at(-1)?.id, 'apr-30-own-ok');
});

test('peer avatars are assigned to the tail of each sender run', () => {
    const model = buildMessageThreadModel({
        conversationId: 'conversation-1',
        viewerId: 'viewer-1',
        viewerUnreadCount: 0,
        messages: [
            message('own-before', 'viewer-1', { createdAt: '2026-04-30T10:00:00.000Z' }),
            message('peer-1', 'peer-1', { createdAt: '2026-04-30T10:01:00.000Z' }),
            message('peer-2', 'peer-1', { createdAt: '2026-04-30T10:02:00.000Z' }),
            message('own-after', 'viewer-1', { createdAt: '2026-04-30T10:03:00.000Z' }),
            message('peer-isolated', 'peer-1', { createdAt: '2026-04-30T10:04:00.000Z' }),
        ],
    });

    const avatarById = new Map(
        model.items
            .filter((item) => item.type === 'message')
            .map((item) => [item.id, item.showAvatar] as const),
    );

    assert.equal(avatarById.get('own-before'), false);
    assert.equal(avatarById.get('peer-1'), false);
    assert.equal(avatarById.get('peer-2'), true);
    assert.equal(avatarById.get('own-after'), false);
    assert.equal(avatarById.get('peer-isolated'), true);
});

test('thread group header indexes use the virtualizer flat index space', () => {
    assert.deepEqual(
        buildMessageThreadGroupHeaderIndexes([2, 3, 1]),
        [0, 3, 7],
    );
});
