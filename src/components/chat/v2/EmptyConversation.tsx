'use client';

import { MessageSquare } from 'lucide-react';

interface EmptyConversationProps {
    partnerName?: string | null;
}

export function EmptyConversation({ partnerName }: EmptyConversationProps) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <MessageSquare className="h-8 w-8 text-primary/30" />
            </div>
            <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                {partnerName ? `Start a conversation with ${partnerName}` : 'No messages yet'}
            </p>
            <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                Send a message to get started.
            </p>
        </div>
    );
}
