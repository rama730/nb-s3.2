'use client';

import React from 'react';
import { BubbleReactions } from '@/components/ui/message';
import { cn } from '@/lib/utils';

interface ReactionSummary {
    emoji: string;
    count: number;
    viewerReacted: boolean;
}

interface ReactionPillRowProps {
    reactions: ReactionSummary[];
    align?: 'start' | 'end';
    onToggleReaction: (emoji: string) => void;
    onShowDetail: (emoji: string) => void;
}

export const ReactionPillRow = React.memo(function ReactionPillRow({
    reactions,
    align = 'end',
    onToggleReaction,
    onShowDetail,
}: ReactionPillRowProps) {
    if (reactions.length === 0) return null;
    const visibleReactions = reactions.slice(0, 3);
    const additionalReactionCount = reactions.length - visibleReactions.length;
    return (
        <BubbleReactions
            side="bottom"
            align={align}
            role="group"
            aria-label="Message reactions"
            className="gap-0.5 p-0.5"
        >
            {visibleReactions.map((reaction) => (
                <button
                    key={reaction.emoji}
                    type="button"
                    onClick={() => onToggleReaction(reaction.emoji)}
                    onContextMenu={(e) => { e.preventDefault(); onShowDetail(reaction.emoji); }}
                    className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 px-1.5 py-0.5",
                        reaction.viewerReacted
                            ? "text-primary hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    )}
                    aria-label={`${reaction.emoji}, ${reaction.count} reaction${reaction.count === 1 ? '' : 's'}${reaction.viewerReacted ? ' (you reacted)' : ''}`}
                    aria-pressed={reaction.viewerReacted}
                >
                    <span aria-hidden="true" className="select-none leading-none text-base">{reaction.emoji}</span>
                    {reaction.count > 1 ? (
                        <span aria-hidden="true" className="tabular-nums leading-none text-[13px]">{reaction.count}</span>
                    ) : null}
                </button>
            ))}
            {additionalReactionCount > 0 ? (
                <span aria-hidden="true" className="px-1 text-xs font-semibold tabular-nums text-muted-foreground shrink-0">
                    +{additionalReactionCount}
                </span>
            ) : null}
        </BubbleReactions>
    );
});
