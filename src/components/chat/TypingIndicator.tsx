'use client';

import { getTypingStatusText } from '@/lib/chat/typing-display';
import { cn } from '@/lib/utils';

// ============================================================================
// TYPING INDICATOR
// WhatsApp-style animated dots with name label
// Supports two variants: 'chat' (thread footer) and 'inline' (conversation list)
// ============================================================================

interface TypingUser {
    id: string;
    username: string | null;
    fullName: string | null;
}

interface TypingIndicatorProps {
    users: ReadonlyArray<TypingUser>;
    variant?: 'chat' | 'inline';
    className?: string;
}

const DOT_STYLE_BASE = 'inline-block rounded-full';

function TypingDots({ size = 'md' }: { size?: 'sm' | 'md' }) {
    const dotSize = size === 'sm' ? 'w-[5px] h-[5px]' : 'w-1.5 h-1.5';
    const gap = size === 'sm' ? 'gap-[3px]' : 'gap-1.5';
    return (
        <span className={cn('inline-flex items-center', gap)} aria-hidden="true">
            <span
                className={cn(DOT_STYLE_BASE, dotSize, 'bg-zinc-400 dark:bg-zinc-500')}
                style={{ animation: 'typing-dot 1.4s ease-in-out infinite', animationDelay: '0ms' }}
            />
            <span
                className={cn(DOT_STYLE_BASE, dotSize, 'bg-zinc-400 dark:bg-zinc-500')}
                style={{ animation: 'typing-dot 1.4s ease-in-out infinite', animationDelay: '200ms' }}
            />
            <span
                className={cn(DOT_STYLE_BASE, dotSize, 'bg-zinc-400 dark:bg-zinc-500')}
                style={{ animation: 'typing-dot 1.4s ease-in-out infinite', animationDelay: '400ms' }}
            />
        </span>
    );
}

export function TypingIndicator({ users, variant = 'chat', className }: TypingIndicatorProps) {
    if (users.length === 0) return null;

    const text = getTypingStatusText(users, { ellipsis: true });

    if (variant === 'inline') {
        const textWithoutEllipsis = getTypingStatusText(users);
        return (
            <span className={cn('inline-flex items-center gap-1.5 text-primary/70', className)}>
                <TypingDots size="sm" />
                <span className="truncate text-[12px] font-medium italic leading-5">
                    {textWithoutEllipsis}
                </span>
            </span>
        );
    }

    return (
        <div className={cn(
            'mb-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 font-normal italic animate-in fade-in duration-200',
            className,
        )}>
            <TypingDots size="sm" />
            <span className="animate-pulse">{text}</span>
        </div>
    );
}
