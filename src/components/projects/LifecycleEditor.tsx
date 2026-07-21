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
    const [errorMsg, setErrorMsg] = useState("");

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        const cleaned = val.replace(/[^\p{L}\p{N}\s&]/gu, "");
        
        let msg = "";
        if (cleaned !== val) {
            msg = "Only letters, numbers, spaces, and & are allowed";
        } else {
            const trimmed = cleaned.trim().replace(/\s+/g, " ");
            if (trimmed && stages.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
                msg = "Stage name already exists";
            }
        }
        setErrorMsg(msg);
        setNewStage(cleaned);
    };

    const handleAdd = () => {
        const trimmed = newStage.trim().replace(/\s+/g, " ");
        if (!trimmed) return;

        if (trimmed.length < 2) {
            setErrorMsg("Stage name must be at least 2 characters");
            return;
        }

        if (stages.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
            setErrorMsg("Stage name already exists");
            return;
        }

        onChange([...stages, trimmed]);
        setNewStage("");
        setErrorMsg("");
    };

    const handleRemove = (index: number) => {
        const newStages = stages.filter((_, i) => i !== index);
        onChange(newStages);
    };

    const handleReorder = (newOrder: string[]) => {
        onChange(newOrder);
    };

    const handleStageChange = (index: number, value: string) => {
        const cleaned = value.replace(/[^\p{L}\p{N}\s&]/gu, "");
        let msg = "";
        const trimmed = cleaned.trim().replace(/\s+/g, " ");
        if (cleaned !== value) {
            msg = "Only letters, numbers, spaces, and & are allowed";
        } else if (trimmed && stages.some((stage, i) => i !== index && stage.toLowerCase() === trimmed.toLowerCase())) {
            msg = "Stage name already exists";
        }
        setErrorMsg(msg);
        onChange(stages.map((stage, i) => (i === index ? cleaned : stage)));
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleAdd();
        }
    };

    return (
        <div className="space-y-4">
            <div className="space-y-1.5">
                <div className="flex gap-2">
                    <input
                        value={newStage}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        maxLength={35}
                        placeholder="Add a stage (e.g. 'Design Review')"
                        className="flex-1 px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm   outline-none"
                    />
                    <button
                        type="button"
                        onClick={handleAdd}
                        disabled={!newStage.trim() || !!errorMsg}
                        className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
                {errorMsg && (
                    <p className="text-xs text-red-500 font-medium px-1 animate-in slide-in-from-top-1 duration-200">
                        {errorMsg}
                    </p>
                )}
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
                        <input
                            value={stage}
                            onChange={(event) => handleStageChange(index, event.target.value)}
                            maxLength={35}
                            className="flex-1 bg-transparent text-sm font-medium text-zinc-700 outline-none  dark:text-zinc-200"
                            aria-label={`Stage ${index + 1} name`}
                        />
                        
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
