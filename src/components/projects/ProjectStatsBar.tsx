"use client";

import { Eye, Users, Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectStatsBarProps {
    viewCount?: number;
    followersCount?: number;

    className?: string;
    size?: "sm" | "md";
    testIdPrefix?: string;
}

export default function ProjectStatsBar({
    viewCount = 0,
    followersCount = 0,

    className,
    size = "md",
    testIdPrefix = "project",
}: ProjectStatsBarProps) {
    const iconClass = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";
    const textClass = size === "sm" ? "text-xs" : "text-xs";

    return (
        <div className={cn("flex items-center gap-3 text-zinc-500 dark:text-zinc-400", textClass, className)}>
            <div className="flex items-center gap-1" title="Total Views" data-testid={`${testIdPrefix}-view-count`}>
                <Eye className={iconClass} />
                <span className="font-semibold text-zinc-900 dark:text-zinc-200">{viewCount}</span>
            </div>
            <div className="flex items-center gap-1" title="Followers" data-testid={`${testIdPrefix}-followers-count`}>
                <Users className={iconClass} />
                <span className="font-semibold text-zinc-900 dark:text-zinc-200">{followersCount}</span>
            </div>

        </div>
    );
}
