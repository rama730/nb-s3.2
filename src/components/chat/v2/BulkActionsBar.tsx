'use client';

import { Copy, Trash2, X } from 'lucide-react';

interface BulkActionsBarProps {
    selectedCount: number;
    onDelete: () => void;
    onCopy: () => void;
    onCancel: () => void;
}

export function BulkActionsBar({ selectedCount, onDelete, onCopy, onCancel }: BulkActionsBarProps) {
    return (
        <div className="flex items-center justify-between border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {selectedCount} selected
            </span>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={onCopy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    aria-label="Copy selected messages"
                >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                </button>
                <button
                    type="button"
                    onClick={onDelete}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600"
                    aria-label="Delete selected messages"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    aria-label="Cancel selection"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}
