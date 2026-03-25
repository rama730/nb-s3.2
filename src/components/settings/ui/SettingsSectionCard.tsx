"use client";

import React from "react";
import { cn } from "@/lib/utils";

export function SettingsSectionCard({
    title,
    description,
    children,
    className,
    testId,
}: {
    title: string;
    description?: string;
    children: React.ReactNode;
    className?: string;
    testId?: string;
}) {
    return (
        <section
            data-testid={testId}
            className={cn(
                "rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900",
                className
            )}
        >
            <div className="p-5 sm:p-6 border-b border-zinc-100 dark:border-zinc-900">
                <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    {title}
                </div>
                {description ? (
                    <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        {description}
                    </div>
                ) : null}
            </div>
            <div className="p-5 sm:p-6">{children}</div>
        </section>
    );
}
