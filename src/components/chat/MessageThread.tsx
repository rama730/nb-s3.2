'use client';

import { useRef, useMemo, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useTypingChannel } from '@/hooks/useTypingChannel';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import type { MessageWithSender } from '@/app/actions/messaging';
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

    // OPTIMIZED: Me moize date grouping computation (was recalculating on every render)
    const groupedMessages = useMemo(() => {
        return messages.reduce((groups, message) => {
            const date = new Date(message.createdAt).toLocaleDateString();
            if (!groups[date]) {
                groups[date] = [];
            }
            groups[date].push(message);
            return groups;
        }, {} as Record<string, MessageWithSender[]>);
    }, [messages]);

    return (
        <div
            ref={containerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-4 space-y-4"
        >
            {/* Load more indicator */}
            {isLoading && (
                <div className="flex justify-center py-2">
                    <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
                </div>
            )}

            {/* Messages grouped by date */}
            {Object.entries(groupedMessages).map(([date, dateMessages]) => (
                <div key={date}>
                    {/* Date separator */}
                    <div className="flex items-center justify-center my-4">
                        <span className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-full text-xs text-zinc-500">
                            {formatDateLabel(date)}
                        </span>
                    </div>

                    {/* Messages */}
                    <div className="space-y-2">
                        {dateMessages.map((message, index) => {
                            const prevMessage = index > 0 ? dateMessages[index - 1] : null;
                            const showAvatar = !prevMessage || prevMessage.senderId !== message.senderId;

                            return (
                                <MessageBubble
                                    key={message.id}
                                    message={message}
                                    showAvatar={showAvatar}
                                />
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* Empty state */}
            {messages.length === 0 && !isLoading && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        No messages yet
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                        Send a message to start the conversation
                    </p>
                </div>
            )}

            {/* Scroll anchor */}
            <div ref={bottomRef} />
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
