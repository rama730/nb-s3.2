"use client";

import React, { memo } from "react";
import { Calendar, User, CheckCircle2, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export interface Task {
    id: string;
    title: string;
    status: string;
    priority: string;
    assignee_id?: string | null;
    due_date?: string | null;
    story_points?: number | null;
    assignee?: {
        full_name?: string;
        avatar_url?: string;
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

// Helper for status colors
const getStatusStyles = (status: string) => {
    switch (status) {
        case 'done': return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800";
        case 'in_progress': return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800";
        case 'todo': return "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700";
        default: return "bg-zinc-100 text-zinc-600 border-zinc-200";
    }
};

const getPriorityStyles = (priority: string) => {
    switch (priority) {
        case 'urgent': return "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800";
        case 'high': return "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800";
        case 'medium': return "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800";
        default: return "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700";
    }
};

export const TaskCard = memo(function TaskCard({
    task,
    onClick,
    onClaim,
    isClaiming,
    isSelected,
    onSelect,
    isBulkMode
}: TaskCardProps) {
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
                        {task.title}
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
                    <span className={cn("px-2 py-0.5 rounded-md text-[10px] font-bold border capitalize", getStatusStyles(task.status))}>
                        {task.status?.replace("_", " ")}
                    </span>
                    <span className={cn("px-2 py-0.5 rounded-md text-[10px] font-bold border capitalize", getPriorityStyles(task.priority))}>
                        {task.priority}
                    </span>
                    {task.story_points && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold border bg-zinc-50 border-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:border-zinc-700">
                            {task.story_points} pts
                        </span>
                    )}
                </div>

                {/* Footer: Assignee, Due Date */}
                <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-3">
                        {task.assignee ? (
                            <div className="flex items-center gap-1.5" title={task.assignee.full_name}>
                                <Avatar className="w-5 h-5">
                                    <AvatarImage src={task.assignee.avatar_url} />
                                    <AvatarFallback className="text-[9px]">{task.assignee.full_name?.substring(0, 2).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <span className="text-xs text-zinc-600 dark:text-zinc-400 max-w-[80px] truncate">
                                    {task.assignee.full_name}
                                </span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1.5 text-zinc-400">
                                <span className="w-5 h-5 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center border border-dashed border-zinc-300 dark:border-zinc-700">
                                    <User className="w-3 h-3" />
                                </span>
                                <span className="text-xs italic">Unassigned</span>
                            </div>
                        )}
                    </div>

                    {task.due_date && (
                        <div className={cn(
                            "flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md",
                            new Date(task.due_date) < new Date() ? "text-rose-600 bg-rose-50" : "text-zinc-500 bg-zinc-50"
                        )}>
                            <Calendar className="w-3 h-3" />
                            {format(new Date(task.due_date), "MMM d")}
                        </div>
                    )}
                </div>

                {/* Claim Action (Optional) */}
                {onClaim && !task.assignee_id && (
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
