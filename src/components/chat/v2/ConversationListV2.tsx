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
import { useMessageAttentionState } from '@/hooks/useMessageAttentionState';
import type { TypingUser } from '@/hooks/useTypingChannel';
import type { InboxConversationV2 } from '@/hooks/useMessagesV2';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { OnlineIndicator } from '@/components/ui/OnlineIndicator';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';
import type { MessageAttentionState } from '@/lib/messages/attention';
import { cn } from '@/lib/utils';
import { getLastMessageDeliveryState } from '@/lib/messages/delivery-state';
import { areConversationPreviewStatesEqual } from '@/lib/messages/v2-render-state';
import { formatMessagePreview } from '@/lib/messages/preview';
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

type ConversationListRow =
    | { type: 'section'; id: 'new' | 'recent'; label: string }
    | { type: 'conversation'; conversation: InboxConversationV2; attention: MessageAttentionState | null };

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
    const highlightedConversationId = useMessagesV2UiStore((state) => state.highlightedConversationId);
    const setHighlightedConversationId = useMessagesV2UiStore((state) => state.setHighlightedConversationId);
    const isPopup = surface === 'popup';
    const [internalSearchQuery, setInternalSearchQuery] = useState('');
    const effectiveSearch = searchQuery ?? internalSearchQuery;
    const debouncedSearch = useDebouncedValue(effectiveSearch, 300);
    const visibleKeyRef = useRef('');
    const [visibleRange, setVisibleRange] = useState(() => ({
        startIndex: 0,
        endIndex: DEFAULT_VISIBLE_WINDOW - 1,
    }));

    const filteredConversations = useMemo(() => {
        // Client-side safety net: exclude conversations without a last message
        // Guards against race conditions where server filter hasn't applied yet
        let result = conversations.filter((conversation) => conversation.lastMessage != null);
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
        return result;
    }, [conversations, debouncedSearch]);
    const {
        attentionByConversation,
        attentionConversations,
        normalConversations,
    } = useMessageAttentionState(filteredConversations, user?.id ?? null);

    const listRows = useMemo<ConversationListRow[]>(() => {
        if (attentionConversations.length === 0) {
            return filteredConversations.map((conversation) => ({
                type: 'conversation' as const,
                conversation,
                attention: attentionByConversation.get(conversation.id) ?? null,
            }));
        }

        const rows: ConversationListRow[] = [
            { type: 'section', id: 'new', label: 'New messages' },
            ...attentionConversations.map((conversation) => ({
                type: 'conversation' as const,
                conversation,
                attention: attentionByConversation.get(conversation.id) ?? null,
            })),
        ];

        if (normalConversations.length > 0) {
            rows.push({ type: 'section', id: 'recent', label: 'Recent' });
            rows.push(...normalConversations.map((conversation) => ({
                type: 'conversation' as const,
                conversation,
                attention: attentionByConversation.get(conversation.id) ?? null,
            })));
        }

        return rows;
    }, [attentionByConversation, attentionConversations, filteredConversations, normalConversations]);

    useEffect(() => {
        if (!highlightedConversationId) return;
        const timer = window.setTimeout(() => {
            setHighlightedConversationId(null);
        }, 3200);
        return () => window.clearTimeout(timer);
    }, [highlightedConversationId, setHighlightedConversationId]);

    // Wave 2 — Presence & online dot. The full page can keep subscriptions
    // bounded to the virtualized visible slice, but the popup favors
    // correctness over aggressive pruning because its mount/open timing can
    // race with Virtuoso's first `rangeChanged` callback. Observing the
    // filtered popup rows directly keeps the green dot consistent with the
    // messages page.
    const visiblePeerUserIds = useMemo(() => {
        const visibleConversations = isPopup
            ? filteredConversations
            : listRows.slice(
                visibleRange.startIndex,
                visibleRange.endIndex + 1,
            )
                .flatMap((row) => row.type === 'conversation' ? [row.conversation] : []);
        const ids: string[] = [];
        for (const conversation of visibleConversations) {
            if (conversation.type !== 'dm') continue;
            const peer = conversation.participants[0];
            if (peer?.id) ids.push(peer.id);
        }
        return ids;
    }, [filteredConversations, isPopup, listRows, visibleRange.startIndex, visibleRange.endIndex]);
    const onlineMap = useOnlineUsers(visiblePeerUserIds);

    useEffect(() => {
        const visibleConversationIds = listRows
            .slice(visibleRange.startIndex, visibleRange.endIndex + 1)
            .flatMap((row) => row.type === 'conversation' ? [row.conversation.id] : []);
        const visibleKey = visibleConversationIds.join('|');
        if (visibleKeyRef.current === visibleKey) return;
        visibleKeyRef.current = visibleKey;
        onVisibleConversationIdsChange?.(visibleConversationIds);
    }, [listRows, onVisibleConversationIdsChange, visibleRange.endIndex, visibleRange.startIndex]);

    const [idbWait, setIdbWait] = useState(true);
    useEffect(() => {
        const timer = setTimeout(() => setIdbWait(false), 50);
        return () => clearTimeout(timer);
    }, []);

    if (loading && conversations.length === 0) {
        if (idbWait) return null;
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
            <div className="min-h-0 flex-1">
                <Virtuoso
                    style={{ height: '100%' }}
                    data={listRows}
                    computeItemKey={(_, row) =>
                        row.type === 'section' ? `section-${row.id}` : row.conversation.id}
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
                    itemContent={(_, row) => {
                        if (row.type === 'section') {
                            return <ConversationSectionHeader label={row.label} tone={row.id} isPopup={isPopup} />;
                        }
                        const conversation = row.conversation;
                        const peerId = conversation.type === 'dm' ? conversation.participants[0]?.id ?? null : null;
                        return (
                            <ConversationItemV2
                                conversation={conversation}
                                selected={selectedConversationId === conversation.id}
                                highlighted={highlightedConversationId === conversation.id}
                                attention={row.attention}
                                typingUsers={typingUsersByConversation?.[conversation.id] ?? EMPTY_TYPING_USERS}
                                onClick={onSelectConversation}
                                isPopup={isPopup}
                                viewerUserId={user?.id}
                                peerOnline={peerId ? onlineMap[peerId] === true : false}
                                onMute={onMuteConversation}
                                onArchive={onArchiveConversation}
                                onPrefetch={onPrefetchConversation}
                            />
                        );
                    }}
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

function ConversationSectionHeader({
    label,
    tone,
    isPopup,
}: {
    label: string;
    tone: 'new' | 'recent';
    isPopup: boolean;
}) {
    return (
        <div className={cn('px-4', isPopup ? 'pb-1 pt-2' : 'pb-1.5 pt-3')}>
            <div className={cn(
                'flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]',
                tone === 'new'
                    ? 'text-primary'
                    : 'text-muted-foreground',
            )}>
                {tone === 'new' ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]" />
                ) : null}
                <span>{label}</span>
            </div>
        </div>
    );
}

interface ConversationItemV2Props {
    conversation: InboxConversationV2;
    selected: boolean;
    highlighted?: boolean;
    attention?: MessageAttentionState | null;
    typingUsers: TypingUser[];
    onClick: (conversationId: string) => void;
    isPopup: boolean;
    viewerUserId?: string;
    peerOnline?: boolean;
    onMute?: (conversationId: string) => void;
    onArchive?: (conversationId: string) => void;
    onPrefetch?: (conversationId: string) => void;
}

export const ConversationItemV2 = React.memo(function ConversationItemV2({
    conversation,
    selected,
    highlighted = false,
    attention = null,
    typingUsers,
    onClick,
    isPopup,
    viewerUserId,
    peerOnline = false,
    onMute,
    onArchive,
    onPrefetch,
}: ConversationItemV2Props) {
    const draft = useMessagesV2UiStore((state) => state.draftsByConversation[conversation.id] || '');
    const participant = conversation.participants[0];
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
        <div className="border-b border-zinc-100 dark:border-zinc-800/50">
            <div className="relative overflow-hidden" {...handlers}>
                {/* Swipe action buttons behind */}
                <div className="absolute inset-y-0 right-0 flex items-stretch">
                    <button type="button" onClick={() => { onArchive?.(conversation.id); close(); }} className="flex w-16 items-center justify-center bg-blue-500 text-white" aria-label="Archive">
                        <Archive className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => { onMute?.(conversation.id); close(); }} className="flex w-16 items-center justify-center bg-amber-500 text-white" aria-label="Mute">
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
                                prefetchTimerRef.current = setTimeout(() => onPrefetch(conversation.id), 200);
                            }
                        }}
                        onMouseLeave={() => {
                            if (prefetchTimerRef.current) {
                                clearTimeout(prefetchTimerRef.current);
                                prefetchTimerRef.current = null;
                            }
                        }}
                        className={cn(
                            'relative w-full text-left transition-colors app-density-list-row outline-none focus:outline-none',
                            isPopup ? 'min-h-[52px] px-3 py-1.5' : 'min-h-[56px] px-4 py-2',
                            selected
                                ? 'bg-zinc-50 dark:bg-zinc-900/40 border-r-2 border-primary'
                                : highlighted
                                    ? 'bg-zinc-50/50 dark:bg-zinc-900/20'
                                    : 'hover:bg-zinc-50/30 dark:hover:bg-zinc-900/10',
                        )}
                        aria-current={selected ? 'true' : undefined}
                    >
                        <div className="flex items-center gap-3">
                            <div className="relative shrink-0">
                                <UserAvatar
                                    identity={participant}
                                    className={isPopup ? 'h-9 w-9' : 'h-10 w-10'}
                                    fallbackClassName="text-sm font-medium"
                                />
                                <OnlineIndicator online={peerOnline} size="sm" />
                            </div>

                            <div className="min-w-0 flex-1">
                                <div className="mb-1 flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-1.5">
                                        <span className={cn(
                                            "truncate text-sm",
                                            attention?.hasNewMessages && !attention.clearing
                                                ? "font-bold text-zinc-950 dark:text-white"
                                                : "font-semibold text-zinc-900 dark:text-zinc-100"
                                        )}>
                                            {participant?.fullName || participant?.username || 'Unknown'}
                                        </span>
                                        {conversation.muted ? (
                                            <BellOff className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                                        ) : null}
                                    </div>
                                    <div className="ml-2 flex shrink-0 items-center gap-1">
                                        {attention?.hasNewMessages || attention?.clearing ? (
                                            <span className={cn(
                                                'rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary transition-all duration-200',
                                                attention.clearing ? 'scale-95 opacity-0' : 'scale-100 opacity-100',
                                            )}>
                                                New
                                            </span>
                                        ) : null}
                                        {relativeLastMessageTime ? (
                                            <span className="text-[11px] text-zinc-400">
                                                {relativeLastMessageTime}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                                <div className={cn(
                                    "flex items-center gap-1 truncate text-[13px] leading-5",
                                    attention?.hasNewMessages && !attention.clearing
                                        ? "text-zinc-800 dark:text-zinc-300 font-medium"
                                        : "text-zinc-500 dark:text-zinc-400"
                                )}>
                                    {!typingUsers.length && !draft.trim() && conversation.lastMessage && conversation.lastMessage.senderId === viewerUserId && (
                                        <DeliveryIndicator deliveryState={getLastMessageDeliveryState(conversation.lastMessage) ?? 'sent'} />
                                    )}
                                    <span className="truncate">
                                        {typingUsers.length > 0
                                            ? <TypingIndicator users={typingUsers} variant="inline" />
                                            : draft.trim()
                                                ? <span className="italic"><span className="font-semibold not-italic text-red-500">Draft: </span>{draft.replace(/\n/g, ' ').slice(0, 100)}</span>
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
        prev.conversation.muted === next.conversation.muted &&
        areConversationPreviewStatesEqual(prev.conversation.lastMessage, next.conversation.lastMessage) &&
        prev.selected === next.selected &&
        prev.highlighted === next.highlighted &&
        prev.attention?.hasNewMessages === next.attention?.hasNewMessages &&
        prev.attention?.clearing === next.attention?.clearing &&
        prev.attention?.latestNewMessageId === next.attention?.latestNewMessageId &&
        prev.typingUsers === next.typingUsers &&
        prev.onClick === next.onClick &&
        prev.isPopup === next.isPopup &&
        prev.viewerUserId === next.viewerUserId &&
        prev.peerOnline === next.peerOnline &&
        prev.onMute === next.onMute &&
        prev.onArchive === next.onArchive &&
        prev.onPrefetch === next.onPrefetch
    );
}
