"use client";

import { useMemo } from "react";
import { Trophy, CheckCircle2, Target, Calendar, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface OutcomesTabProps {
    projectId: string;
    project: any;
    isOwnerOrMember: boolean;
}

export default function OutcomesTab({ projectId, project, isOwnerOrMember }: OutcomesTabProps) {
    const tasks = project?.project_tasks || [];

    const completedTasks = useMemo(() => {
        return tasks
            .filter((t: any) => t.status === "done")
            .sort((a: any, b: any) => new Date(b.completed_at || b.updated_at).getTime() - new Date(a.completed_at || a.updated_at).getTime());
    }, [tasks]);

    const lifecycleStages = useMemo(() => {
        const stages = project?.lifecycle_stages || [];
        const currentIndex = project?.current_stage_index ?? 0;

        return stages.map((stageName: string, index: number) => ({
            name: stageName,
            status: index < currentIndex ? "completed" : index === currentIndex ? "current" : "upcoming",
        }));
    }, [project]);

    const completedStages = lifecycleStages.filter((s: any) => s.status === "completed").length;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Outcomes</h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Track completed milestones and achievements
                </p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                                {completedTasks.length}
                            </p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">Tasks Completed</p>
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
                            <Target className="w-5 h-5 text-indigo-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                                {completedStages}/{lifecycleStages.length}
                            </p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">Stages Completed</p>
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20">
                            <Trophy className="w-5 h-5 text-amber-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                                {project?.status === "completed" ? "Done!" : "Active"}
                            </p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">Project Status</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Lifecycle Progress */}
            {lifecycleStages.length > 0 && (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
                        Lifecycle Progress
                    </h3>
                    <div className="space-y-3">
                        {lifecycleStages.map((stage: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-3">
                                <div
                                    className={cn(
                                        "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                                        stage.status === "completed" && "bg-emerald-500 text-white",
                                        stage.status === "current" && "bg-indigo-500 text-white",
                                        stage.status === "upcoming" && "bg-zinc-100 dark:bg-zinc-800 text-zinc-400"
                                    )}
                                >
                                    {stage.status === "completed" ? (
                                        <CheckCircle2 className="w-4 h-4" />
                                    ) : (
                                        idx + 1
                                    )}
                                </div>
                                <div className="flex-1">
                                    <p className={cn(
                                        "text-sm font-medium",
                                        stage.status === "completed" && "text-emerald-600 dark:text-emerald-400",
                                        stage.status === "current" && "text-indigo-600 dark:text-indigo-400",
                                        stage.status === "upcoming" && "text-zinc-500 dark:text-zinc-400"
                                    )}>
                                        {stage.name}
                                    </p>
                                </div>
                                {idx < lifecycleStages.length - 1 && (
                                    <ChevronRight className="w-4 h-4 text-zinc-300 dark:text-zinc-600" />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Completed Tasks */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        Completed Tasks ({completedTasks.length})
                    </h3>
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800 max-h-[400px] overflow-y-auto">
                    {completedTasks.length === 0 ? (
                        <div className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                            No completed tasks yet
                        </div>
                    ) : (
                        completedTasks.slice(0, 20).map((task: any) => (
                            <div key={task.id} className="p-4 flex items-center gap-3">
                                <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                        {task.title}
                                    </p>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                        Completed {task.completed_at ? new Date(task.completed_at).toLocaleDateString() : "recently"}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
