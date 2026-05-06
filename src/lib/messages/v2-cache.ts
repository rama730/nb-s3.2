'use client';

import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { MessageWithSender } from '@/app/actions/messaging';
import type {
    InboxConversationV2,
    MessagesInboxPageV2,
    MessageThreadPageV2,
} from '@/app/actions/messaging/v2';
import {
    buildConversationLastMessageSnapshot,
    shouldReplaceConversationLastMessage,
} from '@/lib/messages/preview-authority';
import { queryKeys } from '@/lib/query-keys';
import { mergeMessages, toEpochMs } from '@/lib/messages/utils';

const INBOX_QUERY_PREFIX = ['chat-v2', 'inbox'] as const;
export interface PendingReadCommitState {
    requestId: string;
    requestedAtMs: number;
    requestedMessageId: string | null;
}

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

function doesLastMessageAdvance(
    currentLastMessage: InboxConversationV2['lastMessage'] | null | undefined,
    nextLastMessage: InboxConversationV2['lastMessage'] | null | undefined,
) {
    if (!nextLastMessage) return false;
    if (!currentLastMessage) return true;
    if (currentLastMessage.id === nextLastMessage.id) return false;

    const currentEpoch = toEpochMs(currentLastMessage.createdAt);
    const nextEpoch = toEpochMs(nextLastMessage.createdAt);
    if (nextEpoch <= 0) return false;
    if (currentEpoch <= 0) return true;
    if (nextEpoch !== currentEpoch) {
        return nextEpoch > currentEpoch;
    }
    return nextLastMessage.id.localeCompare(currentLastMessage.id) > 0;
}

function compareConversationReadWatermarks(
    left: Pick<InboxConversationV2, 'lastReadAt' | 'lastReadMessageId'> | null | undefined,
    right: Pick<InboxConversationV2, 'lastReadAt' | 'lastReadMessageId'> | null | undefined,
) {
    const leftEpoch = toEpochMs(left?.lastReadAt);
    const rightEpoch = toEpochMs(right?.lastReadAt);
    if (leftEpoch !== rightEpoch) {
        return leftEpoch - rightEpoch;
    }
    return 0;
}

function isLastMessageAfterReadWatermark(
    lastMessage: InboxConversationV2['lastMessage'] | null | undefined,
    readWatermark: Pick<InboxConversationV2, 'lastReadAt' | 'lastReadMessageId'> | null | undefined,
) {
    if (!lastMessage) return false;
    const messageEpoch = toEpochMs(lastMessage.createdAt);
    const readEpoch = toEpochMs(readWatermark?.lastReadAt);
    if (messageEpoch <= 0) return false;
    if (readEpoch <= 0) return true;
    if (messageEpoch !== readEpoch) {
        return messageEpoch > readEpoch;
    }
    return false;
}

function mergeConversationSnapshot(
    current: InboxConversationV2 | null | undefined,
    next: InboxConversationV2,
    _options?: { pendingReadCommit?: PendingReadCommitState | null },
): InboxConversationV2 {
    if (!current) {
        return next;
    }

    const shouldUseNextLastMessage = Boolean(
        next.lastMessage && shouldReplaceConversationLastMessage(current.lastMessage, next.lastMessage),
    );
    const lastMessage = shouldUseNextLastMessage
        ? next.lastMessage
        : current.lastMessage ?? next.lastMessage;
    const currentReadIsAtLeastNext = compareConversationReadWatermarks(current, next) >= 0;
    const shouldKeepCurrentReadWatermark = currentReadIsAtLeastNext;
    const shouldIgnoreStaleUnread =
        currentReadIsAtLeastNext
        && next.unreadCount > current.unreadCount
        && !isLastMessageAfterReadWatermark(next.lastMessage, current);
    if (shouldIgnoreStaleUnread) {
        console.debug('[messages-v2] read_summary_ignored_stale', {
            conversationId: current.id,
            previousUnread: current.unreadCount,
            nextUnread: next.unreadCount,
            cachedReadMessageId: current.lastReadMessageId,
            summaryReadMessageId: next.lastReadMessageId,
        });
    }
    const updatedAtEpoch = Math.max(
        toEpochMs(current.updatedAt),
        toEpochMs(next.updatedAt),
        toEpochMs(lastMessage?.createdAt),
    );

    return {
        ...next,
        updatedAt: updatedAtEpoch > 0 ? new Date(updatedAtEpoch) : next.updatedAt,
        lastMessage,
        lastReadAt: shouldKeepCurrentReadWatermark ? current.lastReadAt : next.lastReadAt,
        lastReadMessageId: shouldKeepCurrentReadWatermark ? current.lastReadMessageId : next.lastReadMessageId,
        unreadCount: shouldIgnoreStaleUnread ? current.unreadCount : next.unreadCount,
    };
}

export function getPendingReadCommitState(
    queryClient: QueryClient,
    conversationId: string,
): PendingReadCommitState | null {
    return queryClient.getQueryData<PendingReadCommitState | null>(
        queryKeys.messages.v2.readCommitState(conversationId),
    ) ?? null;
}

export function setPendingReadCommitState(
    queryClient: QueryClient,
    conversationId: string,
    state: PendingReadCommitState | null,
) {
    queryClient.setQueryData<PendingReadCommitState | null>(
        queryKeys.messages.v2.readCommitState(conversationId),
        state,
    );
}

export function clearPendingReadCommitState(
    queryClient: QueryClient,
    conversationId: string,
    requestId?: string | null,
) {
    queryClient.setQueryData<PendingReadCommitState | null>(
        queryKeys.messages.v2.readCommitState(conversationId),
        (current) => {
            if (!current) return null;
            if (requestId && current.requestId !== requestId) return current;
            return null;
        },
    );
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

function isMessageOlderThanBoundary(
    message: Pick<MessageWithSender, 'id' | 'createdAt'>,
    boundary: Pick<MessageWithSender, 'id' | 'createdAt'>,
): boolean {
    const messageCreatedAt = toEpochMs(message.createdAt);
    const boundaryCreatedAt = toEpochMs(boundary.createdAt);
    if (messageCreatedAt !== boundaryCreatedAt) {
        return messageCreatedAt < boundaryCreatedAt;
    }
    return message.id.localeCompare(boundary.id) < 0;
}

function isMessageNewerThanBoundary(
    message: Pick<MessageWithSender, 'id' | 'createdAt'>,
    boundary: Pick<MessageWithSender, 'id' | 'createdAt'>,
): boolean {
    const messageCreatedAt = toEpochMs(message.createdAt);
    const boundaryCreatedAt = toEpochMs(boundary.createdAt);
    if (messageCreatedAt !== boundaryCreatedAt) {
        return messageCreatedAt > boundaryCreatedAt;
    }
    return message.id.localeCompare(boundary.id) > 0;
}

export function upsertInboxConversation(queryClient: QueryClient, conversation: InboxConversationV2) {
    updateInboxData(queryClient, (conversations) => {
        const byId = new Map(conversations.map((entry) => [entry.id, entry] as const));
        byId.set(conversation.id, mergeConversationSnapshot(byId.get(conversation.id), conversation, {
            pendingReadCommit: getPendingReadCommitState(queryClient, conversation.id),
        }));
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
    let committedConversation = conversation;
    updateThreadData(queryClient, conversation.id, (page, pageIndex) =>
        pageIndex === 0
            ? (() => {
                committedConversation = mergeConversationSnapshot(page.conversation, conversation, {
                    pendingReadCommit: getPendingReadCommitState(queryClient, conversation.id),
                });
                return {
                    ...page,
                    conversation: committedConversation,
                    capability: committedConversation.capability,
                };
            })()
            : page,
    );
    upsertInboxConversation(queryClient, committedConversation);
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

export function patchConversationLastMessageFromMessage(
    queryClient: QueryClient,
    conversationId: string,
    message: Pick<MessageWithSender, 'id' | 'content' | 'senderId' | 'createdAt' | 'type'> & {
        metadata?: Record<string, unknown> | null;
    },
) {
    const nextLastMessage = buildConversationLastMessageSnapshot(message);
    if (!nextLastMessage) return;

    patchThreadConversation(queryClient, conversationId, (conversation) => {
        if (!shouldReplaceConversationLastMessage(conversation.lastMessage, message)) {
            return conversation;
        }

        const nextUpdatedAtEpoch = Math.max(
            toEpochMs(conversation.updatedAt),
            nextLastMessage.createdAt.getTime(),
        );

        return {
            ...conversation,
            lifecycleState: 'active',
            updatedAt: nextUpdatedAtEpoch > 0 ? new Date(nextUpdatedAtEpoch) : conversation.updatedAt,
            lastMessage: nextLastMessage,
        };
    });
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
    updateThreadData(queryClient, conversationId, (page) => ({
        ...page,
        messages: page.messages.map((message) =>
            message.id === messageId ? patch(message) : message,
        ),
        pinnedMessages: page.pinnedMessages.map((message) =>
            message.id === messageId ? patch(message) : message,
        ),
    }));
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
    updateThreadData(queryClient, conversationId, (page) => ({
        ...page,
        messages: page.messages.filter((message) => message.id !== messageId),
        pinnedMessages: page.pinnedMessages.filter((message) => message.id !== messageId),
    }));
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
    const normalizedSnapshot: MessageThreadPageV2 = {
        ...snapshot,
        messages: mergeMessages([], snapshot.messages),
    };
    let committedConversation = normalizedSnapshot.conversation;

    queryClient.setQueryData<InfiniteData<MessageThreadPageV2>>(
        queryKeys.messages.v2.thread(conversationId),
        (current) => {
            if (!current) {
                return {
                    pages: [normalizedSnapshot],
                    pageParams: [undefined],
                };
            }

            committedConversation = mergeConversationSnapshot(
                current.pages[0]?.conversation,
                normalizedSnapshot.conversation,
                {
                    pendingReadCommit: getPendingReadCommitState(queryClient, conversationId),
                },
            );
            const snapshotWithConversation: MessageThreadPageV2 = {
                ...normalizedSnapshot,
                conversation: committedConversation,
                capability: committedConversation.capability,
            };
            const newestSnapshotMessage = normalizedSnapshot.messages.at(-1) ?? null;
            const newerCachedMessages = newestSnapshotMessage
                ? current.pages
                    .flatMap((page) => page.messages)
                    .filter((message) => isMessageNewerThanBoundary(message, newestSnapshotMessage))
                : [];
            const mergedSnapshot: MessageThreadPageV2 = newerCachedMessages.length > 0
                ? {
                    ...snapshotWithConversation,
                    messages: mergeMessages(normalizedSnapshot.messages, newerCachedMessages),
                }
                : snapshotWithConversation;
            const oldestSnapshotMessage = mergedSnapshot.messages[0] ?? null;
            if (!oldestSnapshotMessage) {
                return {
                    ...current,
                    pages: [mergedSnapshot],
                    pageParams: [undefined],
                };
            }

            const nextPages: MessageThreadPageV2[] = [mergedSnapshot];
            const nextPageParams: Array<string | undefined> = [undefined];
            current.pages.slice(1).forEach((page, pageIndex) => {
                const olderMessages = mergeMessages([], page.messages)
                    .filter((message) => isMessageOlderThanBoundary(message, oldestSnapshotMessage));
                if (olderMessages.length === 0) return;
                nextPages.push({
                    ...page,
                    messages: olderMessages,
                });
                nextPageParams.push(current.pageParams[pageIndex + 1] as string | undefined);
            });

            return {
                ...current,
                pages: nextPages,
                pageParams: nextPageParams,
            };
        },
    );
    upsertInboxConversation(queryClient, committedConversation);
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

export function isCachedConversationLastMessage(
    queryClient: QueryClient,
    conversationId: string,
    messageId: string,
) {
    const inboxQueries = queryClient.getQueriesData<InfiniteData<MessagesInboxPageV2>>({
        queryKey: INBOX_QUERY_PREFIX,
    });

    for (const [, data] of inboxQueries) {
        for (const page of data?.pages ?? []) {
            const conversation = page.conversations.find((entry) => entry.id === conversationId);
            if (conversation?.lastMessage?.id === messageId) {
                return true;
            }
        }
    }

    const threadData = queryClient.getQueryData<InfiniteData<MessageThreadPageV2>>(
        queryKeys.messages.v2.thread(conversationId),
    );

    return threadData?.pages[0]?.conversation.lastMessage?.id === messageId;
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
