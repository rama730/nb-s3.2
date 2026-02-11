'use client';

import { memo, useEffect } from 'react';
import type { WorkspaceOverviewData, WorkspaceTask } from '@/app/actions/workspace';
import { WorkspaceSectionBoundary } from '../WorkspaceSectionBoundary';
import PinnedStrip from '../sections/PinnedStrip';
import WidgetGrid from '../dashboard/WidgetGrid';
import { useWorkspaceLayout } from '@/hooks/useWorkspaceLayout';

interface OverviewTabProps {
    initialData: WorkspaceOverviewData | null;
    onTaskClick?: (task: WorkspaceTask) => void;
    /** Called by parent to trigger edit mode externally (e.g. from header Customize button) */
    onRequestEditMode?: (enter: () => void) => void;
}

function OverviewTab({ initialData, onTaskClick, onRequestEditMode }: OverviewTabProps) {
    const {
        layout,
        isEditing,
        enterEditMode,
        exitEditMode,
        cancelEditMode,
        addWidget,
        removeWidget,
        resizeWidget,
        moveWidget,
        resetLayout,
        undo,
        redo,
        canUndo,
        canRedo,
        isSaving,
    } = useWorkspaceLayout(initialData?.workspaceLayout);

    // Register once per callback change; avoid calling parent mutators during render.
    useEffect(() => {
        onRequestEditMode?.(enterEditMode);
    }, [onRequestEditMode, enterEditMode]);

    return (
        <div className="flex flex-col lg:h-full overflow-y-auto">
            {/* Pinned Items strip — stays above the customizable grid */}
            <WorkspaceSectionBoundary sectionName="Pinned Items">
                <PinnedStrip onTaskClick={onTaskClick} />
            </WorkspaceSectionBoundary>

            {/* Customizable Widget Grid */}
            <WidgetGrid
                layout={layout}
                isEditing={isEditing}
                data={initialData}
                onTaskClick={onTaskClick}
                // Edit mode callbacks
                onAddWidget={addWidget}
                onRemoveWidget={removeWidget}
                onResizeWidget={resizeWidget}
                onMoveWidget={moveWidget}
                // Toolbar callbacks
                onDone={exitEditMode}
                onCancel={cancelEditMode}
                onUndo={undo}
                onRedo={redo}
                onReset={resetLayout}
                canUndo={canUndo}
                canRedo={canRedo}
                isSaving={isSaving}
            />
        </div>
    );
}

export default memo(OverviewTab);
