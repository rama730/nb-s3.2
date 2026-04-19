import React from "react";
import { cn } from "@/lib/utils";
import { getTaskPriorityLabel } from "@/lib/projects/task-presentation";
import { getTaskPriorityPresentation } from "@/lib/projects/task-workflow";

interface TaskPriorityBadgeProps {
    priority: string;
    className?: string;
}

export default function TaskPriorityBadge({ priority, className }: TaskPriorityBadgeProps) {
    const presentation = getTaskPriorityPresentation(priority);

    return (
        <span className={cn(
            "px-2 py-0.5 rounded text-xs font-medium capitalize whitespace-nowrap",
            presentation.badgeClassName,
            className
        )}>
            {getTaskPriorityLabel(priority)}
        </span>
    );
}
