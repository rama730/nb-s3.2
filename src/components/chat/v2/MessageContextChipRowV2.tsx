'use client';

import { X } from 'lucide-react';
import type { MessageContextChip } from '@/lib/messages/structured';
import { cn } from '@/lib/utils';

interface MessageContextChipRowV2Props {
    chips: MessageContextChip[];
    tone?: 'default' | 'inverted';
    compact?: boolean;
    onRemove?: (chip: MessageContextChip) => void;
}

function getKindLabel(kind: MessageContextChip['kind']) {
    switch (kind) {
        case 'project':
            return 'Project';
        case 'task':
            return 'Task';
        case 'file':
            return 'File';
        case 'profile':
            return 'Profile';
        default:
            return 'Context';
    }
}

export function MessageContextChipRowV2({
    chips,
    tone = 'default',
    compact = false,
    onRemove,
}: MessageContextChipRowV2Props) {
    if (chips.length === 0) {
        return null;
    }

    return (
        <div className={cn('flex flex-wrap gap-1.5', compact ? 'mt-1.5' : 'mt-2')}>
            {chips.map((chip) => (
                <div
                    key={`${chip.kind}:${chip.id}`}
                    className={cn(
                        'inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] leading-none',
                        tone === 'inverted'
                            ? 'border-white/15 bg-white/10 text-white/85'
                            : 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200',
                    )}
                >
                    <span className={cn(
                        'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                        tone === 'inverted'
                            ? 'bg-white/10 text-white/70'
                            : 'bg-primary/10 text-primary',
                    )}>
                        {getKindLabel(chip.kind)}
                    </span>
                    <span className="min-w-0 truncate font-medium">{chip.label}</span>
                    {chip.subtitle ? (
                        <span className={cn(
                            'min-w-0 truncate text-[10px]',
                            tone === 'inverted' ? 'text-white/60' : 'text-zinc-500 dark:text-zinc-400',
                        )}>
                            {chip.subtitle}
                        </span>
                    ) : null}
                    {onRemove ? (
                        <button
                            type="button"
                            onClick={() => onRemove(chip)}
                            className={cn(
                                'rounded-full p-0.5 transition-colors',
                                tone === 'inverted'
                                    ? 'text-white/60 hover:bg-white/10 hover:text-white'
                                    : 'text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
                            )}
                            aria-label={`Remove ${chip.label}`}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    ) : null}
                </div>
            ))}
        </div>
    );
}
