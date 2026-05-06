export type MessageAttentionSource = 'realtime' | 'notification' | 'startup-sync';

export interface MessageAttentionConversationLike {
    id: string;
    unreadCount?: number | null;
    lastReadAt?: Date | string | null;
    lastReadMessageId?: string | null;
    lastMessage?: {
        id?: string | null;
        senderId?: string | null;
        createdAt?: Date | string | null;
    } | null;
}

export interface MessageAttentionState {
    conversationId: string;
    hasNewMessages: boolean;
    firstNewMessageId: string | null;
    latestNewMessageId: string | null;
    source: MessageAttentionSource;
    clearing: boolean;
    updatedAt: number;
}

export const MESSAGE_ATTENTION_CLEAR_MS = 260;

function toEpochMs(value: Date | string | null | undefined): number {
    if (!value) return 0;
    const epoch = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(epoch) ? epoch : 0;
}

export function hasConversationReadLatest(
    conversation: MessageAttentionConversationLike,
): boolean {
    const latestMessage = conversation.lastMessage ?? null;
    if (!latestMessage?.id) return false;
    if (conversation.lastReadMessageId && conversation.lastReadMessageId === latestMessage.id) {
        return true;
    }

    const lastReadAt = toEpochMs(conversation.lastReadAt);
    const latestMessageAt = toEpochMs(latestMessage.createdAt);
    return lastReadAt > 0 && latestMessageAt > 0 && lastReadAt >= latestMessageAt;
}

export function getEffectiveMessageAttentionUnreadCount(
    conversation: MessageAttentionConversationLike | null | undefined,
    viewerId: string | null | undefined,
): number {
    if (!conversation) return 0;
    const unreadCount = Math.max(0, Number(conversation.unreadCount ?? 0));
    if (unreadCount <= 0) return 0;

    const latestMessage = conversation.lastMessage ?? null;
    if (viewerId && latestMessage?.senderId === viewerId) return 0;
    if (hasConversationReadLatest(conversation)) return 0;

    return unreadCount;
}

export function deriveMessageAttention(
    conversation: MessageAttentionConversationLike,
    viewerId: string | null | undefined,
    source: MessageAttentionSource = 'startup-sync',
): MessageAttentionState | null {
    const unreadCount = getEffectiveMessageAttentionUnreadCount(conversation, viewerId);
    if (unreadCount <= 0) return null;

    const latestMessage = conversation.lastMessage ?? null;

    return {
        conversationId: conversation.id,
        hasNewMessages: true,
        firstNewMessageId: latestMessage?.id ?? null,
        latestNewMessageId: latestMessage?.id ?? null,
        source,
        clearing: false,
        updatedAt: Date.now(),
    };
}

export function mergeMessageAttention(
    current: MessageAttentionState | null | undefined,
    next: MessageAttentionState,
): MessageAttentionState {
    return {
        ...next,
        firstNewMessageId: current?.firstNewMessageId ?? next.firstNewMessageId,
        source: current?.source === 'notification' ? current.source : next.source,
        clearing: false,
        updatedAt: Date.now(),
    };
}

export function extractMessageBurstConversationId(value: {
    kind?: string | null;
    entityRefs?: { conversationId?: string | null } | null;
} | null | undefined): string | null {
    if (value?.kind !== 'message_burst') return null;
    const conversationId = value.entityRefs?.conversationId;
    return typeof conversationId === 'string' && conversationId.length > 0 ? conversationId : null;
}
