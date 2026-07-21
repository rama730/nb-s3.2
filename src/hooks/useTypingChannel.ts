'use client';

import { useCallback, useMemo } from 'react';

import { usePresenceTyping } from './usePresenceTyping';
import type { PresenceMemberState } from '@/lib/realtime/presence-types';

export interface TypingUser {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
}

interface UseTypingChannelReturn {
    typingUsers: TypingUser[];
    sendTyping: (isTyping: boolean) => Promise<void>;
}

function isPresenceEligibleConversationId(conversationId: string): boolean {
    return conversationId !== 'new' && !conversationId.startsWith('draft:');
}

function toTypingUser(member: PresenceMemberState): TypingUser {
    return {
        id: member.userId,
        username: member.profile?.username ?? null,
        fullName: member.profile?.fullName ?? member.userName ?? null,
        avatarUrl: member.profile?.avatarUrl ?? null,
    };
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

    const typingUsers = useMemo(() => typingMembers.map(toTypingUser), [typingMembers]);
    const sendTyping = useCallback(async (isTyping: boolean) => {
        await sendPresenceTyping({
            isTyping,
            context: isTyping ? { scope: 'conversation' } : null,
        });
    }, [sendPresenceTyping]);

    return { typingUsers, sendTyping };
}
