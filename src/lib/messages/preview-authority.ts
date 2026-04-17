import type { InboxConversationV2 } from '@/app/actions/messaging/v2';
import { getMessagePreviewText } from '@/lib/messages/structured';
import { toEpochMs } from '@/lib/messages/utils';

type PreviewMetadata = Record<string, unknown> | null | undefined;

export interface MessagePreviewSource {
    id: string;
    content?: string | null;
    type?: string | null;
    metadata?: PreviewMetadata;
    senderId?: string | null;
    createdAt?: Date | string | null;
}

export interface ConversationParticipantPreviewUpdate {
    lastMessageAt: Date | null;
    lastMessageId: string | null;
    lastMessagePreview: string | null;
    lastMessageType: string | null;
    lastMessageSenderId: string | null;
}

function getStructuredPreviewType(params: {
    type?: string | null;
    metadata?: PreviewMetadata;
}) {
    if (!params.metadata || typeof params.metadata !== 'object') {
        return params.type ?? null;
    }

    const structured = (params.metadata.structured as { kind?: string } | undefined)?.kind;
    return structured ?? params.type ?? null;
}

export function buildConversationParticipantPreview(
    message: MessagePreviewSource | null | undefined,
): ConversationParticipantPreviewUpdate {
    if (!message) {
        return {
            lastMessageAt: null,
            lastMessageId: null,
            lastMessagePreview: null,
            lastMessageType: null,
            lastMessageSenderId: null,
        };
    }

    return {
        lastMessageAt: message.createdAt ? new Date(message.createdAt) : null,
        lastMessageId: message.id,
        lastMessagePreview: getMessagePreviewText({
            content: message.content,
            type: message.type,
            metadata: message.metadata ?? null,
        }),
        lastMessageType: getStructuredPreviewType(message),
        lastMessageSenderId: message.senderId ?? null,
    };
}

export function buildConversationLastMessageSnapshot(
    message: MessagePreviewSource | null | undefined,
): InboxConversationV2['lastMessage'] | null {
    if (!message?.createdAt) {
        return null;
    }

    const epoch = toEpochMs(message.createdAt);
    if (epoch <= 0) {
        return null;
    }

    return {
        id: message.id,
        content: getMessagePreviewText({
            content: message.content,
            type: message.type,
            metadata: message.metadata ?? null,
        }),
        senderId: message.senderId ?? null,
        createdAt: new Date(epoch),
        type: getStructuredPreviewType(message) ?? 'message',
        metadata: message.metadata ?? null,
    };
}

export function shouldReplaceConversationLastMessage(
    currentLastMessage: InboxConversationV2['lastMessage'] | null | undefined,
    nextMessage: MessagePreviewSource,
) {
    const nextEpoch = toEpochMs(nextMessage.createdAt);
    if (nextEpoch <= 0) {
        return false;
    }

    if (!currentLastMessage) {
        return true;
    }

    const currentEpoch = toEpochMs(currentLastMessage.createdAt);
    if (currentLastMessage.id === nextMessage.id) {
        return true;
    }
    if (nextEpoch !== currentEpoch) {
        return nextEpoch > currentEpoch;
    }

    return nextMessage.id.localeCompare(currentLastMessage.id) >= 0;
}
