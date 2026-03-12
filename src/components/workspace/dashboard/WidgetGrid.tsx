'use client';

import { memo, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
    DndContext,
    type DragEndEvent,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import type { WorkspaceLayout, WidgetPlacement, WidgetCardSizeMode } from './types';
import { GRID_COLS, ROW_HEIGHT_PX } from './types';
import { getWidgetCardSizeMode } from './sizeModeUtils';
import { getOccupiedCells, getMaxRow } from './gridEngine';
import GridCell from './GridCell';
import EmptyCell from './EmptyCell';
import WidgetPicker from './WidgetPicker';
import EditToolbar from './EditToolbar';

import TodaysFocus from '../sections/TodaysFocus';
import RecentActivity from '../sections/RecentActivity';
import MyProjectsGrid from '../sections/MyProjectsGrid';
import UrgentItems from '../sections/UrgentItems';
import QuickNotes from '../sections/QuickNotes';
import RecentMessages from '../sections/RecentMessages';
import ShortcutsWidget from '../sections/ShortcutsWidget';
import RecentFilesWidget from '../sections/RecentFilesWidget';
import ProjectHealthWidget from '../sections/ProjectHealthWidget';
import MentionsRequestsWidget from '../sections/MentionsRequestsWidget';
import SprintSnapshotWidget from '../sections/SprintSnapshotWidget';
import PinnedItemsWidget from '../sections/PinnedItemsWidget';

import type {
    WorkspaceMentionsRequestItem,
    WorkspaceProject,
    WorkspaceRecentFile,
    WorkspaceTask,
    RecentActivityItem,
} from '@/app/actions/workspace';
import type { ConversationWithDetails } from '@/app/actions/messaging';

// ============================================================================
// Props
// ============================================================================

interface WidgetGridProps {
    layout: WorkspaceLayout;
    isEditing: boolean;
    data: {
        tasks: WorkspaceTask[];
        projects: WorkspaceProject[];
        conversations: ConversationWithDetails[];
        recentActivity: RecentActivityItem[];
        files: WorkspaceRecentFile[];
        mentionsRequests: WorkspaceMentionsRequestItem[];
    } | null;
    onTaskClick?: (task: WorkspaceTask) => void;
    // Edit mode callbacks
    onAddWidget?: (widgetId: string, col: number, row: number) => boolean;
    onRemoveWidget?: (widgetId: string) => void;
    onPreviewResizeWidget?: (widgetId: string, newColSpan: number, newRowSpan: number) => boolean;
    onCommitLayoutChange?: () => void;
    onDiscardPreview?: () => void;
    onMoveWidget?: (widgetId: string, newCol: number, newRow: number) => boolean;
    // Toolbar callbacks
    onDone?: () => void;
    onCancel?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
    onReset?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    isSaving?: boolean;
}

// ============================================================================
// Widget Renderer — maps widgetId to the actual component
// ============================================================================

interface WidgetRenderData {
    tasks: WorkspaceTask[];
    projects: WorkspaceProject[];
    conversations: ConversationWithDetails[];
    recentActivity: RecentActivityItem[];
    files: WorkspaceRecentFile[];
    mentionsRequests: WorkspaceMentionsRequestItem[];
    urgentTasks: WorkspaceTask[];
    focusTasks: WorkspaceTask[];
}

function renderWidget(
    widgetId: string,
    data: WidgetRenderData,
    sizeMode: WidgetCardSizeMode,
    onTaskClick?: (task: WorkspaceTask) => void
): React.ReactNode {
    switch (widgetId) {
        case 'todays_focus':
            return <TodaysFocus sizeMode={sizeMode} tasks={data.focusTasks.length > 0 ? data.focusTasks : data.tasks} onTaskClick={onTaskClick} />;
        case 'recent_activity':
            return <RecentActivity sizeMode={sizeMode} items={data.recentActivity} />;
        case 'my_projects':
            return <MyProjectsGrid sizeMode={sizeMode} projects={data.projects} />;
        case 'urgent_items':
            return <UrgentItems sizeMode={sizeMode} tasks={data.urgentTasks} onTaskClick={onTaskClick} />;
        case 'recent_files':
            return <RecentFilesWidget sizeMode={sizeMode} files={data.files} />;
        case 'project_health':
            return <ProjectHealthWidget sizeMode={sizeMode} projects={data.projects} />;
        case 'mentions_requests':
            return <MentionsRequestsWidget sizeMode={sizeMode} items={data.mentionsRequests} />;
        case 'quick_notes':
            return <QuickNotes sizeMode={sizeMode} projects={data.projects} />;
        case 'recent_messages':
            return <RecentMessages sizeMode={sizeMode} conversations={data.conversations} />;
        case 'sprint_snapshot':
            return <SprintSnapshotWidget sizeMode={sizeMode} projects={data.projects} />;
        case 'pinned_items':
            return <PinnedItemsWidget sizeMode={sizeMode} onTaskClick={onTaskClick} />;
        case 'quick_actions':
        case 'shortcuts':
            return <ShortcutsWidget sizeMode={sizeMode} />;
        default:
            return <div className="p-4 text-sm text-zinc-400">Unknown widget: {widgetId}</div>;
    }
}

// ============================================================================
// Component
// ============================================================================

function WidgetGrid({
    layout,
    isEditing,
    data,
    onTaskClick,
    onAddWidget,
    onRemoveWidget,
    onPreviewResizeWidget,
    onCommitLayoutChange,
    onDiscardPreview,
    onMoveWidget,
    onDone,
    onCancel,
    onUndo,
    onRedo,
    onReset,
    canUndo = false,
    canRedo = false,
    isSaving = false,
}: WidgetGridProps) {
    // Widget picker state
    const [pickerState, setPickerState] = useState<{
        col: number;
        row: number;
        position: { x: number; y: number };
    } | null>(null);
    const gridRef = useRef<HTMLDivElement | null>(null);
    const [cellWidth, setCellWidth] = useState<number | null>(null);

    useEffect(() => {
        const gridEl = gridRef.current;
        if (!gridEl) return;

        const updateMetrics = () => {
            const width = gridEl.clientWidth;
            if (width > 0) {
                const styles = window.getComputedStyle(gridEl);
                const parsedGap = Number.parseFloat(styles.columnGap || styles.gap || '0');
                const gap = Number.isFinite(parsedGap) ? Math.max(0, parsedGap) : 0;
                const totalGap = gap * Math.max(0, GRID_COLS - 1);
                const usableWidth = Math.max(0, width - totalGap);
                if (usableWidth > 0) {
                    setCellWidth(usableWidth / GRID_COLS);
                }
            }
        };
        updateMetrics();

        const observer = new ResizeObserver(updateMetrics);
        observer.observe(gridEl);
        return () => observer.disconnect();
    }, []);

    // dnd-kit sensor with a small activation distance to distinguish clicks from drags
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 },
        })
    );

    // Compute the visible grid rows (minimum 3, up to actual content)
    const maxRow = getMaxRow(layout.widgets);
    const gridRows = Math.max(3, isEditing ? Math.max(maxRow + 1, 4) : maxRow);

    // Compute empty cells for edit mode
    const occupiedCells = useMemo(
        () => (isEditing ? getOccupiedCells(layout.widgets) : new Set<string>()),
        [isEditing, layout.widgets]
    );

    const emptyCells = useMemo(() => {
        if (!isEditing) return [];
        const cells: { col: number; row: number }[] = [];
        for (let r = 0; r < gridRows; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                if (!occupiedCells.has(`${c}:${r}`)) {
                    cells.push({ col: c, row: r });
                }
            }
        }
        return cells;
    }, [isEditing, gridRows, occupiedCells]);

    // Placed widget IDs for the picker
    const placedWidgetIds = useMemo(
        () => layout.widgets.map(w => w.widgetId),
        [layout.widgets]
    );

    // Handle empty cell click — open picker
    const handleEmptyCellClick = useCallback((col: number, row: number) => {
        // Position the picker near the click target
        setPickerState({ col, row, position: { x: 0, y: 0 } });
    }, []);

    // Handle widget selection from picker
    const handlePickerSelect = useCallback(
        (widgetId: string) => {
            if (pickerState && onAddWidget) {
                onAddWidget(widgetId, pickerState.col, pickerState.row);
            }
            setPickerState(null);
        },
        [pickerState, onAddWidget]
    );

    // Handle drag end — move widget to new grid position
    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            const { active, delta } = event;
            if (!onMoveWidget || !delta) return;

            const placement = active.data.current?.placement as WidgetPlacement | undefined;
            if (!placement) return;
            if (!cellWidth) return;
            const cellHeight = ROW_HEIGHT_PX;

            const colDelta = Math.round(delta.x / cellWidth);
            const rowDelta = Math.round(delta.y / cellHeight);

            if (colDelta === 0 && rowDelta === 0) return;

            const newCol = Math.max(0, Math.min(GRID_COLS - placement.colSpan, placement.col + colDelta));
            const newRow = Math.max(0, placement.row + rowDelta);

            onMoveWidget(placement.widgetId, newCol, newRow);
        },
        [onMoveWidget, cellWidth]
    );

    // Sort widgets by position for mobile stacking order (left-to-right, top-to-bottom)
    const sortedWidgets = useMemo(() => {
        return [...layout.widgets].sort((a, b) => {
            if (a.row !== b.row) return a.row - b.row;
            return a.col - b.col;
        });
    }, [layout.widgets]);

    const widgetData = useMemo<WidgetRenderData>(() => {
        const tasks = data?.tasks ?? [];
        const projects = data?.projects ?? [];
        const conversations = data?.conversations ?? [];
        const recentActivity = data?.recentActivity ?? [];
        const files = data?.files ?? [];
        const mentionsRequests = data?.mentionsRequests ?? [];

        const now = new Date();
        const urgentTasks = tasks.filter(
            (t) => t.priority === 'urgent' || t.priority === 'high' || (t.dueDate && new Date(t.dueDate) < now)
        );
        const focusTasks = tasks.filter(
            (t) => t.priority !== 'urgent' && t.priority !== 'high' && !(t.dueDate && new Date(t.dueDate) < now)
        );

        return { tasks, projects, conversations, recentActivity, files, mentionsRequests, urgentTasks, focusTasks };
    }, [data]);

    const gridContent = (
        <>
            {/* Desktop grid (lg+): 6-column CSS Grid with explicit positioning */}
            <div
                ref={gridRef}
                data-widget-grid
                className="hidden lg:grid gap-3"
                style={{
                    gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
                    gridTemplateRows: `repeat(${gridRows}, minmax(${ROW_HEIGHT_PX}px, 1fr))`,
                }}
            >
                {/* Placed widgets */}
                {layout.widgets.map((placement, index) => (
                    <GridCell
                        key={placement.widgetId}
                        placement={placement}
                        isEditing={isEditing}
                        cellWidth={cellWidth}
                        staggerIndex={index}
                        onRemove={onRemoveWidget}
                        onPreviewResize={onPreviewResizeWidget}
                        onCommitResize={onCommitLayoutChange}
                        onCancelResize={onDiscardPreview}
                    >
                        {renderWidget(placement.widgetId, widgetData, getWidgetCardSizeMode(placement), onTaskClick)}
                    </GridCell>
                ))}

                {/* Empty cells (edit mode only) */}
                {isEditing &&
                    emptyCells.map(({ col, row }) => (
                        <EmptyCell
                            key={`empty-${col}-${row}`}
                            col={col}
                            row={row}
                            onClick={handleEmptyCellClick}
                        />
                    ))}
            </div>

            {/* Mobile/Tablet: single column stack, ordered by grid position */}
            <div className="lg:hidden flex flex-col gap-3">
                {sortedWidgets.map((placement) => (
                    <div key={placement.widgetId} className="min-h-[180px]">
                        {renderWidget(placement.widgetId, widgetData, getWidgetCardSizeMode(placement), onTaskClick)}
                    </div>
                ))}
            </div>
        </>
    );

    return (
        <div className="flex flex-col gap-3 p-4 relative">
            {/* Edit Toolbar */}
            {isEditing && (
                <EditToolbar
                    onDone={onDone ?? (() => {})}
                    onCancel={onCancel ?? (() => {})}
                    onUndo={onUndo ?? (() => {})}
                    onRedo={onRedo ?? (() => {})}
                    onReset={onReset ?? (() => {})}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    isSaving={isSaving}
                />
            )}

            {/* Grid — wrapped in DndContext when editing */}
            {isEditing ? (
                <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                    {gridContent}
                </DndContext>
            ) : (
                gridContent
            )}

            {/* Widget Picker Popover */}
            {pickerState && (
                <WidgetPicker
                    placedWidgetIds={placedWidgetIds}
                    onSelect={handlePickerSelect}
                    onClose={() => setPickerState(null)}
                />
            )}
        </div>
    );
}

export default memo(WidgetGrid);
