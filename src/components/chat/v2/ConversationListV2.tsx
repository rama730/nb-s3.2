'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { formatDistanceToNow } from 'date-fns';
import { Archive, Bell, BellOff, MessageSquare, Search } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useSwipeAction } from '@/hooks/useSwipeAction';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineUsers } from '@/hooks/useOnlineUsers';
import type { TypingUser } from '@/hooks/useTypingChannel';
import type { InboxConversationV2 } from '@/hooks/useMessagesV2';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { OnlineIndicator } from '@/components/ui/OnlineIndicator';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';
import { cn } from '@/lib/utils';
import { getLastMessageDeliveryState } from '@/lib/messages/delivery-state';
import { areConversationPreviewStatesEqual } from '@/lib/messages/v2-render-state';
import { formatMessagePreview } from './message-rendering';
import { DeliveryIndicator } from './MessageBubbleV2';
import { InboxListSkeletonV2 } from './MessagesSurfaceSkeletons';

interface ConversationListV2Props {
    surface?: 'page' | 'popup';
    conversations: InboxConversationV2[];
    selectedConversationId: string | null;
    loading: boolean;
    error?: string | null;
    hasMore: boolean;
    typingUsersByConversation?: Record<string, TypingUser[]>;
    searchQuery?: string;
    onSearchQueryChange?: (value: string) => void;
    onSelectConversation: (conversationId: string) => void;
    onLoadMore: () => void;
    onVisibleConversationIdsChange?: (conversationIds: string[]) => void;
    onMuteConversation?: (conversationId: string) => void;
    onArchiveConversation?: (conversationId: string) => void;
    archivedCount?: number;
    onOpenArchive?: () => void;
    onPrefetchConversation?: (conversationId: string) => void;
}

const EMPTY_TYPING_USERS: TypingUser[] = [];
const DEFAULT_VISIBLE_WINDOW = 12;

function safeFormatRelativeTime(value: unknown): string | null {
    if (!value) return null;
    const date = new Date(value as string | number | Date);
    if (Number.isNaN(date.getTime())) return null;
    return formatDistanceToNow(date, { addSuffix: false });
}

export function ConversationListV2({
    surface = 'page',
    conversations,
    selectedConversationId,
    loading,
    error,
    hasMore,
    typingUsersByConversation,
    searchQuery,
    onSearchQueryChange,
    onSelectConversation,
    onLoadMore,
    onVisibleConversationIdsChange,
    onMuteConversation,
    onArchiveConversation,
    archivedCount,
    onOpenArchive,
    onPrefetchConversation,
}: ConversationListV2Props) {
    const { user } = useAuth();
    const draftsByConversation = useMessagesV2UiStore((state) => state.draftsByConversation);
    const isPopup = surface === 'popup';
    const [internalSearchQuery, setInternalSearchQuery] = useState('');
    const effectiveSearch = searchQuery ?? internalSearchQuery;
    const debouncedSearch = useDebouncedValue(effectiveSearch, 300);
    const handleSearchChange = onSearchQueryChange ?? setInternalSearchQuery;
    const visibleKeyRef = useRef('');
    const [visibleRange, setVisibleRange] = useState(() => ({
        startIndex: 0,
        endIndex: DEFAULT_VISIBLE_WINDOW - 1,
    }));
    const [activeFilter, setActiveFilter] = useState<'all' | 'unread' | 'groups'>('all');

    const filteredConversations = useMemo(() => {
        let result = conversations;
        // Search filter
        const normalized = debouncedSearch.trim().toLowerCase();
        if (normalized) {
            result = result.filter((conversation) => {
                const participant = conversation.participants[0];
                return (
                    participant?.fullName?.toLowerCase().includes(normalized)
                    || participant?.username?.toLowerCase().includes(normalized)
                    || conversation.lastMessage?.content?.toLowerCase().includes(normalized)
                );
            });
        }
        // Category filter
        if (activeFilter === 'unread') {
            result = result.filter((c) => c.unreadCount > 0);
        } else if (activeFilter === 'groups') {
            result = result.filter((c) => c.type === 'project_group');
        }
        return result;
    }, [conversations, debouncedSearch, activeFilter]);

    // Wave 2 — Presence & online dot. The full page can keep subscriptions
    // bounded to the virtualized visible slice, but the popup favors
    // correctness over aggressive pruning because its mount/open timing can
    // race with Virtuoso's first `rangeChanged` callback. Observing the
    // filtered popup rows directly keeps the green dot consistent with the
    // messages page.
    const visiblePeerUserIds = useMemo(() => {
        const slice = isPopup
            ? filteredConversations
            : filteredConversations.slice(
                visibleRange.startIndex,
                visibleRange.endIndex + 1,
            );
        const ids: string[] = [];
        for (const conversation of slice) {
            if (conversation.type !== 'dm') continue;
            const peer = conversation.participants[0];
            if (peer?.id) ids.push(peer.id);
        }
        return ids;
    }, [filteredConversations, isPopup, visibleRange.startIndex, visibleRange.endIndex]);
    const onlineMap = useOnlineUsers(visiblePeerUserIds);

    useEffect(() => {
        const visibleConversationIds = filteredConversations
            .slice(visibleRange.startIndex, visibleRange.endIndex + 1)
            .map((conversation) => conversation.id);
        const visibleKey = visibleConversationIds.join('|');
        if (visibleKeyRef.current === visibleKey) return;
        visibleKeyRef.current = visibleKey;
        onVisibleConversationIdsChange?.(visibleConversationIds);
    }, [filteredConversations, onVisibleConversationIdsChange, visibleRange.endIndex, visibleRange.startIndex]);

    if (loading && conversations.length === 0) {
        return <InboxListSkeletonV2 surface={surface} />;
    }

    if (error && conversations.length === 0) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <MessageSquare className="h-8 w-8 text-zinc-400" />
                </div>
                <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-white">Unable to load conversations</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{error}</p>
                </div>
            </div>
        );
    }

    if (!loading && filteredConversations.length === 0) {
        return (
            <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-zinc-950">
                <div className={cn(
                    'border-b border-zinc-100 dark:border-zinc-800',
                    isPopup ? 'px-3 pb-3 pt-2' : 'px-4 pb-4 pt-3',
                )}>
                    <SearchFieldV2
                        value={effectiveSearch}
                        onChange={handleSearchChange}
                    />
                </div>
                <div className={cn('flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800', isPopup ? 'px-3 py-2' : 'px-4 py-2')}>
                    {(['all', 'unread', 'groups'] as const).map((filter) => (
                        <button
                            key={filter}
                            type="button"
                            onClick={() => setActiveFilter(filter)}
                            className={cn(
                                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                                activeFilter === filter
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
                            )}
                        >
                            {filter === 'all' ? 'All' : filter === 'unread' ? 'Unread' : 'Groups'}
                        </button>
                    ))}
                </div>
                <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                        <MessageSquare className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {effectiveSearch.trim() ? 'No conversations match your search' : 'No conversations yet'}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {effectiveSearch.trim() ? 'Try a different name or keyword.' : 'Open a chat to start building your inbox.'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-zinc-950">
            <div className={cn(
                'border-b border-zinc-100 dark:border-zinc-800',
                isPopup ? 'px-3 pb-3 pt-2' : 'px-4 pb-4 pt-3',
            )}>
                <SearchFieldV2
                    value={effectiveSearch}
                    onChange={handleSearchChange}
                />
            </div>

            <div className={cn('flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800', isPopup ? 'px-3 py-2' : 'px-4 py-2')}>
                {(['all', 'unread', 'groups'] as const).map((filter) => (
                    <button
                        key={filter}
                        type="button"
                        onClick={() => setActiveFilter(filter)}
                        className={cn(
                            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                            activeFilter === filter
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
                        )}
                    >
                        {filter === 'all' ? 'All' : filter === 'unread' ? 'Unread' : 'Groups'}
                    </button>
                ))}
            </div>

            <div className="min-h-0 flex-1">
                <Virtuoso
                    style={{ height: '100%' }}
                    data={filteredConversations}
                    computeItemKey={(_, conversation) => conversation.id}
                    rangeChanged={({ startIndex, endIndex }) => {
                        setVisibleRange((prev) =>
                            prev.startIndex === startIndex && prev.endIndex === endIndex
                                ? prev
                                : { startIndex, endIndex },
                        );
                    }}
                    endReached={() => {
                        if (hasMore && !loading) onLoadMore();
                    }}
                    components={{
                        Footer: () => (
                            <div>
                                {hasMore ? (
                                    <div className="px-4 py-3 text-center text-xs text-zinc-400">
                                        Loading more conversations…
                                    </div>
                                ) : null}
                                {archivedCount && archivedCount > 0 && onOpenArchive ? (
                                    <button
                                        type="button"
                                        onClick={onOpenArchive}
                                        className="flex w-full items-center gap-2 px-6 py-3 text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                                    >
                                        <Archive className="h-4 w-4" />
                                        <span>Archived ({archivedCount})</span>
                                    </button>
                                ) : null}
                                <div className="h-3" />
                            </div>
                        ),
                    }}
                    itemContent={(_, conversation) => {
                        const peerId = conversation.type === 'dm' ? conversation.participants[0]?.id ?? null : null;
                        return (
                            <ConversationItemV2
                                conversation={conversation}
                                selected={selectedConversationId === conversation.id}
                                typingUsers={typingUsersByConversation?.[conversation.id] ?? EMPTY_TYPING_USERS}
                                draft={draftsByConversation[conversation.id] || ''}
                                onClick={onSelectConversation}
                                isPopup={isPopup}
                                viewerUserId={user?.id}
                                peerOnline={peerId ? onlineMap[peerId] === true : false}
                                onMute={onMuteConversation ? () => onMuteConversation(conversation.id) : undefined}
                                onArchive={onArchiveConversation ? () => onArchiveConversation(conversation.id) : undefined}
                                onPrefetch={onPrefetchConversation ? () => onPrefetchConversation(conversation.id) : undefined}
                            />
                        );
                    }}
                />
            </div>
        </div>
    );
}

function SearchFieldV2({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div className="rounded-2xl border border-zinc-200/80 bg-white/95 p-1 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-zinc-800 dark:bg-zinc-950">
            <div className="relative rounded-[18px] bg-zinc-50 dark:bg-zinc-900">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                    type="text"
                    aria-label="Search conversations"
                    placeholder="Search conversations..."
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    className="h-[44px] w-full rounded-[18px] border border-transparent bg-transparent pl-10 pr-4 text-sm text-zinc-700 outline-none transition-all placeholder:text-zinc-400 focus:border-primary/25 focus:bg-white focus:ring-2 focus:ring-primary/10 dark:text-zinc-200 dark:focus:bg-zinc-950"
                />
            </div>
        </div>
    );
}

function capabilityText(conversation: InboxConversationV2) {
    if (conversation.capability.blocked) return 'Blocked';
    if (conversation.capability.status === 'pending_received') return 'Incoming request';
    if (conversation.capability.status === 'pending_sent') return 'Request pending';
    if (conversation.type === 'project_group') return 'Project conversation';
    return 'No messages yet';
}

interface ConversationItemV2Props {
    conversation: InboxConversationV2;
    selected: boolean;
    typingUsers: TypingUser[];
    draft: string;
    onClick: (conversationId: string) => void;
    isPopup: boolean;
    viewerUserId?: string;
    peerOnline?: boolean;
    onMute?: () => void;
    onArchive?: () => void;
    onPrefetch?: () => void;
}

export const ConversationItemV2 = React.memo(function ConversationItemV2({
    conversation,
    selected,
    typingUsers,
    draft,
    onClick,
    isPopup,
    viewerUserId,
    peerOnline = false,
    onMute,
    onArchive,
    onPrefetch,
}: ConversationItemV2Props) {
    const participant = conversation.participants[0];
    const unread = conversation.unreadCount;
    const relativeLastMessageTime = conversation.lastMessage
        ? safeFormatRelativeTime(conversation.lastMessage.createdAt)
        : null;
    const { offsetX, isRevealed, handlers, close } = useSwipeAction();
    const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (prefetchTimerRef.current) {
            clearTimeout(prefetchTimerRef.current);
            prefetchTimerRef.current = null;
        }
    }, []);

    return (
        <div className="px-2 py-1">
            <div className="relative overflow-hidden rounded-2xl" {...handlers}>
                {/* Swipe action buttons behind */}
                <div className="absolute inset-y-0 right-0 flex items-stretch">
                    <button type="button" onClick={() => { onArchive?.(); close(); }} className="flex w-16 items-center justify-center bg-blue-500 text-white" aria-label="Archive">
                        <Archive className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => { onMute?.(); close(); }} className="flex w-16 items-center justify-center bg-amber-500 text-white" aria-label="Mute">
                        {conversation.muted ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
                    </button>
                </div>
                {/* The actual row content slides left */}
                <div style={{ transform: `translateX(-${offsetX}px)`, transition: isRevealed || offsetX === 0 ? 'transform 200ms ease-out' : 'none' }} className="relative bg-white dark:bg-zinc-950">
                    <button
                        type="button"
                        onClick={() => onClick(conversation.id)}
                        data-testid={`conversation-row-${conversation.id}`}
                        onMouseEnter={() => {
                            if (onPrefetch) {
                                prefetchTimerRef.current = setTimeout(() => onPrefetch(), 200);
                            }
                        }}
                        onMouseLeave={() => {
                            if (prefetchTimerRef.current) {
                                clearTimeout(prefetchTimerRef.current);
                                prefetchTimerRef.current = null;
                            }
                        }}
                        className={cn(
                            'relative w-full rounded-2xl border text-left transition-colors app-density-list-row',
                            isPopup ? 'min-h-[74px] px-4 py-3' : 'min-h-[80px] px-4 py-3.5',
                            selected
                                ? 'border-primary/15 bg-primary/[0.08] shadow-[0_1px_3px_rgba(15,23,42,0.04)]'
                                : 'border-transparent hover:border-zinc-200/80 hover:bg-zinc-50/80 dark:hover:border-zinc-800 dark:hover:bg-zinc-900',
                        )}
                        aria-current={selected ? 'true' : undefined}
                    >
                        {selected ? (
                            <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-primary" aria-hidden="true" />
                        ) : null}
                        <div className="flex items-center gap-3">
                            <div className="relative shrink-0">
                                <div className={cn(
                                    'flex items-center justify-center overflow-hidden rounded-full app-accent-gradient',
                                    isPopup ? 'h-11 w-11' : 'h-12 w-12',
                                )}>
                                    {participant?.avatarUrl ? (
                                        <Image
                                            src={participant.avatarUrl}
                                            alt={participant.fullName || ''}
                                            width={48}
                                            height={48}
                                            unoptimized
                                            className="h-full w-full object-cover"
                                        />
                                    ) : (
                                        <span className="font-medium text-white">
                                            {(participant?.fullName || participant?.username || '?')[0].toUpperCase()}
                                        </span>
                                    )}
                                </div>
                                {unread > 0 ? (
                                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                                        {unread > 9 ? '9+' : unread}
                                    </span>
                                ) : null}
                                <OnlineIndicator online={peerOnline} size="sm" />
                            </div>

                            <div className="min-w-0 flex-1">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                        <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                            {participant?.fullName || participant?.username || 'Unknown'}
                                        </span>
                                        {conversation.muted ? (
                                            <BellOff className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                                        ) : null}
                                    </div>
                                    <div className="ml-2 flex shrink-0 items-center gap-1">
                                        {relativeLastMessageTime ? (
                                            <span className="text-[11px] text-zinc-400">
                                                {relativeLastMessageTime}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 truncate text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
                                    {!typingUsers.length && !draft.trim() && conversation.lastMessage && conversation.lastMessage.senderId === viewerUserId && (
                                        <DeliveryIndicator deliveryState={getLastMessageDeliveryState(conversation.lastMessage) ?? 'sent'} />
                                    )}
                                    <span className="truncate">
                                        {typingUsers.length > 0
                                            ? <TypingIndicator users={typingUsers} variant="inline" />
                                            : draft.trim()
                                                ? <span><span className="font-medium text-red-500">Draft: </span>{draft.replace(/\n/g, ' ').slice(0, 100)}</span>
                                                : conversation.lastMessage
                                                    ? formatMessagePreview(conversation.lastMessage)
                                                    : capabilityText(conversation)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
}, areConversationItemPropsEqual);

export function areConversationItemPropsEqual(
    prev: Readonly<ConversationItemV2Props>,
    next: Readonly<ConversationItemV2Props>,
) {
    return (
        prev.conversation.id === next.conversation.id &&
        prev.conversation.unreadCount === next.conversation.unreadCount &&
        prev.conversation.muted === next.conversation.muted &&
        areConversationPreviewStatesEqual(prev.conversation.lastMessage, next.conversation.lastMessage) &&
        prev.selected === next.selected &&
        prev.typingUsers === next.typingUsers &&
        prev.draft === next.draft &&
        prev.onClick === next.onClick &&
        prev.isPopup === next.isPopup &&
        prev.viewerUserId === next.viewerUserId &&
        prev.peerOnline === next.peerOnline &&
        prev.onMute === next.onMute &&
        prev.onArchive === next.onArchive &&
        prev.onPrefetch === next.onPrefetch
    );
}
