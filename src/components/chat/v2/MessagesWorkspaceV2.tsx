'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Moon, PenSquare, Search, WifiOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useChatTypingState } from '@/hooks/useChatTypingState';
import { useDebounce } from '@/hooks/hub/useDebounce';
import { useMessagesV2Realtime } from '@/hooks/useMessagesV2Realtime';
import {
    useConversationThread,
    useEnsureDirectConversation,
    useInbox,
    useMessageSearch,
    useMessagesActions,
} from '@/hooks/useMessagesV2';
import { useMessagingShortcuts } from '@/hooks/useMessagingShortcuts';
import { useDoNotDisturb } from '@/hooks/useDoNotDisturb';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';
import { cn } from '@/lib/utils';
import { upsertThreadConversation } from '@/lib/messages/v2-cache';
import { refreshConversationCache } from '@/lib/messages/v2-refresh';
import { queryKeys } from '@/lib/query-keys';
import { ConversationHeaderV2 } from './ConversationHeaderV2';
import { ConversationListV2 } from './ConversationListV2';
import { DropZoneOverlay } from './DropZoneOverlay';
import { MessageComposerV2 } from './MessageComposerV2';
import { MessageThreadV2 } from './MessageThreadV2';
import { ApplicationsListV2 } from './ApplicationsListV2';
import { ProjectGroupsListV2 } from './ProjectGroupsListV2';
import { ConversationStatusBannerV2 } from './ConversationStatusBannerV2';
import { NewMessageModalV2 } from './NewMessageModalV2';
import { formatMessagePreview } from './message-rendering';
import { ThreadSkeletonV2 } from './MessagesSurfaceSkeletons';
import type { MessageWithSender } from '@/app/actions/messaging';

interface MessagesWorkspaceV2Props {
    mode: 'page' | 'popup';
    targetUserId?: string | null;
    initialConversationId?: string | null;
}

interface ReplyContextJumpState {
    anchorMessageId: string;
    hasOlderContext: boolean;
    hasNewerContext: boolean;
}

const INBOX_TABS = [
    { id: 'chats', label: 'Chats' },
    { id: 'applications', label: 'Applications' },
    { id: 'projects', label: 'Project Groups' },
] as const;

export function MessagesWorkspaceV2({
    mode,
    targetUserId,
    initialConversationId,
}: MessagesWorkspaceV2Props) {
    const compact = mode === 'popup';
    const router = useRouter();
    const queryClient = useQueryClient();
    const activeTab = useMessagesV2UiStore((state) => state.activeTab);
    const setActiveTab = useMessagesV2UiStore((state) => state.setActiveTab);
    const selectedConversationId = useMessagesV2UiStore((state) => state.selectedConversationId);
    const setSelectedConversationId = useMessagesV2UiStore((state) => state.setSelectedConversationId);
    const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
    const [replyTarget, setReplyTarget] = useState<MessageWithSender | null>(null);
    const [replyContextJumpState, setReplyContextJumpState] = useState<ReplyContextJumpState | null>(null);
    const [globalSearch, setGlobalSearch] = useState('');
    const debouncedSearch = useDebounce(globalSearch.trim(), 250);
    const [visibleConversationIds, setVisibleConversationIds] = useState<string[]>([]);
    const [searchOpen, setSearchOpen] = useState(false);
    const [newMessageOpen, setNewMessageOpen] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const initialSelectionAppliedRef = useRef(false);
    const composerAddFilesRef = useRef<((files: File[]) => void) | null>(null);
    const ensureConversation = useEnsureDirectConversation();
    const inbox = useInbox();
    const thread = useConversationThread(selectedConversationId);
    const { markRead, muteConversation, archiveConversation, pinMessage, injectMessageContext } = useMessagesActions();
    const search = useMessageSearch(debouncedSearch);
    const { activeTypingUsers, sendTyping, typingUsersByConversation } = useChatTypingState({
        activeConversationId: selectedConversationId,
        visibleConversationIds,
        enabled: true,
        listVisible: true,
    });
    const isOnline = useOnlineStatus();
    const { isDnd, toggleDnd } = useDoNotDisturb();
    const realtime = useMessagesV2Realtime(
        selectedConversationId,
        true,
    );

    useEffect(() => {
        if (initialSelectionAppliedRef.current) return;
        if (initialConversationId) {
            setSelectedConversationId(initialConversationId);
            initialSelectionAppliedRef.current = true;
            return;
        }
        if (targetUserId) {
            initialSelectionAppliedRef.current = true;
            ensureConversation.mutate(targetUserId, {
                onSuccess: (result) => {
                    if (!result.conversationId) {
                        toast.error('Failed to open conversation');
                        return;
                    }
                    setSelectedConversationId(result.conversationId);
                    if (result.conversation) {
                        upsertThreadConversation(queryClient, result.conversation);
                    }
                    if (mode === 'page') {
                        router.replace(`/messages?conversationId=${result.conversationId}`);
                    }
                },
                onError: (error) => {
                    toast.error(error instanceof Error ? error.message : 'Failed to open conversation');
                },
            });
            return;
        }
        initialSelectionAppliedRef.current = true;
    }, [ensureConversation, initialConversationId, mode, queryClient, router, setSelectedConversationId, targetUserId]);

    useEffect(() => {
        if (mode !== 'page' || !selectedConversationId) return;
        router.replace(`/messages?conversationId=${selectedConversationId}`);
    }, [mode, router, selectedConversationId]);

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
        if (!selectedConversationId || !thread.messages.length) return;
        const latestMessageId = thread.messages[thread.messages.length - 1]?.id;
        if (!latestMessageId || !thread.conversation?.unreadCount) return;
        void markRead.mutateAsync({
            conversationId: selectedConversationId,
            lastReadMessageId: latestMessageId,
        }).catch((error) => {
            console.warn('[messages-v2] markRead failed', error);
        });
    }, [markRead, selectedConversationId, thread.conversation?.unreadCount, thread.messages]);

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
    const showThreadSkeleton = isResolvingConversation || (Boolean(selectedConversationId) && thread.isLoading && !activeConversation);

    const handleSelectConversation = (conversationId: string) => {
        setSelectedConversationId(conversationId);
        setReplyTarget(null);
        setFocusMessageId(null);
        setReplyContextJumpState(null);
        if (mode === 'page') {
            router.replace(`/messages?conversationId=${conversationId}`);
        }
    };

    const handleCloseConversation = () => {
        setSelectedConversationId(null);
        setReplyTarget(null);
        setFocusMessageId(null);
        setReplyContextJumpState(null);
        if (mode === 'page') {
            router.replace('/messages');
        }
    };

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
    const showSearchResults = mode === 'page' && searchOpen && debouncedSearch.length > 0;

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
        <div className={cn('flex h-full min-h-0 flex-col overflow-hidden', shellClasses)}>
            {mode === 'page' ? (
                <header className="border-b border-zinc-100 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-950">
                    <div className="flex items-center gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-2xl app-accent-solid shadow-sm">
                                <MessageSquare className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Messages</h1>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                    {!isOnline
                                        ? 'You\u2019re offline'
                                        : realtime.isDegraded
                                            ? 'Realtime reconnecting\u2026'
                                            : 'Shared inbox for chats, project groups, and applications.'}
                                </p>
                            </div>
                        </div>

                        <div className="relative ml-auto flex w-full max-w-[640px] items-center gap-3">
                            <button
                                type="button"
                                onClick={() => setNewMessageOpen(true)}
                                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                            >
                                <PenSquare className="h-4 w-4" />
                                New message
                            </button>

                            <button
                                type="button"
                                onClick={() => toggleDnd()}
                                className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl border px-4 text-sm font-medium shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors ${
                                    isDnd
                                        ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900'
                                }`}
                                aria-label={isDnd ? 'Turn off Do Not Disturb' : 'Turn on Do Not Disturb'}
                            >
                                <Moon className="h-4 w-4" />
                                {isDnd ? 'DND On' : 'DND'}
                            </button>

                            <div className="relative flex-1 rounded-2xl border border-zinc-200/90 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-zinc-800 dark:bg-zinc-950">
                                <div className="relative rounded-[18px] bg-zinc-50 dark:bg-zinc-900">
                                    <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                                    <input
                                        type="text"
                                        value={globalSearch}
                                        onChange={(event) => {
                                            setGlobalSearch(event.target.value);
                                            setSearchOpen(true);
                                        }}
                                        placeholder="Search messages…"
                                        className="h-[44px] w-full rounded-[18px] border border-transparent bg-transparent pl-10 pr-10 text-sm text-zinc-700 outline-none transition-all placeholder:text-zinc-400 focus:border-primary/25 focus:bg-white focus:ring-2 focus:ring-primary/10 dark:text-zinc-200 dark:focus:bg-zinc-950"
                                    />
                                    {globalSearch ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setGlobalSearch('');
                                                setSearchOpen(false);
                                            }}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
                                            aria-label="Clear search"
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    ) : null}
                                </div>
                            </div>

                            {showSearchResults ? (
                                <div className="absolute right-0 top-full z-20 mt-2 max-h-[60vh] w-[360px] overflow-y-auto rounded-3xl border border-zinc-200 bg-white p-2 shadow-[0_18px_48px_rgba(15,23,42,0.14)] dark:border-zinc-800 dark:bg-zinc-950">
                                    {search.isLoading ? (
                                        <div className="px-4 py-3 text-sm text-zinc-500">Searching…</div>
                                    ) : searchResults.length === 0 ? (
                                        <div className="px-4 py-3 text-sm text-zinc-500">No messages found.</div>
                                    ) : searchResults.map((result) => (
                                        <button
                                            key={`${result.conversationId}:${result.message.id}`}
                                            type="button"
                                            onClick={() => {
                                                handleSelectConversation(result.conversationId);
                                                setFocusMessageId(result.message.id);
                                                setSearchOpen(false);
                                                setGlobalSearch('');
                                            }}
                                            className="w-full rounded-2xl px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                                        >
                                            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                {result.conversation?.participants?.[0]?.fullName
                                                    || result.conversation?.participants?.[0]?.username
                                                    || 'Conversation'}
                                            </div>
                                            <div className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                                                {formatMessagePreview(result.message)}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </header>
            ) : null}

            {(!isOnline || realtime.isDegraded) ? (
                <div className={cn(
                    'flex items-center gap-2 border-b border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200',
                    compact ? 'px-3 py-2 text-xs' : 'px-5 py-2.5 text-sm',
                )}>
                    <WifiOff className="h-3.5 w-3.5 shrink-0" />
                    <span>
                        {!isOnline
                            ? 'You\u2019re offline \u2014 messages will send when your connection restores.'
                            : 'Realtime connection lost \u2014 messages may be delayed.'}
                    </span>
                </div>
            ) : null}

            {showTabsRail ? (
                <div className={cn(
                    'border-b border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-950',
                    compact ? 'px-3 pb-3 pt-4' : 'px-5 py-3',
                )}>
                    <div className="inline-flex rounded-2xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900">
                        {INBOX_TABS.map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    'rounded-[14px] px-3.5 py-2 text-sm font-medium transition-colors',
                                    activeTab === tab.id
                                        ? 'app-accent-solid shadow-sm'
                                        : 'text-zinc-500 hover:bg-white hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
                                )}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>
            ) : null}

            <div className="flex min-h-0 flex-1 overflow-hidden">
                {showSidebar ? (
                    <aside className={cn(
                        'min-h-0 border-r border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-950',
                        compact ? 'w-full' : 'min-w-[300px] w-[min(360px,31vw)]',
                    )}>
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
                    </aside>
                ) : null}

                <section
                    className={cn(
                        'relative min-h-0 min-w-0 flex-1 overflow-hidden bg-white dark:bg-zinc-950',
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
                        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-zinc-950">
                            <DropZoneOverlay visible={isDragOver} />
                            <ConversationHeaderV2
                                conversation={activeConversation}
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

                            <ConversationStatusBannerV2
                                conversationId={selectedConversationId!}
                                capability={thread.capability}
                                messages={thread.messages}
                                surface={mode}
                            />

                            <MessageThreadV2
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
                                onDismissContextJumpState={() => setReplyContextJumpState(null)}
                                onLoadMore={handleThreadLoadMore}
                                onReply={handleReply}
                                onTogglePin={handleTogglePin}
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

                            <MessageComposerV2
                                conversationId={selectedConversationId!}
                                targetUserId={otherParticipant?.id}
                                capability={thread.capability}
                                messageCount={thread.messages.length}
                                surface={mode}
                                replyTarget={replyTarget}
                                sendTyping={sendTyping}
                                onClearReply={() => setReplyTarget(null)}
                                onAddFiles={(fn) => { composerAddFilesRef.current = fn; }}
                                participants={conversationParticipants}
                            />
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

            {mode === 'page' ? (
                <NewMessageModalV2
                    isOpen={newMessageOpen}
                    onClose={() => setNewMessageOpen(false)}
                    onConversationOpened={handleSelectConversation}
                />
            ) : null}
        </div>
    );
}
