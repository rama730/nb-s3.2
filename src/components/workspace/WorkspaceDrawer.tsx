"use client";

import React from "react";
import { Inbox, ListChecks, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useUIStore } from "@/lib/stores/ui-store";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { getWorkspaceSummaryAction } from "@/app/actions/workspace";
import { usePeopleNotifications } from "@/hooks/usePeopleNotifications";

import WorkspaceTasksTab from "./WorkspaceTasksTab";
import WorkspaceRequestsTab from "./WorkspaceRequestsTab";

export default function WorkspaceDrawer() {
  const isWorkspaceOpen = useUIStore((s) => s.isWorkspaceOpen);
  const setWorkspaceOpen = useUIStore((s) => s.setWorkspaceOpen);
  const activeTab = useUIStore((s) => s.workspaceTab);
  const setActiveTab = useUIStore((s) => s.setWorkspaceTab);
  const { pendingConnections } = usePeopleNotifications();

  const { data: summary } = useQuery({
    queryKey: queryKeys.workspace.summary(),
    queryFn: getWorkspaceSummaryAction,
    enabled: isWorkspaceOpen,
    staleTime: 30_000,
  });
  const taskCount = summary?.success ? summary.taskCount : 0;
  // Project invitations are already included in the workspace summary; only
  // add connection requests from the shared Connections attention source.
  const requestCount = (summary?.success ? summary.requestCount : 0) + pendingConnections;
  const tabs = [
    { id: "tasks" as const, label: "Tasks", icon: ListChecks, count: taskCount },
    { id: "requests" as const, label: "Requests", icon: Inbox, count: requestCount },
  ];

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex]!;
    setActiveTab(next.id);
    document.getElementById(`workspace-${next.id}-tab`)?.focus();
  };

  return (
    <Dialog open={isWorkspaceOpen} onOpenChange={setWorkspaceOpen}>
      <DialogContent
        data-testid="workspace-drawer"
        id="workspace-drawer"
        presentation="right-drawer"
        showCloseButton={false}
        overlayClassName="z-[200] bg-zinc-900/40 backdrop-blur-md dark:bg-black/50"
        onCloseAutoFocus={(event) => {
          const launcher = document.getElementById("workspace-launcher");
          if (!launcher) return;
          event.preventDefault();
          launcher.focus();
        }}
        className="z-[201] h-full gap-0 border-zinc-200 bg-white p-0 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 lg:w-[40vw] lg:max-w-[42rem]"
      >
        <div className="flex-shrink-0 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2">
              <DialogTitle className="text-base font-bold text-zinc-900 dark:text-zinc-50">
                Workspace
              </DialogTitle>
              <DialogDescription className="sr-only">
                Review open work and pending project requests.
              </DialogDescription>
            </div>
            <DialogClose
              aria-label="Close workspace"
              className="min-h-10 min-w-10 rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-zinc-800"
            >
              <X className="h-4 w-4" />
            </DialogClose>
          </div>

          <div
            role="tablist"
            className="flex w-full items-center gap-4 px-6 pb-0"
          >
            {tabs.map((tab, index) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              const needsAttention = tab.count > 0;
              return <button
                key={tab.id}
                id={`workspace-${tab.id}-tab`}
                data-testid={`workspace-tab-${tab.id}`}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                role="tab"
                tabIndex={selected ? 0 : -1}
                aria-selected={selected}
                aria-controls={`workspace-${tab.id}-panel`}
                className={cn(
                  "flex items-center gap-2 border-b-2 px-1 pb-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  selected ? "border-primary text-primary" : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
                )}
              >
                <Icon className={cn(
                  "h-4 w-4 transition-colors duration-300",
                  needsAttention
                    ? "text-rose-500 drop-shadow-[0_0_3px_rgba(244,63,94,0.3)] dark:text-rose-400"
                    : selected ? "text-primary" : "",
                )} />
                <span>{tab.label}</span>
                {tab.count > 0 && <span aria-label={tab.id === "tasks" ? `${tab.count} tasks assigned to you` : `${tab.count} pending requests`} className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{tab.count > 99 ? "99+" : tab.count}</span>}
              </button>;
            })}
          </div>
        </div>

        <div className={cn(
          "relative flex-1 overflow-y-auto bg-zinc-50/20 px-6 pb-6 pt-2 dark:bg-zinc-950/20",
        )}>
          {activeTab === "tasks" ? (
            <WorkspaceTasksTab isActive={activeTab === "tasks"} />
          ) : (
            <WorkspaceRequestsTab isActive={activeTab === "requests"} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
