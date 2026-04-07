'use client';

import { MessagesWorkspaceV2 } from './MessagesWorkspaceV2';

interface MessagesClientV2Props {
    targetUserId?: string | null;
    initialConversationId?: string | null;
}

export default function MessagesClientV2({
    targetUserId = null,
    initialConversationId = null,
}: MessagesClientV2Props) {
    return (
        <MessagesWorkspaceV2
            mode="page"
            targetUserId={targetUserId}
            initialConversationId={initialConversationId}
        />
    );
}
