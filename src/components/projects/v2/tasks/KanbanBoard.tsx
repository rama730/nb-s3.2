"use client";

import React, { useMemo, useState, useEffect } from "react";
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
    const DEFAULT_VISIBLE = 20;
    const STEP = 20;
    const [visibleCounts, setVisibleCounts] = useState({
        todo: DEFAULT_VISIBLE,
        in_progress: DEFAULT_VISIBLE,
        done: DEFAULT_VISIBLE
    });

    useEffect(() => {
        setVisibleCounts((prev) => ({
            todo: Math.max(prev.todo, DEFAULT_VISIBLE),
            in_progress: Math.max(prev.in_progress, DEFAULT_VISIBLE),
            done: Math.max(prev.done, DEFAULT_VISIBLE),
        }));
    }, [tasks.length]);

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
        <>
        <div role="region" aria-label="Kanban board" className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {columnConfig.map(col => {
                const colTasks = columns[col.id as keyof typeof columns];
                const visibleLimit = visibleCounts[col.id as keyof typeof visibleCounts] || DEFAULT_VISIBLE;
                const visibleTasks = colTasks.slice(0, visibleLimit);
                const hasMoreInColumn = colTasks.length > visibleLimit;

                return (
                    <div key={col.id} role="region" aria-label={`${col.title} column, ${colTasks.length} tasks`} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col transition-all">
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
                            {visibleTasks.length > 0 ? (
                                <>
                                {visibleTasks.map((task) => (
                                    <div key={task.id} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 80px' }}>
                                    <TaskCard
                                        task={task}
                                        onClick={onTaskClick}
                                        onClaim={onClaimTask}
                                        isClaiming={claimLoading[task.id]}
                                        isSelected={selectedTaskIds.has(task.id)}
                                        onSelect={() => toggleTaskSelection(task.id)}
                                        isBulkMode={isBulkMode}
                                    />
                                    </div>
                                ))}
                                {hasMoreInColumn && (
                                    <button
                                        aria-label={`Show more tasks in ${col.title}`}
                                        onClick={() =>
                                            setVisibleCounts((prev) => ({
                                                ...prev,
                                                [col.id]: Math.min(colTasks.length, (prev as any)[col.id] + STEP),
                                            }))
                                        }
                                        className="w-full py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 border border-dashed border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                                    >
                                        Show more
                                    </button>
                                )}
                                </>
                            ) : (
                                <div role="status" className="h-24 flex flex-col items-center justify-center text-zinc-400 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg">
                                    <p className="text-xs font-medium">No tasks in {col.title.toLowerCase()}</p>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
        {hasNextPage && (
            <div className="mt-4 flex justify-center">
                <button
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="px-4 py-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400 border border-dashed border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors disabled:opacity-60"
                >
                    {isFetchingNextPage ? "Loading more tasks..." : "Load more tasks"}
                </button>
            </div>
        )}
        </>
    );
}
