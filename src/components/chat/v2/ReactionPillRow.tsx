'use client';

import React from 'react';

interface ReactionSummary {
    emoji: string;
    count: number;
    viewerReacted: boolean;
}

interface ReactionPillRowProps {
    reactions: ReactionSummary[];
    onToggleReaction: (emoji: string) => void;
    onShowDetail: (emoji: string) => void;
}

export const ReactionPillRow = React.memo(function ReactionPillRow({ reactions, onToggleReaction, onShowDetail }: ReactionPillRowProps) {
    if (reactions.length === 0) return null;

    return (
        <div className="mt-1 flex flex-wrap gap-1">
            {reactions.map((reaction) => (
                <button
                    key={reaction.emoji}
                    type="button"
                    onClick={() => onToggleReaction(reaction.emoji)}
                    onContextMenu={(e) => { e.preventDefault(); onShowDetail(reaction.emoji); }}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
                        reaction.viewerReacted
                            ? 'bg-primary/10 ring-1 ring-primary/30 text-primary'
                            : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                    }`}
                    aria-label={`${reaction.emoji} ${reaction.count}${reaction.viewerReacted ? ' (you reacted)' : ''}`}
                >
                    <span>{reaction.emoji}</span>
                    <span>{reaction.count}</span>
                </button>
            ))}
        </div>
    );
});
