"use client";

import React from "react";
import { TableVirtuoso } from "react-virtuoso";
import { Task } from "./TaskCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Calendar, User } from "lucide-react";
import { format } from "date-fns";

interface TasksTableProps {
    tasks: Task[];
    onTaskClick: (task: Task) => void;
    selectedTaskIds: Set<string>;
    toggleTaskSelection: (taskId: string) => void;
    isBulkMode: boolean;
}

export default function TasksTable({
    tasks,
    onTaskClick,
    selectedTaskIds,
    toggleTaskSelection,
    isBulkMode
}: TasksTableProps) {
    return (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 h-[600px] overflow-hidden flex flex-col shadow-sm">
            <TableVirtuoso
                data={tasks}
                fixedHeaderContent={() => (
                    <tr className="bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800">
                        <th className="px-4 py-3 text-left w-12">
                            {isBulkMode && (
                                <div className="w-4 h-4 rounded border border-zinc-300 dark:border-zinc-600" />
                            )}
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Title</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider w-32">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider w-32">Priority</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider w-40">Assignee</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider w-32">Due Date</th>
                    </tr>
                )}
                itemContent={(index, task) => (
                    <>
                        <td className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
                            {isBulkMode && (
                                <input
                                    type="checkbox"
                                    checked={selectedTaskIds.has(task.id)}
                                    onChange={() => toggleTaskSelection(task.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                            )}
                        </td>
                        <td className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
                            <span
                                onClick={() => onTaskClick(task)}
                                className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 cursor-pointer truncate block max-w-[300px]"
                            >
                                {task.title}
                            </span>
                        </td>
                        <td className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
                            <span className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border capitalize",
                                task.status === 'done' ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                    task.status === 'in_progress' ? "bg-blue-50 text-blue-700 border-blue-200" :
                                        "bg-zinc-100 text-zinc-600 border-zinc-200"
                            )}>
                                {task.status.replace("_", " ")}
                            </span>
                        </td>
                        <td className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
                            <span className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border capitalize",
                                task.priority === 'urgent' ? "bg-rose-50 text-rose-700 border-rose-200" :
                                    task.priority === 'high' ? "bg-orange-50 text-orange-700 border-orange-200" :
                                        "bg-zinc-100 text-zinc-600 border-zinc-200"
                            )}>
                                {task.priority}
                            </span>
                        </td>
                        <td className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
                            {task.assignee ? (
                                <div className="flex items-center gap-2">
                                    <Avatar className="w-5 h-5">
                                        <AvatarImage src={task.assignee.avatarUrl || task.assignee.avatar_url} />
                                        <AvatarFallback className="text-[9px]">
                                            {(task.assignee.fullName || task.assignee.full_name)?.substring(0, 2).toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>
                                    <span className="text-sm text-zinc-600 dark:text-zinc-400 truncate max-w-[100px]">
                                        {task.assignee.fullName || task.assignee.full_name}
                                    </span>
                                </div>
                            ) : (
                                <span className="text-xs text-zinc-400 italic">Unassigned</span>
                            )}
                        </td>
                        <td className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
                            {task.dueDate ? (
                                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                                    {format(new Date(task.dueDate), "MMM d, yyyy")}
                                </span>
                            ) : (
                                <span className="text-xs text-zinc-400">-</span>
                            )}
                        </td>
                    </>
                )}
            />
        </div>
    );
}
