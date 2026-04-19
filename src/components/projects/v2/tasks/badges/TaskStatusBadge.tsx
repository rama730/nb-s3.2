import React from "react";
import { cn } from "@/lib/utils";
import { getTaskStatusLabel } from "@/lib/projects/task-presentation";
import { getTaskStatusPresentation } from "@/lib/projects/task-workflow";

interface TaskStatusBadgeProps {
    status: string;
    className?: string;
}

export default function TaskStatusBadge({ status, className }: TaskStatusBadgeProps) {
    const presentation = getTaskStatusPresentation(status);

    return (
        <span className={cn(
            "px-2 py-0.5 rounded text-xs font-medium capitalize whitespace-nowrap",
            presentation.badgeClassName,
            className
        )}>
            {getTaskStatusLabel(status)}
        </span>
    );
}
