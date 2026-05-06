'use client';

import React from 'react';

const QUICK_REACTIONS = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'];

interface ReactionQuickBarProps {
    align?: 'start' | 'end';
    onReact: (emoji: string) => void;
    onClose: () => void;
}

export function ReactionQuickBar({ align = 'start', onReact, onClose }: ReactionQuickBarProps) {
    return (
        <div
            className={`msg-reaction-quick-bar absolute -top-12 z-20 flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${
                align === 'end' ? 'right-0' : 'left-0'
            }`}
            onMouseLeave={onClose}
        >
            {QUICK_REACTIONS.map((emoji) => (
                <button
                    key={emoji}
                    type="button"
                    onClick={() => onReact(emoji)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform hover:scale-125 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    aria-label={`React with ${emoji}`}
                >
                    {emoji}
                </button>
            ))}
        </div>
    );
}
