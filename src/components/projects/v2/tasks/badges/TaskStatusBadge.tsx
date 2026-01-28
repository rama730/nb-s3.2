import React from "react";
import { cn } from "@/lib/utils";

interface TaskStatusBadgeProps {
    status: string;
    className?: string;
}

export default function TaskStatusBadge({ status, className }: TaskStatusBadgeProps) {
    const getStatusStyles = (s: string) => {
        switch (s) {
            case 'done':
                return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
            case 'in_progress':
                return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
            default:
                return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
        }
    };

    return (
        <span className={cn(
            "px-2 py-0.5 rounded text-xs font-medium capitalize whitespace-nowrap",
            getStatusStyles(status),
            className
        )}>
            {status.replace("_", " ")}
        </span>
    );
}
