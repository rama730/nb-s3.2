"use client";

import React, { useState, useMemo } from "react";
import { Plus, ChevronRight, CalendarDays, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import CreateSprintModal from "@/components/projects/v2/sprints/CreateSprintModal";
import { createSprintAction } from "@/app/actions/project";

export interface Sprint {
    id: string;
    projectId: string;
    name: string;
    goal?: string | null;
    startDate: string;
    endDate: string;
    status: "planning" | "active" | "completed";
    createdAt: string;
}

export interface SprintTask {
    id: string;
    sprintId: string | null;
    title: string;
    status: "todo" | "in_progress" | "done";
    priority: "low" | "medium" | "high" | "urgent";
    storyPoints?: number | null;
    updatedAt?: string | null;
}

interface SprintPlanningProps {
    projectId: string;
    isOwnerOrMember: boolean;
    sprints: Sprint[];
    tasks: SprintTask[];
    onCreateSprint: () => void;
    onStartSprint: (sprintId: string) => void;
    onCompleteSprint: (sprintId: string) => void;
    onMoveTask: (taskId: string, sprintId: string | null) => void;
}

export default function SprintPlanning({
    projectId,
    isOwnerOrMember,
    sprints,
    tasks,
    onCreateSprint,
    onStartSprint,
    onCompleteSprint,
}: SprintPlanningProps) {
    const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    // Sort sprints: Active first, then by creation date
    const sortedSprints = useMemo(() => {
        return [...sprints].sort((a, b) => {
            if (a.status === 'active' && b.status !== 'active') return -1;
            if (a.status !== 'active' && b.status === 'active') return 1;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
    }, [sprints]);

    // Auto-select first sprint
    const activeSprint = sprints.find(s => s.status === 'active');
    const displaySprintId = selectedSprintId || activeSprint?.id || sortedSprints[0]?.id;
    const currentSprint = sprints.find(s => s.id === displaySprintId);

    // Filter tasks for selected sprint
    const sprintTasks = useMemo(() => {
        if (!displaySprintId) return [];
        return tasks.filter(t => t.sprintId === displaySprintId);
    }, [tasks, displaySprintId]);

    // Empty state
    if (sprints.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-[500px] bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-800">
                <div className="text-center space-y-4 max-w-md px-6">
                    <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-xl flex items-center justify-center mx-auto">
                        <CalendarDays className="w-8 h-8 text-zinc-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">No Sprints Yet</h3>
                        <p className="text-sm text-zinc-500">Create your first sprint to start tracking goals and progress.</p>
                    </div>
                    {isOwnerOrMember && (
                        <>
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-zinc-100 dark:text-zinc-900 font-semibold rounded-lg transition-colors inline-flex items-center gap-2"
                            >
                                <Plus className="w-4 h-4" />
                                Create Sprint
                            </button>
                            <CreateSprintModal
                                isOpen={showCreateModal}
                                onClose={() => setShowCreateModal(false)}
                                onCreate={async (data) => {
                                    try {
                                        const result = await createSprintAction({ ...data, projectId });
                                        if (result.success) {
                                            if (onCreateSprint) onCreateSprint();
                                            setShowCreateModal(false);
                                            toast.success("Sprint created");
                                        } else {
                                            toast.error(result.error);
                                        }
                                    } catch {
                                        toast.error("Failed to create sprint");
                                    }
                                }}
                                sprintCount={0}
                            />
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex gap-6">
            {/* LEFT SIDEBAR: Sprint Cards - Fixed width */}
            <div className="w-[320px] flex-shrink-0 space-y-4">
                <div>
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Sprint History</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">Select a goal to view details</p>
                </div>

                {isOwnerOrMember && (
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="w-full py-2.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-2 text-sm"
                    >
                        <Plus className="w-4 h-4" />
                        New Goal
                    </button>
                )}

                <div className="space-y-2.5">
                    {sortedSprints.map(sprint => (
                        <button
                            key={sprint.id}
                            onClick={() => setSelectedSprintId(sprint.id)}
                            className={cn(
                                "w-full text-left p-4 rounded-lg transition-all relative group border",
                                currentSprint?.id === sprint.id
                                    ? "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-800 shadow-sm"
                                    : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                            )}
                        >
                            {sprint.status === 'active' && (
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500 rounded-l-lg" />
                            )}
                            
                            <div className="flex items-start justify-between gap-2 mb-2.5">
                                <span className={cn(
                                    "text-[10px] px-2.5 py-1 rounded-md font-bold uppercase tracking-wide",
                                    sprint.status === 'active' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400" :
                                    sprint.status === 'completed' ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" :
                                    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-400"
                                )}>
                                    {sprint.status}
                                </span>
                                {currentSprint?.id === sprint.id && (
                                    <ChevronRight className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                                )}
                            </div>
                            
                            <h4 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 mb-2 line-clamp-2 pr-1">
                                {sprint.name}
                            </h4>
                            
                            <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                                <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">
                                    {sprint.startDate && sprint.endDate ? (
                                        `${format(new Date(sprint.startDate), "MMM d")} - ${format(new Date(sprint.endDate), "MMM d")}`
                                    ) : (
                                        "No dates set"
                                    )}
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* RIGHT CONTENT: Sprint Details - Flexible width */}
            <div className="flex-1 min-w-0">
                {currentSprint ? (
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={currentSprint.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="space-y-6"
                        >
                            {/* Sprint Header */}
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">
                                        {currentSprint.goal || currentSprint.name}
                                    </h2>
                                    <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                                        <CalendarDays className="w-4 h-4 shrink-0" />
                                        <span>{format(new Date(currentSprint.startDate), "MMM d, yyyy")} - {format(new Date(currentSprint.endDate), "MMM d, yyyy")}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Tasks List */}
                            <div>
                                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Sprint Tasks</h3>
                                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                                    {sprintTasks.length === 0 ? (
                                        <div className="p-12 text-center">
                                            <p className="text-zinc-500 text-sm">No tasks in this sprint yet.</p>
                                            <p className="text-zinc-400 text-xs mt-1">Assign tasks from the Tasks tab.</p>
                                        </div>
                                    ) : (
                                        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                            {sprintTasks.map(task => (
                                                <div
                                                    key={task.id}
                                                    className="p-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex items-center gap-3"
                                                >
                                                    <div className={cn(
                                                        "w-2 h-2 rounded-full shrink-0",
                                                        task.status === 'done' ? "bg-emerald-500" :
                                                        task.status === 'in_progress' ? "bg-blue-500" :
                                                        "bg-zinc-300"
                                                    )} />
                                                    <div className="flex-1 min-w-0">
                                                        <p className={cn(
                                                            "text-sm font-medium truncate",
                                                            task.status === 'done' ? "text-zinc-400 line-through" : "text-zinc-900 dark:text-zinc-100"
                                                        )}>
                                                            {task.title}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        {task.storyPoints && (
                                                            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">
                                                                {task.storyPoints} pts
                                                            </span>
                                                        )}
                                                        <span className={cn(
                                                            "text-[10px] px-2 py-1 rounded font-semibold uppercase tracking-wide",
                                                            task.status === 'done' ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" :
                                                            task.status === 'in_progress' ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                                                            "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                                        )}>
                                                            {task.status === 'in_progress' ? 'In Progress' : task.status}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    </AnimatePresence>
                ) : null}
            </div>

            <CreateSprintModal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onCreate={async (data) => {
                    try {
                        const result = await createSprintAction({ ...data, projectId });
                        if (result.success) {
                            if (onCreateSprint) onCreateSprint();
                            setShowCreateModal(false);
                            toast.success("Sprint created");
                        } else {
                            toast.error(result.error);
                        }
                    } catch {
                        toast.error("Failed to create sprint");
                    }
                }}
                sprintCount={sprints.length}
            />
        </div>
    );
}
