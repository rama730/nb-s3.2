'use client';

import { useMemo } from 'react';

import { useConversationTypingIndex } from './useConversationTypingIndex';
import { useTypingChannel } from './useTypingChannel';

interface UseChatTypingStateParams {
    activeConversationId: string | null;
    visibleConversationIds: ReadonlyArray<string>;
    enabled?: boolean;
    listVisible?: boolean;
}

export function useChatTypingState({
    activeConversationId,
    visibleConversationIds,
    enabled = true,
    listVisible = true,
}: UseChatTypingStateParams) {
    const { typingUsers: activeTypingUsers, sendTyping } = useTypingChannel(activeConversationId, { listen: true, enabled });
    const trackedConversationIds = useMemo(
        () => !enabled || !listVisible
            ? []
            : visibleConversationIds.filter((conversationId) => conversationId !== activeConversationId),
        [activeConversationId, enabled, listVisible, visibleConversationIds],
    );
    const listTypingUsersByConversation = useConversationTypingIndex(trackedConversationIds, { enabled: enabled && listVisible });
    const typingUsersByConversation = useMemo(
        () => activeConversationId && activeTypingUsers.length > 0
            ? { ...listTypingUsersByConversation, [activeConversationId]: activeTypingUsers }
            : listTypingUsersByConversation,
        [activeConversationId, activeTypingUsers, listTypingUsersByConversation],
    );

    return {
        activeTypingUsers,
        sendTyping,
        typingUsersByConversation,
    };
}
