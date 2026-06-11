"use client";

import { AlertTriangle, CheckCircle2, FileText, FolderOpen, ListTodo, Timer, Users } from "lucide-react";

import type { ProjectReadmeReferenceOption, ProjectReadmeSmartBlockPreview } from "@/lib/projects/readme-blocks";
import { cn } from "@/lib/utils";

const KIND_ICON = {
    roles: Users,
    contributors: Users,
    files: FolderOpen,
    tasks: ListTodo,
    sprints: Timer,
    unknown: AlertTriangle,
} as const;

function referenceMeta(option: ProjectReadmeReferenceOption) {
    return option.context || [option.status, option.meta, option.subtitle].filter(Boolean).join(" · ") || "Project reference";
}

export function ProjectReadmeReferenceOptionCard({
    option,
    selected = false,
    onSelect,
}: {
    option: ProjectReadmeReferenceOption;
    selected?: boolean;
    onSelect?: () => void;
}) {
    const Icon = KIND_ICON[option.kind] ?? FileText;
    const content = (
        <div className="flex min-w-0 items-center gap-2.5">
            {option.avatarUrl ? (
                <img src={option.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                    <Icon className="h-3.5 w-3.5" />
                </span>
            )}
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <p className="truncate text-xs font-semibold text-zinc-950 dark:text-zinc-50">{option.title}</p>
                    {option.status ? (
                        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                            {option.status}
                        </span>
                    ) : null}
                </div>
                <p className="mt-0.5 truncate text-[11px] leading-4 text-zinc-500">{referenceMeta(option)}</p>
                {option.badges?.length ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                        {option.badges.slice(0, 3).map((badge) => (
                            <span key={badge} className="rounded-full border border-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-800">
                                {badge}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
            {selected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-500" /> : null}
        </div>
    );

    if (!onSelect) {
        return <div className="rounded-xl border border-zinc-200 px-2.5 py-2 dark:border-zinc-800">{content}</div>;
    }

    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                "w-full rounded-xl border px-2.5 py-2 text-left transition",
                selected
                    ? "border-blue-400 bg-blue-50/70 dark:border-blue-700 dark:bg-blue-950/30"
                    : "border-zinc-200 hover:border-blue-300 hover:bg-blue-50/40 dark:border-zinc-800 dark:hover:border-blue-900 dark:hover:bg-blue-950/20",
            )}
        >
            {content}
        </button>
    );
}

export function ProjectReadmeSmartBlockPreviewCard({ preview }: { preview: ProjectReadmeSmartBlockPreview }) {
    const Icon = KIND_ICON[preview.kind] ?? FileText;
    return (
        <div
            className={cn(
                "my-3 rounded-2xl border p-3",
                preview.safeUnavailable
                    ? "border-amber-300 bg-amber-50/70 dark:border-amber-900/70 dark:bg-amber-950/20"
                    : "border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950/60",
            )}
        >
            <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm dark:bg-zinc-900">
                    <Icon className={cn("h-4 w-4", preview.safeUnavailable ? "text-amber-500" : "text-blue-500")} />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{preview.title}</p>
                            <p className="mt-0.5 text-xs leading-5 text-zinc-500">{preview.description}</p>
                        </div>
                        {preview.href && !preview.safeUnavailable ? (
                            <a href={preview.href} className="rounded-full border border-zinc-200 px-3 py-1 text-xs font-semibold text-zinc-600 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-300">
                                Open
                            </a>
                        ) : null}
                    </div>
                    {preview.items.length > 0 ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            {preview.items.slice(0, 4).map((item) => <ProjectReadmeReferenceOptionCard key={`${item.kind}-${item.id}`} option={item} />)}
                        </div>
                    ) : null}
                    {preview.unavailableCount > 0 ? (
                        <p className="mt-3 text-xs font-medium text-amber-600 dark:text-amber-300">
                            {preview.unavailableCount} referenced item{preview.unavailableCount === 1 ? "" : "s"} unavailable.
                        </p>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
