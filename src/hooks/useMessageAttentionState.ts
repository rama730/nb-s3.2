'use client';

import { useEffect, useMemo } from 'react';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';
import {
    deriveMessageAttention,
    type MessageAttentionConversationLike,
    type MessageAttentionState,
} from '@/lib/messages/attention';

export function useMessageAttentionState<TConversation extends MessageAttentionConversationLike>(
    conversations: readonly TConversation[],
    viewerId: string | null | undefined,
) {
    const storedAttention = useMessagesV2UiStore((state) => state.messageAttentionByConversation);
    const batchUpsertMessageAttention = useMessagesV2UiStore((state) => state.batchUpsertMessageAttention);
    const clearMessageAttentionSmooth = useMessagesV2UiStore((state) => state.clearMessageAttentionSmooth);

    useEffect(() => {
        const toUpsert: Record<string, MessageAttentionState> = {};
        const toClear: string[] = [];

        for (const conversation of conversations) {
            const derived = deriveMessageAttention(conversation, viewerId, 'startup-sync');
            const existing = storedAttention[conversation.id];
            if (derived) {
                if (
                    !existing
                    || existing.latestNewMessageId !== derived.latestNewMessageId
                ) {
                    toUpsert[conversation.id] = derived;
                }
            } else if (existing?.hasNewMessages && !existing.clearing) {
                toClear.push(conversation.id);
            }
        }

        if (Object.keys(toUpsert).length > 0) {
            batchUpsertMessageAttention(toUpsert);
        }
        if (toClear.length > 0) {
            clearMessageAttentionSmooth(toClear);
        }
    }, [
        batchUpsertMessageAttention,
        clearMessageAttentionSmooth,
        conversations,
        storedAttention,
        viewerId,
    ]);

    return useMemo(() => {
        const attentionByConversation = new Map<string, MessageAttentionState>();
        const attentionConversations: TConversation[] = [];
        const normalConversations: TConversation[] = [];

        for (const conversation of conversations) {
            const stored = storedAttention[conversation.id];
            const derived = deriveMessageAttention(conversation, viewerId, 'startup-sync');
            const attention = stored ?? derived;
            if (attention?.hasNewMessages || attention?.clearing) {
                attentionByConversation.set(conversation.id, attention);
                attentionConversations.push(conversation);
            } else {
                normalConversations.push(conversation);
            }
        }

        return {
            attentionByConversation,
            attentionConversations,
            normalConversations,
            hasAttention: attentionConversations.length > 0,
        };
    }, [conversations, storedAttention, viewerId]);
}
