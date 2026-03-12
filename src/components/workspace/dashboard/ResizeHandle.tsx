'use client';

import { memo, useCallback, useRef, useState } from 'react';
import { GRID_COLS, ROW_HEIGHT_PX } from './types';
import type { WidgetPlacement } from './types';
import { WIDGET_REGISTRY } from './widgetRegistry';

interface ResizeHandleProps {
    placement: WidgetPlacement;
    cellWidth: number | null;
    onPreviewResize: (newColSpan: number, newRowSpan: number) => boolean;
    onCommitResize: () => void;
    onCancelResize: () => void;
}

function ResizeHandle({
    placement,
    cellWidth,
    onPreviewResize,
    onCommitResize,
    onCancelResize,
}: ResizeHandleProps) {
    const [isResizing, setIsResizing] = useState(false);
    const startRef = useRef<{ x: number; y: number; colSpan: number; rowSpan: number } | null>(null);
    const pendingRef = useRef(false);

    const config = WIDGET_REGISTRY[placement.widgetId as keyof typeof WIDGET_REGISTRY];
    const maxColSpan = config?.maxColSpan ?? 3;
    const maxRowSpan = config?.maxRowSpan ?? 3;
    const minColSpan = config?.minColSpan ?? 1;
    const minRowSpan = config?.minRowSpan ?? 1;

    const handlePointerDown = useCallback(
        (e: React.PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const measuredWidth = cellWidth ?? (() => {
                const gridEl = (e.currentTarget as HTMLElement).closest('[data-widget-grid]') as HTMLElement | null;
                if (!gridEl) return 0;
                const width = gridEl.clientWidth;
                if (width <= 0) return 0;
                const styles = window.getComputedStyle(gridEl);
                const parsedGap = Number.parseFloat(styles.columnGap || styles.gap || '0');
                const gap = Number.isFinite(parsedGap) ? Math.max(0, parsedGap) : 0;
                const totalGap = gap * Math.max(0, GRID_COLS - 1);
                const usableWidth = Math.max(0, width - totalGap);
                return usableWidth > 0 ? usableWidth / GRID_COLS : 0;
            })();
            if (measuredWidth <= 0) return;

            startRef.current = {
                x: e.clientX,
                y: e.clientY,
                colSpan: placement.colSpan,
                rowSpan: placement.rowSpan,
            };
            pendingRef.current = false;
            setIsResizing(true);

            const handlePointerMove = (moveEvent: PointerEvent) => {
                if (!startRef.current) return;

                const dx = moveEvent.clientX - startRef.current.x;
                const dy = moveEvent.clientY - startRef.current.y;

                const colDelta = Math.round(dx / measuredWidth);
                const rowDelta = Math.round(dy / ROW_HEIGHT_PX);

                const newColSpan = Math.max(
                    minColSpan,
                    Math.min(
                        maxColSpan,
                        startRef.current.colSpan + colDelta,
                        GRID_COLS - placement.col,
                    ),
                );
                const newRowSpan = Math.max(
                    minRowSpan,
                    Math.min(maxRowSpan, startRef.current.rowSpan + rowDelta),
                );

                if (newColSpan === placement.colSpan && newRowSpan === placement.rowSpan) return;
                pendingRef.current = onPreviewResize(newColSpan, newRowSpan) || pendingRef.current;
            };

            const handlePointerUp = () => {
                setIsResizing(false);
                if (pendingRef.current) {
                    onCommitResize();
                } else {
                    onCancelResize();
                }
                pendingRef.current = false;
                startRef.current = null;
                document.removeEventListener('pointermove', handlePointerMove);
                document.removeEventListener('pointerup', handlePointerUp);
            };

            document.addEventListener('pointermove', handlePointerMove);
            document.addEventListener('pointerup', handlePointerUp);
        },
        [
            placement,
            cellWidth,
            minColSpan,
            maxColSpan,
            minRowSpan,
            maxRowSpan,
            onPreviewResize,
            onCommitResize,
            onCancelResize,
        ],
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
