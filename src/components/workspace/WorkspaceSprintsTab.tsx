"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaceSprintsAction } from "@/app/actions/workspace";
import { queryKeys } from "@/lib/query-keys";
import { useUIStore } from "@/lib/stores/ui-store";
import { Loader2, Inbox, Calendar, Folder, Target } from "lucide-react";
import { cn } from "@/lib/utils";

interface WorkspaceSprintsTabProps {
    isActive?: boolean;
}

export default function WorkspaceSprintsTab({ isActive = true }: WorkspaceSprintsTabProps) {
    const isWorkspaceOpen = useUIStore((s) => s.isWorkspaceOpen);

    // Fetch active sprints, enabled ONLY when drawer is open and tab is active
    const { data, isLoading, error } = useQuery({
        queryKey: queryKeys.workspace.sprints(),
        queryFn: () => fetchWorkspaceSprintsAction(),
        enabled: isWorkspaceOpen && isActive,
        staleTime: 30_000,
    });

    const sprints = data?.sprints || [];

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Loading active sprints...</span>
            </div>
        );
    }

    if (error || (data && !data.success)) {
        return (
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 text-center dark:border-rose-900/30 dark:bg-rose-950/20">
                <p className="text-xs font-medium text-rose-800 dark:text-rose-400">
                    Failed to load sprints. Please try again later.
                </p>
            </div>
        );
    }

    if (sprints.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/10 px-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
                    <Target className="w-5 h-5" />
                </div>
                <h4 className="mt-3 text-xs font-semibold text-zinc-900 dark:text-zinc-100">No Active Sprints</h4>
                <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400 max-w-xs">
                    None of your projects have an active sprint running right now.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4 max-h-[320px] overflow-y-auto pr-1">
            {sprints.map((sprint: any) => {
                const total = sprint.stats?.total ?? 0;
                const completed = sprint.stats?.completed ?? 0;
                const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
                const daysRemaining = (() => {
                    if (!sprint.endDate) return null;
                    const diffTime = new Date(sprint.endDate).getTime() - Date.now();
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    return diffDays;
                })();

                return (
                    <div
                        key={sprint.id}
                        className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40 space-y-4"
                    >
                        {/* Sprint Meta */}
                        <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className="font-semibold text-base text-zinc-950 dark:text-zinc-50 truncate">
                                        {sprint.name}
                                    </h4>
                                    <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                        Active
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                                    <Folder className="w-3.5 h-3.5" />
                                    <span className="truncate">{sprint.project?.title}</span>
                                    <span className="font-mono text-[10px] uppercase bg-zinc-100 dark:bg-zinc-800 px-1 rounded">
                                        {sprint.project?.key}
                                    </span>
                                </div>
                            </div>

                            {/* Remaining Days */}
                            {daysRemaining !== null && (
                                <div className={cn(
                                    "flex flex-col items-end px-3 py-1.5 rounded-xl text-[11px] font-medium shrink-0",
                                    daysRemaining < 0 
                                        ? "bg-rose-50 text-rose-700 dark:bg-rose-950/20 dark:text-rose-400"
                                        : daysRemaining <= 2
                                            ? "bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400"
                                            : "bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400"
                                )}>
                                    <span>
                                        {daysRemaining < 0 
                                            ? `${Math.abs(daysRemaining)}d overdue` 
                                            : daysRemaining === 0
                                                ? "ends today"
                                                : `${daysRemaining}d left`
                                        }
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Sprint Goal */}
                        {sprint.goal && (
                            <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-xl p-3">
                                <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                                    <Target className="w-3.5 h-3.5" />
                                    Sprint Goal
                                </p>
                                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
                                    {sprint.goal}
                                </p>
                            </div>
                        )}

                        {/* Progress Bar */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs font-medium">
                                <span className="text-zinc-500 dark:text-zinc-400">
                                    Progress: {completed} / {total} tasks done
                                </span>
                                <span className="text-zinc-950 dark:text-zinc-50">{progress}%</span>
                            </div>
                            <div className="h-2 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>

                        {/* Sprint Dates */}
                        {sprint.startDate && sprint.endDate && (
                            <div className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500 border-t border-zinc-100 dark:border-zinc-800/60 pt-3">
                                <Calendar className="w-3.5 h-3.5" />
                                <span>
                                    {new Date(sprint.startDate).toLocaleDateString()} – {new Date(sprint.endDate).toLocaleDateString()}
                                </span>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
