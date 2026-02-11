import MessagesClient from '@/components/chat/MessagesClient';

export const dynamic = 'force-dynamic';

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

    return (
        <MessagesClient 
            targetUserId={targetUserId}
            initialConversationId={initialConversationId}
        />
    );
}
