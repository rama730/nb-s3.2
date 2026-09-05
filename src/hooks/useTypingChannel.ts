'use client';

import { useCallback, useMemo, useRef } from 'react';

import { usePresenceTyping } from './usePresenceTyping';
import { toPresenceTypingUser, type PresenceTypingUser } from '@/lib/realtime/presence-types';

export type TypingUser = PresenceTypingUser;

interface UseTypingChannelReturn {
    typingUsers: TypingUser[];
    sendTyping: (isTyping: boolean) => Promise<void>;
}

function isPresenceEligibleConversationId(conversationId: string): boolean {
    return conversationId !== 'new' && !conversationId.startsWith('draft:');
}

export function useTypingChannel(
    conversationId: string | null,
    options: { listen?: boolean; enabled?: boolean } = { listen: true, enabled: true },
): UseTypingChannelReturn {
    const { listen = true, enabled = true } = options;
    const { typingMembers, sendTyping: sendPresenceTyping } = usePresenceTyping({
        roomType: 'conversation',
        roomId: conversationId,
        enabled,
        listen,
        isEligibleRoomId: isPresenceEligibleConversationId,
    });

    const lastSentRef = useRef<number>(0);
    const typingUsers = useMemo(() => typingMembers.map(toPresenceTypingUser), [typingMembers]);
    const sendTyping = useCallback(async (isTyping: boolean) => {
        const now = Date.now();
        if (isTyping && now - lastSentRef.current < 2500) {
            return;
        }
        lastSentRef.current = isTyping ? now : 0;
        await sendPresenceTyping({
            isTyping,
            context: isTyping ? { scope: 'conversation' } : null,
        });
    }, [sendPresenceTyping]);

    return { typingUsers, sendTyping };
}
