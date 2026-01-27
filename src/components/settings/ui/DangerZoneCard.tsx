"use client";

import React from "react";
import { cn } from "@/lib/utils";

export function DangerZoneCard({
    title = "Danger zone",
    description,
    children,
    className,
}: {
    title?: string;
    description?: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section
            className={cn(
                "rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20",
                className
            )}
        >
            <div className="p-5 sm:p-6 border-b border-red-200/60 dark:border-red-900/40">
                <div className="text-base font-semibold text-red-800 dark:text-red-200">
                    {title}
                </div>
                {description ? (
                    <div className="text-sm text-red-700/80 dark:text-red-200/70 mt-1">
                        {description}
                    </div>
                ) : null}
            </div>
            <div className="p-5 sm:p-6">{children}</div>
        </section>
    );
}
