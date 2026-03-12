'use client';

import { memo } from 'react';
import { GitCompare, Share2, Download, X } from 'lucide-react';

interface BulkActionBarProps {
    selectedCount: number;
    totalCount: number;
    onSelectAll: () => void;
    onCompare: () => void;
    onCancel: () => void;
    onShare: () => void;
    onExport: () => void;
    canCompare: boolean;
}

const BulkActionBar = memo(function BulkActionBar({
    selectedCount,
    totalCount,
    onSelectAll,
    onCompare,
    onCancel,
    onShare,
    onExport,
    canCompare,
}: BulkActionBarProps) {
    if (selectedCount === 0) return null;

    return (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-40 bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-700 px-4 py-3 flex items-center gap-4">
            <div className="flex items-center gap-2 pr-4 border-r border-zinc-200 dark:border-zinc-700">
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {selectedCount} selected
                </span>
                <button
                    onClick={onSelectAll}
                    className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                >
                    {selectedCount === totalCount ? 'Deselect all' : 'Select all'}
                </button>
            </div>

            <div className="flex items-center gap-1">
                <button
                    onClick={onCompare}
                    disabled={!canCompare}
                    className={`p-2 rounded-lg transition-colors ${canCompare
                            ? 'text-zinc-600 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-zinc-800'
                            : 'text-zinc-300 dark:text-zinc-600 cursor-not-allowed'
                        }`}
                    title="Compare selected (2-4 projects)"
                >
                    <GitCompare className="w-5 h-5" />
                </button>
                <button
                    onClick={onShare}
                    className="p-2 text-zinc-600 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                    title="Share"
                >
                    <Share2 className="w-5 h-5" />
                </button>
                <button
                    onClick={onExport}
                    className="p-2 text-zinc-600 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                    title="Export"
                >
                    <Download className="w-5 h-5" />
                </button>
            </div>

            <button
                onClick={onCancel}
                className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                title="Cancel selection"
            >
                <X className="w-5 h-5" />
            </button>
        </div>
    );
});

export default BulkActionBar;
