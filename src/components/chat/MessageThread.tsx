'use client';

import { useRef, useMemo, useEffect } from 'react';
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

    const messageCache = useChatStore(state => state.messagesByConversation[conversationId]);
    const pinnedMessages = useChatStore(
        (state) => state.pinnedMessagesByConversation[conversationId] ?? EMPTY_PINNED_MESSAGES
    );
    const loadMoreMessages = useChatStore(state => state.loadMoreMessages);
    const fetchPinnedMessages = useChatStore(state => state.fetchPinnedMessages);
    
    // Scalable Broadcast Typing
    const { typingUsers } = useTypingChannel(conversationId);

    const isLoading = messageCache?.loading || false;
    const hasMore = messageCache?.hasMore || false;

    useEffect(() => {
        isAtBottomRef.current = true;
        initialBottomAppliedForConversationRef.current = null;
        prevMessagesLengthRef.current = 0;
    }, [conversationId]);

    // Auto-scroll to bottom on new messages when user is already at bottom
    useEffect(() => {
        if (messages.length > prevMessagesLengthRef.current && isAtBottomRef.current) {
            virtuosoRef.current?.scrollToIndex({
                index: 'LAST',
                align: 'end',
                behavior: 'smooth',
            });
        }
        prevMessagesLengthRef.current = messages.length;
    }, [messages.length]);

    // Scroll when typing users change (only if at bottom)
    useEffect(() => {
        if (typingUsers.length > 0 && messages.length > 0 && isAtBottomRef.current) {
            virtuosoRef.current?.scrollToIndex({
                index: 'LAST',
                align: 'end',
                behavior: 'smooth',
            });
        }
    }, [messages.length, typingUsers.length]);

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

    // Flatten messages with date headers for virtualization
    const items = useMemo(() => {
        const toValidDate = (value: unknown) => {
            const date = new Date(value as string | number | Date);
            return Number.isNaN(date.getTime()) ? null : date;
        };

        const result: Array<{ type: 'date'; date: Date; id: string } | { type: 'message'; message: MessageWithSender; id: string }> = [];
        const groups = new Map<string, { date: Date; messages: MessageWithSender[] }>();
        const sortedMessages = [...messages].sort((a, b) => {
            const da = toValidDate(a.createdAt);
            const db = toValidDate(b.createdAt);
            if (!da && !db) return 0;
            if (!da) return 1;
            if (!db) return -1;
            return da.getTime() - db.getTime();
        });

        for (const message of sortedMessages) {
            const createdAt = toValidDate(message.createdAt);
            if (!createdAt) {
                result.push({ type: 'message', message, id: message.id });
                continue;
            }
            const dayKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}-${String(createdAt.getDate()).padStart(2, '0')}`;

            if (!groups.has(dayKey)) {
                groups.set(dayKey, {
                    date: new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate()),
                    messages: [],
                });
            }

            groups.get(dayKey)!.messages.push(message);
        }

        for (const [dayKey, group] of groups.entries()) {
            result.push({ type: 'date', date: group.date, id: `date-${dayKey}` });
            for (const msg of group.messages) {
                result.push({ type: 'message', message: msg, id: msg.id });
            }
        }

        return result;
    }, [messages]);
    const initialTopMostItemIndex = items.length > 0 ? items.length - 1 : 0;

    return (
        <div className="flex-1 overflow-hidden h-full flex flex-col">
            {pinnedMessages.length > 0 && (
                <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-900/70">
                    <div className="flex items-center gap-2 overflow-x-auto">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                            Pinned
                        </span>
                        {pinnedMessages.map((message) => (
                            <button
                                key={`pin-${message.id}`}
                                type="button"
                                className="max-w-[240px] text-left text-xs px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-800/80 hover:bg-white dark:hover:bg-zinc-800 whitespace-nowrap truncate"
                                onClick={() => {
                                    const node = document.getElementById(`msg-${message.id}`);
                                    if (node) {
                                        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        node.classList.add('ring-2', 'ring-amber-500/70');
                                        window.setTimeout(() => {
                                            node.classList.remove('ring-2', 'ring-amber-500/70');
                                        }, 1400);
                                    }
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
                style={{ height: '100%', flex: 1 }}
                data={items}
                initialTopMostItemIndex={initialTopMostItemIndex} // Start at bottom
                followOutput="smooth" // Auto-scroll on new messages
                alignToBottom // Stick to bottom on load
                atBottomStateChange={(atBottom) => {
                    isAtBottomRef.current = atBottom;
                }}
                startReached={() => {
                    if (!isLoading && hasMore) {
                        loadMoreMessages(conversationId);
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
                        <div id={`msg-${item.message.id}`} className="px-4 py-1 transition-shadow duration-300 rounded-md">
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
