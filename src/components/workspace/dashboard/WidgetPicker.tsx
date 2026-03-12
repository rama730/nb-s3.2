'use client';

import { memo, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import {
    Target,
    AtSign,
    Activity,
    FileClock,
    FolderKanban,
    Gauge,
    HeartPulse,
    Pin,
    AlertTriangle,
    StickyNote,
    MessageSquare,
    Zap,
} from 'lucide-react';
import { WIDGET_REGISTRY, ALL_WIDGET_IDS } from './widgetRegistry';
import type { WidgetId } from './types';

// Map icon names to actual icons (avoids dynamic imports)
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
    Target,
    AtSign,
    Activity,
    FileClock,
    FolderKanban,
    Gauge,
    HeartPulse,
    Pin,
    AlertTriangle,
    StickyNote,
    MessageSquare,
    Zap,
};

interface WidgetPickerProps {
    /** Widget IDs already placed on the grid */
    placedWidgetIds: string[];
    /** Called when user selects a widget */
    onSelect: (widgetId: string) => void;
    /** Called when the picker should close */
    onClose: () => void;
    /** Position for the popover */
    anchorPosition?: { x: number; y: number };
}

function WidgetPicker({ placedWidgetIds, onSelect, onClose, anchorPosition }: WidgetPickerProps) {
    const popoverRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        // Delay to avoid the opening click triggering close
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClick);
        }, 10);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClick);
        };
    }, [onClose]);

    // Close on Escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);

    const placedSet = new Set(placedWidgetIds);

    return (
        <div
            ref={popoverRef}
            className="absolute z-50 w-72 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl overflow-hidden"
            style={
                anchorPosition
                    ? { top: anchorPosition.y, left: anchorPosition.x }
                    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
            }
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Add Widget
                </h4>
                <button
                    onClick={onClose}
                    className="p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                    <X className="w-4 h-4 text-zinc-400" />
                </button>
            </div>

            {/* Widget list */}
            <div className="p-2 max-h-80 overflow-y-auto space-y-1">
                {ALL_WIDGET_IDS.map((id: WidgetId) => {
                    const config = WIDGET_REGISTRY[id];
                    const isPlaced = placedSet.has(id);
                    const Icon = ICON_MAP[config.iconName];

                    return (
                        <button
                            key={id}
                            onClick={() => {
                                if (!isPlaced) {
                                    onSelect(id);
                                    onClose();
                                }
                            }}
                            disabled={isPlaced}
                            className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors ${
                                isPlaced
                                    ? 'opacity-40 cursor-not-allowed'
                                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer'
                            }`}
                        >
                            <div className={`p-1.5 rounded-lg shrink-0 ${config.iconBg}`}>
                                {Icon && <Icon className={`w-4 h-4 ${config.iconColor}`} />}
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                                    {config.label}
                                    {isPlaced && (
                                        <span className="ml-2 text-[10px] text-zinc-400 font-normal">
                                            Already added
                                        </span>
                                    )}
                                </p>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                    {config.description}
                                </p>
                                <p className="text-[10px] text-zinc-400 mt-1">
                                    Min size: {config.minColSpan}x{config.minRowSpan}
                                </p>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export default memo(WidgetPicker);
