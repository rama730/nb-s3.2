import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    getConversations,
    getConversationById,
    getMessages,
    sendMessage as sendMessageAction,
    sendMessageWithAttachments,
    markConversationAsRead,
    getOrCreateDMConversation,
    getUnreadCount,
    getPinnedMessages,
    setMessagePinned,
    type ConversationWithDetails,
    type MessageWithSender,
    type UploadedAttachment,
} from '@/app/actions/messaging';
import { checkConnectionStatus, sendConnectionRequest } from '@/app/actions/connections';
import { getInboxApplicationsAction } from '@/app/actions/applications';
import { getProjectGroups, type ProjectGroupConversation } from '@/app/actions/messaging';
import { validateSingleOutboxKey, validateUniqueConversationIds } from '@/lib/chat/contracts';

// ============================================================================
// TYPES
// ============================================================================



interface MessageCache {
    messages: MessageWithSender[];
    hasMore: boolean;
    loading: boolean;
    cursor: string | null;
}

interface OutboxMessage {
    clientMessageId: string;
    conversationId: string;
    content: string;
    attachments: UploadedAttachment[];
    replyToMessageId?: string | null;
    createdAt: number;
    attempts: number;
    nextRetryAt: number;
    lastError?: string;
}

interface ReplyTargetDraft {
    id: string;
    content: string | null;
    senderId: string | null;
    senderName: string | null;
    type: MessageWithSender['type'];
}

interface SenderSnapshot {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
}

interface ProfileCacheEntry {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
}

type MessageDeliveryState = 'sending' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

function withDeliveryMetadata(
    metadata: Record<string, unknown> | null | undefined,
    state: MessageDeliveryState
): Record<string, unknown> {
    return {
        ...(metadata || {}),
        deliveryState: state,
    };
}

function toEpochMs(value: unknown): number {
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isNaN(ms) ? 0 : ms;
    }
    if (typeof value === 'string' || typeof value === 'number') {
        const parsed = new Date(value);
        const ms = parsed.getTime();
        return Number.isNaN(ms) ? 0 : ms;
    }
    return 0;
}

const PROFILE_CACHE_MAX_SIZE = 500;

function upsertProfileCacheEntry(
    cache: Record<string, ProfileCacheEntry>,
    profile: ProfileCacheEntry
): Record<string, ProfileCacheEntry> {
    if (cache[profile.id]) {
        return {
            ...cache,
            [profile.id]: profile,
        };
    }

    const next = { ...cache };
    const keys = Object.keys(next);
    if (keys.length >= PROFILE_CACHE_MAX_SIZE) {
        const oldestKey = keys[0];
        if (oldestKey) delete next[oldestKey];
    }
    next[profile.id] = profile;
    return next;
}

export interface InboxApplication {
    id: string;
    type: 'incoming' | 'outgoing';
    projectId: string;
    projectTitle: string;
    projectSlug?: string;
    roleTitle: string;
    conversationId?: string | null;
    status: 'pending' | 'accepted' | 'rejected';
    lifecycleStatus?: 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'role_filled';
    decisionReason?: string | null;
    decisionAt?: string | null;
    createdAt: Date;
    displayUser: {
        id?: string;
        username?: string | null;
        fullName?: string | null;
        avatarUrl?: string | null;
        type: 'applicant' | 'creator';
    };
}

interface ChatState {
    // Connection state
    isConnected: boolean;
    connectionError: string | null;

    // Conversations
    conversations: ConversationWithDetails[];
    conversationsLoading: boolean;
    conversationsError: string | null;
    hasMoreConversations: boolean;
    conversationsCursor: string | null;

    // Active conversation
    activeConversationId: string | null;
    activeConnectionStatus: 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'blocked' | 'open' | 'loading' | null;
    isIncomingConnectionRequest: boolean;
    isPendingSent: boolean;
    hasActiveApplication: boolean;
    isApplicant: boolean; // New flag
    isCreator: boolean; // New flag
    activeApplicationId: string | null; // New field
    activeApplicationStatus: 'pending' | 'accepted' | 'rejected' | null; // New field
    activeProjectId: string | null; // New field for button link

    // Messages cache (by conversation)
    messagesByConversation: Record<string, MessageCache>;
    pinnedMessagesByConversation: Record<string, MessageWithSender[]>;

    // Drafts (persists across popup/page)
    draftsByConversation: Record<string, string>;
    replyTargetByConversation: Record<string, ReplyTargetDraft | null>;
    outboxByConversation: Record<string, OutboxMessage[]>;
    outboxFlushing: boolean;

    // Applications Cache (Inbox Zero)
    applications: InboxApplication[];
    applicationsLoading: boolean;
    applicationsError: string | null;
    hasMoreApplications: boolean;
    applicationsOffset: number;
    applicationsLastFetchedAt: number;

    // Project Groups Cache
    projectGroups: ProjectGroupConversation[];
    projectGroupsLoading: boolean;
    projectGroupsError: string | null;
    hasMoreProjectGroups: boolean;
    projectGroupsOffset: number;

    // Typing indicators


    // Unread counts
    unreadCounts: Record<string, number>;
    totalUnread: number;

    // Profile cache (to avoid fetching on every message)
    profileCache: Record<string, ProfileCacheEntry>;

    // Popup UI state
    isPopupOpen: boolean;
    isPopupMinimized: boolean;

    // State
    isInitialized: boolean;

    // Actions
    // Actions
    initialize: () => Promise<void>;
    refreshConversations: () => Promise<void>;
    loadMoreConversations: () => Promise<void>;
    openConversation: (conversationId: string) => Promise<void>;
    closeConversation: () => void;
    openPopup: () => void;
    closePopup: () => void;
    minimizePopup: () => void;
    maximizePopup: () => void;
    startConversationWithUser: (userId: string) => Promise<string | null>;
    sendMessage: (
        conversationId: string,
        content: string,
        options?: {
            attachments?: UploadedAttachment[];
            clientMessageId?: string;
            replyToMessageId?: string | null;
            senderSnapshot?: SenderSnapshot;
        }
    ) => Promise<{ ok: boolean; queued?: boolean }>;
    flushOutbox: () => Promise<void>;
    loadMoreMessages: (conversationId: string) => Promise<void>;
    setDraft: (conversationId: string, text: string) => void;
    setReplyTarget: (conversationId: string, target: ReplyTargetDraft | null) => void;
    clearReplyTarget: (conversationId: string) => void;
    markAsRead: (conversationId: string) => Promise<void>;
    setConnected: (connected: boolean, error?: string) => void;
    setConversations: (conversations: ConversationWithDetails[]) => void;
    // Pure Optimization: Allow hydrating individual conversations from Search
    upsertConversation: (conversation: ConversationWithDetails) => void;

    // Internal (called by realtime subscription)
    _handleNewMessage: (rawMessage: any, viewerId?: string | null) => void;

    _updateUnreadCount: () => Promise<void>;
    // Connection Actions
    checkActiveConnectionStatus: () => Promise<void>;
    refreshMessages: (conversationId: string) => Promise<void>;
    fetchPinnedMessages: (conversationId: string) => Promise<void>;
    pinMessage: (messageId: string, conversationId: string, pinned: boolean) => Promise<boolean>;
    sendConnectionRequest: () => Promise<boolean>;
    _handleMessageUpdate: (rawMessage: any) => void;
    setPartialStatus: (status: 'pending' | 'accepted' | 'rejected') => void;
    fetchApplications: (refresh?: boolean) => Promise<void>;
    loadMoreApplications: () => Promise<void>;
    fetchProjectGroups: (refresh?: boolean) => Promise<void>;
    loadMoreProjectGroups: () => Promise<void>;
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
            hasMoreConversations: false,
            conversationsCursor: null,
            activeConversationId: null,
            activeConnectionStatus: null,
            isIncomingConnectionRequest: false,
            isPendingSent: false,
            hasActiveApplication: false,
            isApplicant: false,
            isCreator: false,
            activeApplicationId: null,
            activeApplicationStatus: null,
            activeProjectId: null,
            messagesByConversation: {},
            pinnedMessagesByConversation: {},
            draftsByConversation: {},
            replyTargetByConversation: {},
            outboxByConversation: {},
            outboxFlushing: false,

            // Applications
            applications: [],
            applicationsLoading: false,
            applicationsError: null,
            hasMoreApplications: false,
            applicationsOffset: 0,
            applicationsLastFetchedAt: 0,

            // Project Groups
            projectGroups: [],
            projectGroupsLoading: false,
            projectGroupsError: null,
            hasMoreProjectGroups: false,
            projectGroupsOffset: 0,

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
                    // Initial load: Page 1 (Limit 20)
                    const result = await getConversations(20, undefined);

                    if (result.success && result.conversations) {
                        validateUniqueConversationIds(
                            result.conversations.map((conversation) => conversation.id),
                            'initialize'
                        );
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
                            hasMoreConversations: result.hasMore || false,
                            conversationsCursor: result.nextCursor || null,
                        });
                        void get().flushOutbox();
                    } else {
                        set({
                            conversationsError: result.error || 'Failed to load conversations',
                            conversationsLoading: false,
                            isInitialized: true,
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
            // LOAD MORE CONVERSATIONS
            // ================================================================
            loadMoreConversations: async () => {
                const state = get();
                if (state.conversationsLoading || !state.hasMoreConversations) return;

                set({ conversationsLoading: true });

                try {
                    const result = await getConversations(20, state.conversationsCursor || undefined);

                    if (result.success && result.conversations) {
                        const newConversations = result.conversations;

                        set(prev => {
                            const existingIds = new Set(prev.conversations.map((conv) => conv.id));
                            const dedupedConversations = newConversations.filter((conv) => !existingIds.has(conv.id));
                            const mergedConversations = [...prev.conversations, ...dedupedConversations];
                            validateUniqueConversationIds(
                                mergedConversations.map((conversation) => conversation.id),
                                'loadMoreConversations'
                            );

                            const unreadCounts = { ...prev.unreadCounts };
                            for (const conv of dedupedConversations) {
                                unreadCounts[conv.id] = conv.unreadCount;
                            }
                            const totalUnread = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);

                            const nextCursor = result.nextCursor || null;
                            const hasMoreConversations = !!result.hasMore && nextCursor !== prev.conversationsCursor;

                            return {
                                conversations: mergedConversations,
                                unreadCounts,
                                totalUnread,
                                conversationsLoading: false,
                                hasMoreConversations,
                                conversationsCursor: nextCursor,
                            };
                        });
                    } else {
                        set({ conversationsLoading: false });
                    }
                } catch (error) {
                    console.error('Error loading more conversations:', error);
                    set({ conversationsLoading: false });
                }
            },

            // ================================================================
            // REFRESH CONVERSATIONS
            // ================================================================
            refreshConversations: async () => {
                try {
                    // Reset to Page 1
                    const result = await getConversations(20, undefined);

                    if (result.success && result.conversations) {
                        validateUniqueConversationIds(
                            result.conversations.map((conversation) => conversation.id),
                            'refreshConversations'
                        );
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
                            hasMoreConversations: result.hasMore || false,
                            conversationsCursor: result.nextCursor || null,
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

                void get().fetchPinnedMessages(conversationId);

                // Mark as read
                await get().markAsRead(conversationId);

                // Check connection status if DM, skip for groups and project_groups
                const conversation = state.conversations.find(c => c.id === conversationId);
                const projectGroup = state.projectGroups.find(g => g.id === conversationId);

                if (projectGroup) {
                    // Project groups are always allowed (membership enforced at DB level)
                    set({ activeConnectionStatus: 'connected' });
                } else if (conversation && conversation.type === 'dm') {
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
                    const state = get();
                    const existingConversation = state.conversations.find(
                        (conversation) =>
                            conversation.type === 'dm' &&
                            conversation.participants.some((participant) => participant.id === userId)
                    );

                    if (existingConversation) {
                        await get().openConversation(existingConversation.id);
                        return existingConversation.id;
                    }

                    const result = await getOrCreateDMConversation(userId);

                    if (result.success && result.conversationId) {
                        const hydrated = await getConversationById(result.conversationId);
                        if (hydrated.success && hydrated.conversation) {
                            get().upsertConversation(hydrated.conversation);
                        } else {
                            // Fallback if hydration query fails for any reason.
                            await get().refreshConversations();
                        }

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
            sendMessage: async (conversationId: string, content: string, options) => {
                const state = get();
                const normalized = content.trim();
                const attachments = options?.attachments || [];
                const senderSnapshot = options?.senderSnapshot || null;
	                const replyTarget =
	                    options?.replyToMessageId
	                        ? (state.messagesByConversation[conversationId]?.messages || []).find(
	                            (message) => message.id === options.replyToMessageId
	                        ) || null
	                        : state.replyTargetByConversation[conversationId] || null;
	                const replyToMessageId = options?.replyToMessageId || replyTarget?.id || null;
	                const replySenderName =
	                    replyTarget && 'senderName' in replyTarget
	                        ? (replyTarget.senderName || null)
	                        : (replyTarget?.sender?.fullName || replyTarget?.sender?.username || null);
	                if (!normalized && attachments.length === 0) return { ok: false };

                const generatedClientId =
                    options?.clientMessageId ||
                    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
                        ? crypto.randomUUID()
                        : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

                const tempId = `temp-${generatedClientId}`;
                const queueMessage = (errorText: string) => {
                    set(prev => {
                        const existingQueue = prev.outboxByConversation[conversationId] || [];
                        const alreadyQueued = existingQueue.some(
                            item => item.clientMessageId === generatedClientId
                        );

                        const nextOutbox = alreadyQueued
                            ? existingQueue.map(item => item.clientMessageId === generatedClientId
                                ? { ...item, lastError: errorText }
                                : item
                            )
                            : [
                                ...existingQueue,
                                {
                                    clientMessageId: generatedClientId,
                                    conversationId,
                                    content: normalized,
                                    attachments,
                                    replyToMessageId,
                                    createdAt: Date.now(),
                                    attempts: 0,
                                    nextRetryAt: Date.now(),
                                    lastError: errorText,
                                },
                            ];

                        const nextMessages = (prev.messagesByConversation[conversationId]?.messages || []).map((message) => {
                            if (
                                message.id === tempId ||
                                message.clientMessageId === generatedClientId
                            ) {
                                return {
                                    ...message,
                                    metadata: withDeliveryMetadata({
                                        ...(message.metadata || {}),
                                        queued: true,
                                        clientMessageId: generatedClientId,
                                    }, 'queued'),
                                };
                            }
                            return message;
                        });

                        const nextOutboxByConversation = {
                            ...prev.outboxByConversation,
                            [conversationId]: nextOutbox,
                        };
                        validateSingleOutboxKey(nextOutboxByConversation, 'sendMessage.queue');

                        return {
                            outboxByConversation: nextOutboxByConversation,
                            messagesByConversation: {
                                ...prev.messagesByConversation,
                                [conversationId]: {
                                    ...(prev.messagesByConversation[conversationId] || {
                                        messages: [],
                                        hasMore: true,
                                        loading: false,
                                        cursor: null,
                                    }),
                                    messages: nextMessages,
                                },
                            },
                        };
                    });
                };

                // Optimistic update
                const optimisticMessage: MessageWithSender = {
                    id: tempId,
                    conversationId,
                    senderId: senderSnapshot?.id || null,
                    clientMessageId: generatedClientId,
                    content: normalized || null,
                    type: attachments[0]?.type || 'text',
                    metadata: withDeliveryMetadata({
                        clientMessageId: generatedClientId,
                        queued: false,
                    }, 'sending'),
	                    replyTo: replyTarget
	                        ? {
	                            id: replyTarget.id,
	                            content: replyTarget.content || null,
	                            type: replyTarget.type || 'text',
	                            senderId: replyTarget.senderId || null,
	                            senderName: replySenderName,
	                            deletedAt: null,
	                        }
	                        : null,
                    createdAt: new Date(),
                    editedAt: null,
                    deletedAt: null,
                    sender: senderSnapshot
                        ? {
                            id: senderSnapshot.id,
                            username: senderSnapshot.username,
                            fullName: senderSnapshot.fullName,
                            avatarUrl: senderSnapshot.avatarUrl,
                        }
                        : null,
                    attachments: attachments.map((att) => ({
                        id: att.id,
                        type: att.type,
                        url: att.url,
                        filename: att.filename,
                        sizeBytes: att.sizeBytes,
                        mimeType: att.mimeType,
                        thumbnailUrl: att.thumbnailUrl,
                        width: att.width,
                        height: att.height,
                    })),
                };

                set(prev => ({
                    messagesByConversation: {
                        ...prev.messagesByConversation,
                        [conversationId]: {
                            ...(prev.messagesByConversation[conversationId] || {
                                messages: [],
                                hasMore: true,
                                loading: false,
                                cursor: null,
                            }),
                            messages: [
                                ...(prev.messagesByConversation[conversationId]?.messages || []).filter(
                                    message => message.clientMessageId !== generatedClientId
                                ),
                                optimisticMessage,
                            ],
                        },
                    },
                    draftsByConversation: {
                        ...prev.draftsByConversation,
                        [conversationId]: '',
                    },
                    replyTargetByConversation: {
                        ...prev.replyTargetByConversation,
                        [conversationId]: null,
                    },
                }));

                const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
                if (!isOnline) {
                    queueMessage('offline');
                    return { ok: true, queued: true };
                }

                try {
                    const result = attachments.length > 0
                        ? await sendMessageWithAttachments(conversationId, normalized, attachments, {
                            clientMessageId: generatedClientId,
                            replyToMessageId,
                        })
                        : await sendMessageAction(conversationId, normalized, 'text', undefined, {
                            clientMessageId: generatedClientId,
                            replyToMessageId,
                        });

                    if (result.success && result.message) {
                        set(prev => {
                            const currentMessages = prev.messagesByConversation[conversationId]?.messages || [];
                            const alreadyExists = currentMessages.some(message => message.id === result.message!.id);
                            const filteredQueue = (prev.outboxByConversation[conversationId] || []).filter(
                                item => item.clientMessageId !== generatedClientId
                            );

                            const nextMessages = alreadyExists
                                ? currentMessages.filter(
                                    message =>
                                        message.id !== tempId &&
                                        message.clientMessageId !== generatedClientId
                                )
                                : currentMessages.map((message) => {
                                    if (
                                        message.id === tempId ||
                                        message.clientMessageId === generatedClientId
                                    ) {
                                        return result.message!;
                                    }
                                    return message;
                                });

                            const nextOutboxByConversation = {
                                ...prev.outboxByConversation,
                                [conversationId]: filteredQueue,
                            };
                            validateSingleOutboxKey(nextOutboxByConversation, 'sendMessage.success');

                            return {
                                outboxByConversation: nextOutboxByConversation,
                                messagesByConversation: {
                                    ...prev.messagesByConversation,
                                    [conversationId]: {
                                        ...(prev.messagesByConversation[conversationId] || {
                                            messages: [],
                                            hasMore: true,
                                            loading: false,
                                            cursor: null,
                                        }),
                                        messages: nextMessages,
                                    },
                                },
                            };
                        });

                        void get().refreshConversations();
                        return { ok: true };
                    }

                    queueMessage(result.error || 'send_failed');
                    void get().flushOutbox();
                    return { ok: true, queued: true };
                } catch (error) {
                    console.error('Error sending message:', error);
                    queueMessage('send_exception');
                    void get().flushOutbox();
                    return { ok: true, queued: true };
                }
            },

            // ================================================================
            // FLUSH OUTBOX
            // ================================================================
            flushOutbox: async () => {
                const state = get();
                if (state.outboxFlushing) return;
                if (typeof navigator !== 'undefined' && !navigator.onLine) return;

                const allQueue = Object.values(state.outboxByConversation).flat();
                if (allQueue.length === 0) return;

                set({ outboxFlushing: true });
                let anySuccess = false;

                try {
                    const now = Date.now();
                    const eligible = allQueue
                        .filter(item => item.nextRetryAt <= now)
                        .sort((a, b) => a.createdAt - b.createdAt);

                    for (const queued of eligible) {
                        const sendResult = queued.attachments.length > 0
                            ? await sendMessageWithAttachments(
                                queued.conversationId,
                                queued.content,
                                queued.attachments,
                                {
                                    clientMessageId: queued.clientMessageId,
                                    replyToMessageId: queued.replyToMessageId || null,
                                }
                            )
                            : await sendMessageAction(
                                queued.conversationId,
                                queued.content,
                                'text',
                                undefined,
                                {
                                    clientMessageId: queued.clientMessageId,
                                    replyToMessageId: queued.replyToMessageId || null,
                                }
                            );

                        if (sendResult.success && sendResult.message) {
                            anySuccess = true;
                            set(prev => {
                                const queue = (prev.outboxByConversation[queued.conversationId] || []).filter(
                                    item => item.clientMessageId !== queued.clientMessageId
                                );
                                const currentMessages = prev.messagesByConversation[queued.conversationId]?.messages || [];
                                const alreadyExists = currentMessages.some(m => m.id === sendResult.message!.id);
                                const replacedMessages = alreadyExists
                                    ? currentMessages.filter(
                                        message => message.clientMessageId !== queued.clientMessageId
                                    )
                                    : currentMessages.map((message) => {
                                        if (message.clientMessageId === queued.clientMessageId) {
                                            return sendResult.message!;
                                        }
                                        return message;
                                    });
                                const nextOutboxByConversation = {
                                    ...prev.outboxByConversation,
                                    [queued.conversationId]: queue,
                                };
                                validateSingleOutboxKey(nextOutboxByConversation, 'flushOutbox.success');

                                return {
                                    outboxByConversation: nextOutboxByConversation,
                                    messagesByConversation: {
                                        ...prev.messagesByConversation,
                                        [queued.conversationId]: {
                                            ...(prev.messagesByConversation[queued.conversationId] || {
                                                messages: [],
                                                hasMore: true,
                                                loading: false,
                                                cursor: null,
                                            }),
                                            messages: replacedMessages,
                                        },
                                    },
                                };
                            });
                            continue;
                        }

                        set(prev => {
                            const nextRetryMs = Math.min(60_000, 1000 * (2 ** Math.min(6, queued.attempts + 1)));
                            const isFinalFailure = queued.attempts + 1 >= 8;
                            const nextOutboxByConversation = {
                                ...prev.outboxByConversation,
                                [queued.conversationId]: (prev.outboxByConversation[queued.conversationId] || []).map(
                                    item => item.clientMessageId === queued.clientMessageId
                                        ? {
                                            ...item,
                                            attempts: item.attempts + 1,
                                            nextRetryAt: isFinalFailure ? Date.now() : (Date.now() + nextRetryMs),
                                            lastError: sendResult.error || 'retry_failed',
                                        }
                                        : item
                                ),
                            };
                            validateSingleOutboxKey(nextOutboxByConversation, 'flushOutbox.retry');
                            return {
                                outboxByConversation: nextOutboxByConversation,
                                messagesByConversation: {
                                    ...prev.messagesByConversation,
                                    [queued.conversationId]: {
                                        ...(prev.messagesByConversation[queued.conversationId] || {
                                            messages: [],
                                            hasMore: true,
                                            loading: false,
                                            cursor: null,
                                        }),
                                        messages: (prev.messagesByConversation[queued.conversationId]?.messages || []).map((message) => {
                                            if (message.clientMessageId !== queued.clientMessageId) return message;
                                            return {
                                                ...message,
                                                metadata: withDeliveryMetadata({
                                                    ...(message.metadata || {}),
                                                    queued: !isFinalFailure,
                                                    lastError: sendResult.error || 'retry_failed',
                                                }, isFinalFailure ? 'failed' : 'queued'),
                                            };
                                        }),
                                    },
                                },
                            };
                        });
                    }
                } catch (error) {
                    console.error('Error flushing outbox:', error);
                } finally {
                    set({ outboxFlushing: false });
                    if (anySuccess) {
                        void get().refreshConversations();
                    }
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

            setReplyTarget: (conversationId: string, target: ReplyTargetDraft | null) => {
                set(prev => ({
                    replyTargetByConversation: {
                        ...prev.replyTargetByConversation,
                        [conversationId]: target,
                    },
                }));
            },

            clearReplyTarget: (conversationId: string) => {
                set(prev => ({
                    replyTargetByConversation: {
                        ...prev.replyTargetByConversation,
                        [conversationId]: null,
                    },
                }));
            },

            // ================================================================
            // MARK AS READ
            // ================================================================
            markAsRead: async (conversationId: string) => {
                const state = get();
                const previousUnread = state.unreadCounts[conversationId] || 0;
                const latestMessageId =
                    state.messagesByConversation[conversationId]?.messages[
                        (state.messagesByConversation[conversationId]?.messages.length || 1) - 1
                    ]?.id;

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
                    await markConversationAsRead(conversationId, latestMessageId);
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
                validateUniqueConversationIds(conversations.map((conversation) => conversation.id), 'setConversations');
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

            // UPSERT CONVERSATION (Hydration)
            // ================================================================
            upsertConversation: (conversation: ConversationWithDetails) => {
                set(prev => {
                    const index = prev.conversations.findIndex(c => c.id === conversation.id);
                    let newConversations;

                    if (index >= 0) {
                        newConversations = [...prev.conversations];
                        newConversations[index] = conversation;
                    } else {
                        newConversations = [conversation, ...prev.conversations];
                    }
                    validateUniqueConversationIds(newConversations.map((conv) => conv.id), 'upsertConversation');

                    // Update unread count
                    const newUnreadCounts = { ...prev.unreadCounts, [conversation.id]: conversation.unreadCount };
                    // Recalculate total (safe way)
                    const totalUnread = Object.values(newUnreadCounts).reduce((a, b) => a + b, 0);

                    return {
                        conversations: newConversations,
                        unreadCounts: newUnreadCounts,
                        totalUnread
                    };
                });
            },

            // HANDLE NEW MESSAGE (from realtime) - OPTIMIZED
            // ================================================================
            _handleNewMessage: async (rawMessage: any, viewerId?: string | null) => {
                const conversationId = rawMessage.conversation_id || rawMessage.conversationId;
                const senderId = rawMessage.sender_id || rawMessage.senderId;
                const clientMessageId =
                    rawMessage.client_message_id ||
                    rawMessage.clientMessageId ||
                    rawMessage.metadata?.clientMessageId ||
                    null;

                if (!conversationId || !rawMessage.id) return;

                // OPTIMIZED: Use cached profile or fetch only if missing
                let sender = rawMessage.sender || null;
                if (!sender && senderId) {
                    // Check cache first
                    const cachedSender = get().profileCache[senderId];
                    if (cachedSender) {
                        sender = cachedSender;
                    } else {
                        // Fetch from database only if not in cache
                        try {
                            const { createClient } = await import('@/lib/supabase/client');
                            const supabase = createClient();
                            const { data } = await supabase
                                .from('profiles')
                                .select('id, username, full_name, avatar_url')
                                .eq('id', senderId)
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
                                    profileCache: upsertProfileCacheEntry(
                                        prev.profileCache,
                                        sender as ProfileCacheEntry
                                    ),
                                }));
                            }
                        } catch (error) {
                            console.error('Error fetching profile:', error);
                            // Use placeholder if fetch fails
                            sender = {
                                id: senderId,
                                username: null,
                                fullName: null,
                                avatarUrl: null,
                            };
                        }
                    }
                }

                const attachments = Array.isArray(rawMessage.attachments)
                    ? rawMessage.attachments.map((att: any) => ({
                        id: att.id,
                        type: att.type,
                        url: att.url,
                        filename: att.filename,
                        sizeBytes: att.sizeBytes ?? att.size_bytes ?? null,
                        mimeType: att.mimeType ?? att.mime_type ?? null,
                        thumbnailUrl: att.thumbnailUrl ?? att.thumbnail_url ?? null,
                        width: att.width ?? null,
                        height: att.height ?? null,
                    }))
                    : [];

                const rawReply = rawMessage.replyTo || rawMessage.reply_to || null;
                let parsedMetadata: Record<string, unknown> = {};
                try {
                    parsedMetadata = typeof rawMessage.metadata === 'string'
                        ? JSON.parse(rawMessage.metadata)
                        : (rawMessage.metadata || {});
                } catch {
                    parsedMetadata = {};
                }
                const normalizedMetadata = withDeliveryMetadata(
                    parsedMetadata,
                    senderId === viewerId ? 'sent' : (parsedMetadata?.deliveryState as MessageDeliveryState || 'delivered')
                );

                // Build complete message object
                const completeMessage: MessageWithSender = {
                    id: rawMessage.id,
                    conversationId,
                    senderId,
                    clientMessageId,
                    content: rawMessage.content,
                    type: rawMessage.type,
                    metadata: normalizedMetadata,
                    replyTo: rawReply
                        ? {
                            id: rawReply.id,
                            content: rawReply.content ?? null,
                            type: rawReply.type ?? 'text',
                            senderId: rawReply.senderId ?? rawReply.sender_id ?? null,
                            senderName: rawReply.senderName ?? rawReply.sender_name ?? null,
                            deletedAt: rawReply.deletedAt
                                ? new Date(rawReply.deletedAt)
                                : (rawReply.deleted_at ? new Date(rawReply.deleted_at) : null),
                        }
                        : null,
                    createdAt: new Date(rawMessage.created_at || rawMessage.createdAt),
                    editedAt: rawMessage.edited_at
                        ? new Date(rawMessage.edited_at)
                        : (rawMessage.editedAt ? new Date(rawMessage.editedAt) : null),
                    deletedAt: rawMessage.deleted_at
                        ? new Date(rawMessage.deleted_at)
                        : (rawMessage.deletedAt ? new Date(rawMessage.deletedAt) : null),
                    sender,
                    attachments,
                };

                // Single batched state update for the new message
                set(prev => {
                    const patch: Partial<ChatState> = {};

                    // 1. Add to message cache
                    const cachedConversation = prev.messagesByConversation[completeMessage.conversationId];
                    if (cachedConversation) {
                        const idSet = new Set(cachedConversation.messages.map(m => m.id));
                        const clientIdSet = new Set(
                            cachedConversation.messages
                                .filter(m => m.clientMessageId)
                                .map(m => m.clientMessageId)
                        );
                        const exists = idSet.has(completeMessage.id) ||
                            (!!completeMessage.clientMessageId && clientIdSet.has(completeMessage.clientMessageId));

                        if (!exists) {
                            patch.messagesByConversation = {
                                ...prev.messagesByConversation,
                                [completeMessage.conversationId]: {
                                    ...cachedConversation,
                                    messages: [...cachedConversation.messages, completeMessage],
                                },
                            };
                        }
                    }

                    // 2. Update unread count
                    const shouldIncrementUnread =
                        prev.activeConversationId !== completeMessage.conversationId &&
                        (!viewerId || completeMessage.senderId !== viewerId);
                    if (shouldIncrementUnread) {
                        patch.unreadCounts = {
                            ...prev.unreadCounts,
                            [completeMessage.conversationId]: (prev.unreadCounts[completeMessage.conversationId] || 0) + 1,
                        };
                        patch.totalUnread = prev.totalUnread + 1;
                    }

                    // 3. Remove from outbox
                    if (completeMessage.clientMessageId) {
                        const queue = prev.outboxByConversation[completeMessage.conversationId] || [];
                        patch.outboxByConversation = {
                            ...prev.outboxByConversation,
                            [completeMessage.conversationId]: queue.filter(
                                item => item.clientMessageId !== completeMessage.clientMessageId
                            ),
                        };
                    }

                    // 4. Update conversation list
                    const conversations = [...prev.conversations];
                    const convIndex = conversations.findIndex(c => c.id === completeMessage.conversationId);
                    if (convIndex !== -1) {
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
                        conversations.sort((a, b) => toEpochMs(b.updatedAt) - toEpochMs(a.updatedAt));
                        patch.conversations = conversations;
                    }

                    // 5. Update project groups
                    const groupIndex = prev.projectGroups.findIndex(
                        (group) => group.id === completeMessage.conversationId
                    );
                    if (groupIndex !== -1) {
                        const nextGroups = [...prev.projectGroups];
                        const current = nextGroups[groupIndex];
                        const unreadInc = shouldIncrementUnread ? 1 : 0;
                        nextGroups[groupIndex] = {
                            ...current,
                            unreadCount: Math.max(0, current.unreadCount + unreadInc),
                            lastMessage: {
                                id: completeMessage.id,
                                content: completeMessage.content,
                                senderId: completeMessage.senderId,
                                createdAt: completeMessage.createdAt,
                                type: completeMessage.type,
                            },
                            updatedAt: completeMessage.createdAt,
                        };
                        nextGroups.sort((a, b) => toEpochMs(b.updatedAt) - toEpochMs(a.updatedAt));
                        patch.projectGroups = nextGroups;
                    }

                    return patch;
                });

                // Background refreshes for unknown conversations/groups (outside the batch to avoid blocking)
                {
                    const state = get();
                    const convExists = state.conversations.some(c => c.id === completeMessage.conversationId);
                    if (!convExists) void state.refreshConversations();

                    const groupExists = state.projectGroups.some(g => g.id === completeMessage.conversationId);
                    if (!groupExists) void state.fetchProjectGroups(true);
                }

                const messageMetadata = completeMessage.metadata as Record<string, unknown>;
                if (messageMetadata?.isApplication || messageMetadata?.isApplicationUpdate) {
                    void get().fetchApplications(true);
                }
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
                            isPendingSent: result.isPendingSent || false,
                            hasActiveApplication: result.hasActiveApplication || false,
                            isApplicant: result.isApplicant || false,
                            isCreator: result.isCreator || false,
                            activeApplicationId: result.activeApplicationId || null,
                            activeApplicationStatus: result.activeApplicationStatus || null,
                            activeProjectId: result.activeProjectId || null
                        });
                    } else {
                        set({
                            activeConnectionStatus: 'none',
                            isIncomingConnectionRequest: false,
                            isPendingSent: false,
                            hasActiveApplication: false,
                            isApplicant: false,
                            isCreator: false,
                            activeApplicationId: null,
                            activeApplicationStatus: null,
                            activeProjectId: null
                        });
                    }
                } catch (error) {
                    console.error('Error checking connection status:', error);
                    set({
                        activeConnectionStatus: 'none',
                        isIncomingConnectionRequest: false,
                        isPendingSent: false,
                        hasActiveApplication: false,
                        isApplicant: false,
                        isCreator: false,
                        activeApplicationId: null,
                        activeApplicationStatus: null,
                        activeProjectId: null
                    });
                }
            },

            // ================================================================
            // REFRESH MESSAGES
            // ================================================================
            refreshMessages: async (conversationId: string) => {
                try {
                    const { messages: messageList, hasMore, nextCursor } = await getMessages(conversationId);
                    const serverMessages = messageList || [];

                    const serverIdSet = new Set<string>();
                    const serverClientIdSet = new Set<string>();
                    for (const m of serverMessages) {
                        serverIdSet.add(m.id);
                        if (m.clientMessageId) serverClientIdSet.add(m.clientMessageId);
                    }

                    set((state) => ({
                        messagesByConversation: {
                            ...state.messagesByConversation,
                            [conversationId]: {
                                messages: [
                                    ...serverMessages,
                                    ...(state.messagesByConversation[conversationId]?.messages || []).filter((localMessage) => {
                                        if (serverIdSet.has(localMessage.id)) return false;
                                        if (localMessage.clientMessageId && serverClientIdSet.has(localMessage.clientMessageId)) return false;
                                        const deliveryState = (localMessage.metadata as Record<string, unknown> | undefined)?.deliveryState;
                                        return (
                                            localMessage.id.startsWith('temp-') ||
                                            deliveryState === 'sending' ||
                                            deliveryState === 'queued' ||
                                            deliveryState === 'failed'
                                        );
                                    }),
                                ],
                                hasMore: hasMore || false,
                                cursor: nextCursor || null,
                                loading: false
                            }
                        }
                    }));
                } catch (error) {
                    console.error('Error refreshing messages:', error);
                }
            },

            fetchPinnedMessages: async (conversationId: string) => {
                try {
                    const result = await getPinnedMessages(conversationId, 3);
                    if (!result.success) return;
                    set((prev) => ({
                        pinnedMessagesByConversation: {
                            ...prev.pinnedMessagesByConversation,
                            [conversationId]: result.messages || [],
                        },
                    }));
                } catch (error) {
                    console.error('Error fetching pinned messages:', error);
                }
            },

            pinMessage: async (messageId: string, conversationId: string, pinned: boolean) => {
                try {
                    const result = await setMessagePinned(messageId, pinned);
                    if (!result.success) return false;
                    await Promise.all([
                        get().refreshMessages(conversationId),
                        get().fetchPinnedMessages(conversationId),
                        get().refreshConversations(),
                    ]);
                    return true;
                } catch (error) {
                    console.error('Error pinning message:', error);
                    return false;
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

            // ================================================================
            // HANDLE MESSAGE UPDATE (e.g. Status Banner Change)
            // ================================================================
            _handleMessageUpdate: (rawMessage: any) => {
                const state = get();
                const conversationId = rawMessage.conversation_id;
                let parsedMetadata: Record<string, unknown> = {};
                try {
                    parsedMetadata = typeof rawMessage.metadata === 'string'
                        ? JSON.parse(rawMessage.metadata)
                        : (rawMessage.metadata || {});
                } catch {
                    parsedMetadata = {};
                }

                // 1. Update in Message Cache
                if (state.messagesByConversation[conversationId]) {
                    const rawReply = rawMessage.replyTo || rawMessage.reply_to || null;
                    set(prev => ({
                        messagesByConversation: {
                            ...prev.messagesByConversation,
                            [conversationId]: {
                                ...prev.messagesByConversation[conversationId],
                                messages: prev.messagesByConversation[conversationId].messages.map(msg =>
                                    msg.id === rawMessage.id
                                        ? {
                                            ...msg,
                                            content: rawMessage.content,
                                            metadata: withDeliveryMetadata(
                                                parsedMetadata,
                                                (parsedMetadata?.deliveryState as MessageDeliveryState) || 'sent'
                                            ),
                                            replyTo: rawReply
                                                ? {
                                                    id: rawReply.id,
                                                    content: rawReply.content ?? null,
                                                    type: rawReply.type ?? 'text',
                                                    senderId: rawReply.senderId ?? rawReply.sender_id ?? null,
                                                    senderName: rawReply.senderName ?? rawReply.sender_name ?? null,
                                                    deletedAt: rawReply.deletedAt
                                                        ? new Date(rawReply.deletedAt)
                                                        : (rawReply.deleted_at ? new Date(rawReply.deleted_at) : null),
                                                }
                                                : msg.replyTo || null,
                                            editedAt: rawMessage.edited_at ? new Date(rawMessage.edited_at) : null,
                                            // Keep sender/attachments from existing message if not in payload
                                            sender: msg.sender,
                                            attachments: msg.attachments,
                                            type: rawMessage.type // Ensure type update for system messages
                                        }
                                        : msg
                                )
                            }
                        }
                    }));
                }

                // 2. Update Status locally if it matches active application
                const updateMetadata = parsedMetadata;
                const statusValue = updateMetadata?.status;
                if (
                    updateMetadata &&
                    updateMetadata.applicationId === state.activeApplicationId &&
                    (statusValue === 'pending' || statusValue === 'accepted' || statusValue === 'rejected')
                ) {
                    set({ activeApplicationStatus: statusValue });
                }

                if (updateMetadata?.isApplication || updateMetadata?.isApplicationUpdate) {
                    void get().fetchApplications(true);
                }

                // 2. Update in Conversation List (Last Message Preview)
                const convIndex = state.conversations.findIndex(c => c.id === conversationId);
                if (convIndex !== -1) {
                    const lastMsg = state.conversations[convIndex].lastMessage;
                    if (lastMsg && lastMsg.id === rawMessage.id) {
                        set(prev => {
                            const newConversations = [...prev.conversations];
                            newConversations[convIndex] = {
                                ...newConversations[convIndex],
                                lastMessage: {
                                    ...newConversations[convIndex].lastMessage!,
                                    content: rawMessage.content,
                                    type: rawMessage.type,
                                }
                            };
                            return { conversations: newConversations };
                        });
                    }
                }

                const projectGroupIndex = state.projectGroups.findIndex((group) => group.id === conversationId);
                if (projectGroupIndex !== -1) {
                    const current = state.projectGroups[projectGroupIndex];
                    if (current.lastMessage?.id === rawMessage.id) {
                        set((prev) => {
                            const next = [...prev.projectGroups];
                            next[projectGroupIndex] = {
                                ...next[projectGroupIndex],
                                lastMessage: {
                                    ...next[projectGroupIndex].lastMessage!,
                                    content: rawMessage.content,
                                    type: rawMessage.type,
                                },
                            };
                            return { projectGroups: next };
                        });
                    }
                }

                if (updateMetadata?.pinned === true || updateMetadata?.pinned === false) {
                    void get().fetchPinnedMessages(conversationId);
                }

                // 3. Update Active Application Status (Real-time Banner)
                const metadata = typeof rawMessage.metadata === 'string'
                    ? JSON.parse(rawMessage.metadata)
                    : (rawMessage.metadata || {});

                if (
                    state.activeConversationId === conversationId &&
                    state.hasActiveApplication &&
                    state.activeApplicationId &&
                    metadata.isApplication &&
                    metadata.applicationId === state.activeApplicationId &&
                    (metadata.status === 'pending' || metadata.status === 'accepted' || metadata.status === 'rejected')
                ) {
                    set({ activeApplicationStatus: metadata.status });
                }
            },
            setPartialStatus: (status) => {
                set({ activeApplicationStatus: status });
            },

            // ================================================================
            // FETCH APPLICATIONS (Inbox Zero Cache)
            // ================================================================
            fetchApplications: async (refresh = false) => {
                const state = get();
                // If we have data and not refreshing, return immediately (Cache First)
                if (!refresh && state.applications.length > 0) return;
                // Throttle forced refreshes to avoid hot-loop fetch storms from multiple surfaces.
                if (refresh && state.applicationsLastFetchedAt > 0 && Date.now() - state.applicationsLastFetchedAt < 2_000) {
                    return;
                }

                if (state.applicationsLoading) return;

                set({ applicationsLoading: true, applicationsError: null });

                try {
                    const result = await getInboxApplicationsAction(20, 0);

                    if (result.success && result.applications) {
                        set({
                            applications: result.applications as InboxApplication[],
                            applicationsLoading: false,
                            hasMoreApplications: result.hasMore || false,
                            applicationsOffset: 20,
                            applicationsLastFetchedAt: Date.now(),
                        });
                    } else {
                        set({
                            applicationsError: 'Failed to load applications',
                            applicationsLoading: false
                        });
                    }
                } catch (error) {
                    console.error('Error fetching applications:', error);
                    set({
                        applicationsError: 'Failed to fetch applications',
                        applicationsLoading: false
                    });
                }
            },

            loadMoreApplications: async () => {
                const state = get();
                if (state.applicationsLoading || !state.hasMoreApplications) return;

                set({ applicationsLoading: true });

                try {
                    const result = await getInboxApplicationsAction(20, state.applicationsOffset);

                    if (result.success && result.applications) {
                        set(prev => ({
                            applications: [...prev.applications, ...result.applications as InboxApplication[]],
                            applicationsLoading: false,
                            hasMoreApplications: result.hasMore || false,
                            applicationsOffset: prev.applicationsOffset + 20,
                            applicationsLastFetchedAt: Date.now(),
                        }));
                    } else {
                        set({ applicationsLoading: false });
                    }
                } catch (error) {
                    console.error('Error loading more applications:', error);
                    set({ applicationsLoading: false });
                }
            },

            // ================================================================
            // PROJECT GROUPS (Phase 3: UI Integration)
            // ================================================================
            fetchProjectGroups: async (refresh = false) => {
                const state = get();
                // If we have data and not refreshing, return immediately (Cache First)
                if (!refresh && state.projectGroups.length > 0) return;

                if (state.projectGroupsLoading) return;

                set({ projectGroupsLoading: true, projectGroupsError: null });

                try {
                    const result = await getProjectGroups(20, 0);

                    if (result.success && result.projectGroups) {
                        set({
                            projectGroups: result.projectGroups,
                            projectGroupsLoading: false,
                            hasMoreProjectGroups: result.hasMore || false,
                            projectGroupsOffset: 20
                        });
                    } else {
                        set({
                            projectGroupsError: 'Failed to load project groups',
                            projectGroupsLoading: false
                        });
                    }
                } catch (error) {
                    console.error('Error fetching project groups:', error);
                    set({
                        projectGroupsError: 'Failed to fetch project groups',
                        projectGroupsLoading: false
                    });
                }
            },

            loadMoreProjectGroups: async () => {
                const state = get();
                if (state.projectGroupsLoading || !state.hasMoreProjectGroups) return;

                set({ projectGroupsLoading: true });

                try {
                    const result = await getProjectGroups(20, state.projectGroupsOffset);

                    if (result.success && result.projectGroups) {
                        set(prev => ({
                            projectGroups: [...prev.projectGroups, ...result.projectGroups!],
                            projectGroupsLoading: false,
                            hasMoreProjectGroups: result.hasMore || false,
                            projectGroupsOffset: prev.projectGroupsOffset + 20
                        }));
                    } else {
                        set({ projectGroupsLoading: false });
                    }
                } catch (error) {
                    console.error('Error loading more project groups:', error);
                    set({ projectGroupsLoading: false });
                }
            }
        }),
        {
            name: 'chat-storage',
            partialize: (state) => ({
                // Persist only user input state and pending outbox.
                draftsByConversation: state.draftsByConversation,
                replyTargetByConversation: state.replyTargetByConversation,
                outboxByConversation: state.outboxByConversation,
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

export const selectUnreadTotal = (state: ChatState) => state.totalUnread;
