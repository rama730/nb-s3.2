"use client";

import React, { useState } from "react";
import { Plus, X, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { createSubtaskAction, toggleSubtaskAction, deleteSubtaskAction } from "@/app/actions/subtask";

import { useTaskSubtasks } from "@/hooks/useTaskSubtasks";

interface SubtasksTabProps {
    taskId: string;
    isOwnerOrMember: boolean;
    projectId: string;
}

export default function SubtasksTab({ taskId, isOwnerOrMember, projectId }: SubtasksTabProps) {
    const { subtasks, isLoading } = useTaskSubtasks(taskId);
    const [newSubtask, setNewSubtask] = useState("");
    const [isAdding, setIsAdding] = useState(false);

    const handleAdd = async () => {
        if (!newSubtask.trim() || !isOwnerOrMember) return;
        
        setIsAdding(true);
        try {
            const result = await createSubtaskAction(taskId, newSubtask, projectId);
            if (result.success) {
                setNewSubtask("");
            }
        } catch (error) {
            console.error("Error adding subtask:", error);
        } finally {
            setIsAdding(false);
        }
    };

    const handleToggle = async (subtaskId: string, completed: boolean) => {
        if (!isOwnerOrMember) return;
        
        try {
            await toggleSubtaskAction(subtaskId, !completed, projectId);
        } catch (error) {
            console.error("Error toggling subtask:", error);
        }
    };

    const handleDelete = async (subtaskId: string) => {
        if (!isOwnerOrMember) return;
        
        try {
            await deleteSubtaskAction(subtaskId, projectId);
        } catch (error) {
            console.error("Error deleting subtask:", error);
        }
    };

    if (isLoading) {
        return (
            <div className="p-6 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-4">
            {/* Subtasks List */}
            {subtasks.map((subtask) => (
                <div key={subtask.id} className="flex items-center gap-3 group">
                    <button
                        onClick={() => handleToggle(subtask.id, subtask.completed)}
                        disabled={!isOwnerOrMember}
                        className={cn(
                            "flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                            subtask.completed
                                ? "bg-indigo-600 border-indigo-600"
                                : "border-zinc-300 dark:border-zinc-600 hover:border-indigo-600",
                            !isOwnerOrMember && "cursor-not-allowed opacity-50"
                        )}
                    >
                        {subtask.completed && <Check className="w-3 h-3 text-white" />}
                    </button>
                    <span className={cn(
                        "flex-1 text-sm transition-all",
                        subtask.completed && "line-through text-zinc-400"
                    )}>
                        {subtask.title}
                    </span>
                    {isOwnerOrMember && (
                        <button 
                            onClick={() => handleDelete(subtask.id)}
                            className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-all"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            ))}

            {/* Empty State */}
            {subtasks.length === 0 && (
                <p className="text-sm text-zinc-400 text-center py-8">No subtasks yet</p>
            )}

            {/* Add New */}
            {isOwnerOrMember && (
                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                    <Plus className="w-4 h-4 text-zinc-400" />
                    <input
                        placeholder="Add subtask... (Enter to add)"
                        value={newSubtask}
                        onChange={(e) => setNewSubtask(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        disabled={isAdding}
                        className="flex-1 bg-transparent border-none p-0 text-sm placeholder-zinc-400 focus:ring-0"
                    />
                    {isAdding && <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />}
                </div>
            )}
        </div>
    );
}
