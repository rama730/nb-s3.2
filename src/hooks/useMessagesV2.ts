'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import {
    convertMessageToFollowUpV2,
    convertMessageToTaskV2,
    type InboxConversationV2,
    type MessageThreadPageV2,
    ensureDirectConversationV2,
    getApplicationsInboxPageV2,
    getConversationCapabilityV2,
    getConversationSummaryV2,
    getConversationThreadPageV2,
    getInboxPageV2,
    getMessagingStructuredCatalogPageV2,
    getMessageContextV2,
    getProjectGroupsPageV2,
    getUnreadSummaryV2,
    markConversationReadV2,
    resolveConversationWorkflowV2,
    searchMessagesV2,
    sendConversationMessageV2,
    sendStructuredConversationMessageV2,
    setConversationArchivedV2,
    setConversationMutedV2,
    setMessagePinnedV2,
} from '@/app/actions/messaging/v2';
import type { MessageWithSender, UploadedAttachment } from '@/app/actions/messaging';
import { queryKeys } from '@/lib/query-keys';
import {
    patchInboxConversation,
    patchConversationLastMessageFromMessage,
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
import {
    createPendingStructuredState,
    createStructuredMessagePayload,
    type MessageContextChip,
    type StructuredMessagePayload,
    withMessageContextChipsMetadata,
    withStructuredMessageMetadata,
} from '@/lib/messages/structured';

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

    return {
        ...query,
        messages,
        conversation: firstPage?.conversation ?? null,
        capability: firstPage?.capability ?? null,
        pinnedMessages: firstPage?.pinnedMessages ?? [],
    };
}

export function useConversationCapabilities(conversationId: string | null, targetUserId?: string | null) {
    return useQuery({
        queryKey: queryKeys.messages.v2.capabilities(conversationId, targetUserId ?? null),
        enabled: Boolean(conversationId || targetUserId),
        queryFn: async () => {
            const result = await getConversationCapabilityV2({ conversationId, targetUserId });
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

export function useMessagingStructuredCatalog(conversationId: string | null, targetUserId?: string | null, enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.messages.v2.structuredCatalog(conversationId, targetUserId ?? null),
        enabled: enabled && Boolean(conversationId || targetUserId),
        queryFn: async () => {
            const result = await getMessagingStructuredCatalogPageV2({
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
            contextChips?: MessageContextChip[];
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
        mutationFn: async (params: Parameters<typeof convertMessageToTaskV2>[0]) => {
            const result = await convertMessageToTaskV2(params);
            if (!result.success || !result.taskId) {
                throw new Error(result.error || 'Failed to convert message to task');
            }
            return result;
        },
        onSuccess: (result) => {
            if (result.bridgeMessage) {
                upsertThreadMessage(queryClient, result.bridgeMessage.conversationId, result.bridgeMessage);
                patchConversationLastMessageFromMessage(queryClient, result.bridgeMessage.conversationId, result.bridgeMessage);
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
        mutationFn: async (params: Parameters<typeof convertMessageToFollowUpV2>[0] & { conversationId: string }) => {
            const result = await convertMessageToFollowUpV2(params);
            if (!result.success || !result.workflowItemId) {
                throw new Error(result.error || 'Failed to add follow-up');
            }
            return result;
        },
        onSuccess: (_result, variables) => {
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

export type { InboxConversationV2 };
