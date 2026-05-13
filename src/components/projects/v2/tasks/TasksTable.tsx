"use client";

import React from "react";
import { TableVirtuoso } from "react-virtuoso";
import { Task } from "./TaskCard";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { format } from "date-fns";
import { SPRINT_STATUS_PRESENTATION } from "@/lib/projects/sprint-detail";
import { normalizeTaskSurfaceRecord } from "@/lib/projects/task-presentation";
import { cn } from "@/lib/utils";
import TaskPriorityBadge from "./badges/TaskPriorityBadge";
import TaskStatusBadge from "./badges/TaskStatusBadge";
import { buildProjectPersonReference } from "@/lib/projects/settings-policies";

interface TasksTableProps {
    tasks: Task[];
    onTaskClick: (task: Task) => void;
    fetchNextPage: () => void;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    activeAssignableMemberIds?: Set<string>;
}

export default function TasksTable({
    tasks,
    onTaskClick,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    activeAssignableMemberIds,
}: TasksTableProps) {
    return (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 h-[600px] overflow-hidden flex flex-col shadow-sm">
            <TableVirtuoso
                data={tasks}
                endReached={() => {
                    if (hasNextPage && !isFetchingNextPage) {
                        fetchNextPage();
                    }
                }}
                fixedHeaderContent={() => (
                    <tr className="bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider">Title</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider w-32">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider w-32">Priority</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider w-40">Sprint</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider w-40">Assignee</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wider w-32">Due Date</th>
                    </tr>
                )}
                itemContent={(index, task) => {
                    const taskRecord = normalizeTaskSurfaceRecord(task);
                    const assigneeRemoved = Boolean(
                        taskRecord.assigneeId &&
                        taskRecord.assignee &&
                        activeAssignableMemberIds &&
                        !activeAssignableMemberIds.has(taskRecord.assigneeId),
                    );
                    const assigneeReference = taskRecord.assignee
                        ? buildProjectPersonReference({
                            person: taskRecord.assignee,
                            isActiveMember: !assigneeRemoved,
                        })
                        : null;

                    return <>
                        <td className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
                            <span
                                onClick={() => onTaskClick(task)}
                                className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 cursor-pointer truncate block max-w-[300px]"
                            >
                                {taskRecord.title}
                            </span>
                        </td>
                        <td className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
                            <TaskStatusBadge status={taskRecord.status} className="rounded-md" />
                        </td>
                        <td className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
                            <TaskPriorityBadge priority={taskRecord.priority} className="rounded-md" />
                        </td>
                        <td className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
                            {taskRecord.sprint ? (
                                <span
                                    className={cn(
                                        "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border truncate max-w-[150px]",
                                        taskRecord.sprint.status && SPRINT_STATUS_PRESENTATION[taskRecord.sprint.status]
                                            ? SPRINT_STATUS_PRESENTATION[taskRecord.sprint.status].toneClassName
                                            : "bg-zinc-100 text-zinc-600 border-zinc-200",
                                    )}
                                >
                                    {taskRecord.sprint.name}
                                </span>
                            ) : (
                                <span className="text-xs text-zinc-400 italic">Backlog</span>
                            )}
                        </td>
                        <td className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
                            {taskRecord.assignee ? (
                                <div className="flex items-center gap-2">
                                    <UserAvatar
                                        identity={{
                                            fullName: assigneeReference?.displayName ?? taskRecord.assignee.fullName,
                                            avatarUrl: assigneeReference?.avatarUrl ?? taskRecord.assignee.avatarUrl,
                                        }}
                                        size={20}
                                        className="h-5 w-5"
                                        fallbackClassName="text-[9px]"
                                    />
                                    <span className="text-sm text-zinc-600 dark:text-zinc-400 truncate max-w-[100px]">
                                        {assigneeReference?.displayName ?? taskRecord.assignee.fullName}
                                    </span>
                                    {assigneeRemoved ? (
                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                                            Removed from project
                                        </span>
                                    ) : null}
                                </div>
                            ) : (
                                <span className="text-xs text-zinc-400 italic">Unassigned</span>
                            )}
                        </td>
                        <td className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50">
                            {taskRecord.dueDate ? (
                                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                                    {format(new Date(taskRecord.dueDate), "MMM d, yyyy")}
                                </span>
                            ) : (
                                <span className="text-xs text-zinc-400">-</span>
                            )}
                        </td>
                    </>;
                }}
            />
        </div>
    );
}
