'use client';

import Image from 'next/image';
import { useChatStore } from '@/stores/chatStore';
import { formatDistanceToNow } from 'date-fns';
import { BellOff, MessageSquare, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTypingChannel } from '@/hooks/useTypingChannel';
import { Virtuoso } from 'react-virtuoso';

// ============================================================================
// CONVERSATION LIST
// Shows all conversations with last message preview + typing indicators
// ============================================================================

interface ConversationListProps {
    hideSearch?: boolean;
    searchQuery?: string;
    onSearchQueryChange?: (value: string) => void;
    activeConversationId?: string | null;
    onConversationSelect?: (conversationId: string) => void;
}

function safeFormatRelativeTime(value: unknown): string | null {
    if (!value) return null;
    const date = new Date(value as string | number | Date);
    if (Number.isNaN(date.getTime())) return null;
    return formatDistanceToNow(date, { addSuffix: false });
}

export function ConversationList({
    hideSearch = false,
    searchQuery,
    onSearchQueryChange,
    activeConversationId,
    onConversationSelect,
}: ConversationListProps) {
    const conversations = useChatStore(state => state.conversations);
    const conversationsLoading = useChatStore(state => state.conversationsLoading);
    const unreadCounts = useChatStore(state => state.unreadCounts);
    const storeActiveConversationId = useChatStore(state => state.activeConversationId);
    const openConversation = useChatStore(state => state.openConversation);
    const refreshConversations = useChatStore(state => state.refreshConversations);
    const hasMoreConversations = useChatStore(state => state.hasMoreConversations);
    const loadMoreConversations = useChatStore(state => state.loadMoreConversations);
    const [internalSearchQuery, setInternalSearchQuery] = useState('');
    const didBootstrapRefreshRef = useRef(false);
    const effectiveSearchQuery = searchQuery ?? internalSearchQuery;
    const handleSearchChange = onSearchQueryChange ?? setInternalSearchQuery;
    const selectedConversationId = activeConversationId ?? storeActiveConversationId;

    // Filter conversations by search
    const filteredConversations = conversations.filter(conv => {
        if (!effectiveSearchQuery.trim()) return true;
        const participant = conv.participants[0];
        if (!participant) return false;
        const searchLower = effectiveSearchQuery.toLowerCase();
        return (
            participant.fullName?.toLowerCase().includes(searchLower) ||
            participant.username?.toLowerCase().includes(searchLower)
        );
    });

    useEffect(() => {
        if (didBootstrapRefreshRef.current) return;
        if (conversationsLoading) return;
        if (effectiveSearchQuery.trim()) return;
        didBootstrapRefreshRef.current = true;
        if (conversations.length === 0) {
            void refreshConversations();
        }
    }, [conversations.length, conversationsLoading, effectiveSearchQuery, refreshConversations]);

    if (conversationsLoading && conversations.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
            </div>
        );
    }

    const renderConversationItem = (conv: (typeof filteredConversations)[number]) => {
        const participant = conv.participants[0];
        const unread = unreadCounts[conv.id] || 0;
        const relativeLastMessageTime = conv.lastMessage
            ? safeFormatRelativeTime(conv.lastMessage.createdAt)
            : null;
        const isSelected = selectedConversationId === conv.id;

        return (
            <button
                key={conv.id}
                data-testid={`conversation-row-${conv.id}`}
                aria-label={`Conversation with ${participant?.fullName || participant?.username || 'Unknown'}${unread > 0 ? `, ${unread} unread` : ''}`}
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => (onConversationSelect ? onConversationSelect(conv.id) : openConversation(conv.id))}
                className={`w-full flex items-center gap-3 p-3 transition-colors text-left border-l-2 ${
                    isSelected
                        ? 'bg-blue-50 dark:bg-blue-950/30 border-l-blue-600'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border-l-transparent'
                }`}
            >
                <div className="relative flex-shrink-0">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center overflow-hidden">
                        {participant?.avatarUrl ? (
                            <Image
                                src={participant.avatarUrl}
                                alt={participant.fullName || ''}
                                width={48}
                                height={48}
                                unoptimized
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <span className="text-white font-medium">
                                {(participant?.fullName || participant?.username || '?')[0].toUpperCase()}
                            </span>
                        )}
                    </div>
                    {unread > 0 && (
                        <span className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full">
                            {unread > 9 ? '9+' : unread}
                        </span>
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1 min-w-0">
                            <span className={`font-medium text-sm truncate ${unread > 0 ? 'text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'}`}>
                                {participant?.fullName || participant?.username || 'Unknown'}
                            </span>
                            {conv.muted && (
                                <BellOff className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                            )}
                        </div>
                        {relativeLastMessageTime && (
                            <span className="text-xs text-zinc-400 flex-shrink-0 ml-2">
                                {relativeLastMessageTime}
                            </span>
                        )}
                    </div>
                    <ConversationPreview
                        typingConversationId={conv.id}
                        lastMessage={conv.lastMessage}
                        unread={unread}
                        listenTyping={isSelected}
                    />
                </div>
            </button>
        );
    };

    return (
        <div className="h-full min-h-0 flex flex-col overflow-hidden">
            {/* Search */}
            {!hideSearch && (
                <div className="p-3 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                        <input
                            type="text"
                            aria-label="Search conversations"
                            placeholder="Search conversations..."
                            value={effectiveSearchQuery}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 text-sm bg-zinc-100 dark:bg-zinc-800 rounded-lg border-0 focus:ring-2 focus:ring-blue-500 placeholder-zinc-400"
                        />
                    </div>
                </div>
            )}

            {/* Conversation List */}
            <div
                role="listbox"
                aria-label="Conversations"
                className="flex-1 min-h-0"
                onKeyDown={(e) => {
                    if (filteredConversations.length === 0) return;
                    const buttons = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button[data-testid^="conversation-row-"]');
                    if (!buttons.length) return;
                    const idx = Array.from(buttons).findIndex((b) => b === document.activeElement);
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        const next = idx < buttons.length - 1 ? idx + 1 : 0;
                        buttons[next]?.focus();
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        const prev = idx > 0 ? idx - 1 : buttons.length - 1;
                        buttons[prev]?.focus();
                    }
                }}
            >
                {filteredConversations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                        <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4">
                            <MessageSquare className="w-8 h-8 text-zinc-400" />
                        </div>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            {effectiveSearchQuery.trim() ? 'No conversations found' : 'No messages yet'}
                        </p>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                            Start a conversation from someone&apos;s profile
                        </p>
                    </div>
                ) : (
                    <Virtuoso
                        style={{ height: '100%' }}
                        data={filteredConversations}
                        computeItemKey={(_, conv) => conv.id}
                        increaseViewportBy={{ top: 180, bottom: 240 }}
                        endReached={() => {
                            if (hasMoreConversations && !effectiveSearchQuery.trim() && !conversationsLoading) {
                                void loadMoreConversations();
                            }
                        }}
                        components={{
                            Footer: () =>
                                hasMoreConversations && !effectiveSearchQuery.trim() ? (
                                    <div className="p-3 text-center text-xs text-zinc-500">
                                        {conversationsLoading ? 'Loading…' : 'Scroll for older conversations'}
                                    </div>
                                ) : null,
                        }}
                        itemContent={(_, conv) => (
                            <div className="border-b border-zinc-100 dark:border-zinc-800 last:border-b-0">
                                {renderConversationItem(conv)}
                            </div>
                        )}
                    />
                )}
            </div>
        </div>
    );
}

// ============================================================================
// CONVERSATION PREVIEW - Shows typing indicator or last message
// ============================================================================

export function ConversationPreview({ 
    typingConversationId,
    lastMessage, 
    unread,
    listenTyping = true,
}: { 
    typingConversationId: string | null;
    lastMessage: { content?: string | null; type?: string | null } | null | undefined; 
    unread: number;
    listenTyping?: boolean;
}) {
    const { typingUsers } = useTypingChannel(listenTyping ? typingConversationId : null);

    if (typingUsers.length > 0) {
        const typingLabel = typingUsers.length === 1
            ? `${typingUsers[0].fullName || typingUsers[0].username || 'Someone'} is typing...`
            : `${typingUsers.length} people are typing...`;

        return (
            <p className="text-sm truncate text-blue-600 dark:text-blue-400 font-medium">
                {typingLabel}
            </p>
        );
    }

    // Show last message
    return (
        <p className={`text-sm truncate ${unread > 0 ? 'text-zinc-700 dark:text-zinc-200 font-medium' : 'text-zinc-500 dark:text-zinc-400'}`}>
            {formatPreviewText(lastMessage)}
        </p>
    );
}

function formatPreviewText(lastMessage: { content?: string | null; type?: string | null } | null | undefined): string {
    if (!lastMessage) return 'No messages yet';
    if (lastMessage.content && lastMessage.content.trim().length > 0) {
        const normalized = lastMessage.content.replace(/\s+/g, ' ').trim();
        if (normalized.includes('```')) return 'Code snippet';
        return normalized;
    }

    switch (lastMessage.type) {
        case 'image':
            return 'Photo';
        case 'video':
            return 'Video';
        case 'file':
            return 'Attachment';
        case 'system':
            return 'System update';
        default:
            return 'Message';
    }
}
