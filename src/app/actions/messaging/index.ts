// Module barrel — re-exports from split modules
// conversations: DM creation, listing, archiving, muting, read receipts
// messages: send, edit, delete, get, unread
// search: search messages, pins
// attachments: upload, cancel, send with attachments

export {
    // Conversations
    getOrCreateDMConversation,
    getConversations,
    getConversationById,
    markConversationAsRead,
    setConversationArchived,
    setConversationMuted,
    getProjectGroups,

    // Messages
    getMessages,
    sendMessage,
    editMessage,
    deleteMessage,
    getUnreadCount,

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
    MessageWithSender,
    SendMessageResult,
    UploadedAttachment,
    ProjectGroupConversation,
} from './_all'
