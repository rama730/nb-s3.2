"use client";

import React, { useState } from "react";
import { Plus, X, GripVertical } from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";
import { cn } from "@/lib/utils";

interface LifecycleEditorProps {
    stages: string[];
    onChange: (stages: string[]) => void;
    currentStageIndex?: number; // Optional visual indicator of current progress
}

export function LifecycleEditor({ stages, onChange, currentStageIndex = 0 }: LifecycleEditorProps) {
    const [newStage, setNewStage] = useState("");

    const handleAdd = () => {
        if (newStage.trim()) {
            onChange([...stages, newStage.trim()]);
            setNewStage("");
        }
    };

    const handleRemove = (index: number) => {
        const newStages = stages.filter((_, i) => i !== index);
        onChange(newStages);
    };

    const handleReorder = (newOrder: string[]) => {
        onChange(newOrder);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleAdd();
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <input
                    value={newStage}
                    onChange={(e) => setNewStage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Add a stage (e.g. 'Design Review')"
                    className="flex-1 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                />
                <button
                    type="button"
                    onClick={handleAdd}
                    disabled={!newStage.trim()}
                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <Plus className="w-4 h-4" />
                </button>
            </div>

            <Reorder.Group axis="y" values={stages} onReorder={handleReorder} className="space-y-2">
                {stages.map((stage, index) => (
                    <Reorder.Item
                        key={stage}
                        value={stage}
                        className={cn(
                            "flex items-center gap-3 p-3 rounded-lg border bg-white dark:bg-zinc-900 shadow-sm cursor-grab active:cursor-grabbing",
                            index === currentStageIndex 
                                ? "border-indigo-500 ring-1 ring-indigo-500/20" 
                                : "border-zinc-200 dark:border-zinc-800"
                        )}
                    >
                        <GripVertical className="w-4 h-4 text-zinc-400" />
                        <span className="flex-1 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                            {stage}
                        </span>
                        
                        {index === currentStageIndex && (
                            <span className="text-[10px] uppercase font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded-full mr-2">
                                Current
                            </span>
                        )}

                        <button
                            type="button"
                            onClick={() => handleRemove(index)}
                            className="text-zinc-400 hover:text-red-500 transition-colors p-1"
                            title="Remove stage"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </Reorder.Item>
                ))}
            </Reorder.Group>
            
            {stages.length === 0 && (
                <div className="text-center p-4 text-sm text-zinc-500 italic border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg">
                    No stages defined. Add one above.
                </div>
            )}
        </div>
    );
}
