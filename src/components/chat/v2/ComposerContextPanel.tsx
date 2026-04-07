'use client';

import type { MessageContextChip } from '@/lib/messages/structured';
import { MessageContextChipRowV2 } from './MessageContextChipRowV2';

interface ComposerContextPanelProps {
    chips: MessageContextChip[];
    hasStructuredDraft: boolean;
    onClear: () => void;
    onRemove: (chip: MessageContextChip) => void;
}

export function ComposerContextPanel({
    chips,
    hasStructuredDraft,
    onClear,
    onRemove,
}: ComposerContextPanelProps) {
    if (chips.length === 0) {
        return null;
    }

    return (
        <div className="mb-3 rounded-2xl border border-zinc-200 bg-zinc-50/80 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/70">
            <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {hasStructuredDraft ? 'Card context' : 'Message context'}
                </div>
                <button
                    type="button"
                    onClick={onClear}
                    className="text-xs text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                    Clear
                </button>
            </div>
            <MessageContextChipRowV2 chips={chips} onRemove={onRemove} />
        </div>
    );
}
