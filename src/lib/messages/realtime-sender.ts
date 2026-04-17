import type { MessageWithSender } from '@/app/actions/messaging';

export type RealtimeSenderIdentity = NonNullable<MessageWithSender['sender']>;

type ViewerIdentitySource = {
    id: string;
    user_metadata?: {
        username?: string | null;
        full_name?: string | null;
        avatar_url?: string | null;
    } | null;
} | null | undefined;

type SenderMessageCandidate = Pick<MessageWithSender, 'senderId' | 'sender'>;

export function buildViewerSenderIdentity(
    viewer: ViewerIdentitySource,
): RealtimeSenderIdentity | null {
    if (!viewer?.id) {
        return null;
    }

    return {
        id: viewer.id,
        username: typeof viewer.user_metadata?.username === 'string'
            ? viewer.user_metadata.username
            : null,
        fullName: typeof viewer.user_metadata?.full_name === 'string'
            ? viewer.user_metadata.full_name
            : null,
        avatarUrl: typeof viewer.user_metadata?.avatar_url === 'string'
            ? viewer.user_metadata.avatar_url
            : null,
    };
}

export function resolveRealtimeMessageSender(params: {
    senderId: string | null;
    viewerIdentity: RealtimeSenderIdentity | null;
    participants?: Array<RealtimeSenderIdentity | null | undefined> | null;
    messages?: Array<SenderMessageCandidate | null | undefined> | null;
}): RealtimeSenderIdentity | null {
    const senderId = params.senderId?.trim() || null;
    if (!senderId) {
        return null;
    }

    if (params.viewerIdentity?.id === senderId) {
        return params.viewerIdentity;
    }

    const cachedMessageSender = (params.messages ?? []).find((message) =>
        message?.senderId === senderId && message.sender?.id === senderId,
    )?.sender;
    if (cachedMessageSender) {
        return cachedMessageSender;
    }

    const participantSender = (params.participants ?? []).find((participant) =>
        participant?.id === senderId,
    );
    return participantSender ?? null;
}
