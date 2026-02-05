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

export function MessageThread({ messages, conversationId }: MessageThreadProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const prevMessagesLengthRef = useRef(messages.length);

    const messageCache = useChatStore(state => state.messagesByConversation[conversationId]);
    const loadMoreMessages = useChatStore(state => state.loadMoreMessages);
    
    // Scalable Broadcast Typing
    const { typingUsers } = useTypingChannel(conversationId);

    const isLoading = messageCache?.loading || false;
    const hasMore = messageCache?.hasMore || false;

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        if (messages.length > prevMessagesLengthRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
        prevMessagesLengthRef.current = messages.length;
    }, [messages.length]);

    // Scroll when typing users change (if near bottom)
    useEffect(() => {
        if (typingUsers.length > 0) {
           bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [typingUsers.length]);

    // Initial scroll to bottom
    useEffect(() => {
        bottomRef.current?.scrollIntoView();
    }, [conversationId]);

    // Handle scroll for infinite loading
    const handleScroll = () => {
        if (!containerRef.current || isLoading || !hasMore) return;

        // Load more when scrolled near top
        if (containerRef.current.scrollTop < 100) {
            loadMoreMessages(conversationId);
        }
    };

    // Flatten messages with date headers for virtualization
    const items = useMemo(() => {
        const result: Array<{ type: 'date'; date: string; id: string } | { type: 'message'; message: MessageWithSender; id: string }> = [];
        
        // Group first (or just iterate and detect change which is single pass, better for perf)
        // Grouping logic existing is fine, we just need to output linear list
        
        const groups = messages.reduce((acc, message) => {
            const date = new Date(message.createdAt).toLocaleDateString();
            if (!acc[date]) {
                acc[date] = [];
            }
            acc[date].push(message);
            return acc;
        }, {} as Record<string, MessageWithSender[]>);

        Object.entries(groups).forEach(([date, dateMessages]) => {
            result.push({ type: 'date', date, id: `date-${date}` });
            dateMessages.forEach(msg => {
                result.push({ type: 'message', message: msg, id: msg.id });
            });
        });

        return result;
    }, [messages]);

    return (
        <div className="flex-1 overflow-hidden h-full">
            <Virtuoso
                style={{ height: '100%' }}
                data={items}
                initialTopMostItemIndex={items.length - 1} // Start at bottom
                followOutput="smooth" // Auto-scroll on new messages
                alignToBottom // Stick to bottom on load
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
                        <div className="pb-2 px-4" ref={bottomRef}>
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
                        <div className="px-4 py-1">
                            <MessageBubble
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
function formatDateLabel(dateString: string): string {
    const date = new Date(dateString);
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
