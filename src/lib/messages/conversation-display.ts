export type ConversationDisplayType = 'dm' | 'group' | 'project_group';

export interface ConversationDisplayParticipant {
    username?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
}

export interface ConversationDisplay {
    title: string;
    avatarUrl: string | null;
    subtitle: string;
}

export function buildConversationDisplay(input: {
    type: ConversationDisplayType;
    participants?: ConversationDisplayParticipant[];
    projectTitle?: string | null;
    configuredTitle?: string | null;
    configuredAvatarUrl?: string | null;
}): ConversationDisplay {
    const participants = input.participants ?? [];
    const participantNames = participants
        .map((participant) => participant.fullName?.trim() || participant.username?.trim() || null)
        .filter((name): name is string => Boolean(name));

    if (input.type === 'project_group') {
        return {
            title: input.projectTitle?.trim() || input.configuredTitle?.trim() || 'Project conversation',
            avatarUrl: input.configuredAvatarUrl ?? null,
            subtitle: 'Project',
        };
    }

    if (input.type === 'group') {
        return {
            title: input.configuredTitle?.trim()
                || participantNames.slice(0, 3).join(', ')
                || 'Group conversation',
            avatarUrl: input.configuredAvatarUrl ?? null,
            subtitle: 'Group',
        };
    }

    const peer = participants[0] ?? null;
    return {
        title: participantNames[0] || 'Direct message',
        avatarUrl: peer?.avatarUrl ?? null,
        subtitle: 'Direct message',
    };
}
