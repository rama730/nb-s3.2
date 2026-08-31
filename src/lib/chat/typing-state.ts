import {
    toPresenceTypingUser,
    type PresenceMemberState,
    type PresenceTypingUser,
} from '@/lib/realtime/presence-types';

export function normalizeTrackedConversationIds(
    conversationIds: ReadonlyArray<string | null | undefined>,
): string[] {
    const uniqueIds: string[] = [];
    const seen = new Set<string>();

    for (const conversationId of conversationIds) {
        if (!conversationId || conversationId === 'new' || conversationId.startsWith('draft:') || seen.has(conversationId)) continue;
        seen.add(conversationId);
        uniqueIds.push(conversationId);
    }

    return uniqueIds;
}

export function deriveTypingUsersFromPresenceState(
    members: ReadonlyArray<PresenceMemberState>,
    currentUserId: string | null,
): PresenceTypingUser[] {
    return members
        .filter((member) => member.typing && member.userId !== currentUserId)
        .map((member) => toPresenceTypingUser(member));
}

export function applyTypingDelta(params: {
    currentUsers: ReadonlyArray<PresenceTypingUser>;
    member: PresenceMemberState;
    action: 'upsert' | 'leave';
    currentUserId: string | null;
}): PresenceTypingUser[] {
    const { currentUsers, member, action, currentUserId } = params;
    if (member.userId === currentUserId) {
        return [...currentUsers];
    }

    const typingUser = toPresenceTypingUser(member);
    if (action === 'leave' || !member.typing) {
        return currentUsers.filter((item) => item.id !== typingUser.id);
    }

    const existingIndex = currentUsers.findIndex((item) => item.id === typingUser.id);
    if (existingIndex >= 0) {
        const nextUsers = [...currentUsers];
        nextUsers[existingIndex] = typingUser;
        return nextUsers;
    }

    return [...currentUsers, typingUser];
}
