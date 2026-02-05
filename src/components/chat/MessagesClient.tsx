'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useAuth } from '@/lib/hooks/use-auth';
import { MessageThread } from '@/components/chat/MessageThread';
import { MessageInput } from '@/components/chat/MessageInput';
import { searchMessages, type MessageWithSender, type ConversationWithDetails } from '@/app/actions/messaging';
import { MessageSquare, Search, X, Loader2, PenSquare } from 'lucide-react';
import { useDebounce } from '@/hooks/hub/useDebounce';
import { NewChatModal } from './NewChatModal';
import { Virtuoso } from 'react-virtuoso';
import { useConversations, useTargetUser } from '@/hooks/useMessagesData';
import { ConversationPreview } from './ConversationList';

import { ApplicationList } from './ApplicationList';
import { ProjectGroupList } from './ProjectGroupList';

// ============================================================================
// MESSAGES CLIENT
// ============================================================================

interface MessagesClientProps {
    initialConversations?: ConversationWithDetails[];
    targetUserId?: string | null;  // Changed from full object to ID
}

export default function MessagesClient({ initialConversations = [], targetUserId }: MessagesClientProps) {
    const { user, isLoading: authLoading } = useAuth();
    
    // React Query Hooks for Lazy Loading
    const { data: fetchedConversations, isLoading: conversationsQueryLoading } = useConversations(initialConversations.length > 0 ? initialConversations : undefined);
    const { data: fetchedTargetUser, isLoading: targetUserLoading } = useTargetUser(targetUserId || null);

    const activeConversationId = useChatStore(state => state.activeConversationId);
    const conversations = useChatStore(state => state.conversations);
    const messagesByConversation = useChatStore(state => state.messagesByConversation);
    const conversationsLoading = useChatStore(state => state.conversationsLoading);
    const unreadCounts = useChatStore(state => state.unreadCounts);
    const openConversation = useChatStore(state => state.openConversation);
    const setConversations = useChatStore(state => state.setConversations);
    const upsertConversation = useChatStore(state => state.upsertConversation);
    const isInitialized = useChatStore(state => state.isInitialized);

    // Sync React Query data to Store
    useEffect(() => {
        if (fetchedConversations && fetchedConversations.length > 0) {
            // Only update if different length or force sync? 
            // Better to rely on Store for extensive logic, but hydrate it here.
            // If store is empty, definitely set it.
            if (conversations.length === 0) {
                 setConversations(fetchedConversations);
            }
        }
    }, [fetchedConversations, setConversations, conversations.length]);

    // Target User Resolution
    const targetUser = fetchedTargetUser;

    // Draft State
    const [isNewChatOpen, setIsNewChatOpen] = useState(false);
    
    // Check if we need to set up a draft conversation
    const existingConversationWithTarget = useMemo(() => {
        if (!targetUser) return null;
        return conversations.find(c => c.participants.some(p => p.id === targetUser.id));
    }, [conversations, targetUser]);

    // Handle Target User Navigation
    useEffect(() => {
        if (targetUser) {
            if (existingConversationWithTarget) {
                if (activeConversationId !== existingConversationWithTarget.id) {
                    openConversation(existingConversationWithTarget.id);
                }
            }
        }
    }, [targetUser, existingConversationWithTarget, activeConversationId, openConversation]);

    // Derive active conversation
    const activeConversation = useMemo(() => {
        if (!activeConversationId) return null;
        return conversations.find(c => c.id === activeConversationId) || null;
    }, [activeConversationId, conversations]);

    const messages = useMemo(() => {
        if (!activeConversationId) return [];
        return messagesByConversation[activeConversationId]?.messages || [];
    }, [activeConversationId, messagesByConversation]);

    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<Array<{ 
        message: MessageWithSender; 
        conversationId: string;
        conversation?: ConversationWithDetails; // Hydration data
    }>>([]);
    const [showSearchResults, setShowSearchResults] = useState(false);

    const debouncedSearch = useDebounce(searchQuery, 300);

    // Initialize store with data from hook
    // This replaces the old separate effects
    
    // Full-text search effect
    useEffect(() => {
        async function performSearch() {
            if (!debouncedSearch.trim()) {
                setSearchResults([]);
                return;
            }
            
            setIsSearching(true);
            setShowSearchResults(true);
            
            try {
                const result = await searchMessages(debouncedSearch);
                if (result.success && result.results) {
                    setSearchResults(result.results);
                }
            } catch (error) {
                console.error('Search failed:', error);
            } finally {
                setIsSearching(false);
            }
        }
        performSearch();
    }, [debouncedSearch]);

    // Handle search result click
    const handleSearchResultClick = useCallback((conversationId: string, conversation?: ConversationWithDetails) => {
        // Hydrate conversation if missing (Ghost Conversation Fix)
        if (conversation) {
            upsertConversation(conversation);
        }
        
        openConversation(conversationId);
        setSearchQuery('');
        setShowSearchResults(false);
        setSearchResults([]);
    }, [openConversation, upsertConversation]);

    // Filter conversations for sidebar
    const filteredConversations = conversations.filter(conv => {
        if (showSearchResults) return true; // Show all when search results are displayed
        if (!searchQuery.trim()) return true;
        const participant = conv.participants[0];
        if (!participant) return false;
        const searchLower = searchQuery.toLowerCase();
        return (
            participant.fullName?.toLowerCase().includes(searchLower) ||
            participant.username?.toLowerCase().includes(searchLower)
        );
    });

    // Determine what to show in the main pane
    // 1. Loading
    // 2. Draft (Target User + No Existing)
    // 3. Active Conversation
    // 4. Empty State

    // Helper for participant
    const otherParticipant = activeConversation?.participants[0];

    // Use hook loading state
    const showLoading = (conversationsQueryLoading && conversations.length === 0);

    if (authLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-6">
                <MessageSquare className="w-16 h-16 text-zinc-300 mb-4" />
                <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-2">Sign in to view messages</h1>
                <p className="text-zinc-500">You need to be logged in to access your messages.</p>
            </div>
        );
    }

    const isDraftMode = !!targetUser && !existingConversationWithTarget;

    const [activeTab, setActiveTab] = useState<'chats' | 'applications' | 'projects'>('chats');

    return (
        <div className="flex h-[calc(100vh-64px)] bg-white dark:bg-zinc-950">
            {/* Sidebar code remains same */}
            <div className="w-80 border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
                {/* Header, Search, List logic... */}
                 <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Messages</h1>
                        <button 
                            onClick={() => setIsNewChatOpen(true)}
                            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full text-zinc-600 dark:text-zinc-400 transition-colors"
                            title="New Message"
                        >
                            <PenSquare className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Inbox Zero Toggle */}
                    <div className="flex p-1 bg-zinc-100 dark:bg-zinc-900 rounded-lg">
                        <button
                            onClick={() => setActiveTab('chats')}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                                activeTab === 'chats'
                                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                        >
                            Chats
                        </button>
                        <button
                            onClick={() => setActiveTab('applications')}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                                activeTab === 'applications'
                                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                        >
                            Applications
                        </button>
                        <button
                            onClick={() => setActiveTab('projects')}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                                activeTab === 'projects'
                                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                        >
                            Projects
                        </button>
                    </div>
                </div>

                {/* Search (Only for Chats) */}
                {activeTab === 'chats' && (
                    <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-800/50">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                            <input
                                type="text"
                                placeholder="Search messages..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-8 py-2 text-sm bg-zinc-100 dark:bg-zinc-800 rounded-lg border-0 focus:ring-1 focus:ring-blue-500 placeholder-zinc-400"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => {
                                        setSearchQuery('');
                                        setShowSearchResults(false);
                                        setSearchResults([]);
                                    }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Content: Search Results or Conversation List/Application List */}
                <div className="flex-1 overflow-y-auto">
                    {activeTab === 'applications' ? (
                        <ApplicationList />
                    ) : activeTab === 'projects' ? (
                        <ProjectGroupList />
                    ) : showSearchResults ? (
                        isSearching ? (
                            <div className="flex items-center justify-center p-8">
                                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                            </div>
                        ) : searchResults.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                                <Search className="w-12 h-12 text-zinc-300 mb-4" />
                                <p className="text-sm text-zinc-500">No messages found</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {searchResults.map((item) => {
                                    const { message, conversationId } = item;
                                    // Use local or hydrated conversation
                                    const conv = conversations.find(c => c.id === conversationId) || item.conversation;
                                    const participant = conv?.participants.find(p => p.id !== user?.id) || conv?.participants[0];

                                    return (
                                        <button
                                            key={message.id}
                                            onClick={() => handleSearchResultClick(conversationId, (item as any).conversation)}
                                            className="w-full flex flex-col gap-1 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-left transition-colors"
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center overflow-hidden">
                                                    {participant?.avatarUrl ? (
                                                        <img
                                                            src={participant.avatarUrl}
                                                            alt=""
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <span className="text-white text-xs">
                                                            {(participant?.fullName || '?')[0].toUpperCase()}
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                                                    {participant?.fullName || participant?.username || 'Unknown'}
                                                </span>
                                            </div>
                                            <p className="text-sm text-zinc-600 dark:text-zinc-300 line-clamp-2">
                                                {highlightMatch(message.content || '', debouncedSearch)}
                                            </p>
                                        </button>
                                    );
                                })}
                            </div>
                        )
                    ) : showLoading ? (
                        <div className="flex items-center justify-center p-8">
                            <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-600 border-t-transparent" />
                        </div>
                    ) : filteredConversations.length === 0 && !isDraftMode ? (
                        <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                            <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4">
                                <MessageSquare className="w-8 h-8 text-zinc-400" />
                            </div>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                No conversations yet
                            </p>
                            <button
                                onClick={() => setIsNewChatOpen(true)}
                                className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
                            >
                                Start a new chat
                            </button>
                        </div>
                    ) : (
                        <Virtuoso
                            style={{ height: '100%' }}
                            data={filteredConversations}
                            itemContent={(index, conv) => {
                                const participant = conv.participants[0];
                                const unread = unreadCounts[conv.id] || 0;
                                const isActive = conv.id === activeConversationId && !isDraftMode;

                                return (
                                    <button
                                        key={conv.id}
                                        onClick={() => openConversation(conv.id)}
                                        className={`w-full flex items-center gap-3 p-4 transition-colors text-left border-b border-zinc-50 dark:border-zinc-800/50 ${isActive
                                            ? 'bg-blue-50 dark:bg-blue-950/30 border-l-2 border-l-blue-600'
                                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border-l-2 border-l-transparent'
                                            }`}
                                    >
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

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between mb-0.5">
                                                <span className={`font-medium text-sm truncate ${unread > 0 || isActive ? 'text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'}`}>
                                                    {participant?.fullName || participant?.username || 'Unknown'}
                                                </span>
                                                {conv.lastMessage && (
                                                    <span className="text-xs text-zinc-400 flex-shrink-0 ml-2">
                                                        {formatTime(new Date(conv.lastMessage.createdAt))}
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
                            }}
                            components={{
                                Header: () => (
                                    <>
                                        {isDraftMode && targetUser && (
                                            <div className="w-full flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-950/30 border-l-2 border-blue-600 border-b border-zinc-100 dark:border-zinc-800">
                                                <div className="relative flex-shrink-0">
                                                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center overflow-hidden">
                                                        {targetUser.avatarUrl ? (
                                                            <img src={targetUser.avatarUrl} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <span className="text-white font-medium">
                                                                {(targetUser.fullName || targetUser.username || '?')[0].toUpperCase()}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between mb-0.5">
                                                        <span className="font-medium text-sm text-zinc-900 dark:text-white truncate">
                                                            {targetUser.fullName || targetUser.username}
                                                        </span>
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300 font-medium">
                                                            New
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
                                                        Say hello 👋
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )
                            }}
                        />
                    )}
                </div>

            </div>

            {/* Main Content - Message Thread */}
            <div className="flex-1 flex flex-col">
                {activeConversationId && otherParticipant ? (
                    // Logic already handled for existing chat
                     <>
                        {/* Conversation Header */}
                        <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                             {/* ... Header content ... */}
                             <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center overflow-hidden">
                                {otherParticipant.avatarUrl ? (
                                    <img
                                        src={otherParticipant.avatarUrl}
                                        alt={otherParticipant.fullName || ''}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <span className="text-white font-medium">
                                        {(otherParticipant.fullName || otherParticipant.username || '?')[0].toUpperCase()}
                                    </span>
                                )}
                            </div>
                            <div>
                                <h2 className="font-semibold text-zinc-900 dark:text-white">
                                    {otherParticipant.fullName || otherParticipant.username || 'Unknown'}
                                </h2>
                                {otherParticipant.username && (
                                    <p className="text-sm text-zinc-500">@{otherParticipant.username}</p>
                                )}
                            </div>
                        </div>

                        {/* Messages */}
                        <MessageThread
                            messages={messages}
                            conversationId={activeConversationId}
                        />

                        {/* Input */}
                        <MessageInput conversationId={activeConversationId} />
                    </>
                ) : isDraftMode && targetUser ? (
                    // DRAFT MODE UI
                    <>
                         <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                             <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center overflow-hidden">
                                {targetUser.avatarUrl ? (
                                    <img src={targetUser.avatarUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                     <span className="text-zinc-500 font-medium">
                                        {(targetUser.fullName || targetUser.username || '?')[0].toUpperCase()}
                                    </span>
                                )}
                             </div>
                             <div>
                                 <h2 className="font-semibold text-zinc-900 dark:text-white">
                                     {targetUser.fullName || targetUser.username}
                                 </h2>
                                 <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                     New Conversation
                                 </span>
                             </div>
                         </div>
                         
                         <div className="flex-1 flex flex-col items-center justify-center p-8 bg-zinc-50/50 dark:bg-zinc-900/50">
                             <p className="text-zinc-500">This is the beginning of your conversation with <span className="font-semibold">{targetUser.fullName || targetUser.username}</span>.</p>
                         </div>

                         {/* Actual Input for Draft */}
                        <MessageInput conversationId="new" targetUserId={targetUser.id} />
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                        <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-950/30 dark:to-indigo-950/30 rounded-full flex items-center justify-center mb-6">
                            <MessageSquare className="w-10 h-10 text-blue-600" />
                        </div>
                        <h2 className="text-xl font-bold text-zinc-900 dark:text-white mb-2">
                            Your Messages
                        </h2>
                        <p className="text-zinc-500 dark:text-zinc-400 max-w-md">
                            Select a conversation from the sidebar, or start a new one.
                        </p>
                    </div>
                )}
            </div>


            <NewChatModal 
                isOpen={isNewChatOpen} 
                onClose={() => setIsNewChatOpen(false)} 
            />
        </div>
    );
}

// Helper function to format time
function formatTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (days === 1) {
        return 'Yesterday';
    } else if (days < 7) {
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
}

// Helper function to highlight search matches
function highlightMatch(text: string, query: string): React.ReactNode {
    if (!query.trim()) return text;

    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
            <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">{part}</mark>
        ) : part
    );
}

