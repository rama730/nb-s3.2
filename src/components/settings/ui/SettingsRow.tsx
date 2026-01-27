"use client";

import React from "react";
import { cn } from "@/lib/utils";

export function SettingsRow({
    title,
    description,
    right,
    className,
}: {
    title: string;
    description?: string;
    right?: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
                className
            )}
        >
            <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {title}
                </div>
                {description ? (
                    <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        {description}
                    </div>
                ) : null}
            </div>
            {right ? <div className="shrink-0">{right}</div> : null}
        </div>
    );
}
