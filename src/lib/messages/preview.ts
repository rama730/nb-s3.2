import { getMessagePreviewText } from '@/lib/messages/structured';

export function formatMessagePreview(
    lastMessage: { content?: string | null; type?: string | null; metadata?: Record<string, unknown> | null } | null | undefined,
): string {
    if (!lastMessage) return 'No messages yet';
    return getMessagePreviewText(lastMessage);
}
