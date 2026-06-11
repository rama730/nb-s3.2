"use client";

import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaceTasksAction } from "@/app/actions/workspace";
import { useUIStore } from "@/lib/stores/ui-store";
import { Virtuoso } from "react-virtuoso";
import { Loader2, Inbox, Calendar, Folder } from "lucide-react";
import TaskStatusBadge from "@/components/projects/v2/tasks/badges/TaskStatusBadge";
import TaskPriorityBadge from "@/components/projects/v2/tasks/badges/TaskPriorityBadge";
import { formatTaskId } from "@/lib/project-key";

interface WorkspaceTasksTabProps {
    isActive?: boolean;
}

type VirtualRowItem = 
    | { kind: "header"; projectId: string; projectTitle: string; projectKey: string }
    | { kind: "task"; task: any };

export default function WorkspaceTasksTab({ isActive = true }: WorkspaceTasksTabProps) {
    const setWorkspaceTaskId = useUIStore((s) => s.setWorkspaceTaskId);
    const isWorkspaceOpen = useUIStore((s) => s.isWorkspaceOpen);

    // Fetch tasks, enabled ONLY when drawer is open and tab is active
    const { data, isLoading, error } = useQuery({
        queryKey: ["workspace", "tasks"],
        queryFn: () => fetchWorkspaceTasksAction(),
        enabled: isWorkspaceOpen && isActive,
        staleTime: 30_000,
    });

    const tasks = data?.tasks || [];

    // Flatten tasks into project groups for react-virtuoso virtualization
    const virtualRows = useMemo((): VirtualRowItem[] => {
        if (tasks.length === 0) return [];

        const groups: Record<string, { title: string; key: string; items: any[] }> = {};
        
        tasks.forEach((task: any) => {
            const project = task.project || { id: "unknown", title: "Unassigned Project", key: "TASK" };
            if (!groups[project.id]) {
                groups[project.id] = {
                    title: project.title,
                    key: project.key || "TASK",
                    items: [],
                };
            }
            groups[project.id]!.items.push(task);
        });

        const rows: VirtualRowItem[] = [];
        Object.entries(groups).forEach(([projectId, group]) => {
            rows.push({
                kind: "header",
                projectId,
                projectTitle: group.title,
                projectKey: group.key,
            });
            group.items.forEach((task) => {
                rows.push({
                    kind: "task",
                    task,
                });
            });
        });

        return rows;
    }, [tasks]);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Loading your tasks...</span>
            </div>
        );
    }

    if (error || (data && !data.success)) {
        return (
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 text-center dark:border-rose-900/30 dark:bg-rose-950/20">
                <p className="text-xs font-medium text-rose-800 dark:text-rose-400">
                    Failed to load tasks. Please try again later.
                </p>
            </div>
        );
    }

    if (tasks.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/10 px-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
                    <Inbox className="w-5 h-5" />
                </div>
                <h4 className="mt-3 text-xs font-semibold text-zinc-900 dark:text-zinc-100">No Pending Tasks</h4>
                <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400 max-w-xs">
                    You have no active tasks assigned to you right now.
                </p>
            </div>
        );
    }

    return (
        <div className="h-[320px] min-h-0 w-full relative">
            <Virtuoso
                style={{ height: "100%", width: "100%" }}
                data={virtualRows}
                itemContent={(_, row) => {
                    if (row.kind === "header") {
                        return (
                            <div className="sticky top-0 z-10 flex items-center gap-2 bg-white dark:bg-zinc-950 py-3 font-semibold text-zinc-950 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-900/50 text-sm mt-4 first:mt-0">
                                <Folder className="w-4 h-4 text-blue-500" />
                                <span>{row.projectTitle}</span>
                                <span className="text-xs font-mono text-zinc-400 bg-zinc-100 dark:bg-zinc-900 px-1.5 py-0.5 rounded uppercase">
                                    {row.projectKey}
                                </span>
                            </div>
                        );
                    }

                    const task = row.task;
                    const taskIdStr = task.taskNumber && task.project?.key
                        ? formatTaskId(task.project.key, task.taskNumber)
                        : `#${task.id.slice(0, 8)}`;

                    return (
                        <div className="py-1">
                            <button
                                type="button"
                                onClick={() => setWorkspaceTaskId(task.id)}
                                className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-zinc-100 bg-white shadow-sm dark:border-zinc-900 dark:bg-zinc-900/40 hover:border-zinc-200 dark:hover:border-zinc-800 text-left transition-all group"
                            >
                                <div className="space-y-1.5 flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs text-zinc-400 group-hover:text-blue-500 transition-colors">
                                            {taskIdStr}
                                        </span>
                                        <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">
                                            {task.title}
                                        </h5>
                                    </div>
                                    {task.dueDate && (
                                        <div className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                                            <Calendar className="w-3.5 h-3.5" />
                                            <span>
                                                Due {new Date(task.dueDate).toLocaleDateString(undefined, {
                                                    month: "short",
                                                    day: "numeric",
                                                })}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <TaskStatusBadge status={task.status} />
                                    <TaskPriorityBadge priority={task.priority} />
                                </div>
                            </button>
                        </div>
                    );
                }}
            />
        </div>
    );
}
