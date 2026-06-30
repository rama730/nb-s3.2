"use client";

import type { ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";

import { cn } from "@/lib/utils";

export function ProjectDocEditorShell({
    children,
    drawer,
    drawerTitle,
    drawerDescription,
    onCloseDrawer,
    className,
}: {
    children: ReactNode;
    drawer?: ReactNode;
    drawerTitle?: string;
    drawerDescription?: string;
    onCloseDrawer?: () => void;
    className?: string;
}) {
    return (
        <div className={cn("mx-auto grid max-w-7xl gap-4", drawer ? "xl:grid-cols-[minmax(0,1fr)_420px]" : "", className)}>
            <div className="min-w-0">{children}</div>
            {drawer ? (
                <aside className="min-w-0 rounded-[1.75rem] border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                    <div className="mb-4 flex items-start justify-between gap-3 border-b border-zinc-100 pb-3 dark:border-zinc-900">
                        <div>
                            {drawerTitle ? <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{drawerTitle}</p> : null}
                            {drawerDescription ? <p className="mt-1 text-xs leading-5 text-zinc-500">{drawerDescription}</p> : null}
                        </div>
                        <button
                            type="button"
                            onClick={onCloseDrawer}
                            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-600 transition hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-300"
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            Back
                        </button>
                    </div>
                    <div>{drawer}</div>
                    <button
                        type="button"
                        onClick={onCloseDrawer}
                        className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                    >
                        <X className="h-3.5 w-3.5" />
                        Close panel
                    </button>
                </aside>
            ) : null}
        </div>
    );
}
