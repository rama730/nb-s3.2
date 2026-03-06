'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Image from 'next/image';
import { useChatStore } from '@/stores/chatStore';
import { useAuth } from '@/lib/hooks/use-auth';
import { MessageThread } from '@/components/chat/MessageThread';
import { MessageInput } from '@/components/chat/MessageInput';
import {
    searchMessages,
    setConversationArchived,
    setConversationMuted,
    type MessageWithSender,
    type ConversationWithDetails
} from '@/app/actions/messaging';
import { MessageSquare, Search, X, Loader2, PenSquare, Archive, BellOff, Bell, MoreVertical } from 'lucide-react';
import { useDebounce } from '@/hooks/hub/useDebounce';
import { NewChatModal } from './NewChatModal';
import { useTargetUser } from '@/hooks/useMessagesData';
import { ConversationList } from './ConversationList';
import { toast } from 'sonner';

import { ApplicationList } from './ApplicationList';
import { ProjectGroupList } from './ProjectGroupList';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ============================================================================
// MESSAGES CLIENT
// ============================================================================

interface MessagesClientProps {
    targetUserId?: string | null;  // Changed from full object to ID
    initialConversationId?: string | null;
}

export default function MessagesClient({ targetUserId, initialConversationId }: MessagesClientProps) {
    const { user, isLoading: authLoading } = useAuth();
    const userId = user?.id ?? null;
    
    // Resolve draft target profile when deep-linking with userId
    const { data: fetchedTargetUser } = useTargetUser(targetUserId || null);

    const activeConversationId = useChatStore(state => state.activeConversationId);
    const conversations = useChatStore(state => state.conversations);
    const messagesByConversation = useChatStore(state => state.messagesByConversation);
    const openConversation = useChatStore(state => state.openConversation);
    const upsertConversation = useChatStore(state => state.upsertConversation);
    const initializeChat = useChatStore(state => state.initialize);
    const chatInitialized = useChatStore(state => state.isInitialized);
    const conversationsLoading = useChatStore(state => state.conversationsLoading);
    const refreshConversations = useChatStore(state => state.refreshConversations);
    const bootstrapRefreshKeyRef = useRef<string | null>(null);

    // Target User Resolution
    const targetUser = fetchedTargetUser;

    // Draft State
    const [isNewChatOpen, setIsNewChatOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'chats' | 'applications' | 'projects'>('chats');
    
    // Check if we need to set up a draft conversation
    const existingConversationWithTarget = useMemo(() => {
        if (!targetUser) return null;
        return conversations.find(c => c.participants.some(p => p.id === targetUser.id));
    }, [conversations, targetUser]);

    // Handle Target User Navigation
    useEffect(() => {
        if (authLoading || !userId || chatInitialized) return;
        void initializeChat();
    }, [authLoading, userId, chatInitialized, initializeChat]);

    useEffect(() => {
        if (authLoading || !userId) return;
        if (!chatInitialized) return;
        if (conversationsLoading) return;
        if (conversations.length > 0) return;

        if (bootstrapRefreshKeyRef.current === userId) return;
        bootstrapRefreshKeyRef.current = userId;
        void refreshConversations();
    }, [
        authLoading,
        chatInitialized,
        conversations.length,
        conversationsLoading,
        refreshConversations,
        userId,
    ]);

    useEffect(() => {
        if (initialConversationId) return;
        if (targetUser) {
            if (existingConversationWithTarget) {
                if (activeConversationId !== existingConversationWithTarget.id) {
                    openConversation(existingConversationWithTarget.id);
                }
            }
        }
    }, [targetUser, existingConversationWithTarget, activeConversationId, openConversation, initialConversationId]);

    useEffect(() => {
        if (!initialConversationId) return;
        const exists = conversations.some((conv) => conv.id === initialConversationId);
        if (!exists) return;
        if (activeConversationId === initialConversationId) return;
        openConversation(initialConversationId);
    }, [initialConversationId, conversations, activeConversationId, openConversation]);

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
    const [conversationActionLoading, setConversationActionLoading] = useState(false);

    const debouncedSearch = useDebounce(searchQuery, 300);

    // Initialize store with data from hook
    // This replaces the old separate effects
    
    // Full-text search effect
    useEffect(() => {
        let cancelled = false;

        async function performSearch() {
            const query = debouncedSearch.trim();

            if (!query) {
                setIsSearching(false);
                setShowSearchResults(false);
                setSearchResults([]);
                return;
            }
            
            setIsSearching(true);
            setShowSearchResults(true);
            
            try {
                const result = await searchMessages(query);
                if (cancelled) return;
                if (result.success && result.results) {
                    setSearchResults(result.results);
                } else {
                    setSearchResults([]);
                }
            } catch (error) {
                if (cancelled) return;
                console.error('Search failed:', error);
                setSearchResults([]);
            } finally {
                if (cancelled) return;
                setIsSearching(false);
            }
        }

        performSearch();

        return () => {
            cancelled = true;
        };
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

    const handleToggleArchiveConversation = useCallback(async () => {
        if (!activeConversation) return;
        setConversationActionLoading(true);
        try {
            const nextArchived = activeConversation.lifecycleState !== 'archived';
            const result = await setConversationArchived(activeConversation.id, nextArchived);
            if (!result.success) {
                toast.error(result.error || 'Failed to update conversation');
                return;
            }
            await useChatStore.getState().refreshConversations();
            if (nextArchived) {
                useChatStore.getState().closeConversation();
            } else {
                await openConversation(activeConversation.id);
            }
        } finally {
            setConversationActionLoading(false);
        }
    }, [activeConversation, openConversation]);

    const handleToggleMuteConversation = useCallback(async () => {
        if (!activeConversation) return;
        setConversationActionLoading(true);
        try {
            const result = await setConversationMuted(activeConversation.id, !activeConversation.muted);
            if (!result.success) {
                toast.error(result.error || 'Failed to update mute state');
                return;
            }
            await useChatStore.getState().refreshConversations();
            await openConversation(activeConversation.id);
        } finally {
            setConversationActionLoading(false);
        }
    }, [activeConversation, openConversation]);

    // Determine what to show in the main pane
    // 1. Loading
    // 2. Draft (Target User + No Existing)
    // 3. Active Conversation
    // 4. Empty State

    // Helper for participant
    const otherParticipant = activeConversation?.participants[0];

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

    const isDraftMode = !initialConversationId && !!targetUser && !existingConversationWithTarget;

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
                            data-testid="messages-tab-chats"
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
                            data-testid="messages-tab-applications"
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
                            data-testid="messages-tab-projects"
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
                                        setIsSearching(false);
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
                <div className="flex-1 min-h-0 overflow-hidden">
                    {activeTab === 'applications' ? (
                        <div className="h-full overflow-y-auto custom-scrollbar">
                            <ApplicationList />
                        </div>
                    ) : activeTab === 'projects' ? (
                        <div className="h-full min-h-0 overflow-hidden">
                            <ProjectGroupList />
                        </div>
                    ) : showSearchResults ? (
                        isSearching ? (
                            <div className="h-full flex items-center justify-center p-8">
                                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                            </div>
                        ) : searchResults.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                                <Search className="w-12 h-12 text-zinc-300 mb-4" />
                                <p className="text-sm text-zinc-500">No messages found</p>
                            </div>
                        ) : (
                            <div className="h-full overflow-y-auto custom-scrollbar">
                                <div className="space-y-1">
                                    {searchResults.map((item) => {
                                        const { message, conversationId } = item;
                                        // Use local or hydrated conversation
                                        const conv = conversations.find(c => c.id === conversationId) || item.conversation;
                                        const participant = conv?.participants.find(p => p.id !== user?.id) || conv?.participants[0];

                                        return (
                                            <button
                                                key={message.id}
                                                onClick={() => handleSearchResultClick(conversationId, item.conversation)}
                                                className="w-full flex flex-col gap-1 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-left transition-colors"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center overflow-hidden">
                                                        {participant?.avatarUrl ? (
                                                            <Image
                                                                src={participant.avatarUrl}
                                                                alt=""
                                                                width={24}
                                                                height={24}
                                                                unoptimized
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
                            </div>
                        )
                    ) : (
                        <div className="h-full min-h-0 overflow-hidden">
                            {isDraftMode && targetUser && (
                                <div className="w-full flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-950/30 border-l-2 border-blue-600 border-b border-zinc-100 dark:border-zinc-800">
                                    <div className="relative flex-shrink-0">
                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center overflow-hidden">
                                            {targetUser.avatarUrl ? (
                                                <Image src={targetUser.avatarUrl} alt="" width={48} height={48} unoptimized className="w-full h-full object-cover" />
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
                            <ConversationList
                                hideSearch
                                searchQuery={searchQuery}
                                activeConversationId={isDraftMode ? null : activeConversationId}
                                onConversationSelect={(conversationId) => openConversation(conversationId)}
                            />
                        </div>
                    )}
                </div>

            </div>

            {/* Main Content - Message Thread */}
            <div className="flex-1 flex flex-col">
                {activeConversationId && otherParticipant ? (
                    // Logic already handled for existing chat
                     <>
                        {/* Conversation Header */}
                        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center overflow-hidden">
                                    {otherParticipant.avatarUrl ? (
                                        <Image
                                            src={otherParticipant.avatarUrl}
                                            alt={otherParticipant.fullName || ''}
                                            width={40}
                                            height={40}
                                            unoptimized
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

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className="p-2 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                        disabled={conversationActionLoading}
                                        aria-label="Conversation actions"
                                    >
                                        <MoreVertical className="w-4 h-4" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                        onClick={handleToggleMuteConversation}
                                        disabled={conversationActionLoading}
                                    >
                                        {activeConversation?.muted ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                                        {activeConversation?.muted ? 'Unmute conversation' : 'Mute conversation'}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={handleToggleArchiveConversation}
                                        disabled={conversationActionLoading}
                                    >
                                        <Archive className="w-4 h-4" />
                                        {activeConversation?.lifecycleState === 'archived' ? 'Unarchive conversation' : 'Archive conversation'}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
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
                                    <Image src={targetUser.avatarUrl} alt="" width={40} height={40} unoptimized className="w-full h-full object-cover" />
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
