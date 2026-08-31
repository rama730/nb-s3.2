import { getMessagePreviewText } from '@/lib/messages/structured';

type PreviewMessage = {
    content?: string | null;
    type?: string | null;
    metadata?: Record<string, unknown> | null;
    senderId?: string | null;
    createdAt?: Date | string | null;
    deletedAt?: Date | string | null;
    replyToMessageId?: string | null;
};

export type ConversationReactionPreview = {
    messageId: string;
    actorUserId: string;
    emoji: string;
    createdAt: Date | string;
};

export function formatMessagePreview(
    lastMessage: PreviewMessage | null | undefined,
): string {
    if (!lastMessage) return 'No messages yet';
    return getMessagePreviewText(lastMessage);
}

export function formatConversationPreview(
    lastMessage: PreviewMessage | null | undefined,
    viewerUserId?: string | null,
    reactionPreview?: ConversationReactionPreview | null,
    reactionActorName?: string | null,
): string {
    if (!lastMessage) return 'No messages yet';
    if (shouldShowConversationReactionPreview(lastMessage, reactionPreview)) {
        return `${reactionActorName?.trim() || 'Someone'} reacted ${reactionPreview!.emoji} to your message`;
    }
    const preview = lastMessage.content?.startsWith('↩ ')
        ? lastMessage.content
        : formatMessagePreview(lastMessage);
    if (lastMessage.deletedAt || lastMessage.type === 'deleted') return preview;

    const replied = preview.startsWith('↩ ');
    const label = replied ? preview.slice(2) : preview;
    const own = Boolean(viewerUserId && lastMessage.senderId === viewerUserId);

    if (lastMessage.type === 'project_invite') {
        const projectTitle = label.match(/^Invitation to join\s+(.+?)(?:\s+as\s+.+)?$/i)?.[1]?.trim();
        const action = own ? 'You sent' : 'You received';
        return projectTitle
            ? `${action} a project invitation to ${projectTitle}`
            : `${action} a project invitation`;
    }

    const media = new Set(['image', 'video', 'voice', 'file']).has(lastMessage.type ?? '');

    if (media) {
        const article = /^[aeiou]/i.test(label) ? 'an' : 'a';
        const action = own ? (replied ? 'You replied with' : 'You sent') : (replied ? 'Replied with' : 'Received');
        return `${replied ? '↩ ' : ''}${action} ${article} ${label.toLowerCase()}`;
    }

    return own ? `${replied ? '↩ ' : ''}You: ${label}` : preview;
}

/** A reaction is newer activity, never a replacement for the last message. */
export function shouldShowConversationReactionPreview(
    lastMessage: PreviewMessage | null | undefined,
    reactionPreview: ConversationReactionPreview | null | undefined,
): boolean {
    if (!lastMessage || !reactionPreview) return false;
    const reactionAt = new Date(reactionPreview.createdAt).getTime();
    const messageAt = lastMessage.createdAt ? new Date(lastMessage.createdAt).getTime() : Number.NaN;
    return Number.isFinite(reactionAt) && (!Number.isFinite(messageAt) || reactionAt > messageAt);
}
