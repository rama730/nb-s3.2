'use client';

import { MessageSquare } from 'lucide-react';

interface EmptyConversationProps {
    partnerName?: string | null;
}

export function EmptyConversation({ partnerName }: EmptyConversationProps) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary/8 ring-1 ring-primary/15">
                <MessageSquare className="h-9 w-9 text-primary/60" />
            </div>
            <p className="text-base font-semibold text-foreground">
                {partnerName ? `Say hi to ${partnerName}` : 'No messages yet'}
            </p>
            <p className="mt-1.5 max-w-[260px] text-xs text-muted-foreground">
                Drop a quick hello below to start the conversation.
            </p>
        </div>
    );
}
