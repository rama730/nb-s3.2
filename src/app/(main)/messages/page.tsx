import MessagesClient from '@/components/chat/MessagesClient';
import { isMessagesHardeningEnabled } from '@/lib/features/messages';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
    // OPTIMIZATION: usage of "Instant Shell" pattern.
    // We do NOT fetch conversations or target user on the server.
    // The client component fetches them lazily to ensure instant navigation.

    const resolvedParams = await searchParams;
    const targetUserId =
        typeof resolvedParams.userId === 'string'
            ? resolvedParams.userId
            : typeof resolvedParams.user === 'string'
                ? resolvedParams.user
                : null;
    const initialConversationId = typeof resolvedParams.conversationId === 'string'
        ? resolvedParams.conversationId
        : null;

    const { user } = await getViewerAuthContext();
    const messagesHardeningEnabled = isMessagesHardeningEnabled(user?.id ?? null);

    return (
        <div
            data-scroll-root="route"
            data-hardening-messages={messagesHardeningEnabled ? "v1" : "off"}
            className="h-full min-h-0 overflow-hidden app-scroll app-scroll-y app-scroll-gutter bg-white dark:bg-zinc-950"
        >
            <MessagesClient
                targetUserId={targetUserId}
                initialConversationId={initialConversationId}
                hardeningEnabled={messagesHardeningEnabled}
            />
        </div>
    );
}
