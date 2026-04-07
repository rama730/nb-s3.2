'use client';

import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { MessageWithSender } from '@/app/actions/messaging';
import type {
    InboxConversationV2,
    MessagesInboxPageV2,
    MessageThreadPageV2,
} from '@/app/actions/messaging/v2';
import { queryKeys } from '@/lib/query-keys';
import { mergeMessages, toEpochMs } from '@/lib/messages/utils';

const INBOX_QUERY_PREFIX = ['chat-v2', 'inbox'] as const;

function updateThreadData(
    queryClient: QueryClient,
    conversationId: string,
    updater: (page: MessageThreadPageV2, pageIndex: number) => MessageThreadPageV2,
) {
    queryClient.setQueryData<InfiniteData<MessageThreadPageV2>>(
        queryKeys.messages.v2.thread(conversationId),
        (current) => {
            if (!current) return current;
            return {
                ...current,
                pages: current.pages.map((page, index) => updater(page, index)),
            };
        },
    );
}

function normalizeConversationRows(conversations: InboxConversationV2[]) {
    return [...conversations].sort((left, right) => {
        const updatedDiff = toEpochMs(right.updatedAt) - toEpochMs(left.updatedAt);
        if (updatedDiff !== 0) return updatedDiff;
        return left.id.localeCompare(right.id);
    });
}

function repartitionConversations(
    data: InfiniteData<MessagesInboxPageV2>,
    nextConversations: InboxConversationV2[],
): InfiniteData<MessagesInboxPageV2> {
    const totalVisible = data.pages.reduce((count, page) => count + page.conversations.length, 0);
    const capped = totalVisible > 0 ? nextConversations.slice(0, totalVisible) : nextConversations;
    let cursor = 0;

    return {
        ...data,
        pages: data.pages.map((page) => {
            const pageSize = page.conversations.length;
            const conversations = capped.slice(cursor, cursor + pageSize);
            cursor += pageSize;
            return {
                ...page,
                conversations,
            };
        }),
    };
}

function updateInboxData(
    queryClient: QueryClient,
    updater: (conversations: InboxConversationV2[]) => InboxConversationV2[],
) {
    queryClient.setQueriesData<InfiniteData<MessagesInboxPageV2>>(
        { queryKey: INBOX_QUERY_PREFIX },
        (current) => {
            if (!current) return current;
            const flattened = current.pages.flatMap((page) => page.conversations);
            const nextConversations = normalizeConversationRows(updater(flattened));
            return repartitionConversations(current, nextConversations);
        },
    );
}

export function upsertInboxConversation(queryClient: QueryClient, conversation: InboxConversationV2) {
    updateInboxData(queryClient, (conversations) => {
        const byId = new Map(conversations.map((entry) => [entry.id, entry] as const));
        byId.set(conversation.id, conversation);
        return Array.from(byId.values());
    });
}

export function removeInboxConversation(queryClient: QueryClient, conversationId: string) {
    updateInboxData(queryClient, (conversations) =>
        conversations.filter((conversation) => conversation.id !== conversationId),
    );
}

export function patchInboxConversation(
    queryClient: QueryClient,
    conversationId: string,
    patch: (conversation: InboxConversationV2) => InboxConversationV2,
) {
    updateInboxData(queryClient, (conversations) =>
        conversations.map((conversation) =>
            conversation.id === conversationId ? patch(conversation) : conversation,
        ),
    );
}

export function upsertThreadConversation(
    queryClient: QueryClient,
    conversation: InboxConversationV2,
) {
    updateThreadData(queryClient, conversation.id, (page, pageIndex) =>
        pageIndex === 0
            ? {
                ...page,
                conversation,
                capability: conversation.capability,
            }
            : page,
    );
    upsertInboxConversation(queryClient, conversation);
}

export function patchThreadConversation(
    queryClient: QueryClient,
    conversationId: string,
    patch: (conversation: InboxConversationV2) => InboxConversationV2,
) {
    // H2/MSG11: Apply the same patch to both thread and inbox atomically.
    // Both setQueryData calls are synchronous and execute within the same
    // microtask, so React Query batches the notifications together.
    let nextConversation: InboxConversationV2 | null = null;

    updateThreadData(queryClient, conversationId, (page, pageIndex) => {
        if (pageIndex !== 0) return page;
        nextConversation = patch(page.conversation);
        return {
            ...page,
            conversation: nextConversation,
            capability: nextConversation.capability,
        };
    });

    // Always sync to inbox using the same patch function, even if thread data
    // didn't exist yet — ensures inbox stays consistent.
    patchInboxConversation(queryClient, conversationId, (existing) =>
        nextConversation ?? patch(existing),
    );
}

export function upsertThreadMessage(
    queryClient: QueryClient,
    conversationId: string,
    message: MessageWithSender,
    conversation?: InboxConversationV2 | null,
) {
    updateThreadData(queryClient, conversationId, (page, pageIndex) =>
        pageIndex === 0
            ? {
                ...page,
                conversation: conversation ?? page.conversation,
                capability: conversation?.capability ?? page.capability,
                messages: mergeMessages(page.messages, [message]),
            }
            : page,
    );

    if (conversation) {
        upsertInboxConversation(queryClient, conversation);
    }
}

export function replaceOptimisticThreadMessage(
    queryClient: QueryClient,
    conversationId: string,
    clientMessageId: string,
    message: MessageWithSender,
    conversation?: InboxConversationV2 | null,
) {
    updateThreadData(queryClient, conversationId, (page, pageIndex) => {
        if (pageIndex !== 0) return page;
        const nextMessages = page.messages.filter((entry) =>
            entry.clientMessageId !== clientMessageId && entry.id !== `temp-${clientMessageId}`,
        );
        return {
            ...page,
            conversation: conversation ?? page.conversation,
            capability: conversation?.capability ?? page.capability,
            messages: mergeMessages(nextMessages, [message]),
        };
    });

    if (conversation) {
        upsertInboxConversation(queryClient, conversation);
    }
}

export function patchThreadMessage(
    queryClient: QueryClient,
    conversationId: string,
    messageId: string,
    patch: (message: MessageWithSender) => MessageWithSender,
) {
    updateThreadData(queryClient, conversationId, (page, pageIndex) =>
        pageIndex === 0
            ? {
                ...page,
                messages: page.messages.map((message) =>
                    message.id === messageId ? patch(message) : message,
                ),
            }
            : page,
    );
}

export function patchPinnedMessages(
    queryClient: QueryClient,
    conversationId: string,
    patch: (messages: ReadonlyArray<MessageWithSender>) => MessageWithSender[],
) {
    updateThreadData(queryClient, conversationId, (page, pageIndex) =>
        pageIndex === 0
            ? {
                ...page,
                pinnedMessages: patch(page.pinnedMessages),
            }
            : page,
    );
}

export function hideThreadMessageForViewer(
    queryClient: QueryClient,
    conversationId: string,
    messageId: string,
) {
    updateThreadData(queryClient, conversationId, (page, pageIndex) =>
        pageIndex === 0
            ? {
                ...page,
                messages: page.messages.filter((message) => message.id !== messageId),
            }
            : page,
    );
}

export function removeThreadMessage(
    queryClient: QueryClient,
    conversationId: string,
    messageId: string,
) {
    hideThreadMessageForViewer(queryClient, conversationId, messageId);
}

export function replaceThreadSnapshot(
    queryClient: QueryClient,
    conversationId: string,
    snapshot: MessageThreadPageV2,
) {
    queryClient.setQueryData<InfiniteData<MessageThreadPageV2>>(
        queryKeys.messages.v2.thread(conversationId),
        (current) => {
            if (!current) {
                return {
                    pages: [snapshot],
                    pageParams: [undefined],
                };
            }

            const [, ...remainingPages] = current.pages;
            const [, ...remainingParams] = current.pageParams;
            return {
                ...current,
                pages: [snapshot, ...remainingPages],
                pageParams: [
                    undefined,
                    ...remainingParams,
                ],
            };
        },
    );
    upsertInboxConversation(queryClient, snapshot.conversation);
}

export function hasCachedThreadMessage(
    queryClient: QueryClient,
    conversationId: string,
    messageId: string,
) {
    const data = queryClient.getQueryData<InfiniteData<MessageThreadPageV2>>(
        queryKeys.messages.v2.thread(conversationId),
    );

    return (data?.pages ?? []).some((page) =>
        page.messages.some((message) => message.id === messageId),
    );
}

export function getCachedInboxConversationIds(queryClient: QueryClient) {
    const ids = new Set<string>();
    const queries = queryClient.getQueriesData<InfiniteData<MessagesInboxPageV2>>({
        queryKey: INBOX_QUERY_PREFIX,
    });

    for (const [, data] of queries) {
        for (const page of data?.pages ?? []) {
            for (const conversation of page.conversations) {
                ids.add(conversation.id);
            }
        }
    }

    return Array.from(ids);
}

export function patchUnreadSummary(
    queryClient: QueryClient,
    updater: (count: number) => number,
) {
    queryClient.setQueryData<number | undefined>(
        queryKeys.messages.v2.unread(),
        (current) => updater(current ?? 0),
    );
}

export function setUnreadSummary(queryClient: QueryClient, count: number) {
    queryClient.setQueryData<number | undefined>(
        queryKeys.messages.v2.unread(),
        count,
    );
}
