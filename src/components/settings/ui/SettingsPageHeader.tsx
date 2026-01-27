"use client";

import React from "react";

export function SettingsPageHeader({
    title,
    description,
    action,
}: {
    title: string;
    description?: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
                <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {title}
                </h1>
                {description ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        {description}
                    </p>
                ) : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    );
}
