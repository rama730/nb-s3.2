'use client';

import { memo, useEffect } from 'react';
import type {
    RecentActivityItem,
    WorkspaceOverviewBaseData,
    WorkspaceProject,
    WorkspaceTask,
} from '@/app/actions/workspace';
import type { ConversationWithDetails } from '@/app/actions/messaging';
import WidgetGrid from '../dashboard/WidgetGrid';
import { useWorkspaceLayout } from '@/hooks/useWorkspaceLayout';
import { useWorkspaceOverviewSections } from '@/hooks/useWorkspaceOverviewSections';

interface OverviewTabProps {
    initialData: WorkspaceOverviewBaseData | null;
    initialSections?: {
        tasks?: WorkspaceTask[];
        projects?: WorkspaceProject[];
        conversations?: ConversationWithDetails[];
        recentActivity?: RecentActivityItem[];
    } | null;
    onTaskClick?: (task: WorkspaceTask) => void;
    onRequestEditMode?: (enter: () => void) => void;
}

function OverviewTab({ initialData, initialSections, onTaskClick, onRequestEditMode }: OverviewTabProps) {
    const {
        layout,
        isEditing,
        enterEditMode,
        exitEditMode,
        cancelEditMode,
        addWidget,
        removeWidget,
        previewResizeWidget,
        moveWidget,
        commitLayoutChange,
        discardPreview,
        resetLayout,
        undo,
        redo,
        canUndo,
        canRedo,
        isSaving,
    } = useWorkspaceLayout(initialData?.workspaceLayout);

    const sectionData = useWorkspaceOverviewSections({
        widgetIds: layout.widgets.map((widget) => widget.widgetId),
        initialData: initialSections,
    });

    useEffect(() => {
        onRequestEditMode?.(enterEditMode);
    }, [onRequestEditMode, enterEditMode]);

    return (
        <div className="flex flex-col lg:h-full overflow-y-auto">
            <WidgetGrid
                layout={layout}
                isEditing={isEditing}
                data={sectionData}
                onTaskClick={onTaskClick}
                onAddWidget={addWidget}
                onRemoveWidget={removeWidget}
                onPreviewResizeWidget={previewResizeWidget}
                onCommitLayoutChange={commitLayoutChange}
                onDiscardPreview={discardPreview}
                onMoveWidget={moveWidget}
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
