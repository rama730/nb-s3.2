'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GroupedVirtuoso } from 'react-virtuoso';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { MessageWithSender } from '@/app/actions/messaging';
import type { TypingUser } from '@/hooks/useTypingChannel';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { useAuth } from '@/hooks/useAuth';
import { useMarkMessagesRead } from '@/hooks/useMarkMessagesRead';
import { useDeliveryAcks } from '@/hooks/useDeliveryAcks';
import { useMessageWorkLinks } from '@/hooks/useMessageWorkLinks';
import { useMessageThreadAnchor } from '@/hooks/useMessageThreadAnchor';
import { formatMessageCalendarLabel } from '@/lib/messages/date-buckets';
import { buildMessageThreadModel } from '@/lib/messages/thread-items';
import { MessageBubbleV2 } from './MessageBubbleV2';
import { BulkActionsBar } from './BulkActionsBar';
import { ScrollToBottomFab } from './ScrollToBottomFab';
import { EmptyConversation } from './EmptyConversation';

type MessageFocusSource = 'reply' | 'pin' | 'external';

interface FocusedMessageState {
    id: string;
    source: MessageFocusSource;
}

interface MessageThreadV2Props {
    conversationId: string;
    messages: MessageWithSender[];
    pinnedMessages?: MessageWithSender[];
    typingUsers?: ReadonlyArray<TypingUser>;
    surface?: 'page' | 'popup';
    hasMore: boolean;
    isLoading: boolean;
    isFetchingMore: boolean;
    viewerUnreadCount?: number;
    focusMessageId?: string | null;
    contextJumpState?: {
        anchorMessageId: string;
        hasOlderContext: boolean;
        hasNewerContext: boolean;
    } | null;
    scrollToLatestSignal?: number;
    onLoadMore: () => void;
    onReply: (message: MessageWithSender) => void;
    onTogglePin: (messageId: string, pinned: boolean) => void;
    onRequestMessageContext: (messageId: string) => Promise<boolean>;
    onVisibleReadWatermark?: (messageId: string) => void;
    onClearFocusTarget?: () => void;
    onDismissContextJumpState?: () => void;
    onBulkDelete?: (messageIds: string[]) => void;
}

const EMPTY_PINNED_MESSAGES: MessageWithSender[] = [];
const EMPTY_TYPING_USERS: TypingUser[] = [];
const OLDER_MESSAGES_PRELOAD_THRESHOLD = 6;

export function MessageThreadV2({
    conversationId,
    messages,
    pinnedMessages = EMPTY_PINNED_MESSAGES,
    typingUsers = EMPTY_TYPING_USERS,
    surface = 'page',
    hasMore,
    isLoading,
    isFetchingMore,
    viewerUnreadCount = 0,
    focusMessageId,
    contextJumpState = null,
    scrollToLatestSignal = 0,
    onLoadMore,
    onReply,
    onTogglePin,
    onRequestMessageContext,
    onVisibleReadWatermark,
    onClearFocusTarget,
    onDismissContextJumpState,
    onBulkDelete,
}: MessageThreadV2Props) {
    const isPopup = surface === 'popup';
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
    const [focusedMessage, setFocusedMessage] = useState<FocusedMessageState | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const latestScrollToLatestSignalRef = useRef(scrollToLatestSignal);
    const lastScrollToLatestSignalRef = useRef(scrollToLatestSignal);
    const focusResetTimeoutRef = useRef<number | null>(null);
    const focusAnimationFrameRef = useRef<number | null>(null);
    const unreadVisibilityObserverRef = useRef<IntersectionObserver | null>(null);
    const unreadVisibilityNodeByMessageIdRef = useRef<Map<string, Element>>(new Map());
    const unreadMessageIdSetRef = useRef<Set<string>>(new Set());
    const messageDataIndexByIdRef = useRef<Map<string, number>>(new Map());
    const onVisibleReadWatermarkRef = useRef<typeof onVisibleReadWatermark>(onVisibleReadWatermark);
    const touchYRef = useRef<number | null>(null);
    const userInteractedAfterOpenRef = useRef(false);
    const initialAnchorSettleTimersRef = useRef<number[]>([]);
    const olderMessagesRequestInFlightRef = useRef(false);

    // Wave 1: wire delivery-ack and read-receipt buffers.
    // - ackDelivery: fires once per NEW incoming message from others → ✓✓ gray
    // - markRead: fires when messages scroll into view → ✓✓ blue
    const { user } = useAuth();
    const viewerId = user?.id ?? null;
    // Wave 2 Step 11: pass conversationId so delivery acks are also
    // broadcast via the conversation presence room for ~100 ms latency.
    const { ackDelivery } = useDeliveryAcks(viewerId, conversationId);
    const { markRead } = useMarkMessagesRead(conversationId, viewerId);
    const ackedMessageIdsRef = useRef<Set<string>>(new Set());
    const threadModel = useMemo(() => buildMessageThreadModel({
        conversationId,
        messages,
        viewerId,
        viewerUnreadCount: 0,
    }), [conversationId, messages, viewerId]);
    const canonicalUnreadModel = useMemo(() => buildMessageThreadModel({
        conversationId,
        messages,
        viewerId,
        viewerUnreadCount,
    }), [conversationId, messages, viewerId, viewerUnreadCount]);
    const orderedMessages = threadModel.messages;
    const messageIds = useMemo(() => orderedMessages.map((message) => message.id), [orderedMessages]);
    const linkedWorkQuery = useMessageWorkLinks(conversationId, messageIds);
    const linkedWorkByMessageId = linkedWorkQuery.data ?? {};

    // When the messages prop changes, ack delivery for any newly-seen messages
    // that are NOT from the viewer. This runs exactly once per message.
    useEffect(() => {
        if (!viewerId) return;
        const unseen: Array<{ id: string; senderId: string | null }> = [];
        for (const message of orderedMessages) {
            if (message.senderId === viewerId) continue;
            if (ackedMessageIdsRef.current.has(message.id)) continue;
            ackedMessageIdsRef.current.add(message.id);
            unseen.push({ id: message.id, senderId: message.senderId });
        }
        if (unseen.length > 0) {
            ackDelivery(unseen);
        }
    }, [orderedMessages, viewerId, ackDelivery]);

    // Clear the ack set when the conversation changes
    useEffect(() => {
        ackedMessageIdsRef.current.clear();
    }, [conversationId]);

    const items = threadModel.items;
    const groups = threadModel.groups;
    const groupCounts = threadModel.groupCounts;
    const groupHeaderIndexes = threadModel.groupHeaderIndexes;
    const unreadMessageIdSet = useMemo(
        () => new Set(canonicalUnreadModel.unreadMessageIds),
        [canonicalUnreadModel.unreadMessageIds],
    );

    const messageDataIndexById = useMemo(() => {
        const indexMap = new Map<string, number>();
        items.forEach((item, index) => {
            if (item.type === 'message') {
                indexMap.set(item.message.id, index);
            }
        });
        return indexMap;
    }, [items]);

    useLayoutEffect(() => {
        unreadMessageIdSetRef.current = unreadMessageIdSet;
        messageDataIndexByIdRef.current = messageDataIndexById;
        onVisibleReadWatermarkRef.current = onVisibleReadWatermark;
    }, [messageDataIndexById, onVisibleReadWatermark, unreadMessageIdSet]);

    const getUnreadVisibilityObserver = useCallback(() => {
        if (typeof IntersectionObserver === 'undefined') return null;
        if (unreadVisibilityObserverRef.current) return unreadVisibilityObserverRef.current;

        unreadVisibilityObserverRef.current = new IntersectionObserver((entries) => {
            let latestVisibleUnreadMessageId: string | null = null;
            let latestVisibleUnreadIndex = -1;

            for (const entry of entries) {
                if (!entry.isIntersecting || entry.intersectionRatio < 0.25) continue;
                const messageId = (entry.target as HTMLElement).dataset.messageId;
                if (!messageId || !unreadMessageIdSetRef.current.has(messageId)) continue;
                const messageIndex = messageDataIndexByIdRef.current.get(messageId) ?? -1;
                if (messageIndex > latestVisibleUnreadIndex) {
                    latestVisibleUnreadIndex = messageIndex;
                    latestVisibleUnreadMessageId = messageId;
                }
            }

            if (latestVisibleUnreadMessageId) {
                onVisibleReadWatermarkRef.current?.(latestVisibleUnreadMessageId);
            }
        }, {
            threshold: [0.25, 0.5],
        });

        return unreadVisibilityObserverRef.current;
    }, []);

    const registerUnreadMessageRow = useCallback((messageId: string, node: HTMLDivElement | null) => {
        const observer = getUnreadVisibilityObserver();
        const previousNode = unreadVisibilityNodeByMessageIdRef.current.get(messageId);
        if (previousNode && previousNode !== node) {
            observer?.unobserve(previousNode);
            unreadVisibilityNodeByMessageIdRef.current.delete(messageId);
        }

        if (!node) {
            return;
        }

        node.dataset.messageId = messageId;
        unreadVisibilityNodeByMessageIdRef.current.set(messageId, node);
        observer?.observe(node);
    }, [getUnreadVisibilityObserver]);

    useEffect(() => {
        const observer = unreadVisibilityObserverRef.current;
        for (const [messageId, node] of unreadVisibilityNodeByMessageIdRef.current.entries()) {
            if (unreadMessageIdSet.has(messageId)) continue;
            observer?.unobserve(node);
            unreadVisibilityNodeByMessageIdRef.current.delete(messageId);
        }
    }, [unreadMessageIdSet]);

    const hasFocusTarget = Boolean(focusMessageId || contextJumpState);
    const bottomIndex = items.length - 1;
    const {
        virtuosoRef,
        firstItemIndex,
        followBottom,
        isAtLatest,
        unreadBelow,
        noteUserScrollIntent,
        enterFocusedMode,
        handleAtBottomChange,
        handleLatestMessageChange,
        handleRange,
        scrollToLatest,
        canLoadOlderMessages,
        decrementFirstItemIndex,
    } = useMessageThreadAnchor({
        conversationId,
        bottomIndex,
        hasFocusTarget,
    });

    const groupHeaderKeyByVirtualIndex = useMemo(() => {
        const keyMap = new Map<number, string>();
        groupHeaderIndexes.forEach((headerIndex, groupIndex) => {
            const group = groups[groupIndex];
            if (!group) return;
            keyMap.set(firstItemIndex + headerIndex, `group-${group.id}`);
        });
        return keyMap;
    }, [firstItemIndex, groupHeaderIndexes, groups]);

    // When older messages are prepended, decrement firstItemIndex by the
    // rendered item delta so grouped headers and unread dividers stay anchored.
    const initialLatestAnchorConversationRef = useRef<string | null>(null);
    const previousItemsLengthRef = useRef(items.length);
    const previousFirstMessageIdRef = useRef<string | null>(orderedMessages[0]?.id ?? null);
    useEffect(() => {
        const previousLength = previousItemsLengthRef.current;
        const previousFirstId = previousFirstMessageIdRef.current;
        const nextLength = items.length;
        const nextFirstId = orderedMessages[0]?.id ?? null;
        previousItemsLengthRef.current = nextLength;
        previousFirstMessageIdRef.current = nextFirstId;

        if (previousLength === 0 || nextLength <= previousLength) return;
        // Prepend detected if first message id changed AND rendered item count grew.
        if (previousFirstId && nextFirstId && previousFirstId !== nextFirstId) {
            decrementFirstItemIndex(nextLength - previousLength);
            if (!hasFocusTarget && followBottom) {
                scrollToLatest('auto', 3);
            }
        }
    }, [decrementFirstItemIndex, followBottom, hasFocusTarget, items.length, orderedMessages, scrollToLatest]);
    const focusMessage = useCallback(async (
        messageId: string,
        source: MessageFocusSource = 'external',
    ) => {
        if (focusResetTimeoutRef.current) {
            window.clearTimeout(focusResetTimeoutRef.current);
            focusResetTimeoutRef.current = null;
        }
        if (focusAnimationFrameRef.current) {
            window.cancelAnimationFrame(focusAnimationFrameRef.current);
            focusAnimationFrameRef.current = null;
        }

        const index = messageDataIndexById.get(messageId);
        if (typeof index === 'number') {
            const absoluteIndex = firstItemIndex + index;
            const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            enterFocusedMode();
            setFocusedMessage(null);
            focusAnimationFrameRef.current = window.requestAnimationFrame(() => {
                setFocusedMessage({ id: messageId, source });
                focusAnimationFrameRef.current = null;
            });
            virtuosoRef.current?.scrollToIndex({
                index: absoluteIndex,
                align: 'center',
                behavior: prefersReducedMotion ? 'auto' : 'smooth',
            });
            focusResetTimeoutRef.current = window.setTimeout(() => {
                setFocusedMessage((current) => (current?.id === messageId ? null : current));
                focusResetTimeoutRef.current = null;
            }, prefersReducedMotion ? 900 : 2200);
            return true;
        }

        return onRequestMessageContext(messageId);
    }, [enterFocusedMode, firstItemIndex, messageDataIndexById, onRequestMessageContext, virtuosoRef]);

    useEffect(() => {
        if (!isFetchingMore || !hasMore) {
            olderMessagesRequestInFlightRef.current = false;
        }
    }, [hasMore, isFetchingMore, orderedMessages.length]);

    const requestOlderMessages = useCallback(() => {
        if (
            !hasMore
            || isFetchingMore
            || olderMessagesRequestInFlightRef.current
            || !canLoadOlderMessages()
        ) {
            return;
        }

        olderMessagesRequestInFlightRef.current = true;
        onLoadMore();
    }, [canLoadOlderMessages, hasMore, isFetchingMore, onLoadMore]);

    useEffect(() => {
        const observedUnreadNodes = unreadVisibilityNodeByMessageIdRef.current;
        return () => {
            if (focusResetTimeoutRef.current) {
                window.clearTimeout(focusResetTimeoutRef.current);
                focusResetTimeoutRef.current = null;
            }
            if (focusAnimationFrameRef.current) {
                window.cancelAnimationFrame(focusAnimationFrameRef.current);
                focusAnimationFrameRef.current = null;
            }
            unreadVisibilityObserverRef.current?.disconnect();
            unreadVisibilityObserverRef.current = null;
            observedUnreadNodes.clear();
            initialAnchorSettleTimersRef.current.forEach((timer) => window.clearTimeout(timer));
            initialAnchorSettleTimersRef.current = [];
        };
    }, []);

    useEffect(() => {
        latestScrollToLatestSignalRef.current = scrollToLatestSignal;
    }, [scrollToLatestSignal]);

    useEffect(() => {
        lastScrollToLatestSignalRef.current = latestScrollToLatestSignalRef.current;
        initialLatestAnchorConversationRef.current = null;
        userInteractedAfterOpenRef.current = false;
        initialAnchorSettleTimersRef.current.forEach((timer) => window.clearTimeout(timer));
        initialAnchorSettleTimersRef.current = [];
    }, [conversationId]);

    useEffect(() => {
        if (
            isLoading
            || hasFocusTarget
            || items.length === 0
            || initialLatestAnchorConversationRef.current === conversationId
        ) {
            return;
        }

        initialLatestAnchorConversationRef.current = conversationId;
        scrollToLatest('auto', 6);
        initialAnchorSettleTimersRef.current.forEach((timer) => window.clearTimeout(timer));
        initialAnchorSettleTimersRef.current = [120, 360, 720].map((delay) => {
            const timer = window.setTimeout(() => {
                initialAnchorSettleTimersRef.current = initialAnchorSettleTimersRef.current.filter((item) => item !== timer);
                if (userInteractedAfterOpenRef.current) return;
                scrollToLatest('auto', 2);
            }, delay);
            return timer;
        });
    }, [
        conversationId,
        hasFocusTarget,
        isLoading,
        items.length,
        scrollToLatest,
    ]);

    useEffect(() => {
        if (lastScrollToLatestSignalRef.current === scrollToLatestSignal) {
            return;
        }

        lastScrollToLatestSignalRef.current = scrollToLatestSignal;
        scrollToLatest('auto');
    }, [scrollToLatest, scrollToLatestSignal]);

    useEffect(() => {
        if (isLoading || orderedMessages.length === 0) return;
        handleLatestMessageChange({
            latestMessage: orderedMessages[orderedMessages.length - 1] ?? null,
            viewerId,
        });
    }, [handleLatestMessageChange, isLoading, orderedMessages, viewerId]);

    // Resize / layout-change re-anchor: only when user is at bottom.
    // Content-owned height changes call autoscrollToBottom; this covers parent
    // viewport changes like keyboard show/hide, density toggles, or sidebars.
    useEffect(() => {
        if (typeof ResizeObserver === 'undefined') return;
        const element = rootRef.current;
        if (!element) return;
        let resizeFrame: number | null = null;
        const observer = new ResizeObserver(() => {
            if (hasFocusTarget || !followBottom || items.length === 0) return;
            if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
            resizeFrame = window.requestAnimationFrame(() => {
                resizeFrame = null;
                scrollToLatest('auto');
            });
        });
        observer.observe(element);
        return () => {
            observer.disconnect();
            if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
        };
    }, [followBottom, hasFocusTarget, items.length, scrollToLatest]);

    useEffect(() => {
        if (!focusMessageId) return;
        void focusMessage(focusMessageId);
    }, [focusMessage, focusMessageId]);

    const handleFocusMessage = useCallback((messageId: string, source: MessageFocusSource = 'reply') => {
        void focusMessage(messageId, source);
    }, [focusMessage]);

    const handleContentLoad = useCallback(() => {
        if (hasFocusTarget || !followBottom) return;
        virtuosoRef.current?.autoscrollToBottom();
    }, [followBottom, hasFocusTarget, virtuosoRef]);

    return (
        <div
            ref={rootRef}
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
            onTouchStartCapture={(event) => {
                touchYRef.current = event.touches[0]?.clientY ?? null;
            }}
            onTouchMoveCapture={(event) => {
                const nextY = event.touches[0]?.clientY ?? null;
                const previousY = touchYRef.current;
                touchYRef.current = nextY;
                if (previousY === null || nextY === null) return;
                const delta = nextY - previousY;
                if (Math.abs(delta) < 4) return;
                userInteractedAfterOpenRef.current = true;
                noteUserScrollIntent(delta > 0 ? 'up' : 'down');
            }}
            onWheelCapture={(event) => {
                if (Math.abs(event.deltaY) < 4) return;
                userInteractedAfterOpenRef.current = true;
                noteUserScrollIntent(event.deltaY < 0 ? 'up' : 'down');
            }}
        >
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
                                onClick={() => void focusMessage(message.id, 'pin')}
                                title={message.content || 'Pinned message'}
                            >
                                {message.content?.trim() || `[${message.type || 'message'}]`}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {!isLoading && orderedMessages.length === 0 ? (
                <EmptyConversation />
            ) : (
                <>
                    {contextJumpState ? (
                        <div className={isPopup ? 'px-3 pt-2' : 'px-5 pt-3'}>
                            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/15 bg-primary/5 px-3 py-2 text-xs text-primary">
                                <span className="font-semibold uppercase tracking-wide">Viewing original message</span>
                                <span className="text-primary/80">
                                    {contextJumpState.hasOlderContext && contextJumpState.hasNewerContext
                                        ? 'Loaded surrounding conversation context.'
                                        : contextJumpState.hasOlderContext
                                            ? 'Loaded earlier messages around this reply.'
                                            : 'Loaded newer messages around this reply.'}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        onClearFocusTarget?.();
                                        onDismissContextJumpState?.();
                                        scrollToLatest('smooth');
                                    }}
                                    className="rounded-full border border-primary/20 px-2 py-0.5 font-semibold hover:bg-primary/10"
                                >
                                    Back to latest
                                </button>
                                {onDismissContextJumpState ? (
                                    <button
                                        type="button"
                                        onClick={onDismissContextJumpState}
                                        className="rounded-full px-2 py-0.5 text-primary/70 hover:bg-primary/10 hover:text-primary"
                                    >
                                        Dismiss
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                    <div className="min-h-0 flex-1 overflow-hidden">
                        <GroupedVirtuoso
                            ref={virtuosoRef}
                            style={{ height: '100%', overscrollBehavior: 'contain', overflowX: 'hidden' }}
                            data={items}
                            groupCounts={groupCounts}
                            firstItemIndex={firstItemIndex}
                            alignToBottom
                            initialTopMostItemIndex={
                                bottomIndex >= 0
                                    ? { index: 'LAST', align: 'end' }
                                    : 0
                            }
                            atBottomThreshold={120}
                            increaseViewportBy={isPopup ? { top: 80, bottom: 80 } : { top: 80, bottom: 80 }}
                            computeItemKey={(index, item) => groupHeaderKeyByVirtualIndex.get(index) ?? item?.id ?? `message-thread-item-${index}`}
                            atBottomStateChange={handleAtBottomChange}
                            startReached={() => {
                                requestOlderMessages();
                            }}
                            rangeChanged={({ startIndex, endIndex }) => {
                                handleRange(endIndex);
                                const startDataIndex = Math.max(0, startIndex - firstItemIndex);
                                const endDataIndex = Math.min(items.length - 1, endIndex - firstItemIndex);
                                if (startDataIndex <= OLDER_MESSAGES_PRELOAD_THRESHOLD) {
                                    requestOlderMessages();
                                }

                                // Wave 1: mark visible messages (from other senders) as read.
                                // The hook dedups + batches, so pushing on every range
                                // change is safe and cheap.
                                if (viewerId) {
                                    const visible: Array<{ id: string; senderId: string | null }> = [];
                                    let latestVisibleUnreadMessageId: string | null = null;
                                    for (let i = startDataIndex; i <= endDataIndex; i += 1) {
                                        const item = items[i];
                                        if (item?.type === 'message') {
                                            visible.push({ id: item.message.id, senderId: item.message.senderId });
                                            if (unreadMessageIdSet.has(item.message.id)) {
                                                latestVisibleUnreadMessageId = item.message.id;
                                            }
                                        }
                                    }
                                    if (visible.length > 0) {
                                        markRead(visible);
                                    }
                                    if (latestVisibleUnreadMessageId) {
                                        onVisibleReadWatermark?.(latestVisibleUnreadMessageId);
                                    }
                                }
                            }}
                            components={{
                                Header: () =>
                                    isFetchingMore ? (
                                        <OlderMessagesLoader />
                                    ) : null,
                                Footer: () => (
                                    <div
                                        aria-hidden="true"
                                        className={typingUsers.length > 0 ? 'h-14' : 'h-5'}
                                    />
                                ),
                            }}
                            groupContent={(groupIndex) => {
                                const group = groups[groupIndex];
                                if (!group) return null;
                                return <ThreadDateGroupHeader label={formatMessageCalendarLabel(group.dateKey)} />;
                            }}
                            itemContent={(_, __, item) => {
                                if (item.type !== 'message') return null;
                                return (
                                    <div
                                        ref={unreadMessageIdSet.has(item.message.id)
                                            ? (node) => registerUnreadMessageRow(item.message.id, node)
                                            : undefined}
                                        id={`msg-${item.message.id}`}
                                        className={`msg-message-row flex w-full max-w-full min-w-0 items-start gap-2 rounded-md py-1 ${isPopup ? 'px-3' : 'px-5'}`}
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
                                                linkedWork={linkedWorkByMessageId[item.message.id] ?? []}
                                                showAvatar={item.showAvatar}
                                                surface={surface}
                                                onReply={onReply}
                                                onTogglePin={onTogglePin}
                                                onFocusMessage={handleFocusMessage}
                                                onContentLoad={handleContentLoad}
                                                isFocusedReplyTarget={focusedMessage?.id === item.message.id}
                                                focusSource={focusedMessage?.id === item.message.id ? focusedMessage.source : null}
                                            />
                                        </div>
                                    </div>
                                );
                            }}
                        />
                    </div>
                    <ThreadBottomDock typingUsers={typingUsers} isPopup={isPopup} />
                </>
            )}
            <ScrollToBottomFab
                visible={!isAtLatest || unreadBelow > 0}
                showNewMessages={unreadBelow > 0}
                onClick={() => {
                    onClearFocusTarget?.();
                    scrollToLatest('smooth');
                }}
            />
            <div aria-live="polite" className="sr-only">
                {orderedMessages.length > 0 && orderedMessages[orderedMessages.length - 1]?.sender
                    ? `${orderedMessages[orderedMessages.length - 1].sender?.fullName || 'Someone'}: ${orderedMessages[orderedMessages.length - 1].content || 'sent a message'}`
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
                        const selectedMessages = orderedMessages
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

function ThreadBottomDock({
    typingUsers,
    isPopup,
}: {
    typingUsers: ReadonlyArray<TypingUser>;
    isPopup: boolean;
}) {
    return (
        <div
            className={`pointer-events-none absolute bottom-0 left-0 right-0 z-10 h-14 ${isPopup ? 'px-3 pb-1 pt-1' : 'px-5 pb-1 pt-1'}`}
            aria-live="polite"
        >
            {typingUsers.length > 0 ? (
                <TypingIndicator users={typingUsers} className="mb-0 pl-0" />
            ) : null}
        </div>
    );
}

function ThreadDateGroupHeader({ label }: { label: string }) {
    return (
        <div className="msg-date-group-header flex justify-center px-4 py-2">
            <span className="msg-date-pill shadow-sm">{label}</span>
        </div>
    );
}

function OlderMessagesLoader() {
    return (
        <div className="flex justify-center px-4 pb-3 pt-12" role="status" aria-live="polite">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-md">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Loading earlier messages...</span>
            </div>
        </div>
    );
}
