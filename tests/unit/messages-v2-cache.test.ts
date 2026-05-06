import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';

import type { MessageWithSender } from '@/app/actions/messaging';
import type { InboxConversationV2, MessageThreadPageV2, ConversationCapabilityV2 } from '@/app/actions/messaging/v2';
import {
    clearPendingReadCommitState,
    getPendingReadCommitState,
    isCachedConversationLastMessage,
    patchConversationLastMessageFromMessage,
    patchThreadMessage,
    replaceThreadSnapshot,
    setPendingReadCommitState,
    upsertInboxConversation,
    upsertThreadConversation,
} from '@/lib/messages/v2-cache';
import { mergeMessageCollections, pickPreferredMessage } from '@/lib/messages/utils';
import { queryKeys } from '@/lib/query-keys';
import { createStructuredMessagePayload } from '@/lib/messages/structured';

function createCapability(): ConversationCapabilityV2 {
    return {
        conversationType: 'dm',
        status: 'connected',
        canSend: true,
        blocked: false,
        messagePrivacy: 'connections',
        isConnected: true,
        isPendingIncoming: false,
        isPendingOutgoing: false,
        canInvite: true,
        connectionId: 'connection-1',
        hasActiveApplication: false,
        isApplicant: false,
        isCreator: false,
        activeApplicationId: null,
        activeApplicationStatus: null,
        activeProjectId: null,
    };
}

function createConversation(lastMessageId: string, createdAt: Date): InboxConversationV2 {
    return {
        id: 'conversation-1',
        type: 'dm',
        updatedAt: createdAt,
        lifecycleState: 'active',
        muted: false,
        participants: [
            {
                id: 'user-2',
                username: 'other-user',
                fullName: 'Other User',
                avatarUrl: null,
            },
        ],
        lastMessage: {
            id: lastMessageId,
            content: 'hello',
            senderId: 'user-2',
            createdAt,
            type: 'text',
        },
        unreadCount: 0,
        lastReadAt: null,
        lastReadMessageId: null,
        capability: createCapability(),
    };
}

function createMessage(id: string, createdAt: Date): MessageWithSender {
    return {
        id,
        conversationId: 'conversation-1',
        senderId: 'user-2',
        clientMessageId: null,
        content: 'hello',
        type: 'text',
        metadata: {},
        replyTo: null,
        createdAt,
        editedAt: null,
        deletedAt: null,
        sender: null,
        attachments: [],
    };
}

test('pickPreferredMessage prefers a canonical server message over a temp message on tied timestamps', () => {
    const createdAt = new Date('2026-04-07T10:00:00.000Z');
    const tempMessage = createMessage('temp-client-1', createdAt);
    const serverMessage = {
        ...createMessage('message-1', createdAt),
        clientMessageId: 'client-1',
    };

    assert.equal(pickPreferredMessage(tempMessage, serverMessage).id, 'message-1');
    assert.equal(pickPreferredMessage(serverMessage, tempMessage).id, 'message-1');
});

test('patchConversationLastMessageFromMessage updates both thread and inbox previews for newer messages', () => {
    const queryClient = new QueryClient();
    const initialCreatedAt = new Date('2026-04-07T10:00:00.000Z');
    const nextCreatedAt = new Date('2026-04-07T10:05:00.000Z');
    const initialConversation = createConversation('message-1', initialCreatedAt);

    queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
        pages: [{ conversations: [initialConversation], hasMore: false, nextCursor: null }],
        pageParams: [undefined],
    });
    queryClient.setQueryData<{ pages: MessageThreadPageV2[]; pageParams: Array<string | undefined> }>(
        queryKeys.messages.v2.thread('conversation-1'),
        {
            pages: [{
                conversation: initialConversation,
                capability: initialConversation.capability,
                messages: [createMessage('message-1', initialCreatedAt)],
                pinnedMessages: [],
                hasMore: false,
                nextCursor: null,
            }],
            pageParams: [undefined],
        },
    );

    patchConversationLastMessageFromMessage(queryClient, 'conversation-1', {
        id: 'message-2',
        content: 'new preview',
        senderId: 'user-2',
        createdAt: nextCreatedAt,
        type: 'text',
    });

    const inboxData = queryClient.getQueryData<{ pages: Array<{ conversations: InboxConversationV2[] }> }>(
        queryKeys.messages.v2.inbox(20),
    );
    const threadData = queryClient.getQueryData<{ pages: MessageThreadPageV2[] }>(
        queryKeys.messages.v2.thread('conversation-1'),
    );

    assert.equal(inboxData?.pages[0]?.conversations[0]?.lastMessage?.id, 'message-2');
    assert.equal(threadData?.pages[0]?.conversation.lastMessage?.id, 'message-2');
    assert.equal(isCachedConversationLastMessage(queryClient, 'conversation-1', 'message-2'), true);
});

test('patchConversationLastMessageFromMessage derives preview text from structured metadata', () => {
    const queryClient = new QueryClient();
    const initialCreatedAt = new Date('2026-04-07T10:00:00.000Z');
    const nextCreatedAt = new Date('2026-04-07T10:05:00.000Z');
    const initialConversation = createConversation('message-1', initialCreatedAt);
    const structured = createStructuredMessagePayload({
        kind: 'handoff_summary',
        title: 'Handoff summary',
        summary: 'Frontend is complete and ready for review',
        stateSnapshot: { status: 'shared', label: 'Shared' },
    });
    assert.ok(structured);

    queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
        pages: [{ conversations: [initialConversation], hasMore: false, nextCursor: null }],
        pageParams: [undefined],
    });

    patchConversationLastMessageFromMessage(queryClient, 'conversation-1', {
        id: 'message-2',
        content: null,
        senderId: 'user-2',
        createdAt: nextCreatedAt,
        type: 'text',
        metadata: {
            structured,
        },
    });

    const inboxData = queryClient.getQueryData<{ pages: Array<{ conversations: InboxConversationV2[] }> }>(
        queryKeys.messages.v2.inbox(20),
    );

    assert.equal(
        inboxData?.pages[0]?.conversations[0]?.lastMessage?.content,
        'Frontend is complete and ready for review (Shared)',
    );
    assert.equal(
        inboxData?.pages[0]?.conversations[0]?.lastMessage?.type,
        'handoff_summary',
    );
});

test('patchConversationLastMessageFromMessage preserves delivery metadata for last-message icons', () => {
    const queryClient = new QueryClient();
    const initialCreatedAt = new Date('2026-04-07T10:00:00.000Z');
    const nextCreatedAt = new Date('2026-04-07T10:05:00.000Z');
    const initialConversation = createConversation('message-1', initialCreatedAt);

    queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
        pages: [{ conversations: [initialConversation], hasMore: false, nextCursor: null }],
        pageParams: [undefined],
    });

    patchConversationLastMessageFromMessage(queryClient, 'conversation-1', {
        id: 'message-2',
        content: 'latest',
        senderId: 'user-2',
        createdAt: nextCreatedAt,
        type: 'text',
        metadata: {
            deliveryState: 'delivered',
            deliveryCounts: { total: 1, delivered: 1, read: 0 },
        },
    });

    const inboxData = queryClient.getQueryData<{ pages: Array<{ conversations: InboxConversationV2[] }> }>(
        queryKeys.messages.v2.inbox(20),
    );

    assert.deepEqual(
        inboxData?.pages[0]?.conversations[0]?.lastMessage?.metadata,
        {
            deliveryState: 'delivered',
            deliveryCounts: { total: 1, delivered: 1, read: 0 },
        },
    );
});

test('patchConversationLastMessageFromMessage does not overwrite a newer preview with an older message', () => {
    const queryClient = new QueryClient();
    const newestCreatedAt = new Date('2026-04-07T10:05:00.000Z');
    const olderCreatedAt = new Date('2026-04-07T10:00:00.000Z');
    const initialConversation = createConversation('message-2', newestCreatedAt);

    queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
        pages: [{ conversations: [initialConversation], hasMore: false, nextCursor: null }],
        pageParams: [undefined],
    });

    patchConversationLastMessageFromMessage(queryClient, 'conversation-1', {
        id: 'message-1',
        content: 'older preview',
        senderId: 'user-2',
        createdAt: olderCreatedAt,
        type: 'text',
    });

    const inboxData = queryClient.getQueryData<{ pages: Array<{ conversations: InboxConversationV2[] }> }>(
        queryKeys.messages.v2.inbox(20),
    );

    assert.equal(inboxData?.pages[0]?.conversations[0]?.lastMessage?.id, 'message-2');
});

test('mergeMessageCollections ignores malformed collections instead of crashing', () => {
    const createdAt = new Date('2026-04-07T10:00:00.000Z');
    const message = createMessage('message-1', createdAt);

    assert.deepEqual(
        mergeMessageCollections(
            undefined as unknown as ReadonlyArray<MessageWithSender>,
            [message],
        ),
        [message],
    );
});

test('replaceThreadSnapshot drops overlapping stale pages while preserving older history', () => {
    const queryClient = new QueryClient();
    const latestAt = new Date('2026-04-30T11:00:00.000Z');
    const overlapAt = new Date('2026-04-30T10:30:00.000Z');
    const snapshotOldestAt = new Date('2026-04-30T10:00:00.000Z');
    const olderAt = new Date('2026-04-29T10:00:00.000Z');
    const conversation = createConversation('latest', latestAt);

    queryClient.setQueryData<{ pages: MessageThreadPageV2[]; pageParams: Array<string | undefined> }>(
        queryKeys.messages.v2.thread('conversation-1'),
        {
            pages: [
                {
                    conversation,
                    capability: conversation.capability,
                    messages: [createMessage('latest', latestAt)],
                    pinnedMessages: [],
                    hasMore: true,
                    nextCursor: 'cursor-1',
                },
                {
                    conversation,
                    capability: conversation.capability,
                    messages: [
                        createMessage('overlap', overlapAt),
                        createMessage('older', olderAt),
                    ],
                    pinnedMessages: [],
                    hasMore: true,
                    nextCursor: 'cursor-2',
                },
            ],
            pageParams: [undefined, 'cursor-1'],
        },
    );

    replaceThreadSnapshot(queryClient, 'conversation-1', {
        conversation,
        capability: conversation.capability,
        messages: [
            createMessage('latest', latestAt),
            createMessage('snapshot-oldest', snapshotOldestAt),
        ],
        pinnedMessages: [],
        hasMore: true,
        nextCursor: 'snapshot-cursor',
    });

    const data = queryClient.getQueryData<{ pages: MessageThreadPageV2[]; pageParams: Array<string | undefined> }>(
        queryKeys.messages.v2.thread('conversation-1'),
    );

    assert.deepEqual(
        data?.pages.flatMap((page) => page.messages.map((entry) => entry.id)),
        ['snapshot-oldest', 'latest', 'older'],
    );
    assert.deepEqual(data?.pageParams, [undefined, 'cursor-1']);
});

test('replaceThreadSnapshot preserves cached messages newer than a stale snapshot', () => {
    const queryClient = new QueryClient();
    const staleSnapshotAt = new Date('2026-04-30T11:00:00.000Z');
    const newerRealtimeAt = new Date('2026-04-30T11:05:00.000Z');
    const staleConversation = createConversation('snapshot-latest', staleSnapshotAt);
    const currentConversation = createConversation('newer-realtime', newerRealtimeAt);

    queryClient.setQueryData<{ pages: MessageThreadPageV2[]; pageParams: Array<string | undefined> }>(
        queryKeys.messages.v2.thread('conversation-1'),
        {
            pages: [{
                conversation: currentConversation,
                capability: currentConversation.capability,
                messages: [
                    createMessage('snapshot-latest', staleSnapshotAt),
                    createMessage('newer-realtime', newerRealtimeAt),
                ],
                pinnedMessages: [],
                hasMore: false,
                nextCursor: null,
            }],
            pageParams: [undefined],
        },
    );

    replaceThreadSnapshot(queryClient, 'conversation-1', {
        conversation: staleConversation,
        capability: staleConversation.capability,
        messages: [createMessage('snapshot-latest', staleSnapshotAt)],
        pinnedMessages: [],
        hasMore: false,
        nextCursor: null,
    });

    const data = queryClient.getQueryData<{ pages: MessageThreadPageV2[]; pageParams: Array<string | undefined> }>(
        queryKeys.messages.v2.thread('conversation-1'),
    );

    assert.deepEqual(
        data?.pages.flatMap((page) => page.messages.map((entry) => entry.id)),
        ['snapshot-latest', 'newer-realtime'],
    );
    assert.equal(data?.pages[0]?.conversation.lastMessage?.id, 'newer-realtime');
});

test('patchThreadMessage updates every loaded page and pinned copy', () => {
    const queryClient = new QueryClient();
    const latestAt = new Date('2026-04-30T11:00:00.000Z');
    const olderAt = new Date('2026-04-30T10:00:00.000Z');
    const conversation = createConversation('latest', latestAt);
    const olderMessage = createMessage('older', olderAt);

    queryClient.setQueryData<{ pages: MessageThreadPageV2[]; pageParams: Array<string | undefined> }>(
        queryKeys.messages.v2.thread('conversation-1'),
        {
            pages: [
                {
                    conversation,
                    capability: conversation.capability,
                    messages: [createMessage('latest', latestAt)],
                    pinnedMessages: [olderMessage],
                    hasMore: true,
                    nextCursor: 'cursor-1',
                },
                {
                    conversation,
                    capability: conversation.capability,
                    messages: [olderMessage],
                    pinnedMessages: [],
                    hasMore: false,
                    nextCursor: null,
                },
            ],
            pageParams: [undefined, 'cursor-1'],
        },
    );

    patchThreadMessage(queryClient, 'conversation-1', 'older', (message) => ({
        ...message,
        metadata: {
            ...(message.metadata || {}),
            reactionSummary: [{ emoji: '👍', count: 1, viewerReacted: true }],
        },
    }));

    const data = queryClient.getQueryData<{ pages: MessageThreadPageV2[] }>(
        queryKeys.messages.v2.thread('conversation-1'),
    );

    assert.deepEqual(data?.pages[1]?.messages[0]?.metadata?.reactionSummary, [
        { emoji: '👍', count: 1, viewerReacted: true },
    ]);
    assert.deepEqual(data?.pages[0]?.pinnedMessages[0]?.metadata?.reactionSummary, [
        { emoji: '👍', count: 1, viewerReacted: true },
    ]);
});

test('upsertInboxConversation does not regress a newer last-message preview', () => {
    const queryClient = new QueryClient();
    const olderAt = new Date('2026-04-30T11:00:00.000Z');
    const newerAt = new Date('2026-04-30T11:05:00.000Z');
    const currentConversation = createConversation('newer-message', newerAt);
    const staleConversation = createConversation('older-message', olderAt);

    queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
        pages: [{ conversations: [currentConversation], hasMore: false, nextCursor: null }],
        pageParams: [undefined],
    });

    upsertInboxConversation(queryClient, staleConversation);

    const inboxData = queryClient.getQueryData<{ pages: Array<{ conversations: InboxConversationV2[] }> }>(
        queryKeys.messages.v2.inbox(20),
    );

    assert.equal(inboxData?.pages[0]?.conversations[0]?.lastMessage?.id, 'newer-message');
});

test('upsertInboxConversation preserves a local unread clear against stale summaries', () => {
    const queryClient = new QueryClient();
    const latestAt = new Date('2026-04-30T11:05:00.000Z');
    const currentConversation = {
        ...createConversation('latest-message', latestAt),
        unreadCount: 0,
        lastReadAt: latestAt,
        lastReadMessageId: 'latest-message',
    };
    const staleConversation = {
        ...createConversation('latest-message', latestAt),
        unreadCount: 1,
    };

    queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
        pages: [{ conversations: [currentConversation], hasMore: false, nextCursor: null }],
        pageParams: [undefined],
    });

    upsertInboxConversation(queryClient, staleConversation);

    const inboxData = queryClient.getQueryData<{ pages: Array<{ conversations: InboxConversationV2[] }> }>(
        queryKeys.messages.v2.inbox(20),
    );

    assert.equal(inboxData?.pages[0]?.conversations[0]?.unreadCount, 0);
});

test('upsertInboxConversation does not resurrect unread for same-timestamp UUID ties', () => {
    const queryClient = new QueryClient();
    const sharedAt = new Date('2026-04-30T11:05:00.000Z');
    const currentConversation = {
        ...createConversation('10000000-0000-4000-8000-000000000000', sharedAt),
        unreadCount: 0,
        lastReadAt: sharedAt,
        lastReadMessageId: '10000000-0000-4000-8000-000000000000',
    };
    const staleConversation = {
        ...createConversation('f0000000-0000-4000-8000-000000000000', sharedAt),
        unreadCount: 1,
    };

    queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
        pages: [{ conversations: [currentConversation], hasMore: false, nextCursor: null }],
        pageParams: [undefined],
    });

    upsertInboxConversation(queryClient, staleConversation);

    const inboxData = queryClient.getQueryData<{ pages: Array<{ conversations: InboxConversationV2[] }> }>(
        queryKeys.messages.v2.inbox(20),
    );

    assert.equal(inboxData?.pages[0]?.conversations[0]?.unreadCount, 0);
});

test('upsertInboxConversation accepts unread count when a newer message arrives after a local clear', () => {
    const queryClient = new QueryClient();
    const olderAt = new Date('2026-04-30T11:00:00.000Z');
    const newerAt = new Date('2026-04-30T11:05:00.000Z');
    const currentConversation = {
        ...createConversation('older-message', olderAt),
        unreadCount: 0,
        lastReadAt: olderAt,
        lastReadMessageId: 'older-message',
    };
    const nextConversation = {
        ...createConversation('newer-message', newerAt),
        unreadCount: 1,
    };

    queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
        pages: [{ conversations: [currentConversation], hasMore: false, nextCursor: null }],
        pageParams: [undefined],
    });

    upsertInboxConversation(queryClient, nextConversation);

    const inboxData = queryClient.getQueryData<{ pages: Array<{ conversations: InboxConversationV2[] }> }>(
        queryKeys.messages.v2.inbox(20),
    );

    assert.equal(inboxData?.pages[0]?.conversations[0]?.unreadCount, 1);
    assert.equal(inboxData?.pages[0]?.conversations[0]?.lastMessage?.id, 'newer-message');
});

test('upsertThreadConversation keeps thread and inbox unread clear in sync against stale summaries', () => {
    const queryClient = new QueryClient();
    const latestAt = new Date('2026-04-30T11:05:00.000Z');
    const currentConversation = {
        ...createConversation('latest-message', latestAt),
        unreadCount: 0,
        lastReadAt: latestAt,
        lastReadMessageId: 'latest-message',
    };
    const staleConversation = {
        ...createConversation('latest-message', latestAt),
        unreadCount: 1,
    };

    queryClient.setQueryData(queryKeys.messages.v2.inbox(20), {
        pages: [{ conversations: [currentConversation], hasMore: false, nextCursor: null }],
        pageParams: [undefined],
    });
    queryClient.setQueryData<{ pages: MessageThreadPageV2[]; pageParams: Array<string | undefined> }>(
        queryKeys.messages.v2.thread('conversation-1'),
        {
            pages: [{
                conversation: currentConversation,
                capability: currentConversation.capability,
                messages: [createMessage('latest-message', latestAt)],
                pinnedMessages: [],
                hasMore: false,
                nextCursor: null,
            }],
            pageParams: [undefined],
        },
    );

    upsertThreadConversation(queryClient, staleConversation);

    const inboxData = queryClient.getQueryData<{ pages: Array<{ conversations: InboxConversationV2[] }> }>(
        queryKeys.messages.v2.inbox(20),
    );
    const threadData = queryClient.getQueryData<{ pages: MessageThreadPageV2[] }>(
        queryKeys.messages.v2.thread('conversation-1'),
    );

    assert.equal(inboxData?.pages[0]?.conversations[0]?.unreadCount, 0);
    assert.equal(threadData?.pages[0]?.conversation.unreadCount, 0);
});

test('pending read commit state is stored and conditionally cleared by request id', () => {
    const queryClient = new QueryClient();
    setPendingReadCommitState(queryClient, 'conversation-1', {
        requestId: 'req-1',
        requestedAtMs: Date.now(),
        requestedMessageId: 'message-3',
    });

    assert.equal(getPendingReadCommitState(queryClient, 'conversation-1')?.requestId, 'req-1');

    clearPendingReadCommitState(queryClient, 'conversation-1', 'different');
    assert.equal(getPendingReadCommitState(queryClient, 'conversation-1')?.requestId, 'req-1');

    clearPendingReadCommitState(queryClient, 'conversation-1', 'req-1');
    assert.equal(getPendingReadCommitState(queryClient, 'conversation-1'), null);
});
