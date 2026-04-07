import type { MessageWithSender } from '@/app/actions/messaging';
import {
    getStructuredMessageFromMetadata,
    getStructuredMessageKindLabel,
    getStructuredMessagePreview,
} from '@/lib/messages/structured';

export type ReplyPreviewLike = {
    content: string | null;
    type: MessageWithSender['type'];
    deletedAt: Date | null;
    senderName?: string | null;
    metadata?: Record<string, unknown> | null;
};

export function getReplyPreviewBadge(reply: ReplyPreviewLike): string | null {
    if (reply.deletedAt) return 'Deleted';

    const structured = getStructuredMessageFromMetadata(reply.metadata);
    if (structured) {
        return getStructuredMessageKindLabel(structured.kind);
    }

    switch (reply.type) {
        case 'image':
            return 'Photo';
        case 'video':
            return 'Video';
        case 'file':
            return 'File';
        case 'system':
            return 'System';
        default:
            return null;
    }
}

export function getReplyPreviewText(reply: ReplyPreviewLike): string {
    if (reply.deletedAt) return 'Message deleted';

    const structured = getStructuredMessageFromMetadata(reply.metadata);
    if (structured) {
        return getStructuredMessagePreview(structured);
    }

    const content = reply.content?.trim();
    if (content) return content;

    switch (reply.type) {
        case 'image':
            return 'Shared a photo';
        case 'video':
            return 'Shared a video';
        case 'file':
            return 'Shared an attachment';
        case 'system':
            return 'System message';
        default:
            return 'Original message';
    }
}

export function getReplyFocusLabel(source: 'reply' | 'pin' | 'external'): string {
    if (source === 'reply') return 'Original reply';
    if (source === 'pin') return 'Pinned message';
    return 'Referenced message';
}
