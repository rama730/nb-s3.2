'use client';

import { useState, useCallback, useRef } from 'react';
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
import type { WorkspaceOverviewData } from '@/app/actions/workspace';

const MAX_UNDO = 20;

interface UseWorkspaceLayoutReturn {
    /** The resolved layout (either user's saved or default) */
    layout: WorkspaceLayout;
    /** Whether the user is currently in edit mode */
    isEditing: boolean;
    /** Enter edit mode — clones current layout for editing */
    enterEditMode: () => void;
    /** Exit edit mode and persist the layout to the server */
    exitEditMode: () => void;
    /** Discard edits and exit edit mode */
    cancelEditMode: () => void;
    /** Add a widget at a position */
    addWidget: (widgetId: string, col: number, row: number) => boolean;
    /** Remove a widget from the layout */
    removeWidget: (widgetId: string) => void;
    /** Resize a widget */
    resizeWidget: (widgetId: string, newColSpan: number, newRowSpan: number) => boolean;
    /** Move a widget to a new position */
    moveWidget: (widgetId: string, newCol: number, newRow: number) => boolean;
    /** Reset the layout to the default */
    resetLayout: () => void;
    /** Undo last edit action */
    undo: () => void;
    /** Redo last undone action */
    redo: () => void;
    /** Whether undo is available */
    canUndo: boolean;
    /** Whether redo is available */
    canRedo: boolean;
    /** Whether the layout is currently being saved */
    isSaving: boolean;
}

export function useWorkspaceLayout(
    rawLayout: unknown
): UseWorkspaceLayoutReturn {
    const queryClient = useQueryClient();

    // The resolved (valid) layout from the server or default
    const savedLayout = resolveLayout(rawLayout);

    // Edit mode state
    const [isEditing, setIsEditing] = useState(false);
    const [editingLayout, setEditingLayout] = useState<WorkspaceLayout | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Undo/redo stacks
    const undoStackRef = useRef<WorkspaceLayout[]>([]);
    const redoStackRef = useRef<WorkspaceLayout[]>([]);

    // The layout to render — editing layout when in edit mode, saved layout otherwise
    const layout = isEditing && editingLayout ? editingLayout : savedLayout;

    // Push current state to undo stack before making a change
    const pushUndo = useCallback((current: WorkspaceLayout) => {
        undoStackRef.current = [
            ...undoStackRef.current.slice(-MAX_UNDO + 1),
            current,
        ];
        // Clear redo stack on new action
        redoStackRef.current = [];
    }, []);

    const enterEditMode = useCallback(() => {
        setEditingLayout(savedLayout);
        undoStackRef.current = [];
        redoStackRef.current = [];
        setIsEditing(true);
    }, [savedLayout]);

    const exitEditMode = useCallback(async () => {
        if (!editingLayout) {
            setIsEditing(false);
            return;
        }

        setIsSaving(true);

        // Optimistic: update React Query cache immediately
        queryClient.setQueryData<WorkspaceOverviewData | undefined>(
            ['workspace', 'overview'],
            (old) => {
                if (!old) return old;
                return { ...old, workspaceLayout: editingLayout };
            }
        );

        setIsEditing(false);

        // Persist to server in background
        try {
            const result = await saveWorkspaceLayout(editingLayout);
            if (!result.success) {
                toast.error('Failed to save layout');
                // Revert optimistic update
                queryClient.setQueryData<WorkspaceOverviewData | undefined>(
                    ['workspace', 'overview'],
                    (old) => {
                        if (!old) return old;
                        return { ...old, workspaceLayout: savedLayout };
                    }
                );
            } else {
                toast.success('Layout saved');
            }
        } catch {
            toast.error('Failed to save layout');
        } finally {
            setIsSaving(false);
            setEditingLayout(null);
        }
    }, [editingLayout, savedLayout, queryClient]);

    const cancelEditMode = useCallback(() => {
        setIsEditing(false);
        setEditingLayout(null);
        undoStackRef.current = [];
        redoStackRef.current = [];
    }, []);

    const addWidget = useCallback((widgetId: string, col: number, row: number): boolean => {
        if (!editingLayout) return false;
        pushUndo(editingLayout);
        const result = placeWidget(editingLayout, widgetId, col, row);
        if (!result) {
            // Revert undo push
            undoStackRef.current.pop();
            return false;
        }
        setEditingLayout(result);
        return true;
    }, [editingLayout, pushUndo]);

    const removeWidgetHandler = useCallback((widgetId: string) => {
        if (!editingLayout) return;
        pushUndo(editingLayout);
        setEditingLayout(removeWidgetEngine(editingLayout, widgetId));
    }, [editingLayout, pushUndo]);

    const resizeWidgetHandler = useCallback((widgetId: string, newColSpan: number, newRowSpan: number): boolean => {
        if (!editingLayout) return false;
        pushUndo(editingLayout);
        const result = resizeWidgetEngine(editingLayout, widgetId, newColSpan, newRowSpan);
        if (!result) {
            undoStackRef.current.pop();
            return false;
        }
        setEditingLayout(result);
        return true;
    }, [editingLayout, pushUndo]);

    const moveWidgetHandler = useCallback((widgetId: string, newCol: number, newRow: number): boolean => {
        if (!editingLayout) return false;
        pushUndo(editingLayout);
        const result = moveWidgetEngine(editingLayout, widgetId, newCol, newRow);
        if (!result) {
            undoStackRef.current.pop();
            return false;
        }
        setEditingLayout(result);
        return true;
    }, [editingLayout, pushUndo]);

    const resetLayout = useCallback(() => {
        if (!editingLayout) return;
        pushUndo(editingLayout);
        setEditingLayout(DEFAULT_LAYOUT);
    }, [editingLayout, pushUndo]);

    const undo = useCallback(() => {
        if (undoStackRef.current.length === 0 || !editingLayout) return;
        redoStackRef.current = [...redoStackRef.current, editingLayout];
        const prev = undoStackRef.current[undoStackRef.current.length - 1];
        undoStackRef.current = undoStackRef.current.slice(0, -1);
        setEditingLayout(prev);
    }, [editingLayout]);

    const redo = useCallback(() => {
        if (redoStackRef.current.length === 0 || !editingLayout) return;
        undoStackRef.current = [...undoStackRef.current, editingLayout];
        const next = redoStackRef.current[redoStackRef.current.length - 1];
        redoStackRef.current = redoStackRef.current.slice(0, -1);
        setEditingLayout(next);
    }, [editingLayout]);

    return {
        layout,
        isEditing,
        enterEditMode,
        exitEditMode,
        cancelEditMode,
        addWidget,
        removeWidget: removeWidgetHandler,
        resizeWidget: resizeWidgetHandler,
        moveWidget: moveWidgetHandler,
        resetLayout,
        undo,
        redo,
        canUndo: undoStackRef.current.length > 0,
        canRedo: redoStackRef.current.length > 0,
        isSaving,
    };
}
