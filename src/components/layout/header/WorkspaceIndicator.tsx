"use client";

import { ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getWorkspaceSummaryAction } from "@/app/actions/workspace";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/lib/stores/ui-store";
import { usePeopleNotifications } from "@/hooks/usePeopleNotifications";

export default function WorkspaceIndicator() {
    const isWorkspaceOpen = useUIStore((s) => s.isWorkspaceOpen);
    const openWorkspace = useUIStore((s) => s.openWorkspace);
    const setWorkspaceOpen = useUIStore((s) => s.setWorkspaceOpen);
    const { pendingConnections } = usePeopleNotifications();
    const { data: summary } = useQuery({
        queryKey: queryKeys.workspace.summary(),
        queryFn: getWorkspaceSummaryAction,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    });
    const actionCount = summary?.success
        ? summary.taskCount + summary.requestCount + pendingConnections
        : pendingConnections;
    const hasAction = actionCount > 0;

    return (
        <button
            id="workspace-launcher"
            type="button"
            onClick={() => isWorkspaceOpen ? setWorkspaceOpen(false) : openWorkspace("tasks")}
            aria-controls="workspace-drawer"
            aria-expanded={isWorkspaceOpen}
            aria-haspopup="dialog"
            aria-label={`${isWorkspaceOpen ? "Close" : "Open"} Workspace${hasAction ? `, ${actionCount} item${actionCount === 1 ? "" : "s"} need attention` : ""}`}
            className={cn(
                "group flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950",
                isWorkspaceOpen
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            )}
        >
            <span className={cn("hidden md:inline", hasAction && "text-rose-600 dark:text-rose-400")}>Workspace</span>
            {hasAction ? (
                <span
                    aria-label={`${actionCount} workspace items need attention`}
                    className="hidden min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white md:inline-flex"
                >
                    {actionCount > 99 ? "99+" : actionCount}
                </span>
            ) : null}
            <ChevronRight className={cn("hidden h-3 w-3 text-zinc-400 transition-transform group-hover:text-zinc-600 dark:group-hover:text-zinc-300 md:block", isWorkspaceOpen && "rotate-90")} />
        </button>
    );
}
