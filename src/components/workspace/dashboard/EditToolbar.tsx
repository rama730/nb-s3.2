'use client';

import { memo } from 'react';
import { Undo2, Redo2, RotateCcw, Check, X } from 'lucide-react';

interface EditToolbarProps {
    onDone: () => void;
    onCancel: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onReset: () => void;
    canUndo: boolean;
    canRedo: boolean;
    isSaving: boolean;
}

function EditToolbar({
    onDone,
    onCancel,
    onUndo,
    onRedo,
    onReset,
    canUndo,
    canRedo,
    isSaving,
}: EditToolbarProps) {
    return (
        <div className="flex items-center justify-between px-4 py-2.5 bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 rounded-xl backdrop-blur-sm">
            <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                        Editing Layout
                    </span>
                </div>
            </div>

            <div className="flex items-center gap-1.5">
                {/* Undo */}
                <button
                    onClick={onUndo}
                    disabled={!canUndo}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Undo"
                >
                    <Undo2 className="w-4 h-4" />
                </button>

                {/* Redo */}
                <button
                    onClick={onRedo}
                    disabled={!canRedo}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="Redo"
                >
                    <Redo2 className="w-4 h-4" />
                </button>

                <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-1" />

                {/* Reset to Default */}
                <button
                    onClick={onReset}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-white dark:hover:bg-zinc-800 transition-colors"
                    title="Reset to default layout"
                >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                </button>

                <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-1" />

                {/* Cancel */}
                <button
                    onClick={onCancel}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-white dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 transition-colors"
                >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                </button>

                {/* Done / Save */}
                <button
                    onClick={onDone}
                    disabled={isSaving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 transition-colors shadow-sm"
                >
                    <Check className="w-3.5 h-3.5" />
                    {isSaving ? 'Saving...' : 'Done'}
                </button>
            </div>
        </div>
    );
}

export default memo(EditToolbar);
