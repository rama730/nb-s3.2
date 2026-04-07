import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';

import type { MessageWithSender } from '@/app/actions/messaging';
import type { InboxConversationV2, MessageThreadPageV2, ConversationCapabilityV2 } from '@/app/actions/messaging/v2';
import {
    isCachedConversationLastMessage,
    patchConversationLastMessageFromMessage,
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
            structured: createStructuredMessagePayload({
                kind: 'handoff_summary',
                title: 'Handoff summary',
                summary: 'Frontend is complete and ready for review',
                stateSnapshot: { status: 'shared', label: 'Shared' },
            }),
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
