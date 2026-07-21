'use client';

import { Profiler, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ProfilerOnRenderCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageSquare, PenSquare, Search, WifiOff, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { markConversationMessageNotificationsReadAction } from '@/app/actions/notifications';
import { useChatTypingState } from '@/hooks/useChatTypingState';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from 'use-debounce';
import { useMessagesV2Realtime } from '@/hooks/useMessagesV2Realtime';
import {
    useConversationThread,
    useEnsureDirectConversation,
    useInbox,
    useMessageSearch,
    useMessagesActions,
} from '@/hooks/useMessagesV2';
import { useMessagingShortcuts } from '@/hooks/useMessagingShortcuts';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { usePresenceHealth } from '@/hooks/usePresenceHealth';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';
import { cn } from '@/lib/utils';
import { upsertThreadConversation } from '@/lib/messages/v2-cache';
import { refreshConversationCache } from '@/lib/messages/v2-refresh';
import { getEffectiveMessageAttentionUnreadCount } from '@/lib/messages/attention';
import { isTemporaryMessageId } from '@/lib/messages/utils';
import { queryKeys } from '@/lib/query-keys';
import { OPEN_MESSAGES_SEARCH_EVENT } from '@/components/layout/header/global-search';
import { ConversationHeaderV2 } from './ConversationHeaderV2';
import { ConversationListV2 } from './ConversationListV2';
import { DropZoneOverlay } from './DropZoneOverlay';
import { MessageComposerV2 } from './MessageComposerV2';
import { MessageThreadV2 } from './MessageThreadV2';
import { ApplicationsListV2 } from './ApplicationsListV2';
import { ProjectGroupsListV2 } from './ProjectGroupsListV2';
import { NewMessageModalV2 } from './NewMessageModalV2';
import { findLatestApplicationEvent } from '@/lib/chat/application-events';
import { formatMessagePreview } from '@/lib/messages/preview';
import { ThreadSkeletonV2 } from './MessagesSurfaceSkeletons';
import type { MessageWithSender } from '@/app/actions/messaging';

interface MessagesWorkspaceV2Props {
    mode: 'page' | 'popup';
    targetUserId?: string | null;
    initialConversationId?: string | null;
    initialMessageId?: string | null;
}

interface ReplyContextJumpState {
    anchorMessageId: string;
    hasOlderContext: boolean;
    hasNewerContext: boolean;
}

type ConversationLastMessageSnapshot = {
    id?: string | null;
    createdAt?: Date | string | null;
} | null | undefined;

const ENABLE_MESSAGES_RENDER_PROFILER = process.env.NEXT_PUBLIC_MESSAGES_RENDER_PROFILER === '1';

const handleMessagesProfilerRender: ProfilerOnRenderCallback = (
    id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime,
) => {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
        performance.mark(`messages-v2:render:${id}:${phase}`);
    }
    console.debug('[messages-v2] render_profile', {
        id,
        phase,
        actualDuration,
        baseDuration,
        startTime,
        commitTime,
    });
};

function MessagesRenderProfiler({ mode, children }: { mode: MessagesWorkspaceV2Props['mode']; children: ReactNode }) {
    if (!ENABLE_MESSAGES_RENDER_PROFILER) {
        return <>{children}</>;
    }

    return (
        <Profiler id={`messages-workspace:${mode}`} onRender={handleMessagesProfilerRender}>
            {children}
        </Profiler>
    );
}

function lastMessageEpoch(value: ConversationLastMessageSnapshot) {
    if (!value?.createdAt) return 0;
    const epoch = value.createdAt instanceof Date
        ? value.createdAt.getTime()
        : new Date(value.createdAt).getTime();
    return Number.isFinite(epoch) ? epoch : 0;
}

function pickNewestLastMessage(
    left: ConversationLastMessageSnapshot,
    right: ConversationLastMessageSnapshot,
) {
    if (!left?.id) return right?.id ? right : null;
    if (!right?.id) return left;
    const leftEpoch = lastMessageEpoch(left);
    const rightEpoch = lastMessageEpoch(right);
    if (rightEpoch !== leftEpoch) {
        return rightEpoch > leftEpoch ? right : left;
    }
    return String(right.id).localeCompare(String(left.id)) > 0 ? right : left;
}

export function MessagesWorkspaceV2({
    mode,
    targetUserId,
    initialConversationId,
    initialMessageId,
}: MessagesWorkspaceV2Props) {
    const compact = mode === 'popup';
    const router = useRouter();
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const activeTab = useMessagesV2UiStore((state) => state.activeTab);
    const setActiveTab = useMessagesV2UiStore((state) => state.setActiveTab);
    const selectedConversationId = useMessagesV2UiStore((state) => state.selectedConversationId);
    const setSelectedConversationId = useMessagesV2UiStore((state) => state.setSelectedConversationId);
    const setHighlightedConversationId = useMessagesV2UiStore((state) => state.setHighlightedConversationId);
    const activeMessageAttention = useMessagesV2UiStore((state) =>
        selectedConversationId ? state.messageAttentionByConversation[selectedConversationId] ?? null : null,
    );
    const clearMessageAttentionSmooth = useMessagesV2UiStore((state) => state.clearMessageAttentionSmooth);
    const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
    const [urlMessageId, setUrlMessageId] = useState<string | null>(null);
    const [replyTarget, setReplyTarget] = useState<MessageWithSender | null>(null);
    const [replyContextJumpState, setReplyContextJumpState] = useState<ReplyContextJumpState | null>(null);
    const [threadScrollToLatestSignal, setThreadScrollToLatestSignal] = useState(0);
    const [globalSearch, setGlobalSearch] = useState('');
    const [debouncedSearch] = useDebounce(globalSearch.trim(), 250);
    const [visibleConversationIds, setVisibleConversationIds] = useState<string[]>([]);
    const [searchOpen, setSearchOpen] = useState(false);
    const [newMessageOpen, setNewMessageOpen] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [composerBlurHeight, setComposerBlurHeight] = useState(0);
    const [isRefreshingLatestThread, setIsRefreshingLatestThread] = useState(false);
    const initialSelectionAppliedRef = useRef(false);
    const latestThreadSyncKeyRef = useRef<string | null>(null);
    const lastReadCommitWatermarkRef = useRef<string | null>(null);
    const pendingReadWatermarkRef = useRef<{ conversationId: string; messageId: string } | null>(null);
    const readCommitInFlightRef = useRef(false);
    const queuedReadCommitRef = useRef<{
        conversationId: string;
        messageId: string | null;
        allowLatestFallback: boolean;
        ignorePendingWatermark: boolean;
    } | null>(null);
    const commitVisibleThreadReadRef = useRef<(() => void) | null>(null);
    const composerAddFilesRef = useRef<((files: File[]) => void) | null>(null);
    const isChatsTabActive = activeTab === 'chats';
    const hasActiveConversation = Boolean(selectedConversationId);
    const ensureConversation = useEnsureDirectConversation();
    const inbox = useInbox(20, isChatsTabActive);
    const thread = useConversationThread(selectedConversationId);
    const { markRead, muteConversation, archiveConversation, pinMessage, injectMessageContext } = useMessagesActions();
    const search = useMessageSearch(debouncedSearch);
    const { activeTypingUsers, sendTyping, typingUsersByConversation } = useChatTypingState({
        activeConversationId: selectedConversationId,
        visibleConversationIds,
        enabled: hasActiveConversation || isChatsTabActive,
        listVisible: isChatsTabActive,
    });
    const isOnline = useOnlineStatus();
    const presenceHealth = usePresenceHealth();
    const realtime = useMessagesV2Realtime(selectedConversationId, {
        inbox: isChatsTabActive,
        activeThread: hasActiveConversation,
    });

    const clearConversationAttention = useCallback((conversationId: string) => {
        clearMessageAttentionSmooth(conversationId);
        void markConversationMessageNotificationsReadAction(conversationId);
    }, [clearMessageAttentionSmooth]);

    useEffect(() => {
        if (initialSelectionAppliedRef.current) return;
        if (initialConversationId) {
            setSelectedConversationId(initialConversationId);
            if (initialMessageId) {
                setFocusMessageId(initialMessageId);
                setUrlMessageId(initialMessageId);
            }
            initialSelectionAppliedRef.current = true;
            return;
        }
        if (targetUserId) {
            initialSelectionAppliedRef.current = true;
            const draftId = `draft:${targetUserId}`;

            // Seed the query cache with a temporary draft conversation so the UI can render instantly
            const tempConversation = {
                id: draftId,
                type: 'dm' as const,
                updatedAt: new Date(),
                lifecycleState: 'draft' as const,
                participants: [{
                    id: targetUserId,
                    username: 'loading',
                    fullName: 'Loading chat...',
                    avatarUrl: null,
                }],
                lastMessage: null,
                unreadCount: 0,
                lastReadAt: null,
                lastReadMessageId: null,
                capability: {
                    conversationType: 'dm' as const,
                    status: 'open' as const,
                    canSend: true,
                    blocked: false,
                    messagePrivacy: 'connections' as const,
                    isConnected: false,
                    isPendingIncoming: false,
                    isPendingOutgoing: false,
                    canInvite: false,
                    connectionId: null,
                }
            };

            queryClient.setQueryData(
                queryKeys.messages.v2.thread(draftId),
                {
                    pages: [{
                        conversation: tempConversation,
                        capability: tempConversation.capability,
                        messages: [],
                        pinnedMessages: [],
                        hasMore: false,
                        nextCursor: null,
                    }],
                    pageParams: [undefined],
                },
            );

            setSelectedConversationId(draftId);

            ensureConversation.mutate(targetUserId, {
                onSuccess: (result) => {
                    if (!result.conversationId) {
                        toast.error('Failed to open conversation');
                        return;
                    }
                    setSelectedConversationId(result.conversationId);
                    if (result.conversation) {
                        // For draft conversations, seed the thread cache with a synthetic page
                        // so the UI can render the conversation header and composer
                        if (result.conversationId.startsWith('draft:')) {
                            queryClient.setQueryData(
                                queryKeys.messages.v2.thread(result.conversationId),
                                {
                                    pages: [{
                                        conversation: result.conversation,
                                        capability: result.conversation.capability,
                                        messages: [],
                                        pinnedMessages: [],
                                        hasMore: false,
                                        nextCursor: null,
                                    }],
                                    pageParams: [undefined],
                                },
                            );
                        } else {
                            upsertThreadConversation(queryClient, result.conversation);
                        }
                    }
                    if (mode === 'page' && !result.conversationId.startsWith('draft:')) {
                        router.replace(`/messages?conversationId=${result.conversationId}`);
                    }
                },
                onError: (error) => {
                    if (useMessagesV2UiStore.getState().selectedConversationId === draftId) {
                        setSelectedConversationId(null);
                    }
                    queryClient.removeQueries({ queryKey: queryKeys.messages.v2.thread(draftId) });
                    toast.error(error instanceof Error ? error.message : 'Failed to open conversation');
                },
            });
            return;
        }
        initialSelectionAppliedRef.current = true;
    }, [ensureConversation, initialConversationId, initialMessageId, mode, queryClient, router, setSelectedConversationId, targetUserId]);

    useEffect(() => {
        if (mode !== 'page' || !selectedConversationId || !urlMessageId) return;
        router.replace(`/messages?conversationId=${selectedConversationId}&messageId=${encodeURIComponent(urlMessageId)}`);
    }, [mode, router, selectedConversationId, urlMessageId]);

    useEffect(() => {
        if (!replyContextJumpState) return;
        const timer = window.setTimeout(() => {
            setReplyContextJumpState((current) =>
                current?.anchorMessageId === replyContextJumpState.anchorMessageId ? null : current,
            );
        }, 4200);
        return () => window.clearTimeout(timer);
    }, [replyContextJumpState]);

    useEffect(() => {
        lastReadCommitWatermarkRef.current = null;
        pendingReadWatermarkRef.current = null;
        readCommitInFlightRef.current = false;
        queuedReadCommitRef.current = null;
        latestThreadSyncKeyRef.current = null;
        setComposerBlurHeight(0);
        setIsRefreshingLatestThread(false);
    }, [selectedConversationId]);

    const hasLoadedReadableMessage = useMemo(
        () => thread.messages.some((message) => !message.deletedAt && !isTemporaryMessageId(message.id)),
        [thread.messages],
    );
    const latestReadableMessageId = useMemo(() => {
        for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
            const message = thread.messages[index]!;
            if (!message.deletedAt && !isTemporaryMessageId(message.id)) {
                return message.id;
            }
        }
        return null;
    }, [thread.messages]);
    const selectedInboxConversation = useMemo(
        () => selectedConversationId
            ? inbox.conversations.find((conversation) => conversation.id === selectedConversationId) ?? null
            : null,
        [inbox.conversations, selectedConversationId],
    );
    const authoritativeLatestMessage = useMemo(
        () => pickNewestLastMessage(
            thread.conversation?.lastMessage ?? null,
            selectedInboxConversation?.lastMessage ?? null,
        ),
        [selectedInboxConversation?.lastMessage, thread.conversation?.lastMessage],
    );
    const authoritativeLatestMessageId = authoritativeLatestMessage?.id ?? null;
    const hasLoadedAuthoritativeLatest = useMemo(
        () => !authoritativeLatestMessageId
            || thread.messages.some((message) => message.id === authoritativeLatestMessageId),
        [authoritativeLatestMessageId, thread.messages],
    );
    const hasThreadLatestGap = Boolean(
        selectedConversationId
        && authoritativeLatestMessageId
        && !hasLoadedAuthoritativeLatest
        && !focusMessageId
        && !replyContextJumpState,
    );
    const rawActiveUnreadCount = Math.max(
        0,
        Number(thread.conversation?.unreadCount ?? 0),
        Number(selectedInboxConversation?.unreadCount ?? 0),
    );
    const effectiveActiveUnreadCount = Math.max(
        getEffectiveMessageAttentionUnreadCount(thread.conversation, user?.id ?? null),
        getEffectiveMessageAttentionUnreadCount(selectedInboxConversation, user?.id ?? null),
    );
    const hasActiveMessageAttention = Boolean(
        activeMessageAttention?.hasNewMessages || activeMessageAttention?.clearing,
    );
    const shouldResolveActiveConversationRead = rawActiveUnreadCount > 0
        || effectiveActiveUnreadCount > 0
        || hasActiveMessageAttention;

    useEffect(() => {
        if (
            !selectedConversationId
            || selectedConversationId.startsWith('draft:')
            || !authoritativeLatestMessageId
            || hasLoadedAuthoritativeLatest
            || focusMessageId
            || replyContextJumpState
        ) {
            if (hasLoadedAuthoritativeLatest) {
                latestThreadSyncKeyRef.current = null;
                setIsRefreshingLatestThread(false);
            }
            return;
        }

        const syncKey = `${selectedConversationId}:${authoritativeLatestMessageId}`;
        if (latestThreadSyncKeyRef.current === syncKey) return;

        latestThreadSyncKeyRef.current = syncKey;
        setIsRefreshingLatestThread(true);
        void refreshConversationCache(queryClient, selectedConversationId, { includeUnread: true })
            .then((refreshed) => {
                if (!refreshed) {
                    console.warn('[messages-v2] latest_thread_sync_unavailable', {
                        conversationId: selectedConversationId,
                        latestMessageId: authoritativeLatestMessageId,
                    });
                }
            })
            .catch((error) => {
                console.warn('[messages-v2] latest_thread_sync_failed', {
                    conversationId: selectedConversationId,
                    latestMessageId: authoritativeLatestMessageId,
                    error,
                });
            })
            .finally(() => {
                setIsRefreshingLatestThread(false);
            });
    }, [
        authoritativeLatestMessageId,
        focusMessageId,
        hasLoadedAuthoritativeLatest,
        queryClient,
        replyContextJumpState,
        selectedConversationId,
    ]);

    const handleCommitThreadRead = useCallback((
        messageId?: string | null,
        options: { allowLatestFallback?: boolean; ignorePendingWatermark?: boolean } = {},
    ) => {
        const conversationId = selectedConversationId;
        if (!conversationId || !shouldResolveActiveConversationRead) return;

        const enqueueCommit = (
            commitMessageId: string | null,
            commitOptions: { allowLatestFallback: boolean; ignorePendingWatermark: boolean },
        ) => {
            const pending = commitOptions.ignorePendingWatermark ? null : pendingReadWatermarkRef.current;
            const pendingMessageId = pending?.conversationId === conversationId
                ? pending.messageId
                : null;
            const candidateMessageId = commitMessageId
                ?? pendingMessageId
                ?? null;
            const explicitMessageId = !isTemporaryMessageId(candidateMessageId)
                ? candidateMessageId
                : commitOptions.allowLatestFallback
                    ? latestReadableMessageId
                    : null;
            const serverMessageId = explicitMessageId
                ?? (commitOptions.allowLatestFallback ? latestReadableMessageId : null);
            if (!serverMessageId) return;

            const watermark = `${conversationId}:${serverMessageId}`;
            if (readCommitInFlightRef.current) {
                if (
                    lastReadCommitWatermarkRef.current === watermark
                    || lastReadCommitWatermarkRef.current === `${conversationId}:${latestReadableMessageId ?? ''}`
                ) {
                    return;
                }
                queuedReadCommitRef.current = {
                    conversationId,
                    messageId: serverMessageId,
                    allowLatestFallback: false,
                    ignorePendingWatermark: commitOptions.ignorePendingWatermark,
                };
                console.debug('[messages-v2] read_commit_replaced_by_newer', {
                    conversationId,
                    requestedWatermark: serverMessageId,
                });
                return;
            }

            if (lastReadCommitWatermarkRef.current === watermark) return;
            lastReadCommitWatermarkRef.current = watermark;

            if (pending?.conversationId === conversationId && pending.messageId === serverMessageId) {
                pendingReadWatermarkRef.current = null;
            }

            readCommitInFlightRef.current = true;
            console.debug('[messages-v2] read_commit_requested', {
                conversationId,
                requestedWatermark: serverMessageId,
            });
            void markRead.mutateAsync({
                conversationId,
                lastReadMessageId: serverMessageId,
            }).then((result) => {
                if (result.unreadCount === 0) {
                    clearConversationAttention(conversationId);
                }
            }).catch((error) => {
                if (lastReadCommitWatermarkRef.current === watermark) {
                    lastReadCommitWatermarkRef.current = null;
                }
                pendingReadWatermarkRef.current = { conversationId, messageId: serverMessageId };
                console.warn('[messages-v2] markRead failed', error);
            }).finally(() => {
                readCommitInFlightRef.current = false;
                const nextCommit = queuedReadCommitRef.current;
                if (!nextCommit || nextCommit.conversationId !== conversationId) {
                    queuedReadCommitRef.current = null;
                    return;
                }
                queuedReadCommitRef.current = null;
                enqueueCommit(nextCommit.messageId, {
                    allowLatestFallback: nextCommit.allowLatestFallback,
                    ignorePendingWatermark: nextCommit.ignorePendingWatermark,
                });
            });
        };

        enqueueCommit(messageId ?? null, {
            allowLatestFallback: options.allowLatestFallback ?? true,
            ignorePendingWatermark: options.ignorePendingWatermark ?? false,
        });
    }, [
        markRead,
        clearConversationAttention,
        latestReadableMessageId,
        selectedConversationId,
        shouldResolveActiveConversationRead,
    ]);

    const handleCommitVisibleThreadRead = useCallback(() => {
        const shouldCommitLatestServerWatermark =
            hasLoadedReadableMessage && hasLoadedAuthoritativeLatest;
        handleCommitThreadRead(
            null,
            shouldCommitLatestServerWatermark ? { ignorePendingWatermark: true } : {},
        );
    }, [handleCommitThreadRead, hasLoadedAuthoritativeLatest, hasLoadedReadableMessage]);

    useEffect(() => {
        if (
            !selectedConversationId
            || !shouldResolveActiveConversationRead
            || !hasLoadedReadableMessage
            || !hasLoadedAuthoritativeLatest
        ) {
            return;
        }

        console.debug('[messages-v2] read_seen_detected', {
            conversationId: selectedConversationId,
            source: 'thread-open',
        });
        handleCommitThreadRead(null, { ignorePendingWatermark: true });
    }, [
        hasLoadedAuthoritativeLatest,
        hasLoadedReadableMessage,
        handleCommitThreadRead,
        selectedConversationId,
        shouldResolveActiveConversationRead,
    ]);

    const handleVisibleReadWatermark = useCallback((messageId: string) => {
        if (!selectedConversationId || !shouldResolveActiveConversationRead) return;

        pendingReadWatermarkRef.current = {
            conversationId: selectedConversationId,
            messageId,
        };
        console.debug('[messages-v2] read_seen_detected', {
            conversationId: selectedConversationId,
            source: 'visible-unread-row',
            messageId,
        });
        handleCommitThreadRead(messageId, { allowLatestFallback: false });
    }, [
        handleCommitThreadRead,
        selectedConversationId,
        shouldResolveActiveConversationRead,
    ]);

    useEffect(() => {
        commitVisibleThreadReadRef.current = handleCommitVisibleThreadRead;
    }, [handleCommitVisibleThreadRead]);

    useEffect(() => {
        const commitPendingRead = () => {
            commitVisibleThreadReadRef.current?.();
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                commitPendingRead();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('pagehide', commitPendingRead);
        window.addEventListener('blur', commitPendingRead);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('pagehide', commitPendingRead);
            window.removeEventListener('blur', commitPendingRead);
        };
    }, []);

    useEffect(() => () => {
        commitVisibleThreadReadRef.current?.();
    }, []);

    const clearMessageFocus = useCallback(() => {
        setFocusMessageId(null);
        setUrlMessageId(null);
        setReplyContextJumpState(null);
        if (mode === 'page' && selectedConversationId) {
            router.replace(`/messages?conversationId=${selectedConversationId}`);
        }
    }, [mode, router, selectedConversationId]);

    const activeConversation = thread.conversation;
    const otherParticipant = activeConversation?.participants[0];
    const showSidebar = !compact || !selectedConversationId;
    const showTabsRail = mode === 'page' || !selectedConversationId;
    const isResolvingConversation = Boolean(targetUserId && ensureConversation.isPending && !selectedConversationId);
    const showPageInitialSkeleton = mode === 'page'
        && !selectedConversationId
        && inbox.isLoading
        && inbox.conversations.length === 0
        && !isResolvingConversation;
    const showThreadSkeleton = isResolvingConversation
        || (Boolean(selectedConversationId) && thread.isLoading && !activeConversation)
        || (hasThreadLatestGap && !hasLoadedReadableMessage);
    const showLatestThreadRefresh = isRefreshingLatestThread && hasLoadedReadableMessage;

    const handleSelectConversation = useCallback((conversationId: string) => {
        if (conversationId !== selectedConversationId) {
            handleCommitVisibleThreadRead();
        }
        setSelectedConversationId(conversationId);
        setHighlightedConversationId(null);
        setReplyTarget(null);
        setFocusMessageId(null);
        setUrlMessageId(null);
        setReplyContextJumpState(null);
        if (mode === 'page') {
            router.replace(`/messages?conversationId=${conversationId}`);
        }
    }, [handleCommitVisibleThreadRead, selectedConversationId, setSelectedConversationId, setHighlightedConversationId, setReplyTarget, setFocusMessageId, setUrlMessageId, setReplyContextJumpState, mode, router]);

    const handleCloseConversation = useCallback(() => {
        handleCommitVisibleThreadRead();
        setSelectedConversationId(null);
        setReplyTarget(null);
        setFocusMessageId(null);
        setUrlMessageId(null);
        setReplyContextJumpState(null);
        if (mode === 'page') {
            router.replace('/messages');
        }
    }, [handleCommitVisibleThreadRead, setSelectedConversationId, setReplyTarget, setFocusMessageId, setUrlMessageId, setReplyContextJumpState, mode, router]);

    useEffect(() => {
        if (mode !== 'page') return;
        const openLocalSearch = () => setSearchOpen(true);
        window.addEventListener(OPEN_MESSAGES_SEARCH_EVENT, openLocalSearch);
        return () => window.removeEventListener(OPEN_MESSAGES_SEARCH_EVENT, openLocalSearch);
    }, [mode]);

    useMessagingShortcuts({
        onEscape: () => {
            if (searchOpen) {
                setSearchOpen(false);
                setGlobalSearch('');
            } else if (compact && selectedConversationId) {
                handleCloseConversation();
            }
        },
        onNewMessage: () => setNewMessageOpen(true),
        onFocusSearch: () => setSearchOpen(true),
        onToggleMute: () => {
            if (activeConversation) {
                void muteConversation.mutateAsync({
                    conversationId: activeConversation.id,
                    muted: !activeConversation.muted,
                });
            }
        },
    }, mode === 'page');

    const searchResults = search.data ?? [];

    const handleReply = useCallback((message: MessageWithSender) => {
        setReplyTarget(message);
    }, []);

    const handleTogglePin = useCallback((messageId: string, pinned: boolean) => {
        void pinMessage.mutateAsync({
            messageId,
            pinned,
            conversationId: selectedConversationId!,
        });
    }, [pinMessage, selectedConversationId]);

    const handlePrefetchConversation = useCallback((conversationId: string) => {
        const existing = queryClient.getQueryData(queryKeys.messages.v2.thread(conversationId));
        if (existing) return;

        void queryClient.prefetchInfiniteQuery({
            queryKey: queryKeys.messages.v2.thread(conversationId),
            queryFn: async ({ pageParam }) => {
                const { getConversationThreadPageV2 } = await import('@/app/actions/messaging/v2');
                const result = await getConversationThreadPageV2(
                    conversationId,
                    pageParam as string | undefined,
                    30,
                );
                if (!result.success || !result.page) {
                    throw new Error(result.error || 'Failed to prefetch conversation');
                }
                return result.page;
            },
            initialPageParam: undefined,
            staleTime: 30_000,
        });
    }, [queryClient]);

    const handleInboxLoadMore = useCallback(() => {
        void inbox.fetchNextPage();
    }, [inbox]);

    const handleThreadLoadMore = useCallback(() => {
        void thread.fetchNextPage();
    }, [thread]);

    const conversationParticipants = useMemo(() => {
        if (!activeConversation) return [];
        return activeConversation.participants.map((p) => ({
            id: p.id,
            username: p.username ?? null,
            fullName: p.fullName ?? null,
            avatarUrl: p.avatarUrl ?? null,
        }));
    }, [activeConversation]);

    const shellClasses = compact
        ? 'bg-white dark:bg-zinc-950'
        : 'bg-zinc-50/60 dark:bg-zinc-950';

    return (
        <MessagesRenderProfiler mode={mode}>
        <div className={cn('flex h-full min-h-0 flex-col overflow-hidden', shellClasses)}>


            {(!isOnline || realtime.isDegraded || presenceHealth.degraded) ? (
                <div className={cn(
                    'flex items-center gap-2 border-b border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200',
                    compact ? 'px-3 py-2 text-xs' : 'px-5 py-2.5 text-sm',
                )}>
                    <WifiOff className="h-3.5 w-3.5 shrink-0" />
                    <span>
                        {!isOnline
                            ? 'You\u2019re offline \u2014 messages will send when your connection restores.'
                            : presenceHealth.status === 'unavailable'
                                ? 'Typing indicators and online presence are unavailable until realtime reconnects.'
                                : presenceHealth.status === 'degraded'
                                    ? 'Typing indicators and online presence are reconnecting \u2014 message delivery will continue.'
                            : 'Realtime connection lost \u2014 messages may be delayed.'}
                    </span>
                </div>
            ) : null}

            <div className="flex min-h-0 flex-1 overflow-hidden">
                {showSidebar ? (
                    <aside
                        className={cn(
                            'flex min-h-0 flex-col border-r border-border/60 bg-card',
                            compact ? 'w-full' : 'shrink-0 flex-1 min-w-[320px] max-w-[45%]',
                        )}
                        style={compact ? undefined : {}}
                    >
                        {/* Sidebar Header (X-style) */}
                        <div className="flex h-14 shrink-0 items-center justify-between px-3 md:px-5 bg-card">
                            {showTabsRail ? (
                                <DropdownMenu modal={false}>
                                    <DropdownMenuTrigger asChild>
                                        <button
                                            type="button"
                                            data-testid="messages-tab-trigger"
                                            className="flex items-center gap-1.5 text-base font-semibold text-foreground hover:opacity-80 transition-opacity"
                                        >
                                            {activeTab === 'chats' ? 'Chats' : activeTab === 'applications' ? 'Applications' : 'Project Groups'}
                                            <ChevronDown className="h-4 w-4 opacity-60" />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start">
                                        <DropdownMenuItem data-testid="messages-tab-chats" onClick={() => setActiveTab('chats')}>
                                            Chats
                                        </DropdownMenuItem>
                                        <DropdownMenuItem data-testid="messages-tab-applications" onClick={() => setActiveTab('applications')}>
                                            Applications
                                        </DropdownMenuItem>
                                        <DropdownMenuItem data-testid="messages-tab-projects" onClick={() => setActiveTab('projects')}>
                                            Project Groups
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : (
                                <h2 className="text-base font-semibold text-foreground">Messages</h2>
                            )}
                            <div className="flex items-center gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => setSearchOpen(true)}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                    aria-label="Search messages"
                                    title="Search messages (⌘K)"
                                >
                                    <Search className="h-4 w-4" strokeWidth={2.2} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setNewMessageOpen(true)}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                    aria-label="New message"
                                    title="New message"
                                >
                                    <PenSquare className="h-4 w-4" strokeWidth={2.2} />
                                </button>
                                {compact && (
                                    <button
                                        type="button"
                                        onClick={() => useMessagesV2UiStore.getState().setPopupMinimized(true)}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors animate-fade-in"
                                        aria-label="Collapse messages"
                                        title="Collapse"
                                    >
                                        <ChevronDown className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-hidden">
                        {activeTab === 'chats' ? (
                            <ConversationListV2
                                surface={mode}
                                conversations={inbox.conversations}
                                selectedConversationId={selectedConversationId}
                                loading={inbox.isLoading}
                                error={inbox.error instanceof Error ? inbox.error.message : null}
                                hasMore={Boolean(inbox.hasNextPage)}
                                typingUsersByConversation={typingUsersByConversation}
                                onSelectConversation={handleSelectConversation}
                                onLoadMore={handleInboxLoadMore}
                                onVisibleConversationIdsChange={setVisibleConversationIds}
                                onPrefetchConversation={handlePrefetchConversation}
                            />
                        ) : activeTab === 'applications' ? (
                            <ApplicationsListV2
                                surface={mode}
                                onSelectConversation={handleSelectConversation}
                            />
                        ) : (
                            <ProjectGroupsListV2
                                surface={mode}
                                onSelectConversation={handleSelectConversation}
                            />
                        )}
                        </div>
                    </aside>
                ) : null}

                <section
                    className={cn(
                        'relative min-h-0 min-w-0 flex-[2] w-full max-w-4xl overflow-hidden bg-white dark:bg-zinc-950',
                        compact && !selectedConversationId ? 'hidden' : 'flex',
                    )}
                    onDragOver={(e) => {
                        if (e.dataTransfer?.types.includes('Files')) {
                            e.preventDefault();
                            setIsDragOver(true);
                        }
                    }}
                    onDragLeave={(e) => {
                        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                        setIsDragOver(false);
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                        const files = Array.from(e.dataTransfer?.files || []);
                        if (files.length > 0) composerAddFilesRef.current?.(files);
                    }}
                >
                    {showThreadSkeleton ? (
                        <ThreadSkeletonV2 surface={mode} />
                    ) : activeConversation ? (
                        <div
                            className="relative flex flex-col min-h-0 min-w-0 flex-1 overflow-hidden bg-white dark:bg-zinc-950"
                            style={composerBlurHeight > 0
                                ? ({ '--msg-thread-composer-blur': `${composerBlurHeight}px` } as CSSProperties)
                                : undefined}
                        >
                            <DropZoneOverlay visible={isDragOver} />
                            {showLatestThreadRefresh ? (
                                <div className="pointer-events-none absolute right-4 top-16 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-background/80 text-muted-foreground shadow-sm backdrop-blur">
                                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                </div>
                            ) : null}

                            <ConversationHeaderV2
                                conversation={activeConversation}
                                latestApplicationStatus={findLatestApplicationEvent(thread.messages, null)?.status ?? null}
                                surface={mode}
                                compact={compact}
                                typingUsers={activeTypingUsers}
                                onBack={compact ? handleCloseConversation : undefined}
                                actionLoading={muteConversation.isPending || archiveConversation.isPending}
                                onViewProfile={otherParticipant?.username ? () => {
                                    router.push(`/u/${otherParticipant.username}`);
                                } : undefined}
                                onToggleMute={() => {
                                    void muteConversation.mutateAsync({
                                        conversationId: activeConversation.id,
                                        muted: !activeConversation.muted,
                                    });
                                }}
                                onToggleArchive={() => {
                                    archiveConversation.mutate({
                                        conversationId: activeConversation.id,
                                        archived: activeConversation.lifecycleState !== 'archived',
                                    }, {
                                        onSuccess: () => {
                                            handleCloseConversation();
                                        },
                                        onError: (error) => {
                                            toast.error(error instanceof Error ? error.message : 'Failed to archive conversation');
                                        },
                                    });
                                }}
                                onToggleBlock={activeConversation.type === 'dm' && otherParticipant?.id ? async () => {
                                    try {
                                        const isBlocked = activeConversation.capability.blocked;
                                        const response = await fetch(
                                            isBlocked ? `/api/v1/privacy/blocks/${otherParticipant.id}` : '/api/v1/privacy/blocks',
                                            {
                                                method: isBlocked ? 'DELETE' : 'POST',
                                                headers: isBlocked ? undefined : { 'Content-Type': 'application/json' },
                                                body: isBlocked ? undefined : JSON.stringify({ userId: otherParticipant.id }),
                                            },
                                        );
                                        const json = await response.json().catch(() => null);
                                        if (!response.ok || json?.success === false) {
                                            throw new Error(json?.error || 'Failed to update block state');
                                        }
                                        await refreshConversationCache(queryClient, activeConversation.id);
                                        toast.success(isBlocked ? 'Account unblocked' : 'Account blocked');
                                    } catch (error) {
                                        toast.error(error instanceof Error ? error.message : 'Failed to update block state');
                                    }
                                } : undefined}
                            />

                                <MessageThreadV2
                                    key={selectedConversationId!}
                                    conversationId={selectedConversationId!}
                                    messages={thread.messages}
                                    pinnedMessages={thread.pinnedMessages}
                                    typingUsers={activeTypingUsers}
                                    surface={mode}
                                    hasMore={Boolean(thread.hasNextPage)}
                                    isLoading={thread.isLoading}
                                    isFetchingMore={thread.isFetchingNextPage}
                                    viewerUnreadCount={activeConversation.unreadCount}
                                    focusMessageId={focusMessageId}
                                    contextJumpState={replyContextJumpState}
                                    scrollToLatestSignal={threadScrollToLatestSignal}
                                    onDismissContextJumpState={() => setReplyContextJumpState(null)}
                                    onLoadMore={handleThreadLoadMore}
	                                    onReply={handleReply}
	                                    onTogglePin={handleTogglePin}
	                                    onVisibleReadWatermark={handleVisibleReadWatermark}
                                    onClearFocusTarget={clearMessageFocus}
                                    onRequestMessageContext={async (messageId) => {
                                        const injected = await injectMessageContext(selectedConversationId!, messageId);
                                        if (injected) {
                                            setFocusMessageId(injected.anchorMessageId);
                                            setReplyContextJumpState(
                                                injected.hasOlderContext || injected.hasNewerContext
                                                    ? {
                                                        anchorMessageId: injected.anchorMessageId,
                                                        hasOlderContext: injected.hasOlderContext,
                                                        hasNewerContext: injected.hasNewerContext,
                                                    }
                                                    : null,
                                            );
                                            return true;
                                        }
                                        return false;
                                    }}
                                />

                                <div className="relative shrink-0">
                                    <MessageComposerV2
                                        conversationId={selectedConversationId!}
                                        targetUserId={otherParticipant?.id}
                                        capability={thread.capability}
                                        messageCount={thread.messages.length}
                                        surface={mode}
                                        replyTarget={replyTarget}
                                        sendTyping={sendTyping}
	                                        onWillSend={() => {
	                                            clearMessageFocus();
	                                            clearConversationAttention(selectedConversationId!);
	                                            handleCommitThreadRead(null, { ignorePendingWatermark: true });
	                                            setThreadScrollToLatestSignal((current) => current + 1);
	                                        }}
                                            onComposerHeightChange={setComposerBlurHeight}
	                                        onClearReply={() => setReplyTarget(null)}
                                        onAddFiles={(fn) => { composerAddFilesRef.current = fn; }}
                                        participants={conversationParticipants}
                                    />
                                </div>
                        </div>
                    ) : showPageInitialSkeleton ? (
                        <ThreadSkeletonV2 surface={mode} />
                    ) : (
                        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                                <MessageSquare className="h-8 w-8 text-primary" />
                            </div>
                            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Select a conversation</h2>
                            <p className="mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                                Open a chat, application thread, or project group to continue.
                            </p>
                            {targetUserId && !ensureConversation.isPending ? (
                                <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
                                    We couldn&apos;t open this conversation yet. Try refreshing the page.
                                </div>
                            ) : null}
                        </div>
                    )}
                </section>
            </div>

            <NewMessageModalV2
                isOpen={newMessageOpen}
                onClose={() => setNewMessageOpen(false)}
                onConversationOpened={handleSelectConversation}
            />

            <Dialog
                open={searchOpen}
                onOpenChange={(open) => {
                    setSearchOpen(open);
                    if (!open) setGlobalSearch('');
                }}
            >
                <DialogContent className="max-w-[640px] gap-0 p-0 overflow-hidden">
                    <DialogHeader className="border-b border-border/60 px-4 py-3">
                        <DialogTitle className="sr-only">Search messages</DialogTitle>
                        <div className="flex items-center gap-2 pr-6">
                            <Search className="h-4 w-4 text-muted-foreground" />
                            <input
                                autoFocus
                                type="text"
                                value={globalSearch}
                                onChange={(event) => setGlobalSearch(event.target.value)}
                                placeholder="Search messages, people, projects…"
                                className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                            />
                            <kbd className="hidden rounded border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">Esc</kbd>
                        </div>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-y-auto p-2">
                        {debouncedSearch.length === 0 ? (
                            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                                Start typing to search across your conversations.
                            </div>
                        ) : search.isLoading ? (
                            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Searching…</div>
                        ) : searchResults.length === 0 ? (
                            <div className="px-4 py-6 text-center text-sm text-muted-foreground">No matches.</div>
                        ) : (
                            searchResults.map((result) => {
                                const peer = result.conversation?.participants?.[0];
                                const title = peer?.fullName || peer?.username || 'Conversation';
                                return (
                                    <button
                                        key={`${result.conversationId}:${result.message.id}`}
                                        type="button"
                                        onClick={() => {
                                            handleSelectConversation(result.conversationId);
                                            setFocusMessageId(result.message.id);
                                            setUrlMessageId(result.message.id);
                                            setSearchOpen(false);
                                            setGlobalSearch('');
                                        }}
                                        className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="truncate text-sm font-medium text-foreground">{title}</span>
                                            </div>
                                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                                {formatMessagePreview(result.message)}
                                            </p>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
        </MessagesRenderProfiler>
    );
}
