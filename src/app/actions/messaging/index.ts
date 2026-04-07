// Module barrel — re-exports from split modules
// conversations: DM creation, listing, archiving, muting, read receipts
// messages: send, edit, delete, get, unread
// search: search messages, pins
// attachments: upload, cancel, send with attachments

export {
    // Conversations
    getConversations,
    getConversationById,
    getOrCreateDMConversation,
    markConversationAsRead,
    setConversationArchived,
    setConversationMuted,
    getProjectGroups,
    getUnreadCount,

    // Messages
    getMessages,
    getMessageContext,
    sendMessage,
    editMessage,
    deleteMessage,

    // Search & Pins
    searchMessages,
    getPinnedMessages,
    setMessagePinned,

    // Attachments
    uploadAttachment,
    cancelAttachmentUpload,
    sendMessageWithAttachments,
} from './_all'

export type {
    ConversationWithDetails,
    ProjectGroupConversation,
    MessageWithSender,
    SendMessageResult,
    UploadedAttachment,
} from './_all'

// Features: Reactions, Reports, Read Receipts, Pinning
export {
    toggleReaction,
    getMessageReactions,
    reportMessage,
    recordReadReceipts,
    getMessageReadReceipts,
    setConversationPinned,
} from './features'

export type { ReactionSummary } from './features'

export {
    convertMessageToFollowUpActionV2,
    convertMessageToTaskActionV2,
    getMessagingStructuredCatalogV2,
    resolveMessageWorkflowActionV2,
    sendStructuredMessageActionV2,
} from './collaboration'

export type { MessagingStructuredCatalogV2 } from './collaboration'
