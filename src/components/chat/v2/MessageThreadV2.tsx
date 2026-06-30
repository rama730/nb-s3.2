'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
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
}

const EMPTY_PINNED_MESSAGES: MessageWithSender[] = [];
const EMPTY_TYPING_USERS: TypingUser[] = [];
const OLDER_MESSAGES_PRELOAD_THRESHOLD = 6;
const LINKED_WORK_RECENT_MESSAGE_COUNT = 80;

function areStringArraysEqual(left: readonly string[], right: readonly string[]) {
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
}

function messageOrderTime(message: MessageWithSender) {
    const value = message.createdAt instanceof Date ? message.createdAt : new Date(message.createdAt);
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
}

function compareMessageOrder(left: MessageWithSender, right: MessageWithSender) {
    const timeDelta = messageOrderTime(left) - messageOrderTime(right);
    if (timeDelta !== 0) return timeDelta;
    return left.id.localeCompare(right.id);
}

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
}: MessageThreadV2Props) {
    const isPopup = surface === 'popup';
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
    const items = useMemo(() => {
        return buildMessageThreadModel({
            conversationId,
            messages,
            viewerId,
            viewerUnreadCount: 0,
        }).items;
    }, [conversationId, messages, viewerId]);

    const prevMessagesRef = useRef(messages);
    const prevConversationIdRef = useRef(conversationId);
    const prevContextJumpStateRef = useRef(contextJumpState);
    const prevItemsLengthRef = useRef(items.length);
    const [firstItemIndex, setFirstItemIndex] = useState(1_000_000);
    const [justLoadedOlderMessages, setJustLoadedOlderMessages] = useState(false);

    useLayoutEffect(() => {
        if (
            conversationId !== prevConversationIdRef.current
            || contextJumpState !== prevContextJumpStateRef.current
        ) {
            prevConversationIdRef.current = conversationId;
            prevContextJumpStateRef.current = contextJumpState;
            prevMessagesRef.current = messages;
            prevItemsLengthRef.current = items.length;
            setFirstItemIndex(1_000_000);
            setJustLoadedOlderMessages(false);
            return;
        }

        if (messages === prevMessagesRef.current) return;

        const previousMessages = prevMessagesRef.current;
        const previousFirstMessage = previousMessages[0] ?? null;
        const currentFirstMessage = messages[0] ?? null;
        const loadedOlderMessages = Boolean(
            previousFirstMessage
            && currentFirstMessage
            && previousFirstMessage.id !== currentFirstMessage.id
            && compareMessageOrder(currentFirstMessage, previousFirstMessage) < 0
        );
        const prependedCount = items.length - prevItemsLengthRef.current;

        prevMessagesRef.current = messages;
        prevItemsLengthRef.current = items.length;

        if (loadedOlderMessages && prependedCount > 0) {
            setFirstItemIndex((previous) => previous - prependedCount);
            setJustLoadedOlderMessages(true);
        }
    }, [contextJumpState, conversationId, items.length, messages]);

    const orderedMessages = messages;

    const canonicalUnreadModel = useMemo(() => buildMessageThreadModel({
        conversationId,
        messages,
        viewerId,
        viewerUnreadCount,
    }), [conversationId, messages, viewerId, viewerUnreadCount]);
    const recentLinkedWorkMessageIds = useMemo(
        () => orderedMessages.slice(-LINKED_WORK_RECENT_MESSAGE_COUNT).map((message) => message.id),
        [orderedMessages],
    );
    const [visibleLinkedWorkMessageIds, setVisibleLinkedWorkMessageIds] = useState<string[]>([]);
    const linkedWorkMessageIds = useMemo(() => {
        const result: string[] = [];
        const seen = new Set<string>();
        for (const id of [...visibleLinkedWorkMessageIds, ...recentLinkedWorkMessageIds]) {
            if (seen.has(id)) continue;
            seen.add(id);
            result.push(id);
        }
        return result;
    }, [recentLinkedWorkMessageIds, visibleLinkedWorkMessageIds]);
    const linkedWorkQuery = useMessageWorkLinks(conversationId, linkedWorkMessageIds);
    const linkedWorkByMessageId = linkedWorkQuery.data ?? {};

    useEffect(() => {
        setVisibleLinkedWorkMessageIds([]);
    }, [conversationId]);

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
    } = useMessageThreadAnchor({
        conversationId,
        bottomIndex,
        hasFocusTarget,
        firstItemIndex,
    });

    const initialLatestAnchorConversationRef = useRef<string | null>(null);

    useEffect(() => {
        if (justLoadedOlderMessages) {
            setJustLoadedOlderMessages(false);
            if (!hasFocusTarget && followBottom) {
                scrollToLatest('auto', 3);
            }
        }
    }, [justLoadedOlderMessages, followBottom, hasFocusTarget, scrollToLatest]);
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

            // Layout delay to ensure Virtuoso measurements are accurate
            setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({
                    index: absoluteIndex,
                    align: 'center',
                    behavior: 'auto',
                });
            }, 60);

            focusResetTimeoutRef.current = window.setTimeout(() => {
                setFocusedMessage((current) => (current?.id === messageId ? null : current));
                focusResetTimeoutRef.current = null;
            }, prefersReducedMotion ? 900 : 1250);
            return true;
        }

        const loadedContext = await onRequestMessageContext(messageId);
        if (!loadedContext) {
            toast.error('Original message is unavailable');
        }
        return loadedContext;
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

    useEffect(() => {
        const element = rootRef.current;
        if (!element) return;

        const handleTouchStart = (event: TouchEvent) => {
            touchYRef.current = event.touches[0]?.clientY ?? null;
        };

        const handleTouchMove = (event: TouchEvent) => {
            const nextY = event.touches[0]?.clientY ?? null;
            const previousY = touchYRef.current;
            touchYRef.current = nextY;
            if (previousY === null || nextY === null) return;
            const delta = nextY - previousY;
            if (Math.abs(delta) < 4) return;
            userInteractedAfterOpenRef.current = true;
            noteUserScrollIntent(delta > 0 ? 'up' : 'down');
        };

        const handleWheel = (event: WheelEvent) => {
            if (Math.abs(event.deltaY) < 4) return;
            userInteractedAfterOpenRef.current = true;
            noteUserScrollIntent(event.deltaY < 0 ? 'up' : 'down');
        };

        element.addEventListener('touchstart', handleTouchStart, { passive: true });
        element.addEventListener('touchmove', handleTouchMove, { passive: true });
        element.addEventListener('wheel', handleWheel, { passive: true });

        return () => {
            element.removeEventListener('touchstart', handleTouchStart);
            element.removeEventListener('touchmove', handleTouchMove);
            element.removeEventListener('wheel', handleWheel);
        };
    }, [noteUserScrollIntent]);

    return (
        <div
            ref={rootRef}
            className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
        >
            {pinnedMessages.length > 0 && (
                <div className={`border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/70 ${
                    isPopup ? 'px-3 py-2' : 'px-3 py-2'
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
                        <div className={isPopup ? 'px-3 pt-2' : 'px-3 pt-2'}>
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
	                    <div
	                        className="msg-thread-mask min-h-0 flex-1 overflow-hidden"
	                        data-surface={surface}
	                    >
                        <Virtuoso
                            ref={virtuosoRef}
                            style={{ height: '100%', overscrollBehavior: 'contain', overflowX: 'hidden' }}
                            data={items}
                            overscan={200}
                            firstItemIndex={firstItemIndex}
                            alignToBottom
                            initialTopMostItemIndex={
                                bottomIndex >= 0
                                    ? { index: 'LAST', align: 'end' }
                                    : 0
                            }
                            atBottomThreshold={120}
                            computeItemKey={(index, item) => item?.id ?? `message-thread-item-${index}`}
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
                                const visibleMessageIdsForLinks: string[] = [];
                                if (viewerId) {
                                    const visible: Array<{ id: string; senderId: string | null }> = [];
                                    let latestVisibleUnreadMessageId: string | null = null;
                                    for (let i = startDataIndex; i <= endDataIndex; i += 1) {
                                        const item = items[i];
                                        if (item?.type === 'message') {
                                            visibleMessageIdsForLinks.push(item.message.id);
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
                                if (!viewerId) {
                                    for (let i = startDataIndex; i <= endDataIndex; i += 1) {
                                        const item = items[i];
                                        if (item?.type === 'message') {
                                            visibleMessageIdsForLinks.push(item.message.id);
                                        }
                                    }
                                }
                                setVisibleLinkedWorkMessageIds((current) =>
                                    areStringArraysEqual(current, visibleMessageIdsForLinks)
                                        ? current
                                        : visibleMessageIdsForLinks,
                                );
                            }}
                            components={{
                                Header: () =>
                                    isFetchingMore ? (
                                        <OlderMessagesLoader />
                                    ) : (
                                        <div className="h-8 shrink-0" aria-hidden="true" />
                                    ),
                            }}
                            itemContent={(index, item) => {
                                if (item.type === 'date') {
                                    return <ThreadDateGroupHeader label={formatMessageCalendarLabel(item.dateKey)} />;
                                }
                                if (item.type === 'bottom-sentinel') {
                                    return <ThreadBottomSentinel typingVisible={typingUsers.length > 0} isPopup={isPopup} />;
                                }
                                if (item.type === 'unread-divider') {
                                    return <ThreadUnreadDivider count={item.count} />;
                                }
                                if (item.type !== 'message') return null;

                                const dataIndex = index - firstItemIndex;
                                const prevItem = items[dataIndex - 1];
                                const nextItem = items[dataIndex + 1];
                                const isConsecutiveFromPrev = prevItem?.type === 'message' && prevItem.message.senderId === item.message.senderId;
                                const isConsecutiveToNext = nextItem?.type === 'message' && nextItem.message.senderId === item.message.senderId;

                                const ptClass = isConsecutiveFromPrev ? 'pt-[2px]' : 'pt-2';
                                const pbClass = isConsecutiveToNext ? 'pb-[2px]' : 'pb-2';

                                const nextMessageSameSenderWithinTime = nextItem?.type === 'message'
                                    && nextItem.message.senderId === item.message.senderId
                                    && (new Date(nextItem.message.createdAt).getTime() - new Date(item.message.createdAt).getTime()) < 5 * 60 * 1000;
	                                const showTimestamp = !nextMessageSameSenderWithinTime;

	                                return (
	                                    <div
                                        ref={unreadMessageIdSet.has(item.message.id)
                                            ? (node) => registerUnreadMessageRow(item.message.id, node)
                                            : undefined}
                                        id={`msg-${item.message.id}`}
                                        className={`msg-message-row flex w-full min-w-0 items-start gap-2 rounded-md ${ptClass} ${pbClass} px-3`}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <MessageBubbleV2
                                                message={item.message}
                                                linkedWork={linkedWorkByMessageId[item.message.id] ?? []}
	                                                surface={surface}
	                                                onReply={onReply}
	                                                onTogglePin={onTogglePin}
                                                onFocusMessage={handleFocusMessage}
                                                onContentLoad={handleContentLoad}
                                                isFocusedReplyTarget={focusedMessage?.id === item.message.id}
                                                focusSource={focusedMessage?.id === item.message.id ? focusedMessage?.source : null}
                                                showTimestamp={showTimestamp}
                                                isConsecutiveFromPrev={isConsecutiveFromPrev}
                                                isConsecutiveToNext={isConsecutiveToNext}
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
                    ? `${orderedMessages[orderedMessages.length - 1]!.sender?.fullName || 'Someone'}: ${orderedMessages[orderedMessages.length - 1]!.content || 'sent a message'}`
                    : ''}
            </div>
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
            className={`pointer-events-none absolute bottom-2 left-0 right-0 z-10 flex flex-col justify-end ${isPopup ? 'px-3' : 'px-4'}`}
            aria-live="polite"
        >
            {typingUsers.length > 0 ? (
                <TypingIndicator users={typingUsers} className="mb-0 pl-0" />
            ) : null}
        </div>
    );
}

function ThreadUnreadDivider({ count }: { count: number }) {
    return (
        <div className="flex justify-center px-4 py-3 relative">
            <div className="absolute inset-x-6 top-1/2 -mt-px border-t border-primary/20" />
            <span className="relative rounded-full border border-primary/20 bg-background/90 px-3 py-1 text-xs font-semibold text-primary shadow-sm backdrop-blur-sm">
                {count} Unread Message{count === 1 ? '' : 's'}
            </span>
        </div>
    );
}

function ThreadDateGroupHeader({ label }: { label: string }) {
    return (
        <div className="msg-date-group-header flex justify-center px-4 py-1">
            <span className="msg-date-pill shadow-sm">{label}</span>
        </div>
    );
}

function ThreadBottomSentinel({
    typingVisible,
    isPopup,
}: {
    typingVisible: boolean;
    isPopup: boolean;
}) {
    const baseHeight = isPopup ? 84 : 92;
    const height = typingVisible ? baseHeight + 28 : baseHeight;
    return (
        <div
            aria-hidden="true"
            style={{ height: `${height}px` }}
        />
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
