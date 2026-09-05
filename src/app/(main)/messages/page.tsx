import { Suspense } from 'react';
import { MessagesWorkspaceV2 } from '@/components/chat/v2/MessagesWorkspaceV2';
import { buildRouteMetadata } from '@/lib/metadata/route-metadata';

export function generateMetadata() {
    return buildRouteMetadata({
        title: 'Messages | NetworkBase',
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
    const initialReplyToMessageId = typeof resolvedParams.replyToMessageId === 'string'
        ? resolvedParams.replyToMessageId
        : null;
    const initialTab = resolvedParams.tab === 'applications' || resolvedParams.tab === 'projects' || resolvedParams.tab === 'chats'
        ? resolvedParams.tab
        : null;
    const initialSearchOpen = resolvedParams.search === 'messages';
    const initialSearchQuery = initialSearchOpen && typeof resolvedParams.q === 'string'
        ? resolvedParams.q.slice(0, 160)
        : '';

    return (
        <div
            data-scroll-root="route"
            data-hardening-messages="v2"
            className="h-full min-h-0 overflow-hidden app-scroll app-scroll-y app-scroll-gutter bg-white dark:bg-zinc-950"
        >
            <Suspense fallback={<div className="flex h-full items-center justify-center text-zinc-400">Loading inbox...</div>}>
                <MessagesWorkspaceV2
                    mode="page"
                    targetUserId={targetUserId}
                    initialConversationId={initialConversationId}
                    initialMessageId={initialMessageId}
                    initialReplyToMessageId={initialReplyToMessageId}
                    initialTab={initialTab}
                    initialSearchOpen={initialSearchOpen}
                    initialSearchQuery={initialSearchQuery}
                />
            </Suspense>
        </div>
    );
}
