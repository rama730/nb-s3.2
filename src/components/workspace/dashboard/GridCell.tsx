'use client';

import { memo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { GripVertical, X } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { WorkspaceSectionBoundary } from '../WorkspaceSectionBoundary';
import ResizeHandle from './ResizeHandle';
import type { WidgetPlacement } from './types';
import { WIDGET_REGISTRY } from './widgetRegistry';

interface GridCellProps {
    placement: WidgetPlacement;
    isEditing: boolean;
    staggerIndex: number;
    onRemove?: (widgetId: string) => void;
    onResize?: (widgetId: string, newColSpan: number, newRowSpan: number) => boolean;
    children: React.ReactNode;
}

function GridCell({
    placement,
    isEditing,
    staggerIndex,
    onRemove,
    onResize,
    children,
}: GridCellProps) {
    const config = WIDGET_REGISTRY[placement.widgetId as keyof typeof WIDGET_REGISTRY];

    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: placement.widgetId,
        disabled: !isEditing,
        data: { placement },
    });

    const handleRemove = useCallback(() => {
        onRemove?.(placement.widgetId);
    }, [onRemove, placement.widgetId]);

    const handleResize = useCallback(
        (newColSpan: number, newRowSpan: number) => {
            return onResize?.(placement.widgetId, newColSpan, newRowSpan) ?? false;
        },
        [onResize, placement.widgetId]
    );

    // CSS Grid positioning via inline styles
    const gridStyle: React.CSSProperties = {
        gridColumn: `${placement.col + 1} / span ${placement.colSpan}`,
        gridRow: `${placement.row + 1} / span ${placement.rowSpan}`,
        ...(transform
            ? {
                  transform: CSS.Translate.toString(transform),
                  zIndex: 50,
                  opacity: 0.9,
              }
            : {}),
    };

    return (
        <motion.div
            ref={isEditing ? setNodeRef : undefined}
            className={`relative min-h-0 ${isDragging ? 'z-50' : ''}`}
            style={gridStyle}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: staggerIndex * 0.05 }}
            layout={isEditing}
        >
            {/* Edit mode overlay */}
            {isEditing && (
                <>
                    {/* Drag handle */}
                    <div
                        {...attributes}
                        {...listeners}
                        className="absolute top-1.5 left-1.5 z-10 p-1 rounded-md bg-white/80 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 cursor-grab active:cursor-grabbing hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors shadow-sm"
                        title="Drag to move"
                    >
                        <GripVertical className="w-3.5 h-3.5 text-zinc-500" />
                    </div>

                    {/* Remove button */}
                    <button
                        onClick={handleRemove}
                        className="absolute top-1.5 right-1.5 z-10 p-1 rounded-md bg-white/80 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 hover:bg-rose-50 dark:hover:bg-rose-900/30 hover:border-rose-300 dark:hover:border-rose-700 transition-colors shadow-sm group"
                        title={`Remove ${config?.label ?? 'widget'}`}
                    >
                        <X className="w-3.5 h-3.5 text-zinc-400 group-hover:text-rose-500 transition-colors" />
                    </button>

                    {/* Resize handle */}
                    <ResizeHandle
                        placement={placement}
                        onResize={handleResize}
                    />

                    {/* Edit border ring */}
                    <div className="absolute inset-0 rounded-xl border-2 border-dashed border-blue-300 dark:border-blue-700 pointer-events-none z-[5]" />
                </>
            )}

            {/* Widget content */}
            <WorkspaceSectionBoundary sectionName={config?.label ?? placement.widgetId}>
                <div className="h-full">{children}</div>
            </WorkspaceSectionBoundary>
        </motion.div>
    );
}

export default memo(GridCell);
