'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { MessageWithSender } from '@/app/actions/messaging';
import type { TypingUser } from '@/hooks/useTypingChannel';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { MessageBubbleV2 } from './MessageBubbleV2';
import { BulkActionsBar } from './BulkActionsBar';
import { ScrollToBottomFab } from './ScrollToBottomFab';
import { StickyDateHeader } from './StickyDateHeader';
import { EmptyConversation } from './EmptyConversation';

interface MessageThreadV2Props {
    conversationId: string;
    messages: MessageWithSender[];
    pinnedMessages?: MessageWithSender[];
    typingUsers?: ReadonlyArray<TypingUser>;
    surface?: 'page' | 'popup';
    hasMore: boolean;
    isLoading: boolean;
    isFetchingMore: boolean;
    viewerLastReadMessageId?: string | null;
    focusMessageId?: string | null;
    onLoadMore: () => void;
    onReply: (message: MessageWithSender) => void;
    onTogglePin: (messageId: string, pinned: boolean) => void;
    onRequestMessageContext: (messageId: string) => Promise<boolean>;
    onBulkDelete?: (messageIds: string[]) => void;
}

const EMPTY_PINNED_MESSAGES: MessageWithSender[] = [];
const EMPTY_TYPING_USERS: TypingUser[] = [];

export function MessageThreadV2({
    conversationId,
    messages,
    pinnedMessages = EMPTY_PINNED_MESSAGES,
    typingUsers = EMPTY_TYPING_USERS,
    surface = 'page',
    hasMore,
    isLoading,
    isFetchingMore,
    viewerLastReadMessageId,
    focusMessageId,
    onLoadMore,
    onReply,
    onTogglePin,
    onRequestMessageContext,
    onBulkDelete,
}: MessageThreadV2Props) {
    const isPopup = surface === 'popup';
    const [isAtBottom, setIsAtBottom] = useState(true);
    const [unreadBelow, setUnreadBelow] = useState(0);
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
    const [stickyDate, setStickyDate] = useState<string | null>(null);
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);
    const scrollerRef = useRef<HTMLElement | null>(null);
    const isAtBottomRef = useRef(true);
    const initialBottomAppliedRef = useRef<string | null>(null);
    const lastMessageIdRef = useRef<string | null>(null);
    const highlightTimeoutRef = useRef<number | null>(null);
    const removeHighlightTimeoutRef = useRef<number | null>(null);

    const scrollToTrueBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
        const scroller = scrollerRef.current;
        if (!scroller) return;
        const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const resolvedBehavior = prefersReducedMotion ? 'instant' : behavior;
        requestAnimationFrame(() => {
            scroller.scrollTo({ top: scroller.scrollHeight, behavior: resolvedBehavior });
        });
    }, []);

    const items = useMemo(() => {
        const result: Array<
            | { type: 'date'; id: string; date: Date }
            | { type: 'message'; id: string; message: MessageWithSender }
            | { type: 'unread-divider'; id: string; count: number }
        > = [];
        let dayKey: string | null = null;

        for (const message of messages) {
            const createdAt = new Date(message.createdAt);
            if (Number.isNaN(createdAt.getTime())) {
                result.push({ type: 'message', id: message.id, message });
                continue;
            }
            const nextDayKey = `${createdAt.getFullYear()}-${createdAt.getMonth()}-${createdAt.getDate()}`;
            if (dayKey !== nextDayKey) {
                dayKey = nextDayKey;
                result.push({
                    type: 'date',
                    id: `date-${nextDayKey}`,
                    date: new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate()),
                });
            }
            result.push({ type: 'message', id: message.id, message });
        }

        if (viewerLastReadMessageId) {
            const dividerIndex = result.findIndex(
                (item) => item.type === 'message' && item.id > viewerLastReadMessageId
            );
            if (dividerIndex > 0) {
                const unreadCount = result.slice(dividerIndex).filter(i => i.type === 'message').length;
                if (unreadCount > 0) {
                    result.splice(dividerIndex, 0, {
                        type: 'unread-divider' as const,
                        id: `unread-divider-${conversationId}`,
                        count: unreadCount,
                    });
                }
            }
        }

        return result;
    }, [messages, viewerLastReadMessageId, conversationId]);

    const focusMessage = useCallback(async (messageId: string) => {
        if (highlightTimeoutRef.current) {
            window.clearTimeout(highlightTimeoutRef.current);
            highlightTimeoutRef.current = null;
        }
        if (removeHighlightTimeoutRef.current) {
            window.clearTimeout(removeHighlightTimeoutRef.current);
            removeHighlightTimeoutRef.current = null;
        }

        const index = items.findIndex((item) => item.type === 'message' && item.message.id === messageId);
        if (index >= 0) {
            virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' });
            highlightTimeoutRef.current = window.setTimeout(() => {
                const node = document.getElementById(`msg-${messageId}`);
                if (!node) return;
                node.classList.add('ring-2', 'ring-blue-500/60', 'bg-blue-50/40', 'dark:bg-blue-950/20');
                removeHighlightTimeoutRef.current = window.setTimeout(() => {
                    node.classList.remove('ring-2', 'ring-blue-500/60', 'bg-blue-50/40', 'dark:bg-blue-950/20');
                    removeHighlightTimeoutRef.current = null;
                }, 1400);
                highlightTimeoutRef.current = null;
            }, 220);
            return true;
        }

        return onRequestMessageContext(messageId);
    }, [items, onRequestMessageContext]);

    useEffect(() => {
        return () => {
            if (highlightTimeoutRef.current) {
                window.clearTimeout(highlightTimeoutRef.current);
                highlightTimeoutRef.current = null;
            }
            if (removeHighlightTimeoutRef.current) {
                window.clearTimeout(removeHighlightTimeoutRef.current);
                removeHighlightTimeoutRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        initialBottomAppliedRef.current = null;
        lastMessageIdRef.current = null;
    }, [conversationId]);

    useEffect(() => {
        if (isLoading || messages.length === 0) return;
        if (initialBottomAppliedRef.current === conversationId) return;
        initialBottomAppliedRef.current = conversationId;
        scrollToTrueBottom('instant');
    }, [conversationId, isLoading, messages.length, scrollToTrueBottom]);

    useEffect(() => {
        if (isLoading || messages.length === 0) return;
        if (initialBottomAppliedRef.current !== conversationId) return;

        const lastMessageId = messages[messages.length - 1]?.id ?? null;
        const previousLastMessageId = lastMessageIdRef.current;
        lastMessageIdRef.current = lastMessageId;

        if (!previousLastMessageId || !lastMessageId || previousLastMessageId === lastMessageId) return;
        if (!isAtBottomRef.current) { setUnreadBelow(prev => prev + 1); return; }

        scrollToTrueBottom('smooth');
    }, [conversationId, isLoading, messages, scrollToTrueBottom]);

    useEffect(() => {
        if (!focusMessageId) return;
        void focusMessage(focusMessageId);
    }, [focusMessage, focusMessageId]);

    const handleFocusMessage = useCallback((messageId: string) => {
        void focusMessage(messageId);
    }, [focusMessage]);

    useEffect(() => {
        if (typingUsers.length === 0) return;
        if (!isAtBottomRef.current) return;
        scrollToTrueBottom('smooth');
    }, [typingUsers.length, scrollToTrueBottom]);

    return (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {pinnedMessages.length > 0 && (
                <div className={`border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/70 ${
                    isPopup ? 'px-3 py-2' : 'px-5 py-2.5'
                }`}>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                            Pinned
                        </span>
                        {pinnedMessages.map((message) => (
                            <button
                                key={`pin-${message.id}`}
                                type="button"
                                className="max-w-[240px] truncate rounded-md border border-zinc-200 bg-white/70 px-2 py-1 text-left text-xs hover:bg-white dark:border-zinc-700 dark:bg-zinc-800/80 dark:hover:bg-zinc-800"
                                onClick={() => void focusMessage(message.id)}
                                title={message.content || 'Pinned message'}
                            >
                                {message.content?.trim() || `[${message.type || 'message'}]`}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {!isLoading && messages.length === 0 ? (
                <EmptyConversation />
            ) : (
                <Virtuoso
                    ref={virtuosoRef}
                    scrollerRef={(ref) => { scrollerRef.current = ref as HTMLElement | null; }}
                    style={{ height: '100%', flex: 1, overscrollBehavior: 'contain' }}
                    data={items}
                    alignToBottom
                    atBottomThreshold={120}
                    increaseViewportBy={isPopup ? { top: 140, bottom: 96 } : { top: 220, bottom: 140 }}
                    computeItemKey={(_, item) => item.id}
                    followOutput={(atBottom) => (atBottom ? 'smooth' : false)}
                    atBottomStateChange={(atBottom) => {
                        isAtBottomRef.current = atBottom;
                        setIsAtBottom(atBottom);
                        if (atBottom) setUnreadBelow(0);
                    }}
                    startReached={() => {
                        if (hasMore && !isFetchingMore) {
                            onLoadMore();
                        }
                    }}
                    rangeChanged={({ startIndex }) => {
                        let dateLabel: string | null = null;
                        for (let i = startIndex; i >= 0; i--) {
                            const item = items[i];
                            if (item?.type === 'date') {
                                dateLabel = formatDateLabel(item.date);
                                break;
                            }
                        }
                        setStickyDate(dateLabel);
                    }}
                    components={{
                        Header: () =>
                            isFetchingMore ? (
                                <div className="flex justify-center py-2">
                                    <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                                </div>
                            ) : null,
                        Footer: () => (
                            <div className={isPopup ? 'px-3 pb-2 pt-1' : 'px-5 pb-2 pt-1'}>
                                {typingUsers.length > 0 ? (
                                    <TypingIndicator users={typingUsers} className="mb-0 pl-0" />
                                ) : null}
                                <div className="pb-1" />
                            </div>
                        ),
                    }}
                    itemContent={(index, item) => {
                        if (item.type === 'date') {
                            return (
                                <div className="my-4 flex items-center justify-center">
                                    <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-500 dark:bg-zinc-800">
                                        {formatDateLabel(item.date)}
                                    </span>
                                </div>
                            );
                        }

                        if (item.type === 'unread-divider') {
                            return (
                                <div className="my-3 flex items-center gap-3 px-4">
                                    <div className="h-px flex-1 bg-primary/20" />
                                    <span className="rounded-full bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
                                        {item.count} UNREAD {item.count === 1 ? 'MESSAGE' : 'MESSAGES'}
                                    </span>
                                    <div className="h-px flex-1 bg-primary/20" />
                                </div>
                            );
                        }

                        const previousItem = index > 0 ? items[index - 1] : null;
                        const showAvatar =
                            !previousItem ||
                            previousItem.type === 'date' ||
                            (previousItem.type === 'message' && previousItem.message.senderId !== item.message.senderId);

                        return (
                            <div
                                id={`msg-${item.message.id}`}
                                className={`flex items-start gap-2 rounded-md py-1 ${isPopup ? 'px-3' : 'px-5'}`}
                            >
                                {isSelectMode && (
                                    <input
                                        type="checkbox"
                                        checked={selectedMessageIds.has(item.message.id)}
                                        onChange={() => {
                                            setSelectedMessageIds((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(item.message.id)) next.delete(item.message.id);
                                                else next.add(item.message.id);
                                                return next;
                                            });
                                        }}
                                        className="mt-3 shrink-0 accent-primary"
                                        aria-label="Select message"
                                    />
                                )}
                                <div className="min-w-0 flex-1">
                                    <MessageBubbleV2
                                        message={item.message}
                                        showAvatar={showAvatar}
                                        onReply={onReply}
                                        onTogglePin={onTogglePin}
                                        onFocusMessage={handleFocusMessage}
                                    />
                                </div>
                            </div>
                        );
                    }}
                />
            )}
            <StickyDateHeader label={stickyDate || ''} visible={Boolean(stickyDate)} />
            <ScrollToBottomFab
                visible={!isAtBottom}
                unreadBelow={unreadBelow}
                onClick={() => scrollToTrueBottom('smooth')}
            />
            <div aria-live="polite" className="sr-only">
                {messages.length > 0 && messages[messages.length - 1]?.sender
                    ? `${messages[messages.length - 1].sender?.fullName || 'Someone'}: ${messages[messages.length - 1].content || 'sent a message'}`
                    : ''}
            </div>
            {isSelectMode && selectedMessageIds.size > 0 && (
                <BulkActionsBar
                    selectedCount={selectedMessageIds.size}
                    onDelete={() => {
                        onBulkDelete?.(Array.from(selectedMessageIds));
                        setSelectedMessageIds(new Set());
                        setIsSelectMode(false);
                    }}
                    onCopy={async () => {
                        const selectedMessages = messages
                            .filter((m) => selectedMessageIds.has(m.id))
                            .map((m) => `${m.sender?.fullName || 'Unknown'}: ${m.content || ''}`)
                            .join('\n');
                        await navigator.clipboard.writeText(selectedMessages);
                        toast.success('Messages copied');
                        setSelectedMessageIds(new Set());
                        setIsSelectMode(false);
                    }}
                    onCancel={() => {
                        setSelectedMessageIds(new Set());
                        setIsSelectMode(false);
                    }}
                />
            )}
        </div>
    );
}

function formatDateLabel(date: Date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });
}
