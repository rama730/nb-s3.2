'use client';

// ============================================================================
// TYPING INDICATOR
// Shows animated dots when someone is typing
// ============================================================================

interface TypingUser {
    id: string;
    username: string | null;
    fullName: string | null;
}

interface TypingIndicatorProps {
    users: TypingUser[];
}

export function TypingIndicator({ users }: TypingIndicatorProps) {
    if (users.length === 0) return null;

    const displayName = users[0].fullName || users[0].username || 'Someone';
    const text = users.length === 1
        ? `${displayName} is typing`
        : users.length === 2
            ? `${displayName} and ${users[1].fullName || users[1].username} are typing`
            : `${displayName} and ${users.length - 1} others are typing`;

    return (
        <div className="flex items-end gap-2 mb-2 animate-in fade-in slide-in-from-bottom-1 duration-200 pl-4">
            {/* Avatar Placeholder for alignment with messages */}
            {/* <div className="w-8 shrink-0" /> */}
            
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 px-3 py-2 bg-zinc-100 dark:bg-zinc-800/80 rounded-2xl rounded-bl-sm w-fit border border-zinc-200 dark:border-zinc-700/50">
                    <span className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce [animation-duration:600ms]" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce [animation-duration:600ms]" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-zinc-400 dark:bg-zinc-500 rounded-full animate-bounce [animation-duration:600ms]" style={{ animationDelay: '300ms' }} />
                </div>
                {users.length > 1 && (
                     <span className="text-[10px] font-medium text-zinc-400 ml-1">
                        {text}
                    </span>
                )}
            </div>
        </div>
    );
}
