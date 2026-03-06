"use client";

import React from "react";
import { Copy, FolderInput, Trash2, X } from "lucide-react";

interface MultiSelectActionsBarProps {
    count: number;
    canEdit: boolean;
    onMove: () => void;
    onDelete: () => void;
    onCopyPaths: () => void;
    onClear: () => void;
}

export function MultiSelectActionsBar({
    count,
    canEdit,
    onMove,
    onDelete,
    onCopyPaths,
    onClear,
}: MultiSelectActionsBarProps) {
    if (count < 2) return null;

    return (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-2 fade-in duration-200">
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm shadow-xl">
                <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums mr-1">
                    {count} selected
                </span>

                {canEdit && (
                    <>
                        <button
                            type="button"
                            onClick={onMove}
                            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors"
                            title="Move selected"
                        >
                            <FolderInput className="w-3.5 h-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={onDelete}
                            className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors"
                            title="Delete selected"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    </>
                )}

                <button
                    type="button"
                    onClick={onCopyPaths}
                    className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors"
                    title="Copy paths"
                >
                    <Copy className="w-3.5 h-3.5" />
                </button>

                <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />

                <button
                    type="button"
                    onClick={onClear}
                    className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors"
                    title="Clear selection"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}
