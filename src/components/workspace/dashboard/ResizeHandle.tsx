'use client';

import { memo, useCallback, useRef, useState } from 'react';
import { GRID_COLS } from './types';
import type { WidgetPlacement } from './types';
import { WIDGET_REGISTRY } from './widgetRegistry';

interface ResizeHandleProps {
    placement: WidgetPlacement;
    onResize: (newColSpan: number, newRowSpan: number) => boolean;
}

function ResizeHandle({ placement, onResize }: ResizeHandleProps) {
    const [isResizing, setIsResizing] = useState(false);
    const startRef = useRef<{ x: number; y: number; colSpan: number; rowSpan: number } | null>(null);
    const containerRef = useRef<HTMLElement | null>(null);

    const config = WIDGET_REGISTRY[placement.widgetId as keyof typeof WIDGET_REGISTRY];
    const maxColSpan = config?.maxColSpan ?? 3;
    const maxRowSpan = config?.maxRowSpan ?? 3;
    const minColSpan = config?.minColSpan ?? 1;
    const minRowSpan = config?.minRowSpan ?? 1;

    const handlePointerDown = useCallback(
        (e: React.PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();

            // Find the grid container to compute cell dimensions
            const target = e.currentTarget as HTMLElement;
            const gridEl = target.closest('[data-widget-grid]') as HTMLElement | null;
            if (!gridEl) return;

            containerRef.current = gridEl;
            startRef.current = {
                x: e.clientX,
                y: e.clientY,
                colSpan: placement.colSpan,
                rowSpan: placement.rowSpan,
            };
            setIsResizing(true);

            const cellWidth = gridEl.clientWidth / GRID_COLS;
            const cellHeight = gridEl.clientHeight / Math.max(3, gridEl.children.length > 0 ? 3 : 3);

            // Use estimated row height from grid
            const rowHeight = Math.max(120, cellHeight);

            const handlePointerMove = (moveEvent: PointerEvent) => {
                if (!startRef.current) return;

                const dx = moveEvent.clientX - startRef.current.x;
                const dy = moveEvent.clientY - startRef.current.y;

                const colDelta = Math.round(dx / cellWidth);
                const rowDelta = Math.round(dy / rowHeight);

                const newColSpan = Math.max(
                    minColSpan,
                    Math.min(
                        maxColSpan,
                        startRef.current.colSpan + colDelta,
                        GRID_COLS - placement.col // Don't exceed grid width
                    )
                );
                const newRowSpan = Math.max(
                    minRowSpan,
                    Math.min(maxRowSpan, startRef.current.rowSpan + rowDelta)
                );

                if (
                    newColSpan !== placement.colSpan ||
                    newRowSpan !== placement.rowSpan
                ) {
                    onResize(newColSpan, newRowSpan);
                }
            };

            const handlePointerUp = () => {
                setIsResizing(false);
                startRef.current = null;
                document.removeEventListener('pointermove', handlePointerMove);
                document.removeEventListener('pointerup', handlePointerUp);
            };

            document.addEventListener('pointermove', handlePointerMove);
            document.addEventListener('pointerup', handlePointerUp);
        },
        [placement, onResize, minColSpan, maxColSpan, minRowSpan, maxRowSpan]
    );

    return (
        <div
            onPointerDown={handlePointerDown}
            className={`absolute bottom-1.5 right-1.5 z-10 p-1 rounded-md cursor-se-resize transition-colors shadow-sm ${
                isResizing
                    ? 'bg-blue-100 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-700'
                    : 'bg-white/80 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700'
            }`}
            title="Drag to resize"
        >
            {/* Resize icon — bottom-right diagonal lines */}
            <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                className="text-zinc-400"
            >
                <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="9" y1="5" x2="5" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        </div>
    );
}

export default memo(ResizeHandle);
