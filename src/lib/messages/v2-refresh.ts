'use client';

import type { QueryClient } from '@tanstack/react-query';
import {
    getConversationSummaryV2,
    getConversationThreadPageV2,
    getUnreadSummaryV2,
} from '@/app/actions/messaging/v2';
import {
    replaceThreadSnapshot,
    setUnreadSummary,
    upsertInboxConversation,
    upsertThreadConversation,
} from './v2-cache';
import { queryKeys } from '@/lib/query-keys';

export async function refreshUnreadCache(queryClient: QueryClient) {
    const unreadResult = await getUnreadSummaryV2();
    if (unreadResult.success && typeof unreadResult.count === 'number') {
        setUnreadSummary(queryClient, unreadResult.count);
        return true;
    }

    return false;
}

export async function refreshConversationSummaryCache(
    queryClient: QueryClient,
    conversationId: string,
    options?: { syncThread?: boolean },
) {
    const result = await getConversationSummaryV2(conversationId);
    if (!result.success || !result.conversation) {
        return null;
    }

    if (options?.syncThread) {
        upsertThreadConversation(queryClient, result.conversation);
    } else {
        upsertInboxConversation(queryClient, result.conversation);
    }
    queryClient.setQueriesData(
        { queryKey: queryKeys.messages.v2.capabilities(conversationId, null) },
        () => result.conversation?.capability,
    );

    return result.conversation;
}

export async function refreshConversationCache(
    queryClient: QueryClient,
    conversationId: string,
    options?: { includeUnread?: boolean },
) {
    const [threadResult, unreadResult] = await Promise.all([
        getConversationThreadPageV2(conversationId, undefined, 30),
        options?.includeUnread ? getUnreadSummaryV2() : Promise.resolve(null),
    ]);

    if (threadResult.success && threadResult.page) {
        replaceThreadSnapshot(queryClient, conversationId, threadResult.page);
        queryClient.setQueriesData(
            { queryKey: queryKeys.messages.v2.capabilities(conversationId, null) },
            () => threadResult.page?.capability,
        );
    } else {
        await refreshConversationSummaryCache(queryClient, conversationId, { syncThread: true });
    }

    if (unreadResult?.success && typeof unreadResult.count === 'number') {
        setUnreadSummary(queryClient, unreadResult.count);
    }

    return threadResult.success && Boolean(threadResult.page);
}
