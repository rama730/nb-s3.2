'use client';

import { useRef, useMemo, useEffect, useCallback } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useTypingChannel } from '@/hooks/useTypingChannel';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import type { MessageWithSender } from '@/app/actions/messaging';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { Loader2 } from 'lucide-react';

// ============================================================================
// MESSAGE THREAD
// Displays messages with infinite scroll and typing indicators
// ============================================================================

interface MessageThreadProps {
    messages: MessageWithSender[];
    conversationId: string;
}

const EMPTY_PINNED_MESSAGES: MessageWithSender[] = [];

export function MessageThread({ messages, conversationId }: MessageThreadProps) {
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);
    const isAtBottomRef = useRef(true);
    const initialBottomAppliedForConversationRef = useRef<string | null>(null);
    const prevMessagesLengthRef = useRef(messages.length);
    const prevLatestMessageIdRef = useRef<string | null>(messages.length > 0 ? messages[messages.length - 1]?.id ?? null : null);
    const pendingFocusMessageIdRef = useRef<string | null>(null);

    const messageCache = useChatStore(state => state.messagesByConversation[conversationId]);
    const pinnedMessages = useChatStore(
        (state) => state.pinnedMessagesByConversation[conversationId] ?? EMPTY_PINNED_MESSAGES
    );
    const loadMoreMessages = useChatStore(state => state.loadMoreMessages);
    const focusMessageInStore = useChatStore(state => state.focusMessage);
    const fetchPinnedMessages = useChatStore(state => state.fetchPinnedMessages);
    
    // Scalable Broadcast Typing
    const { typingUsers } = useTypingChannel(conversationId);

    const isLoading = messageCache?.loading || false;
    const hasMore = messageCache?.hasMore || false;

    const highlightMessage = useCallback((messageId: string, tone: 'blue' | 'amber' = 'blue') => {
        const node = document.getElementById(`msg-${messageId}`);
        if (!node) return false;
        const ringClass = tone === 'amber' ? 'ring-amber-500/70' : 'ring-blue-500/60';
        const bgClass = tone === 'amber' ? 'bg-amber-50/40' : 'bg-blue-50/40';
        const darkBgClass = tone === 'amber' ? 'dark:bg-amber-950/20' : 'dark:bg-blue-950/20';
        node.classList.add('ring-2', ringClass, bgClass, darkBgClass);
        window.setTimeout(() => {
            node.classList.remove('ring-2', ringClass, bgClass, darkBgClass);
        }, 1400);
        return true;
    }, []);

    useEffect(() => {
        isAtBottomRef.current = true;
        initialBottomAppliedForConversationRef.current = null;
        prevMessagesLengthRef.current = 0;
        prevLatestMessageIdRef.current = null;
        pendingFocusMessageIdRef.current = null;
    }, [conversationId]);

    // Auto-scroll only for tail appends (new outgoing/incoming messages), never for history backfill.
    useEffect(() => {
        const latestMessageId = messages.length > 0 ? messages[messages.length - 1]?.id ?? null : null;
        const didGrow = messages.length > prevMessagesLengthRef.current;
        const tailAdvanced = latestMessageId !== prevLatestMessageIdRef.current;

        if (
            didGrow &&
            tailAdvanced &&
            isAtBottomRef.current &&
            initialBottomAppliedForConversationRef.current === conversationId
        ) {
            virtuosoRef.current?.scrollToIndex({
                index: 'LAST',
                align: 'end',
                behavior: 'auto',
            });
        }
        prevMessagesLengthRef.current = messages.length;
        prevLatestMessageIdRef.current = latestMessageId;
    }, [conversationId, messages]);

    // Ensure each conversation opens from latest message once data is ready
    useEffect(() => {
        if (isLoading) return;
        if (messages.length === 0) return;
        if (initialBottomAppliedForConversationRef.current === conversationId) return;

        initialBottomAppliedForConversationRef.current = conversationId;
        virtuosoRef.current?.scrollToIndex({
            index: 'LAST',
            align: 'end',
            behavior: 'auto',
        });
    }, [conversationId, isLoading, messages.length]);

    useEffect(() => {
        void fetchPinnedMessages(conversationId);
    }, [conversationId, fetchPinnedMessages]);

    // Flatten messages with date headers for virtualization.
    // Message ordering is already normalized in the store merge pipeline.
    const items = useMemo(() => {
        const toValidDate = (value: unknown) => {
            const date = new Date(value as string | number | Date);
            return Number.isNaN(date.getTime()) ? null : date;
        };

        const result: Array<{ type: 'date'; date: Date; id: string } | { type: 'message'; message: MessageWithSender; id: string }> = [];
        let currentDayKey: string | null = null;

        for (const message of messages) {
            const createdAt = toValidDate(message.createdAt);
            if (!createdAt) {
                result.push({ type: 'message', message, id: message.id });
                continue;
            }
            const dayKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}-${String(createdAt.getDate()).padStart(2, '0')}`;

            if (currentDayKey !== dayKey) {
                currentDayKey = dayKey;
                result.push({
                    type: 'date',
                    date: new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate()),
                    id: `date-${dayKey}`,
                });
            }
            result.push({ type: 'message', message, id: message.id });
        }

        return result;
    }, [messages]);
    const focusMessageById = useCallback((messageId: string, tone: 'blue' | 'amber' = 'blue') => {
        const targetIndex = items.findIndex(
            (item) => item.type === 'message' && item.message.id === messageId
        );

        if (targetIndex >= 0) {
            pendingFocusMessageIdRef.current = null;
            virtuosoRef.current?.scrollToIndex({
                index: targetIndex,
                align: 'center',
                behavior: 'auto',
            });
            window.setTimeout(() => {
                highlightMessage(messageId, tone);
            }, 220);
            return true;
        }

        pendingFocusMessageIdRef.current = messageId;
        if (hasMore && !isLoading) {
            void loadMoreMessages(conversationId);
            return false;
        }
        if (!hasMore && !isLoading) {
            void focusMessageInStore(conversationId, messageId).then((result) => {
                if (!result.found && pendingFocusMessageIdRef.current === messageId) {
                    pendingFocusMessageIdRef.current = null;
                }
            });
        }
        return false;
    }, [conversationId, focusMessageInStore, hasMore, highlightMessage, isLoading, items, loadMoreMessages]);

    useEffect(() => {
        const pendingId = pendingFocusMessageIdRef.current;
        if (!pendingId) return;
        if (focusMessageById(pendingId)) return;
        if (!hasMore && !isLoading) {
            pendingFocusMessageIdRef.current = null;
        }
    }, [focusMessageById, hasMore, isLoading, items.length]);

    useEffect(() => {
        type FocusMessageDetail = {
            conversationId?: string;
            messageId?: string;
            tone?: 'blue' | 'amber';
        };
        const handler = (event: Event) => {
            const customEvent = event as CustomEvent<FocusMessageDetail>;
            const detail = customEvent.detail;
            if (!detail?.messageId) return;
            if (detail.conversationId !== conversationId) return;
            focusMessageById(detail.messageId, detail.tone || 'blue');
        };

        window.addEventListener('chat:focus-message', handler as EventListener);
        return () => {
            window.removeEventListener('chat:focus-message', handler as EventListener);
        };
    }, [conversationId, focusMessageById]);

    return (
        <div className="flex-1 overflow-hidden overflow-x-hidden h-full flex flex-col">
            {pinnedMessages.length > 0 && (
                <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/70">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                            Pinned
                        </span>
                        {pinnedMessages.map((message) => (
                            <button
                                key={`pin-${message.id}`}
                                type="button"
                                className="max-w-[240px] text-left text-xs px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-800/80 hover:bg-white dark:hover:bg-zinc-800 whitespace-nowrap truncate"
                                onClick={() => {
                                    focusMessageById(message.id, 'amber');
                                }}
                                title={message.content || 'Pinned message'}
                            >
                                {message.content?.trim() || `[${message.type || 'message'}]`}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            <Virtuoso
                ref={virtuosoRef}
                style={{ height: '100%', flex: 1, overflowX: 'hidden' }}
                data={items}
                increaseViewportBy={{ top: 320, bottom: 160 }}
                computeItemKey={(_, item) => item.id}
                atBottomStateChange={(atBottom) => {
                    isAtBottomRef.current = atBottom;
                }}
                startReached={() => {
                    if (!isLoading && hasMore) {
                        void loadMoreMessages(conversationId);
                    }
                }}
                components={{
                    Header: () => isLoading ? (
                        <div className="flex justify-center py-2">
                             <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
                        </div>
                    ) : null,
                    Footer: () => (
                        <div className="pb-2 px-4">
                            {typingUsers.length > 0 && <TypingIndicator users={typingUsers} />}
                            <div className="pb-2" />
                        </div>
                    )
                }}
                itemContent={(index, item) => {
                    if (item.type === 'date') {
                         return (
                            <div className="flex items-center justify-center my-4">
                                <span className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-full text-xs text-zinc-500">
                                    {formatDateLabel(item.date)}
                                </span>
                            </div>
                        );
                    }

                    // Message Item
                    const prevItem = index > 0 ? items[index - 1] : null;
                    const showAvatar = 
                        !prevItem || 
                        prevItem.type === 'date' || 
                        (prevItem.type === 'message' && prevItem.message.senderId !== item.message.senderId);

                    return (
                        <div id={`msg-${item.message.id}`} className="px-4 py-1 rounded-md min-w-0 overflow-x-hidden">
                            <MessageBubble
                                key={item.message.id}
                                message={item.message}
                                showAvatar={showAvatar}
                            />
                        </div>
                    );
                }}
            />
        </div>
    );
}

// Helper function to format date labels
function formatDateLabel(date: Date): string {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday';
    } else {
        return date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
    }
}
