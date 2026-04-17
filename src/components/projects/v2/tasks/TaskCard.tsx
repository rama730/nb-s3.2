"use client";

import React, { memo } from "react";
import { Calendar, User, CheckCircle2, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { SPRINT_STATUS_PRESENTATION } from "@/lib/projects/sprint-detail";
import { normalizeTaskSurfaceRecord } from "@/lib/projects/task-presentation";

export interface Task {
    id: string;
    title: string;
    status: string;
    priority: string;
    assigneeId?: string | null;
    dueDate?: string | null;
    storyPoints?: number | null;
    sprintId?: string | null;
    creatorId?: string | null;
    assignee?: {
        fullName?: string;
        avatarUrl?: string;
    } | null;
    sprint?: {
        id?: string;
        name?: string;
        status?: "planning" | "active" | "completed" | null;
    } | null;
}

interface TaskCardProps {
    task: Task;
    onClick?: (task: Task) => void;
    onClaim?: (taskId: string) => void;
    isClaiming?: boolean;
    isSelected?: boolean;
    onSelect?: () => void;
    isBulkMode?: boolean;
}

import TaskStatusBadge from "./badges/TaskStatusBadge";
import TaskPriorityBadge from "./badges/TaskPriorityBadge";
import { formatTaskId } from "@/lib/project-key";

export const TaskCard = memo(function TaskCard({
    task,
    onClick,
    onClaim,
    isClaiming,
    isSelected,
    onSelect,
    isBulkMode
}: TaskCardProps) {
    const taskRecord = normalizeTaskSurfaceRecord(task);

    return (
        <div
            onClick={(e) => {
                if (isBulkMode && onSelect) {
                    e.stopPropagation();
                    onSelect();
                } else {
                    onClick?.(task);
                }
            }}
            className={cn(
                "group relative rounded-lg border-2 bg-white dark:bg-zinc-900 transition-all duration-200 hover:shadow-md cursor-pointer",
                isSelected
                    ? "border-indigo-500 ring-1 ring-indigo-500 z-10"
                    : "border-zinc-100 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
            )}
        >
            <div className="p-3 space-y-3">
                {/* Header: Title + Menu */}
                <div className="flex items-start justify-between gap-2">
                    <h4 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 line-clamp-2 leading-snug">
                        {taskRecord.title}
                    </h4>
                    {isBulkMode ? (
                        <div className={cn(
                            "w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors",
                            isSelected ? "bg-indigo-600 border-indigo-600 text-white" : "border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                        )}>
                            {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                        </div>
                    ) : (
                        <button className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 transition-opacity">
                            <MoreHorizontal className="w-4 h-4" />
                        </button>
                    )}
                </div>

                {/* Chips Row */}
                <div className="flex flex-wrap items-center gap-1.5">
                    <TaskStatusBadge status={taskRecord.status} />
                    <TaskPriorityBadge priority={taskRecord.priority} />
                    {taskRecord.sprint?.name ? (
                        <span
                            className={cn(
                                "px-2 py-0.5 rounded-md text-[10px] font-bold border",
                                taskRecord.sprint.status
                                    ? SPRINT_STATUS_PRESENTATION[taskRecord.sprint.status].toneClassName
                                    : "bg-zinc-50 border-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:border-zinc-700",
                            )}
                        >
                            {taskRecord.sprint.name}
                        </span>
                    ) : null}
                    {taskRecord.storyPoints != null && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold border bg-zinc-50 border-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:border-zinc-700">
                            {taskRecord.storyPoints} pts
                        </span>
                    )}
                </div>

                {/* Footer: ID & Meta */}
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-zinc-400 group-hover:text-zinc-500 transition-colors">
                            {taskRecord.taskNumber && taskRecord.projectKey
                                ? formatTaskId(taskRecord.projectKey, taskRecord.taskNumber)
                                : `#${task.id.slice(0, 6)}`}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        {taskRecord.dueDate && (
                            <div className={cn(
                                "flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md",
                                new Date(taskRecord.dueDate) < new Date() ? "text-rose-600 bg-rose-50" : "text-zinc-500 bg-zinc-50"
                            )}>
                                <Calendar className="w-3 h-3" />
                                {format(new Date(taskRecord.dueDate), "MMM d")}
                            </div>
                        )}
                        
                        {taskRecord.assignee ? (
                            <UserAvatar
                                identity={{
                                    fullName: taskRecord.assignee.fullName,
                                    avatarUrl: taskRecord.assignee.avatarUrl,
                                }}
                                size={20}
                                className="h-5 w-5"
                                fallbackClassName="text-[9px]"
                            />
                        ) : (
                            <div className="w-5 h-5 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center border border-dashed border-zinc-300 dark:border-zinc-700" title="Unassigned">
                                <User className="w-3 h-3 text-zinc-400" />
                            </div>
                        )}
                    </div>
                </div>

                {/* Claim Action (Optional) */}
                {onClaim && !taskRecord.assigneeId && (
                    <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onClaim(task.id);
                            }}
                            disabled={isClaiming}
                            className="w-full px-3 py-1.5 text-xs font-semibold rounded-md bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 border border-transparent transition-all"
                        >
                            {isClaiming ? "Claiming..." : "Claim & Start"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
});
