"use client";

import React, { useMemo } from "react";
import { TaskCard, Task } from "./TaskCard";
import { cn } from "@/lib/utils";

interface KanbanBoardProps {
    tasks: Task[];
    onTaskClick: (task: Task) => void;
    onClaimTask?: (taskId: string) => void;
    claimLoading?: Record<string, boolean>;
    selectedTaskIds: Set<string>;
    toggleTaskSelection: (taskId: string) => void;
    isBulkMode: boolean;
    fetchNextPage: () => void;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
}

export default function KanbanBoard({
    tasks,
    onTaskClick,
    onClaimTask,
    claimLoading = {},
    selectedTaskIds,
    toggleTaskSelection,
    isBulkMode,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
}: KanbanBoardProps) {
    // Group tasks
    const columns = useMemo(() => {
        const cols = {
            todo: [] as Task[],
            in_progress: [] as Task[],
            done: [] as Task[]
        };
        tasks.forEach(t => {
            if (cols[t.status as keyof typeof cols]) {
                cols[t.status as keyof typeof cols].push(t);
            } else {
                cols.todo.push(t); // Fallback
            }
        });
        return cols;
    }, [tasks]);

    const columnConfig = [
        { id: 'todo', title: 'To Do', color: 'bg-zinc-500' },
        { id: 'in_progress', title: 'In Progress', color: 'bg-blue-500' },
        { id: 'done', title: 'Done', color: 'bg-emerald-500' }
    ];

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {columnConfig.map(col => {
                const colTasks = columns[col.id as keyof typeof columns];

                return (
                    <div key={col.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col transition-all">
                        {/* Column Header */}
                        <div className="p-4 shrink-0 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-t-xl">
                            <div className="flex items-center gap-2">
                                <div className={cn("w-2 h-2 rounded-full", col.color)} />
                                <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">{col.title}</h3>
                            </div>
                            <span className="px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-bold border border-zinc-200 dark:border-zinc-700">
                                {colTasks.length}
                            </span>
                        </div>

                        {/* List - Auto height */}
                        <div className="p-3 space-y-3 min-h-[100px]">
                            {colTasks.length > 0 ? (
                                colTasks.map((task) => (
                                    <TaskCard
                                        key={task.id}
                                        task={task}
                                        onClick={onTaskClick}
                                        onClaim={onClaimTask}
                                        isClaiming={claimLoading[task.id]}
                                        isSelected={selectedTaskIds.has(task.id)}
                                        onSelect={() => toggleTaskSelection(task.id)}
                                        isBulkMode={isBulkMode}
                                    />
                                ))
                            ) : (
                                <div className="h-24 flex flex-col items-center justify-center text-zinc-400 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg">
                                    <p className="text-xs font-medium">No tasks</p>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
