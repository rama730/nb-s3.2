'use client';

import { memo } from 'react';
import { Plus } from 'lucide-react';

interface EmptyCellProps {
    col: number;
    row: number;
    onClick: (col: number, row: number) => void;
}

function EmptyCell({ col, row, onClick }: EmptyCellProps) {
    return (
        <button
            onClick={() => onClick(col, row)}
            className="flex items-center justify-center rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all group"
            style={{
                gridColumn: `${col + 1} / span 1`,
                gridRow: `${row + 1} / span 1`,
            }}
            title="Add widget"
        >
            <Plus className="w-5 h-5 text-zinc-300 dark:text-zinc-700 group-hover:text-blue-400 dark:group-hover:text-blue-500 transition-colors" />
        </button>
    );
}

export default memo(EmptyCell);
