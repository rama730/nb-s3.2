import React from "react";
import { cn } from "@/lib/utils";

interface TaskPriorityBadgeProps {
    priority: string;
    className?: string;
}

export default function TaskPriorityBadge({ priority, className }: TaskPriorityBadgeProps) {
    const getPriorityStyles = (p: string) => {
        switch (p) {
            case 'urgent':
                return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400";
            case 'high':
                return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
            case 'medium':
                return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
            default: // low
                return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
        }
    };

    return (
        <span className={cn(
            "px-2 py-0.5 rounded text-xs font-medium capitalize whitespace-nowrap",
            getPriorityStyles(priority),
            className
        )}>
            {priority}
        </span>
    );
}
