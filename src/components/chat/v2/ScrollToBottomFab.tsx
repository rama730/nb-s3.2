'use client';

import { ChevronDown } from 'lucide-react';

interface ScrollToBottomFabProps {
    visible: boolean;
    unreadBelow: number;
    onClick: () => void;
}

export function ScrollToBottomFab({ visible, unreadBelow, onClick }: ScrollToBottomFabProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            tabIndex={-1}
            aria-label="Scroll to newest message"
            className={`absolute bottom-20 right-4 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white shadow-lg transition-all duration-200 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${
                visible ? 'scale-100 opacity-100' : 'pointer-events-none scale-75 opacity-0'
            }`}
        >
            <ChevronDown className="h-5 w-5 text-zinc-600 dark:text-zinc-300" />
            {unreadBelow > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {unreadBelow > 99 ? '99+' : unreadBelow}
                </span>
            )}
        </button>
    );
}
