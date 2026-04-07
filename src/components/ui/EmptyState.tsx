"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
    icon: LucideIcon;
    title: string;
    description?: string;
    action?: React.ReactNode;
    className?: string;
    compact?: boolean;
}

export function EmptyState({
    icon: Icon,
    title,
    description,
    action,
    className,
    compact,
}: EmptyStateProps) {
    return (
        <div
            className={cn(
                "text-center bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl rounded-2xl border border-zinc-200/60 dark:border-white/5",
                compact ? "py-8 px-4" : "py-16 px-6",
                className,
            )}
        >
            <Icon
                className={cn(
                    "text-zinc-300 dark:text-zinc-600 mx-auto mb-4",
                    compact ? "w-10 h-10" : "w-14 h-14",
                )}
            />
            <p className="text-zinc-600 dark:text-zinc-400 text-lg font-medium">
                {title}
            </p>
            {description && (
                <p className="text-zinc-400 dark:text-zinc-500 text-sm mt-1">
                    {description}
                </p>
            )}
            {action && <div className="mt-3">{action}</div>}
        </div>
    );
}
