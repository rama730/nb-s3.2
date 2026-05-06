'use client';

import { ChevronDown } from 'lucide-react';

interface ScrollToBottomFabProps {
    visible: boolean;
    showNewMessages?: boolean;
    onClick: () => void;
}

export function ScrollToBottomFab({ visible, showNewMessages = false, onClick }: ScrollToBottomFabProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            tabIndex={-1}
            aria-label={showNewMessages ? 'Jump to new messages' : 'Scroll to newest message'}
            className={`absolute bottom-24 right-5 z-20 flex items-center justify-center gap-2 rounded-full border border-border/70 bg-card text-foreground transition-all duration-200 hover:bg-muted ${
                showNewMessages ? 'h-10 px-3' : 'h-11 w-11'
            } ${
                visible ? 'scale-100 opacity-100' : 'pointer-events-none scale-75 opacity-0'
            }`}
            style={{ boxShadow: 'var(--msg-shadow-lg, 0 12px 30px rgba(15,23,42,0.18))' }}
        >
            {showNewMessages ? (
                <span className="pl-3 text-xs font-semibold">New messages</span>
            ) : null}
            <ChevronDown className="h-5 w-5" />
        </button>
    );
}
