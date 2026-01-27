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
        <div className="flex items-center gap-2 py-2">
            {/* Animated dots */}
            <div className="flex items-center gap-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-2xl">
                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>

            {/* Text */}
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {text}
            </span>
        </div>
    );
}
