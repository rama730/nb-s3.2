'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useEffect } from 'react';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import {
    type InboxConversationV2,
    type MessageThreadPageV2,
    ensureDirectConversationV2,
    getConversationSummaryV2,
    getConversationThreadPageV2,
    getInboxPageV2,
    resolveConversationWorkflowV2,
    sendConversationMessageV2,
    sendStructuredConversationMessageV2,
} from '@/app/actions/messaging/v2';
import {
    convertMessageToFollowUpActionV2,
    convertMessageToTaskActionV2,
    getMessageContext,
    getMessagingStructuredCatalogV2,
    getProjectGroups,
    markConversationAsRead,
    searchMessages,
    setConversationArchived,
    setConversationMuted,
    setMessagePinned,
    type MessageWithSender,
    type UploadedAttachment,
} from '@/app/actions/messaging';
import { getInboxApplicationsAction } from '@/app/actions/applications';
import { queryKeys } from '@/lib/query-keys';
import {
    clearPendingReadCommitState,
    patchInboxConversation,
    patchConversationLastMessageFromMessage,
    patchPinnedMessages,
    patchThreadMessage,
    patchThreadConversation,
    patchUnreadSummary,
    setPendingReadCommitState,
    removeInboxConversation,
    replaceOptimisticThreadMessage,
    upsertInboxConversation,
    upsertThreadConversation,
    upsertThreadMessage,
} from '@/lib/messages/v2-cache';
import { refreshUnreadCache } from '@/lib/messages/v2-refresh';
import { isTemporaryMessageId, mergeMessageCollections } from '@/lib/messages/utils';
import type { MessagesV2OutboxItem } from '@/stores/messagesV2OutboxStore';
import { useMessagesV2OutboxStore } from '@/stores/messagesV2OutboxStore';
import { useAuth } from '@/hooks/useAuth';
import {
    createPendingStructuredState,
    createStructuredMessagePayload,
    type MessageContextChip,
    type StructuredMessagePayload,
    withMessageContextChipsMetadata,
    withStructuredMessageMetadata,
} from '@/lib/messages/structured';
import { toggleReaction } from '@/app/actions/messaging/features';
import {
    normalizeMessageReactionSummary,
    toggleMessageReactionSummary,
    withReactionSummaryMetadata,
} from '@/lib/messages/reactions';

const EMPTY_OUTBOX_ITEMS: MessagesV2OutboxItem[] = [];

function buildOptimisticStructuredMessage(item: MessagesV2OutboxItem): StructuredMessagePayload | null {
    if (!item.structuredAction) {
        return null;
    }

    const action = item.structuredAction;
    const payload = createStructuredMessagePayload({
        kind: action.kind,
        title: action.title?.trim() || action.summary?.trim() || '',
        summary: action.summary?.trim() || '',
        contextChips: item.contextChips ?? [],
        stateSnapshot: action.kind === 'rate_share' || action.kind === 'handoff_summary'
            ? { status: 'shared', label: 'Shared' }
            : createPendingStructuredState(),
        entityRefs: {
            projectId: action.projectId ?? null,
            taskId: action.taskId ?? null,
            fileId: action.fileId ?? null,
            profileId: action.profileId ?? null,
        },
        payload: {
            note: action.note?.trim() || null,
            amount: action.amount?.trim() || null,
            unit: action.unit?.trim() || null,
            dueAt: action.dueAt || null,
            completed: action.completed?.trim() || null,
            blocked: action.blocked?.trim() || null,
            next: action.next?.trim() || null,
        },
    });
    if (!payload) {
        return null;
    }
    return payload;
}

function unwrapThreadPage(value: unknown): MessageThreadPageV2 | null {
    const candidate = value && typeof value === 'object' && 'page' in value
        ? (value as { page?: unknown }).page
        : value;

    if (!candidate || typeof candidate !== 'object') {
        return null;
    }

    const page = candidate as Partial<MessageThreadPageV2>;
    if (!page.conversation || !Array.isArray(page.messages) || !Array.isArray(page.pinnedMessages)) {
        return null;
    }

    return page as MessageThreadPageV2;
}

export function useInbox(limit: number = 20, enabled: boolean = true) {
    const queryClient = useQueryClient();
    const queryKey = useMemo(() => queryKeys.messages.v2.inbox(limit), [limit]);
    const storageKey = useMemo(() => queryKey.join('-'), [queryKey]);

    useEffect(() => {
        if (!enabled) return;
        idbGet(storageKey).then((cachedPage) => {
            if (cachedPage) {
                const currentData = queryClient.getQueryState(queryKey);
                if (!currentData?.data) {
                    queryClient.setQueryData(queryKey, {
                        pages: [cachedPage],
                        pageParams: [undefined],
                    });
                }
            }
        }).catch(() => {});
    }, [enabled, queryClient, queryKey, storageKey]);

    const query = useInfiniteQuery({
        queryKey,
        initialPageParam: undefined as string | undefined,
        enabled,
        queryFn: async ({ pageParam }) => {
            const result = await getInboxPageV2(limit, pageParam);
            if (!result.success || !result.page) {
                throw new Error(result.error || 'Failed to fetch inbox');
            }
            if (!pageParam) {
                idbSet(storageKey, result.page).catch(() => {});
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

    const result = useMemo(() => ({
        ...query,
        conversations,
    }), [query, conversations]);

    return result;
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
    const queryClient = useQueryClient();
    const queryKey = useMemo(() => queryKeys.messages.v2.thread(conversationId), [conversationId]);
    const storageKey = useMemo(() => queryKey.join('-'), [queryKey]);

    useEffect(() => {
        if (!conversationId || conversationId.startsWith('draft:')) return;
        idbGet(storageKey).then((cachedPage) => {
            if (cachedPage) {
                const currentData = queryClient.getQueryState(queryKey);
                if (!currentData?.data) {
                    queryClient.setQueryData(queryKey, {
                        pages: [cachedPage],
                        pageParams: [undefined],
                    });
                }
            }
        }).catch(() => {});
    }, [queryClient, conversationId, queryKey, storageKey]);

    const query = useInfiniteQuery({
        queryKey,
        initialPageParam: undefined as string | undefined,
        enabled: Boolean(conversationId) && !conversationId?.startsWith('draft:'),
        queryFn: async ({ pageParam }) => {
            if (!conversationId) throw new Error('Missing conversation');
            const result = await getConversationThreadPageV2(conversationId, pageParam, limit);
            if (!result.success || !result.page) {
                throw new Error(result.error || 'Failed to fetch conversation');
            }
            if (!pageParam) {
                idbSet(storageKey, result.page).catch(() => {});
            }
            return result.page;
        },
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        staleTime: 15_000,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
    });

    const normalizedPages = useMemo(
        () => (query.data?.pages ?? [])
            .map((page) => unwrapThreadPage(page))
            .filter((page): page is MessageThreadPageV2 => page !== null),
        [query.data?.pages],
    );

    const messages = useMemo(
        () => mergeMessageCollections(
            ...normalizedPages.map((page) => page.messages),
            outboxItems.map((item) => ({
                id: `temp-${item.clientMessageId}`,
                conversationId: item.conversationId,
                senderId: user?.id ?? null,
                clientMessageId: item.clientMessageId,
                content: item.mode === 'structured' ? null : item.content,
                type: item.attachments[0]?.type || 'text',
                metadata: item.mode === 'structured'
                    ? withStructuredMessageMetadata({
                        deliveryState: item.state,
                        queued: item.state === 'queued',
                        lastError: item.error,
                    }, buildOptimisticStructuredMessage(item))
                    : withMessageContextChipsMetadata({
                        deliveryState: item.state,
                        queued: item.state === 'queued',
                        lastError: item.error,
                    }, item.contextChips ?? []),
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
        [normalizedPages, outboxItems, user],
    );
    const firstPage = normalizedPages[0] ?? null;

    const conversation = firstPage?.conversation ?? null;
    const capability = firstPage?.capability ?? null;
    const pinnedMessages = firstPage?.pinnedMessages ?? [];

    const result = useMemo(() => ({
        ...query,
        messages,
        conversation,
        capability,
        pinnedMessages,
    }), [query, messages, conversation, capability, pinnedMessages]);

    return result;
}

export function useMessageSearch(query: string) {
    return useQuery({
        queryKey: queryKeys.messages.v2.search(query),
        enabled: query.trim().length > 0,
        queryFn: async () => {
            const result = await searchMessages(query);
            if (!result.success) throw new Error(result.error || 'Failed to search messages');
            return result.results ?? [];
        },
        staleTime: 20_000,
    });
}

export function useMessagingStructuredCatalog(conversationId: string | null, targetUserId?: string | null, enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.messages.v2.structuredCatalog(conversationId, targetUserId ?? null),
        enabled: enabled && Boolean(conversationId || targetUserId),
        queryFn: async () => {
            const result = await getMessagingStructuredCatalogV2({
                conversationId,
                targetUserId: targetUserId ?? null,
            });
            if (!result.success || !result.catalog) {
                throw new Error(result.error || 'Failed to fetch message commands');
            }
            return result.catalog;
        },
        staleTime: 30_000,
    });
}

export function useApplicationsInbox(limit: number = 20) {
    return useInfiniteQuery({
        queryKey: queryKeys.messages.v2.applications(limit, 0),
        initialPageParam: 0,
        queryFn: async ({ pageParam }) => {
            const result = await getInboxApplicationsAction(limit, pageParam);
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
            const result = await getProjectGroups(limit, pageParam);
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
    const { user } = useAuth();

    const markRead = useMutation({
        mutationFn: async (params: { conversationId: string; lastReadMessageId?: string }) => {
            const serverReadMessageId = isTemporaryMessageId(params.lastReadMessageId)
                ? undefined
                : params.lastReadMessageId;
            const result = await markConversationAsRead(params.conversationId, serverReadMessageId);
            if (!result.success) {
                throw new Error(result.error || 'Failed to mark conversation read');
            }
            return result;
        },
        onMutate: (params) => {
            const currentThread = queryClient.getQueryData<{ pages: MessageThreadPageV2[] }>(
                queryKeys.messages.v2.thread(params.conversationId),
            );
            const currentConversation = currentThread?.pages[0]?.conversation ?? null;
            const previousUnreadCount = currentConversation?.unreadCount ?? 0;
            const previousLastReadAt = currentConversation?.lastReadAt ?? null;
            const previousLastReadMessageId = currentConversation?.lastReadMessageId ?? null;
            const optimisticReadMessage = params.lastReadMessageId && !isTemporaryMessageId(params.lastReadMessageId)
                ? (currentThread?.pages
                    .flatMap((page) => page.messages)
                    .find((message) => message.id === params.lastReadMessageId) ?? null)
                : currentConversation?.lastMessage ?? null;
            const optimisticLastReadAt = optimisticReadMessage?.createdAt ?? previousLastReadAt;
            const optimisticLastReadMessageId = optimisticReadMessage?.id ?? previousLastReadMessageId;
            const requestId = `${params.conversationId}:${Date.now()}`;
            setPendingReadCommitState(queryClient, params.conversationId, {
                requestId,
                requestedAtMs: Date.now(),
                requestedMessageId: optimisticLastReadMessageId ?? params.lastReadMessageId ?? null,
            });
            const optimisticClearedCount = Math.max(0, previousUnreadCount);
            if (optimisticClearedCount > 0) {
                patchThreadConversation(queryClient, params.conversationId, (conversation) => ({
                    ...conversation,
                    unreadCount: 0,
                    lastReadAt: optimisticLastReadAt,
                    lastReadMessageId: optimisticLastReadMessageId,
                }));
                patchUnreadSummary(queryClient, (count) => Math.max(0, count - optimisticClearedCount));
            }
            console.debug('[messages-v2] read_commit_requested', {
                conversationId: params.conversationId,
                requestId,
                requestedWatermark: isTemporaryMessageId(params.lastReadMessageId)
                    ? 'latest-server-message'
                    : params.lastReadMessageId ?? 'latest-server-message',
                optimisticClearedCount,
            });
            return {
                previousUnreadCount,
                previousLastReadAt,
                previousLastReadMessageId,
                requestId,
                optimisticClearedCount,
            };
        },
        onError: (_error, params, context) => {
            clearPendingReadCommitState(queryClient, params.conversationId, context?.requestId);
            const optimisticClearedCount = context?.optimisticClearedCount ?? 0;
            if (optimisticClearedCount > 0) {
                patchThreadConversation(queryClient, params.conversationId, (conversation) => ({
                    ...conversation,
                    unreadCount: context?.previousUnreadCount ?? optimisticClearedCount,
                    lastReadAt: context?.previousLastReadAt ?? conversation.lastReadAt,
                    lastReadMessageId: context?.previousLastReadMessageId ?? conversation.lastReadMessageId,
                }));
                patchUnreadSummary(queryClient, (count) => count + optimisticClearedCount);
            }
            console.warn('[messages-v2] read_commit_failed', {
                conversationId: params.conversationId,
                requestId: context?.requestId ?? null,
            });
        },
        onSuccess: (result, params, context) => {
            const previousUnreadCount = context?.previousUnreadCount ?? 0;
            const optimisticClearedCount = context?.optimisticClearedCount ?? 0;
            const nextUnreadCount = typeof result.unreadCount === 'number'
                ? Math.max(0, result.unreadCount)
                : 0;
            clearPendingReadCommitState(queryClient, params.conversationId, context?.requestId);
            console.debug('[messages-v2] read_commit_applied', {
                conversationId: params.conversationId,
                requestId: context?.requestId ?? null,
                previousUnread: previousUnreadCount,
                nextUnread: nextUnreadCount,
                appliedWatermark: result.lastReadMessageId ?? 'latest-server-message',
            });

            patchThreadConversation(queryClient, params.conversationId, (conversation) => ({
                ...conversation,
                unreadCount: nextUnreadCount,
                lastReadAt: result.lastReadAt ?? conversation.lastReadAt,
                lastReadMessageId: result.lastReadMessageId ?? conversation.lastReadMessageId,
            }));
            if (optimisticClearedCount > 0) {
                if (nextUnreadCount > 0) {
                    patchUnreadSummary(queryClient, (count) => count + nextUnreadCount);
                }
            } else if (nextUnreadCount > previousUnreadCount) {
                patchUnreadSummary(queryClient, (count) => count + (nextUnreadCount - previousUnreadCount));
            } else {
                const clearedUnreadCount = Math.max(0, previousUnreadCount - nextUnreadCount);
                if (clearedUnreadCount > 0) {
                    patchUnreadSummary(queryClient, (count) => Math.max(0, count - clearedUnreadCount));
                }
            }
        },
    });

    const muteConversation = useMutation({
        mutationFn: async (params: { conversationId: string; muted: boolean }) =>
            setConversationMuted(params.conversationId, params.muted),
        onMutate: async (params) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.messages.v2.thread(params.conversationId) });
            await queryClient.cancelQueries({ queryKey: queryKeys.messages.v2.inbox(20) });

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
            setConversationArchived(params.conversationId, params.archived),
        onMutate: async (params) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.messages.v2.thread(params.conversationId) });
            await queryClient.cancelQueries({ queryKey: queryKeys.messages.v2.inbox(20) });

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
                }
                return;
            }

            if (cachedConversation) {
                patchThreadConversation(queryClient, params.conversationId, (conversation) => ({
                    ...conversation,
                    lifecycleState: 'active',
                }));
            }
        },
        onSuccess: async (_result, params) => {
            if (params.archived) {
                await refreshUnreadCache(queryClient);
                return;
            }
            const refreshedConversation = await getConversationSummaryV2(params.conversationId);
            if (refreshedConversation.success && refreshedConversation.conversation) {
                upsertThreadConversation(queryClient, refreshedConversation.conversation);
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
            contextChips?: MessageContextChip[];
        }) => {
            const result = await sendConversationMessageV2(params);
            if (!result.success || !result.conversationId) {
                throw new Error(result.error || 'Failed to send message');
            }
            return result;
        },
        onMutate: (params) => {
            const conversationId = params.conversationId;
            if (!conversationId || conversationId.startsWith('draft:')) return;

            const optimisticMessage = {
                id: params.clientMessageId ? `temp-${params.clientMessageId}` : `temp-${Date.now()}`,
                content: params.content,
                senderId: user?.id ?? null,
                createdAt: new Date(),
                type: (params.attachments?.[0]?.type || 'text') as MessageWithSender['type'],
                metadata: null,
            };

            patchConversationLastMessageFromMessage(queryClient, conversationId, optimisticMessage);
        },
        onSuccess: (result, variables) => {
            if (result.conversation) {
                upsertThreadConversation(queryClient, result.conversation);
            }

            if (result.message && result.conversationId) {
                const clientMessageId = result.message.clientMessageId ?? variables.clientMessageId;
                // If the input was a draft conversation, try to replace the optimistic message
                // in the real conversation's thread (the server created it)
                const inputConversationId = variables.conversationId ?? null;
                const targetConversationId = result.conversationId;

                if (clientMessageId) {
                    replaceOptimisticThreadMessage(
                        queryClient,
                        targetConversationId,
                        clientMessageId,
                        result.message,
                        result.conversation ?? null,
                    );
                    // Also try to replace in the draft thread cache if it was a draft
                    if (inputConversationId && inputConversationId.startsWith('draft:') && inputConversationId !== targetConversationId) {
                        replaceOptimisticThreadMessage(
                            queryClient,
                            inputConversationId,
                            clientMessageId,
                            result.message,
                            result.conversation ?? null,
                        );
                    }
                } else {
                    upsertThreadMessage(
                        queryClient,
                        targetConversationId,
                        result.message,
                        result.conversation ?? null,
                    );
                }
            } else if (result.conversation) {
                upsertInboxConversation(queryClient, result.conversation);
            }
        },
    });

    const sendStructuredMessage = useMutation({
        mutationFn: async (params: Parameters<typeof sendStructuredConversationMessageV2>[0]) => {
            const result = await sendStructuredConversationMessageV2(params);
            if (!result.success || !result.conversationId) {
                throw new Error(result.error || 'Failed to send structured message');
            }
            return result;
        },
        onSuccess: (result, variables) => {
            if (result.conversation) {
                upsertThreadConversation(queryClient, result.conversation);
            }

            if (result.message && result.conversationId) {
                const clientMessageId = result.message.clientMessageId ?? variables.clientMessageId ?? null;
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

    const resolveWorkflow = useMutation({
        mutationFn: async (params: Parameters<typeof resolveConversationWorkflowV2>[0]) => {
            const result = await resolveConversationWorkflowV2(params);
            if (!result.success || !result.conversationId) {
                throw new Error(result.error || 'Failed to resolve workflow');
            }
            return result;
        },
        onSuccess: (result) => {
            if (result.conversation) {
                upsertThreadConversation(queryClient, result.conversation);
            }
            if (result.message && result.conversationId) {
                upsertThreadMessage(queryClient, result.conversationId, result.message, result.conversation ?? null);
            }
            if (result.bridgeMessage && result.conversationId) {
                upsertThreadMessage(queryClient, result.conversationId, result.bridgeMessage, result.conversation ?? null);
                patchConversationLastMessageFromMessage(queryClient, result.conversationId, result.bridgeMessage);
            } else if (result.message && result.conversationId) {
                patchConversationLastMessageFromMessage(queryClient, result.conversationId, result.message);
            }
        },
    });

    const convertMessageToTask = useMutation({
        mutationFn: async (params: Parameters<typeof convertMessageToTaskActionV2>[0]) => {
            const result = await convertMessageToTaskActionV2(params);
            if (!result.success || !result.taskId) {
                throw new Error(result.error || 'Failed to convert message to task');
            }
            return result;
        },
        onSuccess: (result) => {
            if (result.conversationId) {
                void queryClient.invalidateQueries({
                    queryKey: ["chat-v2", "linked-work", result.conversationId],
                    exact: false,
                });
            }
            if (result.bridgeMessage) {
                upsertThreadMessage(queryClient, result.bridgeMessage.conversationId, result.bridgeMessage);
                patchConversationLastMessageFromMessage(queryClient, result.bridgeMessage.conversationId, result.bridgeMessage);
            }
        },
    });

    const pinMessage = useMutation({
        mutationFn: async (params: { messageId: string; pinned: boolean; conversationId: string }) => {
            const result = await setMessagePinned(params.messageId, params.pinned);
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
        const result = await getMessageContext(conversationId, messageId);
        if (!result.success || !result.available || !result.message) {
            return null;
        }

        const contextMessages = Array.isArray(result.messages) && result.messages.length > 0
            ? result.messages
            : [result.message];

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
                                messages: mergeMessageCollections(page.messages, contextMessages),
                            }
                            : page,
                    ),
                };
            },
        );

        return {
            anchorMessageId: result.anchorMessageId ?? result.message.id,
            message: result.message,
            messages: contextMessages,
            hasOlderContext: Boolean(result.hasOlderContext),
            hasNewerContext: Boolean(result.hasNewerContext),
        };
    };

    const convertMessageToFollowUp = useMutation({
        mutationFn: async (params: Parameters<typeof convertMessageToFollowUpActionV2>[0] & { conversationId: string }) => {
            const result = await convertMessageToFollowUpActionV2(params);
            if (!result.success || !result.workflowItemId) {
                throw new Error(result.error || 'Failed to add follow-up');
            }
            return result;
        },
        onSuccess: (_result, variables) => {
            void queryClient.invalidateQueries({
                queryKey: ["chat-v2", "linked-work", variables.conversationId],
                exact: false,
            });
            void injectMessageContext(variables.conversationId, variables.messageId);
        },
    });

    return {
        markRead,
        muteConversation,
        archiveConversation,
        sendConversationMessage,
        sendStructuredMessage,
        resolveWorkflow,
        convertMessageToTask,
        convertMessageToFollowUp,
        pinMessage,
        injectMessageContext,
    };
}

export function useToggleReaction(conversationId: string | null) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (params: { messageId: string; emoji: string }) => {
            const result = await toggleReaction(params.messageId, params.emoji);
            if (!result.success) {
                throw new Error(result.error || 'Failed to toggle reaction');
            }
            return result;
        },
        onMutate: (params) => {
            if (!conversationId) return;

            // Get the current message from the thread cache
            const currentThread = queryClient.getQueryData<{ pages: MessageThreadPageV2[] }>(
                queryKeys.messages.v2.thread(conversationId),
            );
            const currentMessage = currentThread?.pages
                .flatMap((page) => page.messages)
                .find((message) => message.id === params.messageId) ?? null;

            if (!currentMessage) return;

            // Save previous state for rollback
            const previousMessage = { ...currentMessage };

            // Apply optimistic reaction toggle via patchThreadMessage
            const currentReactions = normalizeMessageReactionSummary(
                (currentMessage.metadata as Record<string, unknown> | null)?.reactionSummary as unknown[],
            );
            const nextReactions = toggleMessageReactionSummary(currentReactions, params.emoji);

            patchThreadMessage(queryClient, conversationId, params.messageId, (message) => ({
                ...message,
                metadata: withReactionSummaryMetadata(
                    message.metadata as Record<string, unknown> | null,
                    nextReactions,
                ),
            }));

            return { previousMessage };
        },
        onError: (_error, params, context) => {
            if (!conversationId || !context?.previousMessage) return;

            // Rollback: restore previous message state
            patchThreadMessage(queryClient, conversationId, params.messageId, () => context.previousMessage);
        },
        onSettled: () => {
            // Optionally invalidate to sync with server state
            if (conversationId) {
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.messages.v2.thread(conversationId),
                    exact: false,
                });
            }
        },
    });
}

export type { InboxConversationV2 };
