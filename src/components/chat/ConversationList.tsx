'use client';

import { useChatStore } from '@/stores/chatStore';
import { useTypingChannel } from '@/hooks/useTypingChannel';
import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Search } from 'lucide-react';
import { useState } from 'react';

// ============================================================================
// CONVERSATION LIST
// Shows all conversations with last message preview + typing indicators
// ============================================================================

// Stable empty array to prevent infinite re-renders


export function ConversationList() {
    const conversations = useChatStore(state => state.conversations);
    const conversationsLoading = useChatStore(state => state.conversationsLoading);
    const unreadCounts = useChatStore(state => state.unreadCounts);
    const openConversation = useChatStore(state => state.openConversation);
    const [searchQuery, setSearchQuery] = useState('');

    // Filter conversations by search
    const filteredConversations = conversations.filter(conv => {
        if (!searchQuery.trim()) return true;
        const participant = conv.participants[0];
        if (!participant) return false;
        const searchLower = searchQuery.toLowerCase();
        return (
            participant.fullName?.toLowerCase().includes(searchLower) ||
            participant.username?.toLowerCase().includes(searchLower)
        );
    });

    if (conversationsLoading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Search */}
            <div className="p-3 border-b border-zinc-200 dark:border-zinc-800">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input
                        type="text"
                        placeholder="Search conversations..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 text-sm bg-zinc-100 dark:bg-zinc-800 rounded-lg border-0 focus:ring-2 focus:ring-blue-500 placeholder-zinc-400"
                    />
                </div>
            </div>

            {/* Conversation List */}
            <div className="flex-1 overflow-y-auto">
                {filteredConversations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                        <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4">
                            <MessageSquare className="w-8 h-8 text-zinc-400" />
                        </div>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            {searchQuery ? 'No conversations found' : 'No messages yet'}
                        </p>
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                            Start a conversation from someone's profile
                        </p>
                    </div>
                ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {filteredConversations.map(conv => {
                            const participant = conv.participants[0];
                            const unread = unreadCounts[conv.id] || 0;

                            return (
                                <button
                                    key={conv.id}
                                    onClick={() => openConversation(conv.id)}
                                    className="w-full flex items-center gap-3 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-left"
                                >
                                    {/* Avatar */}
                                    <div className="relative flex-shrink-0">
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center overflow-hidden">
                                            {participant?.avatarUrl ? (
                                                <img
                                                    src={participant.avatarUrl}
                                                    alt={participant.fullName || ''}
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

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between mb-0.5">
                                            <span className={`font-medium text-sm truncate ${unread > 0 ? 'text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'}`}>
                                                {participant?.fullName || participant?.username || 'Unknown'}
                                            </span>
                                            {conv.lastMessage && (
                                                <span className="text-xs text-zinc-400 flex-shrink-0 ml-2">
                                                    {formatDistanceToNow(new Date(conv.lastMessage.createdAt), { addSuffix: false })}
                                                </span>
                                            )}
                                        </div>
                                        <ConversationPreview 
                                            conversationId={conv.id} 
                                            lastMessage={conv.lastMessage} 
                                            unread={unread} 
                                        />
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================================================
// CONVERSATION PREVIEW - Shows typing indicator or last message
// ============================================================================

function ConversationPreview({ 
    conversationId, 
    lastMessage, 
    unread 
}: { 
    conversationId: string; 
    lastMessage: any; 
    unread: number;
}) {
    // Scalable Broadcast Typing for List Item
    // Note: This creates a listener for each visible item. 
    // While O(N), it satisfies the requirement to show typing in list.
    const { typingUsers } = useTypingChannel(conversationId);
    
    // Show typing indicator if anyone is typing
    if (typingUsers.length > 0) {
        const typingUser = typingUsers[0];
        return (
            <p className="text-sm truncate text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1.5">
                <span className="flex gap-0.5">
                    <span className="w-1.5 h-1.5 bg-blue-600 dark:bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-blue-600 dark:bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-blue-600 dark:bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </span>
                <span className="truncate">{typingUser.fullName || typingUser.username} is typing...</span>
            </p>
        );
    }
    
    // Show last message
    return (
        <p className={`text-sm truncate ${unread > 0 ? 'text-zinc-700 dark:text-zinc-200 font-medium' : 'text-zinc-500 dark:text-zinc-400'}`}>
            {lastMessage?.content || 'No messages yet'}
        </p>
    );
}
