import MessagesClientV2 from '@/components/chat/v2/MessagesClientV2';
import { buildRouteMetadata } from '@/lib/metadata/route-metadata';

export function generateMetadata() {
    return buildRouteMetadata({
        title: 'Messages | Edge',
        description: 'Keep conversations, project groups, and application threads in one inbox.',
        path: '/messages',
    });
}

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
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
    const initialMessageId = typeof resolvedParams.messageId === 'string'
        ? resolvedParams.messageId
        : null;

    return (
        <div
            data-scroll-root="route"
            data-hardening-messages="v2"
            className="h-full min-h-0 overflow-hidden app-scroll app-scroll-y app-scroll-gutter bg-white dark:bg-zinc-950"
        >
            <MessagesClientV2
                targetUserId={targetUserId}
                initialConversationId={initialConversationId}
                initialMessageId={initialMessageId}
            />
        </div>
    );
}
