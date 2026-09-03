'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { MessageWithSender } from '@/app/actions/messaging';
import type { TypingUser } from '@/hooks/useTypingChannel';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { useAuth } from '@/hooks/useAuth';
import { useMessageReceiptBuffer } from '@/hooks/useMessageReceiptBuffer';
import { recordDeliveryReceipts } from '@/app/actions/messaging';
import { useMessageWorkLinks } from '@/hooks/useMessageWorkLinks';
import { formatMessageCalendarLabel } from '@/lib/messages/date-buckets';
import { buildMessageThreadModel, type MessageThreadItem } from '@/lib/messages/thread-items';
import { MessageBubbleV2 } from './MessageBubbleV2';
import { ScrollToBottomFab } from './ScrollToBottomFab';
import { EmptyConversation } from './EmptyConversation';
import { Marker } from '@/components/ui/message';
import { cn } from '@/lib/utils';
import { buildIdentityPresentation } from '@/lib/ui/identity';
import type { MessageLinkedWorkSummary } from '@/lib/messages/linked-work';
import { useToggleReaction, useMessagesActions } from '@/hooks/useMessagesV2';
import type { WorkflowResolutionAction } from '@/lib/messages/structured';
import dynamic from 'next/dynamic';

const ReportMessageDialog = dynamic(() => import('./ReportMessageDialog').then(m => m.ReportMessageDialog), { ssr: false });

type ThreadItem = MessageThreadItem | { type: 'typing-indicator'; id: string; typingUsers: ReadonlyArray<TypingUser> };

interface FocusedMessageState {
    id: string;
}

interface MessageThreadV2Props {
    conversationId: string;
    messages: MessageWithSender[];
    pinnedMessages?: MessageWithSender[];
    typingUsers?: ReadonlyArray<TypingUser>;
    surface?: 'page' | 'popup';
    conversationType?: 'dm' | 'group' | 'project_group';
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
const EMPTY_LINKED_WORK: MessageLinkedWorkSummary[] = [];
const OLDER_MESSAGES_PRELOAD_THRESHOLD = 6;

export function MessageThreadV2({
    conversationId,
    messages,
    pinnedMessages = EMPTY_PINNED_MESSAGES,
    typingUsers = EMPTY_TYPING_USERS,
    surface = 'page',
    conversationType,
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
    const [hasFocusTopInset, setHasFocusTopInset] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const focusResetTimeoutRef = useRef<number | null>(null);
    const focusAnimationFrameRef = useRef<number | null>(null);
    const isFocusNavigationRef = useRef(false);
    const pendingFocusMessageIdRef = useRef<string | null>(null);
    const appliedExternalFocusIdRef = useRef<string | null>(null);
    const unreadVisibilityObserverRef = useRef<IntersectionObserver | null>(null);
    const unreadVisibilityNodeByMessageIdRef = useRef<Map<string, Element>>(new Map());
    const unreadMessageIdSetRef = useRef<Set<string>>(new Set());
    const messageDataIndexByIdRef = useRef<Map<string, number>>(new Map());
    const onVisibleReadWatermarkRef = useRef<typeof onVisibleReadWatermark>(onVisibleReadWatermark);
    const olderMessagesRequestInFlightRef = useRef(false);
    const mountedRef = useRef(false);
    const canFetchOlderRef = useRef(false);

    useEffect(() => {
        mountedRef.current = true;
        const timer = setTimeout(() => { canFetchOlderRef.current = true; }, 500);
        return () => { mountedRef.current = false; clearTimeout(timer); };
    }, []);

    // Delivery acknowledgements fire once per incoming unread message. Read
    // state is owned by the visible-message watermark below.
    const { user } = useAuth();
    const viewerId = user?.id ?? null;

    const [dialogTarget, setDialogTarget] = useState<{
        type: 'report';
        message: MessageWithSender;
    } | null>(null);

    const handleTriggerDialog = useCallback((message: MessageWithSender, type: 'report') => {
        setDialogTarget({ type, message });
    }, []);

    const {
        mutateAsync: toggleReactionMutation,
        isPending: isReactionLoading,
    } = useToggleReaction(conversationId);

    const handleToggleReaction = useCallback(async (messageId: string, emoji: string) => {
        return toggleReactionMutation({ messageId, emoji });
    }, [toggleReactionMutation]);

    const { resolveWorkflow } = useMessagesActions();
    const isWorkflowActionLoading = resolveWorkflow.isPending;

    const handleResolveWorkflow = useCallback(async (workflowItemId: string, action: WorkflowResolutionAction) => {
        return resolveWorkflow.mutateAsync({ workflowItemId, action });
    }, [resolveWorkflow]);
    const { enqueueReceipts: ackDelivery } = useMessageReceiptBuffer({
        viewerId,
        conversationId,
        flushIntervalMs: 120,
        recordReceipts: recordDeliveryReceipts,
    });
    const ackedMessageIdsRef = useRef<Set<string>>(new Set());
    const items = useMemo<ThreadItem[]>(() => {
        const base = buildMessageThreadModel({
            conversationId,
            messages,
            viewerId,
            viewerUnreadCount: 0,
        }).items;

        const result: ThreadItem[] = [...base];
        if (typingUsers.length > 0) {
            const enrichedTypingUsers = typingUsers.map((user) => {
                if (user.fullName || user.username) return user;
                const knownSender = messages.find((m) => m.senderId === user.id)?.sender;
                if (!knownSender) return user;
                return {
                    ...user,
                    fullName: knownSender.fullName ?? user.fullName,
                    username: knownSender.username ?? user.username,
                    avatarUrl: knownSender.avatarUrl ?? user.avatarUrl,
                };
            });
            result.push({ type: 'typing-indicator', id: 'typing-indicator', typingUsers: enrichedTypingUsers });
        }
        return result;
    }, [conversationId, messages, viewerId, typingUsers]);

    const latestMessageItemId = useMemo(() => {
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (item && item.type === 'message') return item.id;
        }
        return null;
    }, [items]);

    const prevMessagesRef = useRef(messages);
    const prevConversationIdRef = useRef(conversationId);
    const prevContextJumpStateRef = useRef(contextJumpState);
    const prevItemsRef = useRef<ThreadItem[]>(items);
    const [firstItemIndex, setFirstItemIndex] = useState(1_000_000);

    useLayoutEffect(() => {
        if (
            conversationId !== prevConversationIdRef.current
            || contextJumpState !== prevContextJumpStateRef.current
        ) {
            prevConversationIdRef.current = conversationId;
            prevContextJumpStateRef.current = contextJumpState;
            prevMessagesRef.current = messages;
            prevItemsRef.current = items;
            setFirstItemIndex(1_000_000);
            return;
        }

        if (items === prevItemsRef.current) return;

        const previousItems = prevItemsRef.current;
        const previousFirstMessageIndex = previousItems.findIndex(item => item.type === 'message');
        const previousAnchorIndex = previousFirstMessageIndex >= 0 ? previousFirstMessageIndex : 0;
        const previousAnchorItem = previousItems[previousAnchorIndex] ?? null;

        const newAnchorIndex = previousAnchorItem
            ? items.findIndex((item) => item.id === previousAnchorItem.id)
            : -1;

        const prependedCount = newAnchorIndex - previousAnchorIndex;

        prevMessagesRef.current = messages;
        prevItemsRef.current = items;

        if (prependedCount > 0) {
            setFirstItemIndex((previous) => previous - prependedCount);
        }
    }, [contextJumpState, conversationId, items, messages]);

    const orderedMessages = messages;

    const canonicalUnreadModel = useMemo(() => buildMessageThreadModel({
        conversationId,
        messages,
        viewerId,
        viewerUnreadCount,
    }), [conversationId, messages, viewerId, viewerUnreadCount]);

    const unreadMessageIdSet = useMemo(
        () => new Set(canonicalUnreadModel.unreadMessageIds),
        [canonicalUnreadModel.unreadMessageIds],
    );
    const loadedMessageIds = useMemo(() => orderedMessages.map((m) => m.id), [orderedMessages]);
    const linkedWorkQuery = useMessageWorkLinks(conversationId, loadedMessageIds);
    const linkedWorkByMessageId = linkedWorkQuery.data ?? {};

    // When the messages prop changes, ack delivery for any newly-seen messages
    // that are NOT from the viewer. This runs exactly once per message.
    useEffect(() => {
        if (!viewerId) return;
        const unseen: Array<{ id: string; senderId: string | null }> = [];
        for (const message of orderedMessages) {
            if (message.senderId === viewerId) continue;
            if (ackedMessageIdsRef.current.has(message.id)) continue;
            if (!unreadMessageIdSet.has(message.id)) {
                ackedMessageIdsRef.current.add(message.id);
                continue;
            }
            ackedMessageIdsRef.current.add(message.id);
            unseen.push({ id: message.id, senderId: message.senderId });
        }
        if (unseen.length > 0) {
            ackDelivery(unseen);
        }
    }, [orderedMessages, viewerId, ackDelivery, unreadMessageIdSet]);

    // Clear the ack set when the conversation changes
    useEffect(() => {
        ackedMessageIdsRef.current.clear();
    }, [conversationId]);

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

            if (
                latestVisibleUnreadMessageId
                && (typeof document === 'undefined' || document.visibilityState === 'visible')
            ) {
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

    const hasFocusTarget = Boolean(focusMessageId || contextJumpState || focusedMessage || hasFocusTopInset);
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const [unreadBelow, setUnreadBelow] = useState(0);

    const scrollToLatest = useCallback((behavior: 'auto' | 'smooth' = 'smooth', attempts = 1) => {
        const run = (remainingAttempts: number) => {
            requestAnimationFrame(() => {
                virtuosoRef.current?.scrollToIndex({
                    index: 'LAST',
                    align: 'end',
                    behavior,
                });
                if (remainingAttempts > 1) {
                    run(remainingAttempts - 1);
                }
            });
        };
        run(attempts);
        setUnreadBelow(0);
    }, []);

    const handleAtBottomChange = useCallback((atBottom: boolean) => {
        setIsAtBottom(atBottom);
        if (atBottom) {
            setUnreadBelow(0);
        }
    }, []);
    const focusMessage = useCallback(async (messageId: string) => {
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
            pendingFocusMessageIdRef.current = null;
            isFocusNavigationRef.current = true;
            setHasFocusTopInset(true);
            // ponytail: Virtuoso scrollToIndex uses the local data index; firstItemIndex is render bookkeeping only.
            setFocusedMessage({ id: messageId });
            return true;
        }

        isFocusNavigationRef.current = true;
        pendingFocusMessageIdRef.current = messageId;
        const loadedContext = await onRequestMessageContext(messageId);
        if (!loadedContext) {
            if (pendingFocusMessageIdRef.current === messageId) {
                pendingFocusMessageIdRef.current = null;
            }
            isFocusNavigationRef.current = false;
            toast.error('Original message is unavailable');
        }
        return loadedContext;
    }, [messageDataIndexById, onRequestMessageContext]);

    useLayoutEffect(() => {
        if (!focusedMessage) return;

        const targetIndex = messageDataIndexById.get(focusedMessage.id);
        if (typeof targetIndex !== 'number') return;

        const prefersReducedMotion = typeof window !== 'undefined'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        focusAnimationFrameRef.current = window.requestAnimationFrame(() => {
            virtuosoRef.current?.scrollToIndex({
                index: targetIndex,
                align: 'center',
                behavior: prefersReducedMotion ? 'auto' : 'smooth',
            });
            focusAnimationFrameRef.current = null;
        });
        focusResetTimeoutRef.current = window.setTimeout(() => {
            setFocusedMessage((current) => (current?.id === focusedMessage.id ? null : current));
            isFocusNavigationRef.current = false;
            focusResetTimeoutRef.current = null;
        }, prefersReducedMotion ? 900 : 1250);

        return () => {
            if (focusAnimationFrameRef.current) {
                window.cancelAnimationFrame(focusAnimationFrameRef.current);
                focusAnimationFrameRef.current = null;
            }
        };
    }, [focusedMessage, messageDataIndexById]);

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
        ) {
            return;
        }

        olderMessagesRequestInFlightRef.current = true;
        onLoadMore();
    }, [hasMore, isFetchingMore, onLoadMore]);

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
        };
    }, []);

    useEffect(() => {
        if (hasFocusTarget) return;
        scrollToLatest('auto');
    }, [hasFocusTarget, scrollToLatestSignal, scrollToLatest]);

    const latestMessage = orderedMessages[orderedMessages.length - 1] ?? null;
    const latestMessageId = latestMessage?.id ?? null;
    const previousLatestMessageIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (hasFocusTarget) return;
        if (isLoading || !latestMessage || !latestMessageId) return;
        const prev = previousLatestMessageIdRef.current;
        previousLatestMessageIdRef.current = latestMessageId;

        if (!prev) {
            scrollToLatest('auto', 3);
            return;
        }

        if (prev === latestMessageId) return;

        const isOwn = latestMessage.senderId === viewerId;
        if (isOwn || isAtBottom) {
            scrollToLatest('smooth', 1);
        } else {
            setUnreadBelow((count) => count + 1);
        }
    }, [hasFocusTarget, latestMessage, latestMessageId, viewerId, isLoading, isAtBottom, scrollToLatest]);

    useEffect(() => {
        if (hasFocusTarget) return;
        setUnreadBelow(0);
        setIsAtBottom(true);
        previousLatestMessageIdRef.current = null;
        scrollToLatest('auto', 3);
    }, [conversationId, hasFocusTarget, scrollToLatest]);

    useEffect(() => {
        if (typeof ResizeObserver === 'undefined') return;
        const element = rootRef.current;
        if (!element) return;
        let resizeFrame: number | null = null;
        const observer = new ResizeObserver(() => {
            if (isFocusNavigationRef.current || hasFocusTarget || !isAtBottom || items.length === 0) return;
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
    }, [isAtBottom, hasFocusTarget, items.length, scrollToLatest]);

    useEffect(() => {
        if (!focusMessageId) {
            appliedExternalFocusIdRef.current = null;
            return;
        }
        if (appliedExternalFocusIdRef.current === focusMessageId) return;
        appliedExternalFocusIdRef.current = focusMessageId;
        void focusMessage(focusMessageId);
    }, [focusMessage, focusMessageId]);

    useEffect(() => {
        const pendingMessageId = pendingFocusMessageIdRef.current;
        if (!pendingMessageId || !messageDataIndexById.has(pendingMessageId)) return;
        pendingFocusMessageIdRef.current = null;
        void focusMessage(pendingMessageId);
    }, [focusMessage, messageDataIndexById]);

    const handleFocusMessage = useCallback((messageId: string) => {
        void focusMessage(messageId);
    }, [focusMessage]);

    const handleContentLoad = useCallback(() => {
        if (isFocusNavigationRef.current || hasFocusTarget || !isAtBottom) return;
        virtuosoRef.current?.autoscrollToBottom();
    }, [isAtBottom, hasFocusTarget, virtuosoRef]);

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
                                onClick={() => void focusMessage(message.id)}
                                title={message.content || 'Pinned message'}
                            >
                                {message.content?.trim() || `[${message.type || 'message'}]`}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {!isLoading && !isFetchingMore && orderedMessages.length === 0 ? (
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
                            atBottomThreshold={120}
                            computeItemKey={(index, item) => item?.id ?? `message-thread-item-${index}`}
                            atBottomStateChange={handleAtBottomChange}
                            startReached={() => {
                                requestOlderMessages();
                            }}
                            rangeChanged={({ startIndex }) => {
                                const startDataIndex = Math.max(0, startIndex - firstItemIndex);
                                if (startDataIndex <= OLDER_MESSAGES_PRELOAD_THRESHOLD && canFetchOlderRef.current) {
                                    requestOlderMessages();
                                }
                            }}
                            components={{
                                Header: () => (
                                    <>
                                        {hasFocusTopInset ? <div aria-hidden="true" className="min-h-[min(38dvh,18rem)]" /> : null}
                                        <OlderMessagesLoader visible={isFetchingMore} />
                                    </>
                                ),
                                Footer: () => <ThreadBottomSentinel typingVisible={typingUsers.length > 0} />,
                            }}
                            itemContent={(index, item) => {
                                if (item.type === 'date') {
                                    return <ThreadDateGroupHeader label={formatMessageCalendarLabel(item.dateKey)} />;
                                }
                                if (item.type === 'unread-divider') {
                                    return <ThreadUnreadDivider count={item.count} />;
                                }
                                if (item.type === 'typing-indicator') {
                                    return (
                                        <div className="px-3 py-1">
                                            <TypingIndicator users={item.typingUsers} className="mb-0" />
                                        </div>
                                    );
                                }
                                if (item.type !== 'message') return null;

                                const dataIndex = index - firstItemIndex;
                                const prevItem = items[dataIndex - 1];
                                const nextItem = items[dataIndex + 1];
                                const isConsecutiveFromPrev = prevItem?.type === 'message' && prevItem.message.senderId === item.message.senderId;
                                const isConsecutiveToNext = nextItem?.type === 'message' && nextItem.message.senderId === item.message.senderId;

                                const ptClass = isConsecutiveFromPrev ? 'pt-0' : 'pt-1.5';
                                const pbClass = isConsecutiveToNext ? 'pb-0' : 'pb-1.5';

                                const nextMessageSameSenderWithinTime = nextItem?.type === 'message'
                                    && nextItem.message.senderId === item.message.senderId
                                    && (new Date(nextItem.message.createdAt).getTime() - new Date(item.message.createdAt).getTime()) < 5 * 60 * 1000;
                                const showTimestamp = !nextMessageSameSenderWithinTime;
                                const isLatestMessage = item.id === latestMessageItemId;

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
                                                linkedWork={linkedWorkByMessageId[item.message.id] ?? EMPTY_LINKED_WORK}
                                                surface={surface}
                                                onReply={onReply}
                                                onTogglePin={onTogglePin}
                                                onFocusMessage={handleFocusMessage}
                                                onContentLoad={handleContentLoad}
                                                isFocusedReplyTarget={focusedMessage?.id === item.message.id}
                                                showTimestamp={showTimestamp}
                                                isConsecutiveFromPrev={isConsecutiveFromPrev}
                                                isConsecutiveToNext={isConsecutiveToNext}
                                                conversationType={conversationType}
                                                isLatestMessage={isLatestMessage}
                                                onTriggerDialog={handleTriggerDialog}
                                                onToggleReaction={handleToggleReaction}
                                                isReactionLoading={isReactionLoading}
                                                onResolveWorkflow={handleResolveWorkflow}
                                                isWorkflowActionLoading={isWorkflowActionLoading}
                                            />
                                        </div>
                                    </div>
                                );
                            }}
                        />
                    </div>
                </>
            )}
            <ScrollToBottomFab
                visible={!isAtBottom || unreadBelow > 0}
                showNewMessages={unreadBelow > 0}
                onClick={() => {
                    onClearFocusTarget?.();
                    scrollToLatest('smooth', 2);
                }}
            />
            <div aria-live="polite" className="sr-only">
                {orderedMessages.length > 0 && orderedMessages[orderedMessages.length - 1]?.sender
                    ? `${buildIdentityPresentation(orderedMessages[orderedMessages.length - 1]!.sender).displayName}: ${orderedMessages[orderedMessages.length - 1]!.content || 'sent a message'}`
                    : ''}
            </div>

            {dialogTarget?.type === 'report' && (
                <ReportMessageDialog
                    messageId={dialogTarget.message.id}
                    isOpen={true}
                    onClose={() => setDialogTarget(null)}
                />
            )}
        </div>
    );
}

function ThreadUnreadDivider({ count }: { count: number }) {
    return (
        <Marker className="flex items-center gap-2 text-[10px] tracking-wider text-red-500 my-2">
            <div className="h-px flex-1 bg-red-200 dark:bg-red-900/40" />
            <span className="px-2 py-0.5 rounded bg-red-50 dark:bg-red-950/40 border border-red-200/40 dark:border-red-900/60 font-semibold">
                {count} Unread Message{count === 1 ? '' : 's'}
            </span>
            <div className="h-px flex-1 bg-red-200 dark:bg-red-900/40" />
        </Marker>
    );
}

function ThreadDateGroupHeader({ label }: { label: string }) {
    return (
        <Marker className="flex items-center gap-2 text-[10px] tracking-wider text-muted-foreground my-2">
            <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            <span className="px-2 py-0.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200/40 dark:border-zinc-800/60 font-semibold">{label}</span>
            <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        </Marker>
    );
}

function ThreadBottomSentinel({
    typingVisible,
}: {
    typingVisible: boolean;
}) {
    const baseHeight = 76;
    const height = typingVisible ? baseHeight + 28 : baseHeight;
    return (
        <div
            aria-hidden="true"
            style={{ height: `${height}px` }}
        />
    );
}

function OlderMessagesLoader({ visible }: { visible: boolean }) {
    if (!visible) return null;
    return (
        <div className="flex justify-center px-4 pb-3 pt-12" role="status" aria-live="polite">
            <div className={cn(
                "inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-md transition-opacity duration-200",
                "opacity-100"
            )}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Loading earlier messages...</span>
            </div>
        </div>
    );
}
