import type { PresenceMemberState } from '@/lib/realtime/presence-types';
import type { TypingUser } from '@/hooks/useTypingChannel';

function toTypingUser(member: PresenceMemberState): TypingUser {
    return {
        id: member.userId,
        username: member.profile?.username ?? null,
        fullName: member.profile?.fullName ?? member.userName ?? null,
        avatarUrl: member.profile?.avatarUrl ?? null,
    };
}

export function normalizeTrackedConversationIds(
    conversationIds: ReadonlyArray<string | null | undefined>,
): string[] {
    const uniqueIds: string[] = [];
    const seen = new Set<string>();

    for (const conversationId of conversationIds) {
        if (!conversationId || conversationId === 'new' || seen.has(conversationId)) continue;
        seen.add(conversationId);
        uniqueIds.push(conversationId);
    }

    return uniqueIds;
}

export function deriveTypingUsersFromPresenceState(
    members: ReadonlyArray<PresenceMemberState>,
    currentUserId: string | null,
): TypingUser[] {
    return members
        .filter((member) => member.typing && member.userId !== currentUserId)
        .map((member) => toTypingUser(member));
}

export function applyTypingDelta(params: {
    currentUsers: ReadonlyArray<TypingUser>;
    member: PresenceMemberState;
    action: 'upsert' | 'leave';
    currentUserId: string | null;
}): TypingUser[] {
    const { currentUsers, member, action, currentUserId } = params;
    if (member.userId === currentUserId) {
        return [...currentUsers];
    }

    const typingUser = toTypingUser(member);
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
