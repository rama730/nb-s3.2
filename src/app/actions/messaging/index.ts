// Module barrel — re-exports from split modules
// conversations: DM creation, listing, archiving, muting, read receipts
// messages: send, edit, delete, get, unread
// search: search messages, pins
// attachments: upload, cancel, send with attachments

export {
    // Conversations
    getConversations,
    getConversationById,
    markConversationAsRead,
    setConversationArchived,
    setConversationMuted,
    getProjectGroups,
    getUnreadCount,
} from './conversations'

export {
    getOrCreateDMConversation,

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
} from './conversations'

export type {
    MessageWithSender,
    SendMessageResult,
    UploadedAttachment,
} from './_all'
