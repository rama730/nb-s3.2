'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Loader2, MessageSquare, PenSquare, Search, WifiOff, ChevronDown, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { useChatTypingState } from '@/hooks/useChatTypingState';
import { useAuth } from '@/hooks/useAuth';
import { useMessagesV2Realtime } from '@/hooks/useMessagesV2Realtime';
import {
    useConversationThread,
    useEnsureDirectConversation,
    useInbox,
    useMessageSearch,
    useMessagesActions,
    MessageThreadQueryError,
} from '@/hooks/useMessagesV2';
import { useMessagingShortcuts } from '@/hooks/useMessagingShortcuts';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { usePresenceHealth } from '@/hooks/usePresenceHealth';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';
import { cn } from '@/lib/utils';
import {
    patchInboxConversation,
    patchThreadConversation,
    patchUnreadSummary,
    upsertThreadConversation,
} from '@/lib/messages/v2-cache';
import { refreshConversationCache } from '@/lib/messages/v2-refresh';
import { getEffectiveMessageAttentionUnreadCount } from '@/lib/messages/attention';
import {
    recordMessageSearch,
    recordMessagesDraftLifecycle,
    recordMessagesOpen,
    recordMessagesPagination,
    recordMessagesReadWatermark,
    recordMessagesThreadRecovery,
    recordMessagesThreadState,
    type MessagesOpenSource,
} from '@/lib/messages/observability';
import { isTemporaryMessageId } from '@/lib/messages/utils';
import { queryKeys } from '@/lib/query-keys';
import { ConversationHeaderV2 } from './ConversationHeaderV2';
import { ConversationListV2 } from './ConversationListV2';
import { DropZoneOverlay } from '@/components/ui/drop-zone-overlay';
import { MessageComposerV2 } from './MessageComposerV2';
import { MessageThreadV2 } from './MessageThreadV2';
import { NewMessageModalV2 } from './NewMessageModalV2';
import { findLatestApplicationEvent } from '@/lib/chat/application-events';
import { formatMessagePreview } from '@/lib/messages/preview';
import { ThreadSkeletonV2 } from './MessagesSurfaceSkeletons';
import type { MessageWithSender } from '@/app/actions/messaging';

const ApplicationsListV2 = dynamic(
    () => import('./ApplicationsListV2').then((module) => module.ApplicationsListV2),
    { loading: () => <div className="h-full animate-pulse bg-muted/20" aria-label="Loading applications" /> },
);

const ProjectGroupsListV2 = dynamic(
    () => import('./ProjectGroupsListV2').then((module) => module.ProjectGroupsListV2),
    { loading: () => <div className="h-full animate-pulse bg-muted/20" aria-label="Loading project groups" /> },
);

interface MessagesWorkspaceV2Props {
    mode: 'page' | 'popup';
    targetUserId?: string | null;
    initialConversationId?: string | null;
    initialMessageId?: string | null;
    initialReplyToMessageId?: string | null;
    initialTab?: 'chats' | 'applications' | 'projects' | null;
    initialSearchOpen?: boolean;
    initialSearchQuery?: string;
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

function getSearchHighlightTerm(query: string) {
    const textOnly = query
        .replace(/(?:^|\s)(?:from:"[^"]*"|from:\S+|has:\S+|kind:\S+|is:\S+|in:\S+)/giu, ' ')
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim();
    const [term] = textOnly.match(/"([^"]+)"|[^\s"]+/u) ?? [];
    const normalized = term?.replace(/^"|"$/g, '').trim() ?? '';
    return Array.from(normalized).length >= 2 ? normalized : null;
}

function renderHighlightedSearchText(text: string, term: string | null) {
    if (!term) return text;
    const index = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
    if (index < 0) return text;
    const end = index + term.length;
    return (
        <>
            {text.slice(0, index)}
            <mark className="rounded-sm bg-primary/15 px-0.5 text-inherit">{text.slice(index, end)}</mark>
            {text.slice(end)}
        </>
    );
}

export function MessagesWorkspaceV2({
    mode,
    targetUserId,
    initialConversationId,
    initialMessageId,
    initialReplyToMessageId,
    initialTab,
    initialSearchOpen = false,
    initialSearchQuery = '',
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
    const searchOpen = useMessagesV2UiStore((state) => state.messageSearchOpen);
    const setSearchOpen = useMessagesV2UiStore((state) => state.setMessageSearchOpen);
    const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
    const [replyTarget, setReplyTarget] = useState<MessageWithSender | null>(null);
    const [replyContextJumpState, setReplyContextJumpState] = useState<ReplyContextJumpState | null>(null);
    const [threadScrollToLatestSignal, setThreadScrollToLatestSignal] = useState(0);
    const [globalSearch, setGlobalSearch] = useState('');
    const [activeSearchIndex, setActiveSearchIndex] = useState(0);
    const normalizedGlobalSearch = globalSearch.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const [debouncedSearch, setDebouncedSearch] = useState(normalizedGlobalSearch);
    useEffect(() => {
        const delay = Array.from(normalizedGlobalSearch).length < 4 ? 400 : 250;
        const timer = setTimeout(() => setDebouncedSearch(normalizedGlobalSearch), delay);
        return () => clearTimeout(timer);
    }, [normalizedGlobalSearch]);
    const [visibleConversationIds, setVisibleConversationIds] = useState<string[]>([]);
    const [inboxView, setInboxView] = useState<'active' | 'archived'>('active');
    const [newMessageOpen, setNewMessageOpen] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isRefreshingLatestThread, setIsRefreshingLatestThread] = useState(false);
    const targetResolutionGenerationRef = useRef(0);
    const searchResultNavigationRef = useRef(false);
    const initialOpenTrackedRef = useRef(false);
    const threadOpenStartedAtRef = useRef<number | null>(null);
    const threadStateMetricKeysRef = useRef(new Set<string>());
    const threadFailureMetricKeyRef = useRef<string | null>(null);
    const crossTabChannelRef = useRef<BroadcastChannel | null>(null);
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
    const composerAddFilesRef = useRef<((files: File[]) => void) | null>(null);
    const isChatsTabActive = activeTab === 'chats';
    const hasActiveConversation = Boolean(selectedConversationId);
    const ensureConversation = useEnsureDirectConversation();
    const ensureConversationAsync = ensureConversation.mutateAsync;
    const ensureConversationPending = ensureConversation.isPending;
    const inbox = useInbox(20, isChatsTabActive, inboxView);
    const thread = useConversationThread(selectedConversationId);
    const refetchThread = thread.refetch;
    const isThreadFetching = thread.isFetching;
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

    useEffect(() => {
        if (initialOpenTrackedRef.current) return;
        initialOpenTrackedRef.current = true;
        if (mode === 'page' && initialConversationId) {
            threadOpenStartedAtRef.current = performance.now();
            recordMessagesThreadState({
                surface: mode,
                phase: 'stable_shell',
                durationMs: 0,
            });
            recordMessagesOpen({
                source: 'direct_url',
                surface: 'page',
                hasMessageTarget: Boolean(initialMessageId),
            });
        }
    }, [initialConversationId, initialMessageId, mode]);

    useEffect(() => {
        if (mode !== 'page') return;
        setSearchOpen(initialSearchOpen);
        setGlobalSearch(initialSearchOpen ? initialSearchQuery : '');
        searchResultNavigationRef.current = false;
    }, [initialSearchOpen, initialSearchQuery, mode, setSearchOpen]);

    useEffect(() => {
        if (mode !== 'page' || typeof window === 'undefined') return;
        const current = new URL(window.location.href);
        const urlSearchOpen = current.searchParams.get('search') === 'messages';
        if (searchOpen) {
            const nextQuery = debouncedSearch.slice(0, 160);
            if (!urlSearchOpen) {
                current.searchParams.set('search', 'messages');
                if (nextQuery) current.searchParams.set('q', nextQuery);
                else current.searchParams.delete('q');
                router.replace(`${current.pathname}?${current.searchParams.toString()}`);
                return;
            }
            if ((current.searchParams.get('q') ?? '') !== nextQuery) {
                if (nextQuery) current.searchParams.set('q', nextQuery);
                else current.searchParams.delete('q');
                router.replace(`${current.pathname}?${current.searchParams.toString()}`);
            }
            return;
        }
    }, [debouncedSearch, mode, router, searchOpen]);

    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') return;
        const channel = new BroadcastChannel('nb-messages-sync-v1');
        crossTabChannelRef.current = channel;
        channel.onmessage = (event: MessageEvent<unknown>) => {
            const payload = event.data;
            if (!payload || typeof payload !== 'object') return;
            const candidate = payload as {
                type?: unknown;
                conversationId?: unknown;
                unreadCount?: unknown;
                clearedCount?: unknown;
            };
            if (
                candidate.type !== 'read'
                || typeof candidate.conversationId !== 'string'
                || !Number.isInteger(candidate.unreadCount)
                || Number(candidate.unreadCount) < 0
                || !Number.isInteger(candidate.clearedCount)
                || Number(candidate.clearedCount) < 0
            ) {
                return;
            }
            const unreadCount = Number(candidate.unreadCount);
            const clearedCount = Number(candidate.clearedCount);
            patchInboxConversation(queryClient, candidate.conversationId, (conversation) => ({
                ...conversation,
                unreadCount,
            }));
            patchThreadConversation(queryClient, candidate.conversationId, (conversation) => ({
                ...conversation,
                unreadCount,
            }));
            if (clearedCount > 0) {
                patchUnreadSummary(queryClient, (count) => Math.max(0, count - clearedCount));
            }
            if (unreadCount === 0) {
                useMessagesV2UiStore.getState().clearMessageAttentionSmooth(candidate.conversationId);
            }
        };
        return () => {
            channel.close();
            if (crossTabChannelRef.current === channel) crossTabChannelRef.current = null;
        };
    }, [mode, queryClient]);

    const clearConversationAttention = useCallback((conversationId: string) => {
        clearMessageAttentionSmooth(conversationId);
    }, [clearMessageAttentionSmooth]);

    useEffect(() => {
        if (mode !== 'page') return;
        if (initialConversationId) {
            if (initialTab) setActiveTab(initialTab);
            if (useMessagesV2UiStore.getState().selectedConversationId !== initialConversationId) {
                setSelectedConversationId(initialConversationId);
            }
            setFocusMessageId(initialMessageId ?? null);
            return;
        }
        if (!targetUserId) {
            setSelectedConversationId(null);
            setFocusMessageId(null);
            if (initialTab) setActiveTab(initialTab);
        }
    }, [
        initialConversationId,
        initialMessageId,
        initialTab,
        mode,
        setActiveTab,
        setSelectedConversationId,
        targetUserId,
    ]);

    useEffect(() => {
        if (!targetUserId || initialConversationId) return;
        const generation = ++targetResolutionGenerationRef.current;
        const draftId = `draft:${targetUserId}`;
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
            },
        };
        queryClient.setQueryData(queryKeys.messages.v2.thread(draftId), {
            pages: [{
                conversation: tempConversation,
                capability: tempConversation.capability,
                messages: [],
                pinnedMessages: [],
                hasMore: false,
                nextCursor: null,
            }],
            pageParams: [undefined],
        });
        setActiveTab('chats');
        setSelectedConversationId(draftId);

        void ensureConversationAsync(targetUserId).then((result) => {
            if (targetResolutionGenerationRef.current !== generation || !result.conversationId) return;
            recordMessagesOpen({
                source: 'profile',
                surface: mode,
                hasMessageTarget: false,
            });
            setSelectedConversationId(result.conversationId);
            if (result.conversation) {
                if (result.conversationId.startsWith('draft:')) {
                    queryClient.setQueryData(queryKeys.messages.v2.thread(result.conversationId), {
                        pages: [{
                            conversation: result.conversation,
                            capability: result.conversation.capability,
                            messages: [],
                            pinnedMessages: [],
                            hasMore: false,
                            nextCursor: null,
                        }],
                        pageParams: [undefined],
                    });
                } else {
                    upsertThreadConversation(queryClient, result.conversation);
                    queryClient.removeQueries({ queryKey: queryKeys.messages.v2.thread(draftId) });
                }
            }
            if (mode === 'page' && !result.conversationId.startsWith('draft:')) {
                router.replace(`/messages?conversationId=${result.conversationId}`);
            }
        }).catch((error) => {
            if (targetResolutionGenerationRef.current !== generation) return;
            if (useMessagesV2UiStore.getState().selectedConversationId === draftId) {
                setSelectedConversationId(null);
            }
            queryClient.removeQueries({ queryKey: queryKeys.messages.v2.thread(draftId) });
            toast.error(error instanceof Error ? error.message : 'Failed to open conversation');
        });

        return () => {
            if (targetResolutionGenerationRef.current === generation) {
                targetResolutionGenerationRef.current += 1;
            }
        };
    }, [
        ensureConversationAsync,
        initialConversationId,
        mode,
        queryClient,
        router,
        setActiveTab,
        setSelectedConversationId,
        targetUserId,
    ]);

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
            || isThreadFetching
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
        void refetchThread()
            .then((refreshed) => {
                if (refreshed.isError) {
                    recordMessagesThreadRecovery({
                        surface: mode,
                        action: 'failure',
                        outcome: 'shown',
                        errorCode: 'LATEST_SYNC_FAILED',
                    });
                }
            })
            .catch(() => {
                recordMessagesThreadRecovery({
                    surface: mode,
                    action: 'failure',
                    outcome: 'shown',
                    errorCode: 'LATEST_SYNC_FAILED',
                });
            })
            .finally(() => {
                setIsRefreshingLatestThread(false);
            });
    }, [
        authoritativeLatestMessageId,
        focusMessageId,
        hasLoadedAuthoritativeLatest,
        isThreadFetching,
        mode,
        refetchThread,
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
                recordMessagesReadWatermark({
                    cause: 'visible_unread_row',
                    outcome: 'queued',
                });
                return;
            }

            if (lastReadCommitWatermarkRef.current === watermark) return;
            lastReadCommitWatermarkRef.current = watermark;

            if (pending?.conversationId === conversationId && pending.messageId === serverMessageId) {
                pendingReadWatermarkRef.current = null;
            }

            readCommitInFlightRef.current = true;
            recordMessagesReadWatermark({
                cause: 'visible_unread_row',
                outcome: 'requested',
            });
            void markRead.mutateAsync({
                conversationId,
                lastReadMessageId: serverMessageId,
            }).then((result) => {
                const nextUnreadCount = Math.max(0, Number(result.unreadCount ?? 0));
                const clearedCount = Math.max(0, rawActiveUnreadCount - nextUnreadCount);
                crossTabChannelRef.current?.postMessage({
                    type: 'read',
                    conversationId,
                    unreadCount: nextUnreadCount,
                    clearedCount,
                });
                if (nextUnreadCount === 0) {
                    clearConversationAttention(conversationId);
                }
                recordMessagesReadWatermark({
                    cause: 'visible_unread_row',
                    outcome: 'succeeded',
                });
            }).catch((error) => {
                if (lastReadCommitWatermarkRef.current === watermark) {
                    lastReadCommitWatermarkRef.current = null;
                }
                pendingReadWatermarkRef.current = { conversationId, messageId: serverMessageId };
                console.warn('[messages-v2] markRead failed', error);
                recordMessagesReadWatermark({
                    cause: 'visible_unread_row',
                    outcome: 'failed',
                });
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
        rawActiveUnreadCount,
        selectedConversationId,
        shouldResolveActiveConversationRead,
    ]);

    const handleVisibleReadWatermark = useCallback((messageId: string) => {
        if (!selectedConversationId || !shouldResolveActiveConversationRead) return;

        pendingReadWatermarkRef.current = {
            conversationId: selectedConversationId,
            messageId,
        };
        handleCommitThreadRead(messageId, { allowLatestFallback: false });
    }, [
        handleCommitThreadRead,
        selectedConversationId,
        shouldResolveActiveConversationRead,
    ]);

    const clearMessageFocus = useCallback(() => {
        setFocusMessageId(null);
        setReplyContextJumpState(null);
        if (mode === 'page' && selectedConversationId) {
            const params = new URLSearchParams({
                conversationId: selectedConversationId,
                tab: activeTab,
            });
            if (replyTarget?.id) params.set('replyToMessageId', replyTarget.id);
            router.replace(`/messages?${params.toString()}`);
        }
    }, [activeTab, mode, replyTarget?.id, router, selectedConversationId]);

    const activeConversation = thread.conversation;
    const otherParticipant = activeConversation?.participants[0];
    const showSidebar = !compact || !selectedConversationId;
    const showTabsRail = mode === 'page' || !selectedConversationId;
    const isResolvingConversation = Boolean(targetUserId && ensureConversationPending && !selectedConversationId);
    const showPageInitialSkeleton = mode === 'page'
        && !selectedConversationId
        && inbox.isLoading
        && inbox.conversations.length === 0
        && !isResolvingConversation;
    const showThreadSkeleton = isResolvingConversation
        || (Boolean(selectedConversationId) && thread.isLoading && !activeConversation)
        || (hasThreadLatestGap && !hasLoadedReadableMessage);
    const showLatestThreadRefresh = isRefreshingLatestThread && hasLoadedReadableMessage;
    const threadErrorCode = thread.error instanceof MessageThreadQueryError
        ? thread.error.code
        : 'FAILED';
    const threadErrorPresentation = !isOnline
        ? {
            title: 'You’re offline',
            description: 'Reconnect to load this conversation. Your existing drafts are still saved on this device.',
            retryable: true,
        }
        : threadErrorCode === 'FORBIDDEN'
            ? {
                title: 'Access denied',
                description: 'You no longer have permission to view this conversation.',
                retryable: false,
            }
            : threadErrorCode === 'NOT_FOUND'
                ? {
                    title: 'Conversation unavailable',
                    description: 'This conversation was deleted or the link no longer exists.',
                    retryable: false,
                }
                : threadErrorCode === 'INVALID_CONVERSATION'
                    ? {
                        title: 'Invalid conversation link',
                        description: 'This link does not contain a valid conversation identifier.',
                        retryable: false,
                    }
                    : {
                        title: 'Couldn’t load this conversation',
                        description: 'A temporary problem prevented the conversation from loading. Try again.',
                        retryable: true,
                    };

    useEffect(() => {
        if (!selectedConversationId || selectedConversationId.startsWith('draft:') || !activeConversation) return;
        const phase = thread.isFetchedAfterMount ? 'fresh' : 'cached';
        const metricKey = `${selectedConversationId}:${phase}:${thread.dataUpdatedAt}`;
        if (threadStateMetricKeysRef.current.has(metricKey)) return;
        threadStateMetricKeysRef.current.add(metricKey);
        recordMessagesThreadState({
            surface: mode,
            phase,
            durationMs: threadOpenStartedAtRef.current === null
                ? 0
                : performance.now() - threadOpenStartedAtRef.current,
        });
    }, [
        activeConversation,
        mode,
        selectedConversationId,
        thread.dataUpdatedAt,
        thread.isFetchedAfterMount,
    ]);

    useEffect(() => {
        if (!selectedConversationId || !thread.isError) {
            threadFailureMetricKeyRef.current = null;
            return;
        }
        const metricKey = `${selectedConversationId}:${threadErrorCode}`;
        if (threadFailureMetricKeyRef.current === metricKey) return;
        threadFailureMetricKeyRef.current = metricKey;
        recordMessagesThreadRecovery({
            surface: mode,
            action: 'failure',
            outcome: 'shown',
            errorCode: threadErrorCode,
        });
    }, [mode, selectedConversationId, thread.isError, threadErrorCode]);

    const openConversation = useCallback((conversationId: string, options?: {
        messageId?: string | null;
        tab?: 'chats' | 'applications' | 'projects';
        source?: MessagesOpenSource;
        historyMode?: 'push' | 'replace';
    }) => {
        const messageId = options?.messageId ?? null;
        if (conversationId === selectedConversationId && !messageId) return;
        threadOpenStartedAtRef.current = performance.now();
        recordMessagesThreadState({
            surface: mode,
            phase: 'stable_shell',
            durationMs: 0,
        });
        if (selectedConversationId?.startsWith('draft:') && selectedConversationId !== conversationId) {
            recordMessagesDraftLifecycle('abandoned');
        }
        setActiveTab(options?.tab ?? 'chats');
        setSelectedConversationId(conversationId);
        setHighlightedConversationId(null);
        if (conversationId !== selectedConversationId) {
            setReplyTarget(null);
        }
        setFocusMessageId(messageId);
        setReplyContextJumpState(null);
        recordMessagesOpen({
            source: options?.source ?? 'row',
            surface: mode,
            hasMessageTarget: Boolean(messageId),
        });
        if (mode === 'page') {
            const params = new URLSearchParams({
                conversationId,
                tab: options?.tab ?? 'chats',
            });
            if (messageId) params.set('messageId', messageId);
            const href = `/messages?${params.toString()}`;
            if (options?.historyMode === 'replace') router.replace(href);
            else router.push(href);
        }
    }, [
        mode,
        router,
        selectedConversationId,
        setActiveTab,
        setHighlightedConversationId,
        setSelectedConversationId,
    ]);

    const handleSelectConversation = useCallback((conversationId: string) => {
        openConversation(conversationId, { source: 'row' });
    }, [openConversation]);

    const handleNewConversationOpened = useCallback((conversationId: string) => {
        openConversation(conversationId, { source: 'new_message' });
    }, [openConversation]);

    const handleCloseConversation = useCallback(() => {
        if (selectedConversationId?.startsWith('draft:')) {
            recordMessagesDraftLifecycle('abandoned');
        }
        setSelectedConversationId(null);
        setReplyTarget(null);
        setFocusMessageId(null);
        setReplyContextJumpState(null);
        if (mode === 'page') {
            router.push('/messages');
        }
    }, [selectedConversationId, setSelectedConversationId, mode, router]);

    const setMessageSearchVisibility = useCallback((open: boolean) => {
        setSearchOpen(open);
        if (open) return;
        setGlobalSearch('');
        if (mode !== 'page' || searchResultNavigationRef.current || typeof window === 'undefined') return;
        const current = new URL(window.location.href);
        if (current.searchParams.get('search') !== 'messages') return;
        current.searchParams.delete('search');
        current.searchParams.delete('q');
        const suffix = current.searchParams.toString();
        router.replace(`${current.pathname}${suffix ? `?${suffix}` : ''}`);
    }, [mode, router, setSearchOpen]);

    useMessagingShortcuts({
        onEscape: () => {
            if (searchOpen) {
                setMessageSearchVisibility(false);
            } else if (compact && selectedConversationId) {
                handleCloseConversation();
            }
        },
        onNewMessage: () => setNewMessageOpen(true),
        onToggleMute: () => {
            if (activeConversation) {
                void muteConversation.mutateAsync({
                    conversationId: activeConversation.id,
                    muted: !activeConversation.muted,
                });
            }
        },
    }, true);

    const searchResults = useMemo(
        () => search.data?.pages.flatMap((page) => page.results) ?? [],
        [search.data?.pages],
    );
    const searchHighlightTerm = useMemo(
        () => getSearchHighlightTerm(normalizedGlobalSearch),
        [normalizedGlobalSearch],
    );
    const openSearchResult = useCallback((result: (typeof searchResults)[number]) => {
        searchResultNavigationRef.current = true;
        recordMessageSearch({
            queryLength: Array.from(normalizedGlobalSearch).length,
            durationMs: 0,
            resultCount: searchResults.length,
            outcome: 'selected',
            selectedPosition: Math.max(
                0,
                searchResults.findIndex((candidate) => candidate.message.id === result.message.id),
            ),
            hasMore: Boolean(search.hasNextPage),
        });
        openConversation(result.conversationId, {
            messageId: result.message.id,
            tab: result.conversationType === 'project_group' ? 'projects' : 'chats',
            source: 'search',
        });
        setSearchOpen(false);
        setGlobalSearch('');
    }, [
        normalizedGlobalSearch,
        openConversation,
        search.hasNextPage,
        searchResults,
        setSearchOpen,
    ]);

    useEffect(() => {
        setActiveSearchIndex(0);
    }, [debouncedSearch]);

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

    const handleInboxLoadMore = useCallback(() => {
        const outcome = inbox.isFetchingNextPage ? 'suppressed' : 'requested';
        recordMessagesPagination({ scope: 'inbox', outcome });
        if (!inbox.isFetchingNextPage) void inbox.fetchNextPage();
    }, [inbox]);

    const handleThreadLoadMore = useCallback(() => {
        const outcome = thread.isFetchingNextPage ? 'suppressed' : 'requested';
        recordMessagesPagination({ scope: 'thread', outcome });
        if (!thread.isFetchingNextPage) void thread.fetchNextPage();
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

    useEffect(() => {
        if (!initialReplyToMessageId || !initialConversationId) return;
        const replyMessage = thread.messages.find((message) => message.id === initialReplyToMessageId);
        if (replyMessage) setReplyTarget(replyMessage);
    }, [initialConversationId, initialReplyToMessageId, thread.messages]);

    const shellClasses = compact
        ? 'bg-white dark:bg-zinc-950'
        : 'bg-zinc-50/60 dark:bg-zinc-950';

    return (
        <div
            data-messages-surface={mode}
            className={cn('flex h-full min-h-0 flex-col overflow-hidden', shellClasses)}
        >


            {(!isOnline || realtime.isDegraded || presenceHealth.status !== 'healthy') ? (
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
                            mode === 'page' && selectedConversationId ? 'hidden md:flex' : '',
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
                                    onClick={() => setMessageSearchVisibility(true)}
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
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => useMessagesV2UiStore.getState().setPopupState('minimized')}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors animate-fade-in"
                                            aria-label="Minimize messages"
                                            title="Minimize"
                                        >
                                            <ChevronDown className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                useMessagesV2UiStore.getState().setPopupState('closed');
                                            }}
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                            aria-label="Close messages"
                                            title="Close"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </>
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
                                isFetchingNextPage={inbox.isFetchingNextPage}
                                nextPageError={inbox.isFetchNextPageError
                                    ? inbox.error instanceof Error ? inbox.error.message : 'Failed to load more'
                                    : null}
                                error={inbox.error instanceof Error ? inbox.error.message : null}
                                hasMore={Boolean(inbox.hasNextPage)}
                                typingUsersByConversation={typingUsersByConversation}
                                onSelectConversation={handleSelectConversation}
                                onLoadMore={handleInboxLoadMore}
                                onRetry={() => void inbox.refetch()}
                                onRetryNextPage={() => void inbox.fetchNextPage()}
                                archivedView={inboxView === 'archived'}
                                onToggleArchivedView={() => {
                                    setInboxView((current) => current === 'active' ? 'archived' : 'active');
                                }}
                                onVisibleConversationIdsChange={setVisibleConversationIds}
                                onMuteConversation={(conversationId) => {
                                    const conversation = inbox.conversations.find((item) => item.id === conversationId);
                                    if (!conversation) return;
                                    void muteConversation.mutateAsync({
                                        conversationId,
                                        muted: !conversation.muted,
                                    }).catch((error) => {
                                        toast.error(error instanceof Error ? error.message : 'Failed to update mute state');
                                    });
                                }}
                                onArchiveConversation={(conversationId) => {
                                    const archived = inboxView !== 'archived';
                                    archiveConversation.mutate({ conversationId, archived }, {
                                        onSuccess: () => {
                                            if (selectedConversationId === conversationId) handleCloseConversation();
                                            if (archived) {
                                                toast.success('Conversation archived', {
                                                    action: {
                                                        label: 'Undo',
                                                        onClick: () => archiveConversation.mutate({
                                                            conversationId,
                                                            archived: false,
                                                        }),
                                                    },
                                                });
                                            } else {
                                                toast.success('Conversation returned to messages');
                                            }
                                        },
                                        onError: (error) => {
                                            toast.error(error instanceof Error
                                                ? error.message
                                                : `Failed to ${archived ? 'archive' : 'unarchive'} conversation`);
                                        },
                                    });
                                }}
                            />
                        ) : activeTab === 'applications' ? (
                            <ApplicationsListV2
                                surface={mode}
                                selectedConversationId={selectedConversationId}
                                onSelectConversation={(conversationId) =>
                                    openConversation(conversationId, {
                                        tab: 'applications',
                                        source: 'application',
                                    })}
                            />
                        ) : (
                            <ProjectGroupsListV2
                                surface={mode}
                                selectedConversationId={selectedConversationId}
                                onSelectConversation={(conversationId) =>
                                    openConversation(conversationId, {
                                        tab: 'projects',
                                        source: 'project',
                                    })}
                            />
                        )}
                        </div>
                    </aside>
                ) : null}

                <section
                    className={cn(
                        'relative min-h-0 min-w-0 flex-[2] w-full max-w-4xl overflow-hidden bg-white dark:bg-zinc-950',
                        compact && !selectedConversationId ? 'hidden' : 'flex',
                        mode === 'page' && !selectedConversationId ? 'hidden md:flex' : '',
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
                        <div className="relative flex flex-col min-h-0 min-w-0 flex-1 overflow-hidden bg-white dark:bg-zinc-950">
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
                                onBack={handleCloseConversation}
                                actionLoading={muteConversation.isPending || archiveConversation.isPending}
                                onViewProfile={otherParticipant?.username ? () => {
                                    router.push(`/u/${otherParticipant.username}`);
                                } : undefined}
                                onOpenFullScreen={mode === 'popup' ? () => {
                                    const params = new URLSearchParams({
                                        conversationId: activeConversation.id,
                                        tab: activeTab,
                                    });
                                    const targetMessageId = focusMessageId ?? replyTarget?.id ?? null;
                                    if (targetMessageId) params.set('messageId', targetMessageId);
                                    if (replyTarget?.id) params.set('replyToMessageId', replyTarget.id);
                                    recordMessagesOpen({
                                        source: 'popup_handoff',
                                        surface: 'popup',
                                        hasMessageTarget: Boolean(targetMessageId),
                                    });
                                    useMessagesV2UiStore.getState().setPopupState('closed');
                                    router.push(`/messages?${params.toString()}`);
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
                                    conversationType={activeConversation?.type}
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

                                <div className="absolute inset-x-0 bottom-0 z-10 shrink-0 bg-gradient-to-t from-white via-white/80 to-transparent pb-4 pt-10 px-0 dark:from-black dark:via-black/80 dark:to-transparent pointer-events-none">
                                    <div className="pointer-events-auto px-4 md:px-0">
                                        <MessageComposerV2
                                            conversationId={selectedConversationId!}
                                            targetUserId={otherParticipant?.id}
                                            capability={thread.capability}
                                            surface={mode}
                                            replyTarget={replyTarget}
                                            sendTyping={sendTyping}
	                                        onWillSend={() => {
	                                            clearMessageFocus();
	                                            clearConversationAttention(selectedConversationId!);
	                                            setThreadScrollToLatestSignal((current) => current + 1);
	                                        }}
	                                        onClearReply={() => setReplyTarget(null)}
                                            onAddFiles={(fn) => { composerAddFilesRef.current = fn; }}
                                            participants={conversationParticipants}
                                        />
                                    </div>
                                </div>
                        </div>
                    ) : selectedConversationId && thread.isError ? (
                        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center" role="alert">
                            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
                                <WifiOff className="h-8 w-8 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                            </div>
                            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                {threadErrorPresentation.title}
                            </h2>
                            <p className="mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                                {threadErrorPresentation.description}
                            </p>
                            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                                {threadErrorPresentation.retryable ? (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            recordMessagesThreadRecovery({
                                                surface: mode,
                                                action: 'retry',
                                                outcome: 'requested',
                                                errorCode: threadErrorCode,
                                            });
                                            void thread.refetch().then((result) => {
                                                recordMessagesThreadRecovery({
                                                    surface: mode,
                                                    action: 'retry',
                                                    outcome: result.isError ? 'failed' : 'succeeded',
                                                    errorCode: result.error instanceof MessageThreadQueryError
                                                        ? result.error.code
                                                        : result.isError
                                                            ? 'FAILED'
                                                            : null,
                                                });
                                            });
                                        }}
                                        className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                                    >
                                        Retry
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={handleCloseConversation}
                                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                                >
                                    Back to messages
                                </button>
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
                            {targetUserId && !ensureConversationPending ? (
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
                onConversationOpened={handleNewConversationOpened}
            />

            <Dialog
                open={searchOpen}
                onOpenChange={(open) => {
                    setMessageSearchVisibility(open);
                }}
            >
                <DialogContent className="max-w-[640px] gap-0 p-0 overflow-hidden">
                    <DialogHeader className="border-b border-border/60 px-4 py-3">
                        <DialogTitle className="sr-only">Search messages</DialogTitle>
                        <div className="pr-6">
                            <label htmlFor="message-history-search" className="sr-only">Search message history</label>
                            <div className="flex items-center gap-2">
                                <Search className="h-4 w-4 text-muted-foreground" />
                                <input
                                    id="message-history-search"
                                    autoFocus
                                    type="search"
                                    role="combobox"
                                    aria-autocomplete="list"
                                    aria-controls="message-history-results"
                                    aria-expanded={searchResults.length > 0}
                                    aria-activedescendant={searchResults.length > 0
                                        ? `message-search-result-${activeSearchIndex}`
                                        : undefined}
                                    maxLength={256}
                                    value={globalSearch}
                                    onChange={(event) => setGlobalSearch(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (searchResults.length === 0) return;
                                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                                            event.preventDefault();
                                            const direction = event.key === 'ArrowDown' ? 1 : -1;
                                            setActiveSearchIndex((current) =>
                                                (current + direction + searchResults.length) % searchResults.length);
                                        } else if (event.key === 'Home') {
                                            event.preventDefault();
                                            setActiveSearchIndex(0);
                                        } else if (event.key === 'End') {
                                            event.preventDefault();
                                            setActiveSearchIndex(searchResults.length - 1);
                                        } else if (event.key === 'Enter') {
                                            event.preventDefault();
                                            const result = searchResults[activeSearchIndex];
                                            if (result) openSearchResult(result);
                                        }
                                    }}
                                    placeholder="Search message text or attachment filenames…"
                                    className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                                />
                                <kbd className="hidden rounded border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">Esc</kbd>
                            </div>
                            <div className="flex flex-wrap gap-1 pb-1 pl-6" aria-label="Message search filters">
                                {['from:\"name\"', 'has:image', 'has:file', 'is:pinned', 'in:project'].map((filter) => (
                                    <button
                                        key={filter}
                                        type="button"
                                        onClick={() => setGlobalSearch((current) => `${current.trim()} ${filter}`.trim())}
                                        className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                                    >
                                        {filter}
                                    </button>
                                ))}
                            </div>
                            <p className="pl-6 text-[11px] text-muted-foreground">
                                Search message history across all active conversations
                                {activeTab === 'applications'
                                    ? ' · opened from Applications'
                                    : activeTab === 'projects'
                                        ? ' · opened from Projects'
                                        : ''}.
                            </p>
                        </div>
                    </DialogHeader>
                    <div
                        id="message-history-results"
                        role={searchResults.length > 0 ? 'listbox' : 'region'}
                        aria-label="Message search results"
                        aria-busy={search.isLoading || search.isFetching}
                        className="max-h-[60vh] overflow-y-auto p-2"
                    >
                        {debouncedSearch.length === 0 ? (
                            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                                Start typing to search across your conversations.
                            </div>
                        ) : search.isLoading ? (
                            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Searching…</div>
                        ) : search.isError ? (
                            <div className="space-y-3 px-4 py-6 text-center" role="alert">
                                <p className="text-sm font-medium text-foreground">Message search is unavailable.</p>
                                <p className="text-xs text-muted-foreground">
                                    {search.error instanceof Error ? search.error.message : 'Check your connection and try again.'}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => void search.refetch()}
                                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                                >
                                    Retry
                                </button>
                            </div>
                        ) : searchResults.length === 0 ? (
                            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                                {Array.from(debouncedSearch).length === 1
                                    ? 'Enter at least two characters.'
                                    : 'No messages match this search.'}
                            </div>
                        ) : (
                            <>
                                <div className="sr-only" aria-live="polite">
                                    {searchResults.length} message {searchResults.length === 1 ? 'result' : 'results'}
                                </div>
                                {searchResults.map((result, index) => (
                                    <button
                                        key={`${result.conversationId}:${result.message.id}`}
                                        id={`message-search-result-${index}`}
                                        type="button"
                                        role="option"
                                        aria-selected={activeSearchIndex === index}
                                        onMouseMove={() => setActiveSearchIndex(index)}
                                        onClick={() => openSearchResult(result)}
                                        className={cn(
                                            'flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted',
                                            activeSearchIndex === index ? 'bg-muted' : '',
                                        )}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="truncate text-sm font-medium text-foreground">{result.displayTitle}</span>
                                                <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                                                    {result.contextLabel}
                                                </span>
                                            </div>
                                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                                {renderHighlightedSearchText(
                                                    result.matchedSnippet || formatMessagePreview(result.message),
                                                    searchHighlightTerm,
                                                )}
                                            </p>
                                            <p className="mt-1 text-[11px] text-muted-foreground">
                                                {result.message.sender?.fullName
                                                    || result.message.sender?.username
                                                    || 'Unknown sender'}
                                                {' · '}
                                                <time
                                                    dateTime={new Date(result.message.createdAt).toISOString()}
                                                    title={new Date(result.message.createdAt).toLocaleString()}
                                                >
                                                    {formatDistanceToNow(new Date(result.message.createdAt), { addSuffix: true })}
                                                </time>
                                            </p>
                                            {result.attachmentSummary.count > 0 ? (
                                                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                                                    {result.attachmentSummary.count} attachment{result.attachmentSummary.count === 1 ? '' : 's'}
                                                    {result.attachmentSummary.filename ? ` · ${result.attachmentSummary.filename}` : ''}
                                                </p>
                                            ) : null}
                                        </div>
                                    </button>
                                ))}
                                {search.hasNextPage ? (
                                    <button
                                        type="button"
                                        disabled={search.isFetchingNextPage}
                                        onClick={() => {
                                            const outcome = search.isFetchingNextPage ? 'suppressed' : 'requested';
                                            recordMessagesPagination({ scope: 'search', outcome });
                                            if (!search.isFetchingNextPage) void search.fetchNextPage();
                                        }}
                                        className="mt-1 flex w-full items-center justify-center rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
                                    >
                                        {search.isFetchingNextPage ? 'Loading more…' : 'Load more results'}
                                    </button>
                                ) : null}
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
