import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    getConversations,
    getMessages,
    sendMessage as sendMessageAction,
    markConversationAsRead,
    getOrCreateDMConversation,
    getUnreadCount,
    type ConversationWithDetails,
    type MessageWithSender,
} from '@/app/actions/messaging';
import { checkConnectionStatus, sendConnectionRequest } from '@/app/actions/connections';

// ============================================================================
// TYPES
// ============================================================================



interface MessageCache {
    messages: MessageWithSender[];
    hasMore: boolean;
    loading: boolean;
    cursor: string | null;
}

interface ChatState {
    // Connection state
    isConnected: boolean;
    connectionError: string | null;

    // Conversations
    conversations: ConversationWithDetails[];
    conversationsLoading: boolean;
    conversationsError: string | null;

    // Active conversation
    activeConversationId: string | null;
    activeConnectionStatus: 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'blocked' | 'open' | 'loading' | null;
    isIncomingConnectionRequest: boolean;
    isPendingSent: boolean;

    // Messages cache (by conversation)
    messagesByConversation: Record<string, MessageCache>;

    // Drafts (persists across popup/page)
    draftsByConversation: Record<string, string>;

    // Typing indicators


    // Unread counts
    unreadCounts: Record<string, number>;
    totalUnread: number;

    // Profile cache (to avoid fetching on every message)
    profileCache: Record<string, {
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
    }>;

    // Popup UI state
    isPopupOpen: boolean;
    isPopupMinimized: boolean;

    // State
    isInitialized: boolean;

    // Actions
    initialize: () => Promise<void>;
    refreshConversations: () => Promise<void>;
    openConversation: (conversationId: string) => Promise<void>;
    closeConversation: () => void;
    openPopup: () => void;
    closePopup: () => void;
    minimizePopup: () => void;
    maximizePopup: () => void;
    startConversationWithUser: (userId: string) => Promise<string | null>;
    sendMessage: (conversationId: string, content: string) => Promise<boolean>;
    loadMoreMessages: (conversationId: string) => Promise<void>;
    setDraft: (conversationId: string, text: string) => void;
    markAsRead: (conversationId: string) => Promise<void>;
    setConnected: (connected: boolean, error?: string) => void;
    setConversations: (conversations: ConversationWithDetails[]) => void;

    // Internal (called by realtime subscription)
    _handleNewMessage: (rawMessage: any) => void;

    _updateUnreadCount: () => Promise<void>;
    // Connection Actions
    checkActiveConnectionStatus: () => Promise<void>;
    sendConnectionRequest: () => Promise<boolean>;
}



// ============================================================================
// STORE
// ============================================================================

export const useChatStore = create<ChatState>()(
    persist(
        (set, get) => ({
            // Initial state
            isConnected: false,
            connectionError: null,
            conversations: [],
            conversationsLoading: false,
            conversationsError: null,
            activeConversationId: null,
            activeConnectionStatus: null,
            isIncomingConnectionRequest: false,
            isPendingSent: false,
            messagesByConversation: {},
            draftsByConversation: {},

            unreadCounts: {},
            totalUnread: 0,
            profileCache: {},
            isPopupOpen: false,
            isPopupMinimized: false,
            isInitialized: false,

            // ================================================================
            // INITIALIZE
            // ================================================================
            initialize: async () => {
                const state = get();
                if (state.conversationsLoading || state.isInitialized) return;

                set({ conversationsLoading: true, conversationsError: null });

                try {
                    const result = await getConversations();

                    if (result.success && result.conversations) {
                        // Build unread counts map
                        const unreadCounts: Record<string, number> = {};
                        let totalUnread = 0;

                        for (const conv of result.conversations) {
                            unreadCounts[conv.id] = conv.unreadCount;
                            totalUnread += conv.unreadCount;
                        }

                        set({
                            conversations: result.conversations,
                            unreadCounts,
                            totalUnread,
                            conversationsLoading: false,
                            isInitialized: true,
                        });
                    } else {
                        set({
                            conversationsError: result.error || 'Failed to load conversations',
                            conversationsLoading: false,
                            isInitialized: true, // Mark initialized even on error to stop loop
                        });
                    }
                } catch (error) {
                    console.error('Error initializing chat:', error);
                    set({
                        conversationsError: 'Failed to initialize chat',
                        conversationsLoading: false,
                        isInitialized: true,
                    });
                }
            },

            // ================================================================
            // REFRESH CONVERSATIONS
            // ================================================================
            refreshConversations: async () => {
                try {
                    const result = await getConversations();

                    if (result.success && result.conversations) {
                        const unreadCounts: Record<string, number> = {};
                        let totalUnread = 0;

                        for (const conv of result.conversations) {
                            unreadCounts[conv.id] = conv.unreadCount;
                            totalUnread += conv.unreadCount;
                        }

                        set({
                            conversations: result.conversations,
                            unreadCounts,
                            totalUnread,
                        });
                    }
                } catch (error) {
                    console.error('Error refreshing conversations:', error);
                }
            },

            // ================================================================
            // OPEN CONVERSATION
            // ================================================================
            openConversation: async (conversationId: string) => {
                const state = get();

                set({
                    activeConversationId: conversationId,
                    isPopupOpen: true,
                    isPopupMinimized: false,
                });

                // Load messages if not already cached
                if (!state.messagesByConversation[conversationId]) {
                    set(prev => ({
                        messagesByConversation: {
                            ...prev.messagesByConversation,
                            [conversationId]: {
                                messages: [],
                                hasMore: true,
                                loading: true,
                                cursor: null,
                            },
                        },
                    }));

                    try {
                        const result = await getMessages(conversationId);

                        if (result.success && result.messages) {
                            set(prev => ({
                                messagesByConversation: {
                                    ...prev.messagesByConversation,
                                    [conversationId]: {
                                        messages: result.messages!,
                                        hasMore: result.hasMore || false,
                                        loading: false,
                                        cursor: result.nextCursor || null,
                                    },
                                },
                            }));
                        } else {
                            set(prev => ({
                                messagesByConversation: {
                                    ...prev.messagesByConversation,
                                    [conversationId]: {
                                        messages: [],
                                        hasMore: false,
                                        loading: false,
                                        cursor: null,
                                    },
                                },
                            }));
                        }
                    } catch (error) {
                        console.error('Error loading messages:', error);
                        set(prev => ({
                            messagesByConversation: {
                                ...prev.messagesByConversation,
                                [conversationId]: {
                                    messages: [],
                                    hasMore: false,
                                    loading: false,
                                    cursor: null,
                                },
                            },
                        }));
                    }
                }

                // Mark as read
                await get().markAsRead(conversationId);

                // Check connection status if DM
                const conversation = state.conversations.find(c => c.id === conversationId);
                if (conversation && conversation.type === 'dm') {
                    get().checkActiveConnectionStatus();
                } else {
                    set({ activeConnectionStatus: 'connected' }); // Groups always allowed
                }
            },

            // ================================================================
            // CLOSE CONVERSATION
            // ================================================================
            closeConversation: () => {
                set({ activeConversationId: null, activeConnectionStatus: null });
            },

            // ================================================================
            // POPUP CONTROLS
            // ================================================================
            openPopup: () => {
                set({ isPopupOpen: true, isPopupMinimized: false });
            },

            closePopup: () => {
                set({ isPopupOpen: false, activeConversationId: null, activeConnectionStatus: null });
            },

            minimizePopup: () => {
                set({ isPopupMinimized: true });
            },

            maximizePopup: () => {
                set({ isPopupMinimized: false });
            },

            // ================================================================
            // START CONVERSATION WITH USER
            // ================================================================
            startConversationWithUser: async (userId: string) => {
                try {
                    const result = await getOrCreateDMConversation(userId);

                    if (result.success && result.conversationId) {
                        // Refresh conversations to include new one
                        await get().refreshConversations();

                        // Open the conversation
                        await get().openConversation(result.conversationId);

                        return result.conversationId;
                    }

                    return null;
                } catch (error) {
                    console.error('Error starting conversation:', error);
                    return null;
                }
            },

            // ================================================================
            // SEND MESSAGE
            // ================================================================
            sendMessage: async (conversationId: string, content: string) => {
                if (!content.trim()) return false;

                const state = get();
                const tempId = `temp-${Date.now()}`;

                // Optimistic update - add message immediately
                const optimisticMessage: MessageWithSender = {
                    id: tempId,
                    conversationId,
                    senderId: null, // Will be filled by server
                    content: content.trim(),
                    type: 'text',
                    metadata: {},
                    createdAt: new Date(),
                    editedAt: null,
                    deletedAt: null,
                    sender: null,
                    attachments: [],
                };

                set(prev => ({
                    messagesByConversation: {
                        ...prev.messagesByConversation,
                        [conversationId]: {
                            ...prev.messagesByConversation[conversationId],
                            messages: [
                                ...(prev.messagesByConversation[conversationId]?.messages || []),
                                optimisticMessage,
                            ],
                        },
                    },
                    // Clear draft
                    draftsByConversation: {
                        ...prev.draftsByConversation,
                        [conversationId]: '',
                    },
                }));

                try {
                    const result = await sendMessageAction(conversationId, content.trim());

                    if (result.success && result.message) {
                        // Replace optimistic message with real one
                        set(prev => {
                            const currentMessages = prev.messagesByConversation[conversationId]?.messages || [];

                            // Check if the real message was already added via realtime (race condition)
                            const alreadyExists = currentMessages.some(m => m.id === result.message!.id);

                            if (alreadyExists) {
                                // If it already exists, just remove the optimistic temp message
                                return {
                                    messagesByConversation: {
                                        ...prev.messagesByConversation,
                                        [conversationId]: {
                                            ...prev.messagesByConversation[conversationId],
                                            messages: currentMessages.filter(m => m.id !== tempId),
                                        },
                                    },
                                };
                            }

                            // Otherwise, swap temp for real
                            return {
                                messagesByConversation: {
                                    ...prev.messagesByConversation,
                                    [conversationId]: {
                                        ...prev.messagesByConversation[conversationId],
                                        messages: currentMessages.map(
                                            m => m.id === tempId ? result.message! : m
                                        ),
                                    },
                                },
                            };
                        });

                        // Refresh conversations to update last message
                        get().refreshConversations();

                        return true;
                    } else {
                        // Remove failed message
                        set(prev => ({
                            messagesByConversation: {
                                ...prev.messagesByConversation,
                                [conversationId]: {
                                    ...prev.messagesByConversation[conversationId],
                                    messages: prev.messagesByConversation[conversationId]?.messages.filter(
                                        m => m.id !== tempId
                                    ) || [],
                                },
                            },
                        }));
                        console.error('Failed to send message:', result.error);
                        return false;
                    }
                } catch (error) {
                    // Remove failed message
                    set(prev => ({
                        messagesByConversation: {
                            ...prev.messagesByConversation,
                            [conversationId]: {
                                ...prev.messagesByConversation[conversationId],
                                messages: prev.messagesByConversation[conversationId]?.messages.filter(
                                    m => m.id !== tempId
                                ) || [],
                            },
                        },
                    }));
                    console.error('Error sending message:', error);
                    return false;
                }
            },

            // ================================================================
            // LOAD MORE MESSAGES
            // ================================================================
            loadMoreMessages: async (conversationId: string) => {
                const state = get();
                const cache = state.messagesByConversation[conversationId];

                if (!cache || cache.loading || !cache.hasMore) return;

                set(prev => ({
                    messagesByConversation: {
                        ...prev.messagesByConversation,
                        [conversationId]: {
                            ...prev.messagesByConversation[conversationId],
                            loading: true,
                        },
                    },
                }));

                try {
                    const result = await getMessages(conversationId, cache.cursor || undefined);

                    if (result.success && result.messages) {
                        set(prev => ({
                            messagesByConversation: {
                                ...prev.messagesByConversation,
                                [conversationId]: {
                                    messages: [...result.messages!, ...prev.messagesByConversation[conversationId].messages],
                                    hasMore: result.hasMore || false,
                                    loading: false,
                                    cursor: result.nextCursor || null,
                                },
                            },
                        }));
                    } else {
                        set(prev => ({
                            messagesByConversation: {
                                ...prev.messagesByConversation,
                                [conversationId]: {
                                    ...prev.messagesByConversation[conversationId],
                                    loading: false,
                                },
                            },
                        }));
                    }
                } catch (error) {
                    console.error('Error loading more messages:', error);
                    set(prev => ({
                        messagesByConversation: {
                            ...prev.messagesByConversation,
                            [conversationId]: {
                                ...prev.messagesByConversation[conversationId],
                                loading: false,
                            },
                        },
                    }));
                }
            },

            // ================================================================
            // SET DRAFT
            // ================================================================
            setDraft: (conversationId: string, text: string) => {
                set(prev => ({
                    draftsByConversation: {
                        ...prev.draftsByConversation,
                        [conversationId]: text,
                    },
                }));
            },

            // ================================================================
            // MARK AS READ
            // ================================================================
            markAsRead: async (conversationId: string) => {
                const state = get();
                const previousUnread = state.unreadCounts[conversationId] || 0;

                if (previousUnread === 0) return;

                // Optimistic update
                set(prev => ({
                    unreadCounts: {
                        ...prev.unreadCounts,
                        [conversationId]: 0,
                    },
                    totalUnread: Math.max(0, prev.totalUnread - previousUnread),
                }));

                try {
                    await markConversationAsRead(conversationId);
                } catch (error) {
                    console.error('Error marking as read:', error);
                    // Revert on error
                    set(prev => ({
                        unreadCounts: {
                            ...prev.unreadCounts,
                            [conversationId]: previousUnread,
                        },
                        totalUnread: prev.totalUnread + previousUnread,
                    }));
                }
            },

            // ================================================================
            // SET CONNECTED
            // ================================================================
            setConnected: (connected: boolean, error?: string) => {
                set({
                    isConnected: connected,
                    connectionError: error || null,
                });
            },

            // ================================================================
            // SET CONVERSATIONS (Hydration)
            // ================================================================
            setConversations: (conversations: ConversationWithDetails[]) => {
                const unreadCounts: Record<string, number> = {};
                let totalUnread = 0;

                for (const conv of conversations) {
                    unreadCounts[conv.id] = conv.unreadCount;
                    totalUnread += conv.unreadCount;
                }

                set({
                    conversations,
                    unreadCounts,
                    totalUnread,
                    conversationsLoading: false,
                });
            },

            // HANDLE NEW MESSAGE (from realtime) - OPTIMIZED
            // ================================================================
            _handleNewMessage: async (rawMessage: any) => {
                const state = get();

                // OPTIMIZED: Use cached profile or fetch only if missing
                let sender = null;
                if (rawMessage.sender_id) {
                    // Check cache first
                    if (state.profileCache[rawMessage.sender_id]) {
                        sender = state.profileCache[rawMessage.sender_id];
                    } else {
                        // Fetch from database only if not in cache
                        try {
                            const { createClient } = await import('@/lib/supabase/client');
                            const supabase = createClient();
                            const { data } = await supabase
                                .from('profiles')
                                .select('id, username, full_name, avatar_url')
                                .eq('id', rawMessage.sender_id)
                                .single();

                            if (data) {
                                sender = {
                                    id: data.id,
                                    username: data.username,
                                    fullName: data.full_name,
                                    avatarUrl: data.avatar_url,
                                };
                                // Cache the profile for future use
                                set(prev => ({
                                    profileCache: {
                                        ...prev.profileCache,
                                        [sender!.id]: sender!,
                                    },
                                }));
                            }
                        } catch (error) {
                            console.error('Error fetching profile:', error);
                            // Use placeholder if fetch fails
                            sender = {
                                id: rawMessage.sender_id,
                                username: null,
                                fullName: null,
                                avatarUrl: null,
                            };
                        }
                    }
                }

                // Build complete message object
                const completeMessage: MessageWithSender = {
                    id: rawMessage.id,
                    conversationId: rawMessage.conversation_id,
                    senderId: rawMessage.sender_id,
                    content: rawMessage.content,
                    type: rawMessage.type,
                    metadata: rawMessage.metadata || {},
                    createdAt: new Date(rawMessage.created_at),
                    editedAt: rawMessage.edited_at ? new Date(rawMessage.edited_at) : null,
                    deletedAt: rawMessage.deleted_at ? new Date(rawMessage.deleted_at) : null,
                    sender,
                    attachments: [], // Attachments would need separate fetch if needed
                };

                // Add to message cache if conversation is cached
                if (state.messagesByConversation[completeMessage.conversationId]) {
                    // Check if message already exists (avoid duplicates)
                    const exists = state.messagesByConversation[completeMessage.conversationId].messages.some(
                        m => m.id === completeMessage.id
                    );

                    if (!exists) {
                        set(prev => ({
                            messagesByConversation: {
                                ...prev.messagesByConversation,
                                [completeMessage.conversationId]: {
                                    ...prev.messagesByConversation[completeMessage.conversationId],
                                    messages: [
                                        ...prev.messagesByConversation[completeMessage.conversationId].messages,
                                        completeMessage,
                                    ],
                                },
                            },
                        }));
                    }
                }

                // Update unread count if not active conversation
                if (state.activeConversationId !== completeMessage.conversationId) {
                    set(prev => ({
                        unreadCounts: {
                            ...prev.unreadCounts,
                            [completeMessage.conversationId]: (prev.unreadCounts[completeMessage.conversationId] || 0) + 1,
                        },
                        totalUnread: prev.totalUnread + 1,
                    }));
                }

                // OPTIMIZED: Update conversation list locally instead of full refresh
                // This eliminates the heavy N+1 query cascade
                set(prev => {
                    const conversations = [...prev.conversations];
                    const convIndex = conversations.findIndex(c => c.id === completeMessage.conversationId);

                    if (convIndex !== -1) {
                        // Update existing conversation
                        const conv = conversations[convIndex];
                        conversations[convIndex] = {
                            ...conv,
                            updatedAt: completeMessage.createdAt,
                            lastMessage: {
                                id: completeMessage.id,
                                content: completeMessage.content,
                                senderId: completeMessage.senderId,
                                createdAt: completeMessage.createdAt,
                                type: completeMessage.type,
                            },
                        };
                        // Move to top (sort by updatedAt)
                        conversations.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
                    }
                    // Note: If conversation not in list, it will appear on next refresh
                    // This is acceptable as it's a rare edge case (e.g., new group added to user)

                    return { conversations };
                });
            },

            // ================================================================
            // UPDATE UNREAD COUNT
            // ================================================================
            _updateUnreadCount: async () => {
                try {
                    const result = await getUnreadCount();
                    if (result.success && typeof result.count === 'number') {
                        set({ totalUnread: result.count });
                    }
                } catch (error) {
                    console.error('Error updating unread count:', error);
                }
            },

            // ================================================================
            // CHECK ACTIVE CONNECTION STATUS
            // ================================================================
            checkActiveConnectionStatus: async () => {
                const state = get();
                // Need active conversation and it must be a DM
                const conversation = state.conversations.find(c => c.id === state.activeConversationId);
                if (!conversation || conversation.type !== 'dm') return;

                const otherUser = conversation.participants[0];
                if (!otherUser) return;

                set({ activeConnectionStatus: 'loading' });

                try {
                    const result = await checkConnectionStatus(otherUser.id);
                    if (result.success && result.status) {
                        set({
                            activeConnectionStatus: result.status,
                            isIncomingConnectionRequest: result.isIncomingRequest || false,
                            isPendingSent: result.isPendingSent || false
                        });
                    } else {
                        set({ activeConnectionStatus: 'none', isIncomingConnectionRequest: false, isPendingSent: false });
                    }
                } catch (error) {
                    console.error('Error checking connection status:', error);
                    set({ activeConnectionStatus: 'none', isIncomingConnectionRequest: false, isPendingSent: false });
                }
            },

            // ================================================================
            // SEND CONNECTION REQUEST
            // ================================================================
            sendConnectionRequest: async () => {
                const state = get();
                const conversation = state.conversations.find(c => c.id === state.activeConversationId);
                if (!conversation || conversation.type !== 'dm') return false;

                const otherUser = conversation.participants[0];
                if (!otherUser) return false;

                try {
                    const result = await sendConnectionRequest(otherUser.id);
                    if (result.success) {
                        set({ activeConnectionStatus: 'pending_sent' });
                        return true;
                    }
                } catch (error) {
                    console.error('Error sending connection request:', error);
                }
                return false;
            },
        }),
        {
            name: 'chat-storage',
            partialize: (state) => ({
                // OPTIMIZED: Only persist drafts (removed UI state to simplify hydration)
                draftsByConversation: state.draftsByConversation,
            }),
        }
    )
);

// ============================================================================
// SELECTORS
// ============================================================================

// Stable empty array reference to prevent infinite loops in selectors
const EMPTY_ARRAY: any[] = [];

export const selectActiveConversation = (state: ChatState) => {
    if (!state.activeConversationId) return null;
    return state.conversations.find(c => c.id === state.activeConversationId) || null;
};

export const selectActiveMessages = (state: ChatState) => {
    if (!state.activeConversationId) return EMPTY_ARRAY;
    return state.messagesByConversation[state.activeConversationId]?.messages || EMPTY_ARRAY;
};

export const selectActiveDraft = (state: ChatState) => {
    if (!state.activeConversationId) return '';
    return state.draftsByConversation[state.activeConversationId] || '';
};


