'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { WorkspaceLayout } from '@/components/workspace/dashboard/types';
import { DEFAULT_LAYOUT } from '@/components/workspace/dashboard/types';
import { resolveLayout } from '@/components/workspace/dashboard/validation';
import {
    placeWidget,
    removeWidget as removeWidgetEngine,
    resizeWidget as resizeWidgetEngine,
    moveWidget as moveWidgetEngine,
} from '@/components/workspace/dashboard/gridEngine';
import { saveWorkspaceLayout } from '@/app/actions/workspace';
import type { WorkspaceOverviewBaseData } from '@/app/actions/workspace';
import { queryKeys } from '@/lib/query-keys';

const MAX_UNDO = 20;
const MAX_WIDGETS = 12;

interface UseWorkspaceLayoutReturn {
    layout: WorkspaceLayout;
    savedLayout: WorkspaceLayout;
    draftLayout: WorkspaceLayout | null;
    previewLayout: WorkspaceLayout | null;
    isEditing: boolean;
    enterEditMode: () => void;
    exitEditMode: () => void;
    cancelEditMode: () => void;
    addWidget: (widgetId: string, col: number, row: number) => boolean;
    removeWidget: (widgetId: string) => void;
    resizeWidget: (widgetId: string, newColSpan: number, newRowSpan: number) => boolean;
    moveWidget: (widgetId: string, newCol: number, newRow: number) => boolean;
    previewResizeWidget: (widgetId: string, newColSpan: number, newRowSpan: number) => boolean;
    commitLayoutChange: () => void;
    discardPreview: () => void;
    resetLayout: () => void;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    isSaving: boolean;
}

function cloneLayout(layout: WorkspaceLayout): WorkspaceLayout {
    return {
        ...layout,
        widgets: layout.widgets.map((widget) => ({ ...widget })),
        pins: layout.pins ? layout.pins.map((pin) => ({ ...pin })) : [],
        quickNotes: layout.quickNotes ? { ...layout.quickNotes } : undefined,
    };
}

export function useWorkspaceLayout(rawLayout: unknown): UseWorkspaceLayoutReturn {
    const queryClient = useQueryClient();
    const resolvedServerLayout = useMemo(() => resolveLayout(rawLayout), [rawLayout]);

    const [savedLayout, setSavedLayout] = useState<WorkspaceLayout>(resolvedServerLayout);
    const [isEditing, setIsEditing] = useState(false);
    const [draftLayout, setDraftLayout] = useState<WorkspaceLayout | null>(null);
    const [previewLayout, setPreviewLayout] = useState<WorkspaceLayout | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const undoStackRef = useRef<WorkspaceLayout[]>([]);
    const redoStackRef = useRef<WorkspaceLayout[]>([]);
    const saveInFlightRef = useRef(false);
    const queuedSaveRef = useRef<WorkspaceLayout | null>(null);

    useEffect(() => {
        if (isEditing) return;
        setSavedLayout(resolvedServerLayout);
    }, [resolvedServerLayout, isEditing]);

    const layout = previewLayout ?? (isEditing && draftLayout ? draftLayout : savedLayout);

    const pushUndo = useCallback((current: WorkspaceLayout) => {
        undoStackRef.current = [
            ...undoStackRef.current.slice(-MAX_UNDO + 1),
            cloneLayout(current),
        ];
        redoStackRef.current = [];
    }, []);

    const persistLayout = useCallback(async (): Promise<boolean> => {
        if (saveInFlightRef.current) {
            // Already running; active runner will drain queuedSaveRef.
            return false;
        }
        saveInFlightRef.current = true;
        setIsSaving(true);
        let runSucceeded = true;
        try {
            while (queuedSaveRef.current) {
                const nextLayout = queuedSaveRef.current;
                let result: Awaited<ReturnType<typeof saveWorkspaceLayout>>;
                try {
                    result = await saveWorkspaceLayout(nextLayout);
                } catch (error) {
                    const message =
                        error instanceof Error && error.message
                            ? error.message
                            : 'Failed to save layout';
                    toast.error(message);
                    runSucceeded = false;
                    break;
                }
                if (!result.success) {
                    toast.error(result.error || 'Failed to save layout');
                    runSucceeded = false;
                    break;
                }
                // Only clear when the same pending layout was persisted successfully.
                if (queuedSaveRef.current === nextLayout) {
                    queuedSaveRef.current = null;
                }
            }
            return runSucceeded && queuedSaveRef.current === null;
        } finally {
            saveInFlightRef.current = false;
            setIsSaving(false);
            if (runSucceeded && queuedSaveRef.current) {
                // A new save was queued while we were finishing; start another drain pass.
                void persistLayout();
            }
        }
    }, []);

    const queuePersist = useCallback(async (nextLayout: WorkspaceLayout): Promise<boolean> => {
        queuedSaveRef.current = cloneLayout(nextLayout);
        return await persistLayout();
    }, [persistLayout]);

    const enterEditMode = useCallback(() => {
        const snapshot = cloneLayout(savedLayout);
        setDraftLayout(snapshot);
        setPreviewLayout(null);
        undoStackRef.current = [];
        redoStackRef.current = [];
        setIsEditing(true);
    }, [savedLayout]);

    const commitLayoutChange = useCallback(() => {
        if (!isEditing || !draftLayout || !previewLayout) return;
        pushUndo(draftLayout);
        setDraftLayout(cloneLayout(previewLayout));
        setPreviewLayout(null);
    }, [isEditing, draftLayout, previewLayout, pushUndo]);

    const discardPreview = useCallback(() => {
        setPreviewLayout(null);
    }, []);

    const exitEditMode = useCallback(() => {
        if (!isEditing) return;
        const finalLayout = cloneLayout(previewLayout ?? draftLayout ?? savedLayout);

        const persistAndFinalize = async () => {
            const didSave = await queuePersist(finalLayout);
            if (!didSave) return;

            // Keep both cache keys in sync while legacy consumers are still active.
            queryClient.setQueryData<WorkspaceOverviewBaseData | undefined>(
                queryKeys.workspace.overviewBase(),
                (old) => (old ? { ...old, workspaceLayout: finalLayout } : old),
            );
            queryClient.setQueryData(
                queryKeys.workspace.overview(),
                (old: unknown) => {
                    if (!old || typeof old !== 'object') return old;
                    return { ...(old as Record<string, unknown>), workspaceLayout: finalLayout };
                },
            );

            setSavedLayout(finalLayout);
            setDraftLayout(null);
            setPreviewLayout(null);
            setIsEditing(false);
            toast.success('Layout saved');
        };

        void persistAndFinalize();
    }, [isEditing, previewLayout, draftLayout, savedLayout, queryClient, queuePersist]);

    const cancelEditMode = useCallback(() => {
        setIsEditing(false);
        setDraftLayout(null);
        setPreviewLayout(null);
        undoStackRef.current = [];
        redoStackRef.current = [];
    }, []);

    const addWidget = useCallback((widgetId: string, col: number, row: number): boolean => {
        if (!isEditing || !draftLayout) return false;
        if (draftLayout.widgets.length >= MAX_WIDGETS) return false;
        const result = placeWidget(draftLayout, widgetId, col, row);
        if (!result) return false;
        pushUndo(draftLayout);
        setDraftLayout(result);
        setPreviewLayout(null);
        return true;
    }, [isEditing, draftLayout, pushUndo]);

    const removeWidget = useCallback((widgetId: string) => {
        if (!isEditing || !draftLayout) return;
        pushUndo(draftLayout);
        setDraftLayout(removeWidgetEngine(draftLayout, widgetId));
        setPreviewLayout(null);
    }, [isEditing, draftLayout, pushUndo]);

    const resizeWidget = useCallback((widgetId: string, newColSpan: number, newRowSpan: number): boolean => {
        if (!isEditing || !draftLayout) return false;
        const result = resizeWidgetEngine(draftLayout, widgetId, newColSpan, newRowSpan);
        if (!result) return false;
        pushUndo(draftLayout);
        setDraftLayout(result);
        setPreviewLayout(null);
        return true;
    }, [isEditing, draftLayout, pushUndo]);

    const previewResizeWidget = useCallback((widgetId: string, newColSpan: number, newRowSpan: number): boolean => {
        if (!isEditing || !draftLayout) return false;
        const source = previewLayout ?? draftLayout;
        const result = resizeWidgetEngine(source, widgetId, newColSpan, newRowSpan);
        if (!result) return false;
        setPreviewLayout(result);
        return true;
    }, [isEditing, draftLayout, previewLayout]);

    const moveWidget = useCallback((widgetId: string, newCol: number, newRow: number): boolean => {
        if (!isEditing || !draftLayout) return false;
        const result = moveWidgetEngine(draftLayout, widgetId, newCol, newRow);
        if (!result) return false;
        pushUndo(draftLayout);
        setDraftLayout(result);
        setPreviewLayout(null);
        return true;
    }, [isEditing, draftLayout, pushUndo]);

    const resetLayout = useCallback(() => {
        if (!isEditing || !draftLayout) return;
        pushUndo(draftLayout);
        setDraftLayout(cloneLayout(DEFAULT_LAYOUT));
        setPreviewLayout(null);
    }, [isEditing, draftLayout, pushUndo]);

    const undo = useCallback(() => {
        if (!isEditing || !draftLayout || undoStackRef.current.length === 0) return;
        const previous = undoStackRef.current[undoStackRef.current.length - 1];
        undoStackRef.current = undoStackRef.current.slice(0, -1);
        redoStackRef.current = [...redoStackRef.current, cloneLayout(draftLayout)];
        setDraftLayout(cloneLayout(previous));
        setPreviewLayout(null);
    }, [isEditing, draftLayout]);

    const redo = useCallback(() => {
        if (!isEditing || !draftLayout || redoStackRef.current.length === 0) return;
        const next = redoStackRef.current[redoStackRef.current.length - 1];
        redoStackRef.current = redoStackRef.current.slice(0, -1);
        undoStackRef.current = [...undoStackRef.current, cloneLayout(draftLayout)];
        setDraftLayout(cloneLayout(next));
        setPreviewLayout(null);
    }, [isEditing, draftLayout]);

    return {
        layout,
        savedLayout,
        draftLayout,
        previewLayout,
        isEditing,
        enterEditMode,
        exitEditMode,
        cancelEditMode,
        addWidget,
        removeWidget,
        resizeWidget,
        moveWidget,
        previewResizeWidget,
        commitLayoutChange,
        discardPreview,
        resetLayout,
        undo,
        redo,
        canUndo: undoStackRef.current.length > 0,
        canRedo: redoStackRef.current.length > 0,
        isSaving,
    };
}
