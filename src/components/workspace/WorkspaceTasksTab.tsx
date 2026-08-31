"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkspaceTasksAction } from "@/app/actions/workspace";
import { queryKeys } from "@/lib/query-keys";
import {
    useUIStore,
    createWorkspaceTaskHandoff,
    WORKSPACE_TASK_HANDOFF_STORAGE_KEY,
} from "@/lib/stores/ui-store";
import { Loader2, ListChecks, Folder, MoreHorizontal, Search } from "lucide-react";
import { TaskCard } from "@/components/projects/v2/tasks/TaskCard";
import { TASK_STATUS_PRESENTATION, type TaskWorkflowStatus } from "@/lib/projects/task-workflow";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface WorkspaceTasksTabProps {
    isActive?: boolean;
}

type WorkspaceTask = Awaited<ReturnType<typeof fetchWorkspaceTasksAction>> extends infer Result
    ? Result extends { success: true; tasks: Array<infer Task> } ? Task : never
    : never;

const PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;
const OPEN_STATUSES: TaskWorkflowStatus[] = ["todo", "in_progress", "blocked"];
type WorkspaceScope = "my" | "team" | "all";
type WorkspaceStatusFilter = "all" | (typeof OPEN_STATUSES)[number];

export default function WorkspaceTasksTab({ isActive = true }: WorkspaceTasksTabProps) {
    const router = useRouter();
    const isWorkspaceOpen = useUIStore((s) => s.isWorkspaceOpen);
    const setWorkspaceOpen = useUIStore((s) => s.setWorkspaceOpen);
    const setWorkspaceTaskHandoff = useUIStore((s) => s.setWorkspaceTaskHandoff);
    // The workspace is a cross-project overview: do not hide team work just
    // because the viewer has no personal assignment in that project.
    const [scope, setScope] = useState<WorkspaceScope>("all");
    const [status, setStatus] = useState<WorkspaceStatusFilter>("all");
    const [search, setSearch] = useState("");
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [isNavigating, setIsNavigating] = useState(false);

    useEffect(() => {
        // A blocked navigation must not leave the launcher permanently inert
        // when the user reopens it.
        if (!isWorkspaceOpen) setIsNavigating(false);
    }, [isWorkspaceOpen]);

    // Fetch tasks, enabled ONLY when drawer is open and tab is active
    const query = useQuery({
        queryKey: queryKeys.workspace.tasks(scope, limit),
        queryFn: () => fetchWorkspaceTasksAction(limit, scope),
        enabled: isWorkspaceOpen && isActive,
        staleTime: 30_000,
    });
    const { data, isLoading, error } = query;

    const tasks = useMemo(() => data?.tasks ?? [], [data?.tasks]);
    const visibleTasks = useMemo(() => {
        const normalizedSearch = search.trim().toLocaleLowerCase();
        return tasks.filter((task) => {
            const matchesStatus = status === "all" || task.status === status;
            const matchesSearch = !normalizedSearch
                || task.title.toLocaleLowerCase().includes(normalizedSearch)
                || task.project?.title?.toLocaleLowerCase().includes(normalizedSearch);
            return matchesStatus && matchesSearch;
        });
    }, [search, status, tasks]);

    const groups = useMemo(() => {
        const grouped = new Map<string, { id: string; slug: string | null; title: string; key: string; tasks: WorkspaceTask[] }>();
        for (const task of visibleTasks) {
            const project = task.project || { id: "unknown", slug: null, title: "Project", key: "TASK" };
            const group = grouped.get(project.id) ?? {
                id: project.id,
                slug: project.slug ?? null,
                title: project.title || "Project",
                key: project.key || "TASK",
                tasks: [],
            };
            group.tasks.push(task);
            grouped.set(project.id, group);
        }
        // ponytail: keep the API's urgency-aware task order when grouping,
        // rather than re-sorting projects alphabetically and burying work that
        // needs attention.
        return Array.from(grouped.values());
    }, [visibleTasks]);

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Loading workspace tasks...</span>
            </div>
        );
    }

    if (error || (data && !data.success)) {
        return (
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 text-center dark:border-rose-900/30 dark:bg-rose-950/20 mt-4">
                <p className="text-xs font-medium text-rose-800 dark:text-rose-400">
                    Failed to load tasks. Please try again later.
                </p>
                <button type="button" onClick={() => void query.refetch()} className="mt-2 text-xs font-semibold text-rose-700 underline underline-offset-2 dark:text-rose-300">Try again</button>
            </div>
        );
    }

    const handleTaskClick = (task: WorkspaceTask) => {
        if (isNavigating) return;
        const projectId = task.project?.id || task.projectId;
        const projectIdentifier = task.project?.slug || projectId;
        if (!projectId || !projectIdentifier) return;

        setIsNavigating(true);
        const handoff = createWorkspaceTaskHandoff(projectId, task.id);
        setWorkspaceTaskHandoff(handoff);
        // The navigation can remount the client runtime. Preserve this one
        // transition in the browser session while keeping the URL clean.
        try {
            window.sessionStorage.setItem(
                WORKSPACE_TASK_HANDOFF_STORAGE_KEY,
                JSON.stringify(handoff),
            );
        } catch {
            // In-memory handoff still covers browsers with blocked storage.
        }
        // ponytail: router.push is sufficient here. A prefetch immediately
        // followed by a navigation has no user-visible benefit and competes
        // with the task surface's own data request.
        router.push(`/projects/${projectIdentifier}?tab=tasks`);
        setWorkspaceOpen(false);
    };

    const resetScope = (nextScope: WorkspaceScope) => {
        setScope(nextScope);
        setLimit(PAGE_SIZE);
    };

    const filteredEmpty = tasks.length > 0 && visibleTasks.length === 0;
    const isEmpty = tasks.length === 0 || filteredEmpty;

    const taskFiltersMenu = (
        <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            aria-label="Filter workspace tasks"
                            title="Filter workspace tasks"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        >
                            <MoreHorizontal className="h-4 w-4" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="z-[202] w-72 p-2">
                        <DropdownMenuLabel>Show tasks</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={scope} onValueChange={(value) => resetScope(value as WorkspaceScope)}>
                            <DropdownMenuRadioItem value="all">All open work</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="my">My tasks</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="team">Team tasks</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Status</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={status} onValueChange={(value) => setStatus(value as WorkspaceStatusFilter)}>
                            <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                            {OPEN_STATUSES.map((taskStatus) => (
                                <DropdownMenuRadioItem key={taskStatus} value={taskStatus}>
                                    {TASK_STATUS_PRESENTATION[taskStatus].label}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Search</DropdownMenuLabel>
                        <label className="relative block px-1 pb-1">
                            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                            <input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                onKeyDown={(event) => event.stopPropagation()}
                                placeholder="Search tasks or projects"
                                className="h-9 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-xs text-zinc-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
                            />
                        </label>
                    </DropdownMenuContent>
        </DropdownMenu>
    );

    return (
        <div id="workspace-tasks-panel" role="tabpanel" aria-labelledby="workspace-tasks-tab" className="space-y-2" aria-busy={isNavigating}>
            {isEmpty ? (
                <div className="relative flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/30 px-6 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900/10">
                    <div className="absolute right-3 top-3">{taskFiltersMenu}</div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
                        <ListChecks className="w-5 h-5" />
                    </div>
                    <h4 className="mt-3 text-xs font-semibold text-zinc-900 dark:text-zinc-100">{filteredEmpty ? "No tasks match these filters" : "No open tasks in this view"}</h4>
                    <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400 max-w-xs">
                        {filteredEmpty ? "Try another status, scope, or search phrase." : scope === "my" ? "You have no active tasks assigned to you right now." : scope === "team" ? "No other team tasks are open right now." : "No open tasks are available in your projects right now."}
                    </p>
                    {filteredEmpty ? <button type="button" onClick={() => { setSearch(""); setStatus("all"); }} className="mt-3 text-xs font-semibold text-primary hover:underline">Clear filters</button> : null}
                </div>
            ) : groups.map((group, index) => (
                <section key={group.id}>
                    <div className="mb-2 flex min-h-9 items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                            <Folder className="h-4 w-4 shrink-0 text-blue-500" />
                            <Link
                                href={`/projects/${group.slug || group.id}?tab=tasks`}
                                onClick={() => setWorkspaceOpen(false)}
                                className="min-w-0 truncate hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                aria-label={`Open ${group.title} tasks`}
                            >
                                {group.title}
                            </Link>
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs uppercase text-zinc-400 dark:bg-zinc-900">{group.key}</span>
                        </div>
                        {index === 0 ? taskFiltersMenu : null}
                    </div>
                    <div className="grid grid-cols-1 gap-2 min-[600px]:grid-cols-2">
                        {group.tasks.map((task) => (
                            <TaskCard key={task.id} task={task} onClick={() => handleTaskClick(task)} />
                        ))}
                    </div>
                </section>
            ))}
            {data?.success && data.hasMore ? (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Showing the first {limit} open tasks.</p>
                    <button
                        type="button"
                        onClick={() => setLimit((current) => Math.min(MAX_PAGE_SIZE, current + PAGE_SIZE))}
                        disabled={limit >= MAX_PAGE_SIZE}
                        className="text-xs font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:text-zinc-400 disabled:no-underline"
                    >
                        {limit >= MAX_PAGE_SIZE ? "Open a project to view more" : "Load more tasks"}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
