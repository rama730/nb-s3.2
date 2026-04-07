'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
    type InboxConversationV2,
    type MessageThreadPageV2,
    ensureDirectConversationV2,
    getApplicationsInboxPageV2,
    getConversationCapabilityV2,
    getConversationSummaryV2,
    getConversationThreadPageV2,
    getInboxPageV2,
    getMessageContextV2,
    getProjectGroupsPageV2,
    getUnreadSummaryV2,
    markConversationReadV2,
    searchMessagesV2,
    sendConversationMessageV2,
    setConversationArchivedV2,
    setConversationMutedV2,
    setMessagePinnedV2,
} from '@/app/actions/messaging/v2';
import type { MessageWithSender, UploadedAttachment } from '@/app/actions/messaging';
import { queryKeys } from '@/lib/query-keys';
import {
    patchInboxConversation,
    patchPinnedMessages,
    patchThreadMessage,
    patchThreadConversation,
    patchUnreadSummary,
    removeInboxConversation,
    replaceOptimisticThreadMessage,
    upsertInboxConversation,
    upsertThreadConversation,
    upsertThreadMessage,
} from '@/lib/messages/v2-cache';
import { refreshUnreadCache } from '@/lib/messages/v2-refresh';
import type { MessagesV2OutboxItem } from '@/stores/messagesV2OutboxStore';
import { useMessagesV2OutboxStore } from '@/stores/messagesV2OutboxStore';
import { mergeMessageCollections } from '@/lib/messages/utils';
import { useAuth } from '@/hooks/useAuth';

const EMPTY_OUTBOX_ITEMS: MessagesV2OutboxItem[] = [];

export function useInbox(limit: number = 20) {
    const query = useInfiniteQuery({
        queryKey: queryKeys.messages.v2.inbox(limit),
        initialPageParam: undefined as string | undefined,
        queryFn: async ({ pageParam }) => {
            const result = await getInboxPageV2(limit, pageParam);
            if (!result.success || !result.page) {
                throw new Error(result.error || 'Failed to fetch inbox');
            }
            return result.page;
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        staleTime: 30_000,
    });

    const conversations = useMemo(
        () => query.data?.pages.flatMap((page) => page.conversations) ?? [],
        [query.data?.pages],
    );

    return {
        ...query,
        conversations,
    };
}

export function useConversationThread(conversationId: string | null, limit: number = 30) {
    const { user } = useAuth();
    const outboxStateItems = useMessagesV2OutboxStore((state) => state.items);
    const outboxItems = useMemo<MessagesV2OutboxItem[]>(
        () => (conversationId
            ? outboxStateItems.filter((item) => item.conversationId === conversationId)
            : EMPTY_OUTBOX_ITEMS),
        [conversationId, outboxStateItems],
    );
    const query = useInfiniteQuery({
        queryKey: queryKeys.messages.v2.thread(conversationId),
        initialPageParam: undefined as string | undefined,
        enabled: Boolean(conversationId),
        queryFn: async ({ pageParam }) => {
            if (!conversationId) throw new Error('Missing conversation');
            const result = await getConversationThreadPageV2(conversationId, pageParam, limit);
            if (!result.success || !result.page) {
                throw new Error(result.error || 'Failed to fetch conversation');
            }
            return result.page;
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        staleTime: 15_000,
    });

    const messages = useMemo(
        () => mergeMessageCollections(
            ...(query.data?.pages.map((page) => page.messages) ?? []),
            outboxItems.map((item) => ({
                id: `temp-${item.clientMessageId}`,
                conversationId: item.conversationId,
                senderId: user?.id ?? null,
                clientMessageId: item.clientMessageId,
                content: item.content,
                type: item.attachments[0]?.type || (item.content ? 'text' : 'file'),
                metadata: {
                    deliveryState: item.state,
                    queued: item.state === 'queued',
                    lastError: item.error,
                },
                replyTo: null,
                createdAt: new Date(item.createdAt),
                editedAt: null,
                deletedAt: null,
                sender: user ? {
                    id: user.id,
                    username: (user.user_metadata?.username as string | undefined) ?? null,
                    fullName: (user.user_metadata?.full_name as string | undefined) ?? null,
                    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
                } : null,
                attachments: item.attachments.map((attachment) => ({
                    id: attachment.id,
                    type: attachment.type,
                    url: attachment.url,
                    filename: attachment.filename,
                    sizeBytes: attachment.sizeBytes,
                    mimeType: attachment.mimeType,
                    thumbnailUrl: attachment.thumbnailUrl,
                    width: attachment.width,
                    height: attachment.height,
                })),
            })),
        ),
        [outboxItems, query.data?.pages, user],
    );
    const firstPage = query.data?.pages[0] ?? null;

    return {
        ...query,
        messages,
        conversation: firstPage?.conversation ?? null,
        capability: firstPage?.capability ?? null,
        pinnedMessages: firstPage?.pinnedMessages ?? [],
    };
}

export function useConversationCapabilities(conversationId: string | null, userId?: string | null) {
    return useQuery({
        queryKey: queryKeys.messages.v2.capabilities(conversationId, userId ?? null),
        enabled: Boolean(conversationId || userId),
        queryFn: async () => {
            const result = await getConversationCapabilityV2({ conversationId, userId });
            if (!result.success || !result.capability) {
                throw new Error(result.error || 'Failed to fetch conversation capability');
            }
            return result.capability;
        },
        staleTime: 15_000,
    });
}

export function useUnreadSummary() {
    return useQuery({
        queryKey: queryKeys.messages.v2.unread(),
        queryFn: async () => {
            const result = await getUnreadSummaryV2();
            if (!result.success) throw new Error(result.error || 'Failed to fetch unread summary');
            return result.count ?? 0;
        },
        staleTime: 15_000,
    });
}

export function useMessageSearch(query: string) {
    return useQuery({
        queryKey: queryKeys.messages.v2.search(query),
        enabled: query.trim().length > 0,
        queryFn: async () => {
            const result = await searchMessagesV2(query);
            if (!result.success) throw new Error(result.error || 'Failed to search messages');
            return result.results ?? [];
        },
        staleTime: 20_000,
    });
}

export function useApplicationsInbox(limit: number = 20) {
    return useInfiniteQuery({
        queryKey: queryKeys.messages.v2.applications(limit, 0),
        initialPageParam: 0,
        queryFn: async ({ pageParam }) => {
            const result = await getApplicationsInboxPageV2(limit, pageParam);
            if (!result.success) {
                const errorMessage = 'error' in result && typeof result.error === 'string'
                    ? result.error
                    : 'Failed to fetch applications inbox';
                throw new Error(errorMessage);
            }
            return result;
        },
        getNextPageParam: (lastPage, _pages, lastOffset) =>
            lastPage.success && lastPage.hasMore ? lastOffset + limit : undefined,
        staleTime: 30_000,
    });
}

export function useProjectGroups(limit: number = 20) {
    return useInfiniteQuery({
        queryKey: queryKeys.messages.v2.projectGroups(limit, 0),
        initialPageParam: 0,
        queryFn: async ({ pageParam }) => {
            const result = await getProjectGroupsPageV2(limit, pageParam);
            if (!result.success) {
                const errorMessage = 'error' in result && typeof result.error === 'string'
                    ? result.error
                    : 'Failed to fetch project groups';
                throw new Error(errorMessage);
            }
            return result;
        },
        getNextPageParam: (lastPage, _pages, lastOffset) =>
            lastPage.success && lastPage.hasMore ? lastOffset + limit : undefined,
        staleTime: 30_000,
    });
}

export function useEnsureDirectConversation() {
    return useMutation({
        mutationFn: async (targetUserId: string) => {
            const result = await ensureDirectConversationV2(targetUserId);
            if (!result.success || !result.conversationId || !result.conversation) {
                throw new Error(result.error || 'Failed to open conversation');
            }
            return result;
        },
    });
}

export function useMessagesActions() {
    const queryClient = useQueryClient();

    const markRead = useMutation({
        mutationFn: async (params: { conversationId: string; lastReadMessageId?: string }) =>
            markConversationReadV2(params.conversationId, params.lastReadMessageId),
        onSuccess: (_result, params) => {
            const currentThread = queryClient.getQueryData<{ pages: MessageThreadPageV2[] }>(
                queryKeys.messages.v2.thread(params.conversationId),
            );
            const unreadBefore = currentThread?.pages[0]?.conversation?.unreadCount ?? 0;

            patchInboxConversation(queryClient, params.conversationId, (conversation) => ({
                ...conversation,
                unreadCount: 0,
            }));
            if (unreadBefore > 0) {
                patchUnreadSummary(queryClient, (count) => Math.max(0, count - unreadBefore));
            }

            queryClient.setQueryData<{ pages: MessageThreadPageV2[]; pageParams: Array<string | undefined> }>(
                queryKeys.messages.v2.thread(params.conversationId),
                (current) => {
                    if (!current || current.pages.length === 0) return current;
                    return {
                        ...current,
                        pages: current.pages.map((page, index) =>
                            index === 0
                                ? {
                                    ...page,
                                    conversation: page.conversation
                                        ? { ...page.conversation, unreadCount: 0 }
                                        : page.conversation,
                                }
                                : page,
                        ),
                    };
                },
            );
        },
    });

    const muteConversation = useMutation({
        mutationFn: async (params: { conversationId: string; muted: boolean }) =>
            setConversationMutedV2(params.conversationId, params.muted),
        onSuccess: (_result, params) => {
            const nextConversation = (conversation: InboxConversationV2) => ({
                ...conversation,
                muted: params.muted,
            });
            patchInboxConversation(queryClient, params.conversationId, nextConversation);
            patchThreadConversation(queryClient, params.conversationId, nextConversation);
        },
    });

    const archiveConversation = useMutation({
        mutationFn: async (params: { conversationId: string; archived: boolean }) =>
            setConversationArchivedV2(params.conversationId, params.archived),
        onSuccess: async (_result, params) => {
            const currentThread = queryClient.getQueryData<{ pages: MessageThreadPageV2[] }>(
                queryKeys.messages.v2.thread(params.conversationId),
            );
            const cachedConversation = currentThread?.pages[0]?.conversation ?? null;

            if (params.archived) {
                const unreadBefore = cachedConversation?.unreadCount ?? 0;
                removeInboxConversation(queryClient, params.conversationId);
                if (cachedConversation) {
                    patchThreadConversation(queryClient, params.conversationId, (conversation) => ({
                        ...conversation,
                        lifecycleState: 'archived',
                    }));
                }
                if (unreadBefore > 0) {
                    patchUnreadSummary(queryClient, (count) => Math.max(0, count - unreadBefore));
                } else {
                    await refreshUnreadCache(queryClient);
                }
                return;
            }
            const refreshedConversation = await getConversationSummaryV2(params.conversationId);
            if (refreshedConversation.success && refreshedConversation.conversation) {
                upsertThreadConversation(queryClient, refreshedConversation.conversation);
                return;
            }
            if (cachedConversation) {
                patchThreadConversation(queryClient, params.conversationId, (conversation) => ({
                    ...conversation,
                    lifecycleState: 'active',
                }));
            }
        },
    });

    const sendConversationMessage = useMutation({
        mutationFn: async (params: {
            conversationId?: string | null;
            targetUserId?: string | null;
            content: string;
            attachments?: UploadedAttachment[];
            clientMessageId?: string;
            replyToMessageId?: string | null;
        }) => {
            const result = await sendConversationMessageV2(params);
            if (!result.success || !result.conversationId) {
                throw new Error(result.error || 'Failed to send message');
            }
            return result;
        },
        onSuccess: (result, variables) => {
            if (result.conversation) {
                upsertThreadConversation(queryClient, result.conversation);
            }

            if (result.message && result.conversationId) {
                const clientMessageId = result.message.clientMessageId ?? variables.clientMessageId;
                if (clientMessageId) {
                    replaceOptimisticThreadMessage(
                        queryClient,
                        result.conversationId,
                        clientMessageId,
                        result.message,
                        result.conversation ?? null,
                    );
                } else {
                    upsertThreadMessage(
                        queryClient,
                        result.conversationId,
                        result.message,
                        result.conversation ?? null,
                    );
                }
            } else if (result.conversation) {
                upsertInboxConversation(queryClient, result.conversation);
            }
        },
    });

    const pinMessage = useMutation({
        mutationFn: async (params: { messageId: string; pinned: boolean; conversationId: string }) => {
            const result = await setMessagePinnedV2(params.messageId, params.pinned);
            if (!result.success) throw new Error(result.error || 'Failed to update pin');
            return params.conversationId;
        },
        onSuccess: (_conversationId, params) => {
            patchThreadMessage(queryClient, params.conversationId, params.messageId, (message) => ({
                ...message,
                metadata: {
                    ...(message.metadata || {}),
                    pinned: params.pinned,
                },
            }));
            patchPinnedMessages(queryClient, params.conversationId, (messages) => {
                const existing = messages.find((message) => message.id === params.messageId);
                if (params.pinned) {
                    if (!existing) {
                        const currentThread = queryClient.getQueryData<{ pages: MessageThreadPageV2[] }>(
                            queryKeys.messages.v2.thread(params.conversationId),
                        );
                        const nextPinned = currentThread?.pages[0]?.messages.find((message) => message.id === params.messageId);
                        if (!nextPinned) return Array.from(messages);
                        return [nextPinned, ...messages].slice(0, 3);
                    }
                    return Array.from(messages);
                }
                return messages.filter((message) => message.id !== params.messageId);
            });
        },
    });

    const injectMessageContext = async (conversationId: string, messageId: string) => {
        const result = await getMessageContextV2(conversationId, messageId);
        if (!result.success || !result.available || !result.message) {
            return null;
        }

        queryClient.setQueryData(
            queryKeys.messages.v2.thread(conversationId),
            (current: { pages: MessageThreadPageV2[]; pageParams: Array<string | undefined> } | undefined) => {
                if (!current) return current;
                return {
                    ...current,
                    pages: current.pages.map((page, index) =>
                        index === 0
                            ? {
                                ...page,
                                messages: mergeMessageCollections(page.messages, [result.message!]),
                            }
                            : page,
                    ),
                };
            },
        );

        return result.message;
    };

    return {
        markRead,
        muteConversation,
        archiveConversation,
        sendConversationMessage,
        pinMessage,
        injectMessageContext,
    };
}

export type { InboxConversationV2 };
