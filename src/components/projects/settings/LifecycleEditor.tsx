"use client";

import React, { useState, useCallback, useId } from "react";
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from "@dnd-kit/core";
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface LifecycleEditorProps {
    initialStages: string[];
    currentStageIndex: number;
    onSave: (stages: string[], currentStageIdentity: string) => Promise<void>;
    isSaving?: boolean;
}

interface SortableStageItemProps {
    id: string;
    name: string;
    isCurrent: boolean;
    isLast: boolean;
    onRename: (newName: string) => void;
    onDelete: () => void;
}

function SortableStageItem({
    id,
    name,
    isCurrent,
    isLast,
    onRename,
    onDelete,
}: SortableStageItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "flex items-center gap-3 p-3 rounded-lg border bg-white dark:bg-zinc-900 transition-all",
                isDragging
                    ? "shadow-lg border-indigo-400 z-10"
                    : "border-zinc-200 dark:border-zinc-700",
                isCurrent && "ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-zinc-900"
            )}
        >
            {/* Drag Handle */}
            <button
                {...attributes}
                {...listeners}
                className="cursor-grab touch-none text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
                <GripVertical className="w-5 h-5" />
            </button>

            {/* Stage Name Input */}
            <input
                type="text"
                value={name}
                onChange={(e) => onRename(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-zinc-900 dark:text-zinc-100 font-medium text-sm focus:ring-0"
                placeholder="Stage name"
            />

            {/* Current Badge */}
            {isCurrent && (
                <span className="px-2 py-0.5 text-xs font-semibold bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-full">
                    Current
                </span>
            )}

            {/* Delete Button */}
            <button
                onClick={onDelete}
                disabled={isLast}
                className={cn(
                    "p-1.5 rounded-md transition-colors",
                    isLast
                        ? "text-zinc-300 dark:text-zinc-600 cursor-not-allowed"
                        : "text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                )}
                title={isLast ? "Cannot delete the last stage" : "Delete stage"}
            >
                <Trash2 className="w-4 h-4" />
            </button>
        </div>
    );
}

export default function LifecycleEditor({
    initialStages,
    currentStageIndex,
    onSave,
    isSaving = false,
}: LifecycleEditorProps) {
    const dndId = useId();

    // Local state for stages (editable copy)
    const [stages, setStages] = useState<{ id: string; name: string }[]>(() =>
        initialStages.map((name, idx) => ({ id: `stage-${idx}`, name }))
    );

    // Track which stage was "current" at load time
    const [currentStageName] = useState(() => initialStages[currentStageIndex] || "");

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setStages((items) => {
                const oldIndex = items.findIndex((i) => i.id === active.id);
                const newIndex = items.findIndex((i) => i.id === over.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    }, []);

    const handleRename = useCallback((id: string, newName: string) => {
        setStages((prev) =>
            prev.map((s) => (s.id === id ? { ...s, name: newName } : s))
        );
    }, []);

    const handleDelete = useCallback((id: string) => {
        setStages((prev) => {
            if (prev.length <= 1) {
                toast.error("You must have at least one stage");
                return prev;
            }
            return prev.filter((s) => s.id !== id);
        });
    }, []);

    const handleAddStage = useCallback(() => {
        setStages((prev) => [
            ...prev,
            { id: `stage-${Date.now()}`, name: "New Stage" },
        ]);
    }, []);

    const handleSave = useCallback(async () => {
        const stageNames = stages.map((s) => s.name.trim()).filter(Boolean);
        if (stageNames.length === 0) {
            toast.error("You must have at least one stage");
            return;
        }
        // Pass the current stage identity so backend can rebalance
        await onSave(stageNames, currentStageName);
    }, [stages, currentStageName, onSave]);

    // Determine which item is currently "current" (by matching name)
    const currentItemId = stages.find((s) => s.name === currentStageName)?.id;

    return (
        <div className="space-y-4">
            <DndContext
                id={dndId}
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
            >
                <SortableContext
                    items={stages.map((s) => s.id)}
                    strategy={verticalListSortingStrategy}
                >
                    <div className="space-y-2">
                        {stages.map((stage) => (
                            <SortableStageItem
                                key={stage.id}
                                id={stage.id}
                                name={stage.name}
                                isCurrent={stage.id === currentItemId}
                                isLast={stages.length === 1}
                                onRename={(newName) => handleRename(stage.id, newName)}
                                onDelete={() => handleDelete(stage.id)}
                            />
                        ))}
                    </div>
                </SortableContext>
            </DndContext>

            {/* Add Stage Button */}
            <button
                onClick={handleAddStage}
                className="flex items-center gap-2 w-full p-3 rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-sm font-medium"
            >
                <Plus className="w-4 h-4" />
                Add Stage
            </button>

            {/* Save Button */}
            <div className="pt-4">
                <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                    {isSaving ? "Saving..." : "Save Lifecycle"}
                </Button>
            </div>
        </div>
    );
}
