'use client';

import { useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { MessageSquare, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

// ============================================================================
// MESSAGE BUTTON
// Button to start a conversation with a user (from profile, people list, etc.)
// ============================================================================

interface MessageButtonProps {
    userId: string;
    userName?: string;
    variant?: 'default' | 'icon' | 'outline';
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

export function MessageButton({
    userId,
    userName,
    variant = 'default',
    size = 'md',
    className = ''
}: MessageButtonProps) {
    const { user } = useAuth();
    const startConversationWithUser = useChatStore(state => state.startConversationWithUser);
    const [isLoading, setIsLoading] = useState(false);

    // Don't show button for own profile
    if (user?.id === userId) return null;

    // Don't show if not logged in
    if (!user) return null;

    const handleClick = async () => {
        if (isLoading) return;
        setIsLoading(true);

        try {
            await startConversationWithUser(userId);
        } finally {
            setIsLoading(false);
        }
    };

    const sizeClasses = {
        sm: 'px-3 py-1.5 text-sm',
        md: 'px-4 py-2 text-sm',
        lg: 'px-5 py-2.5 text-base',
    };

    const iconSizeClasses = {
        sm: 'w-8 h-8',
        md: 'w-10 h-10',
        lg: 'w-12 h-12',
    };

    const iconInnerClasses = {
        sm: 'w-4 h-4',
        md: 'w-5 h-5',
        lg: 'w-6 h-6',
    };

    if (variant === 'icon') {
        return (
            <button
                onClick={handleClick}
                disabled={isLoading}
                className={`${iconSizeClasses[size]} flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-primary/10 text-zinc-600 dark:text-zinc-300 hover:text-primary transition-colors disabled:opacity-50 ${className}`}
                title={`Message ${userName || 'user'}`}
            >
                {isLoading ? (
                    <Loader2 className={`${iconInnerClasses[size]} animate-spin`} />
                ) : (
                    <MessageSquare className={iconInnerClasses[size]} />
                )}
            </button>
        );
    }

    if (variant === 'outline') {
        return (
            <button
                onClick={handleClick}
                disabled={isLoading}
                className={`${sizeClasses[size]} flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-primary hover:bg-primary/10 text-zinc-700 dark:text-zinc-300 hover:text-primary transition-colors disabled:opacity-50 ${className}`}
            >
                {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <MessageSquare className="w-4 h-4" />
                )}
                <span>Message</span>
            </button>
        );
    }

    // Default variant
    return (
        <button
            onClick={handleClick}
            disabled={isLoading}
            className={`${sizeClasses[size]} flex items-center gap-2 rounded-lg app-accent-solid font-medium shadow-sm hover:shadow-md hover:bg-primary/90 transition-all disabled:opacity-50 ${className}`}
        >
            {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
                <MessageSquare className="w-4 h-4" />
            )}
            <span>Message</span>
        </button>
    );
}
