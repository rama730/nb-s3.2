"use client";

import {
  Archive,
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  XCircle,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatSprintDateRange,
  formatSprintTimelineStamp,
  SPRINT_STATUS_PRESENTATION,
  computeSprintStatus,
  isSprintReadyToClose,
  type SprintListItem,
  type SprintPermissionSet,
} from "@/lib/projects/sprint-detail";
import { cn } from "@/lib/utils";

interface SprintHeaderProps {
  sprint: SprintListItem;
  permissions: SprintPermissionSet;
  isMutatingLifecycle: boolean;
  onEdit: () => void;
  onComplete: () => void;
  onArchive: () => void;
  onCancel: () => void;
}

export function SprintHeader({
  sprint,
  permissions,
  isMutatingLifecycle,
  onEdit,
  onComplete,
  onArchive,
  onCancel,
}: SprintHeaderProps) {
  const goal = sprint.goal?.trim();
  const description = sprint.description?.trim();
  const computedStatus = computeSprintStatus(sprint);
  const status = SPRINT_STATUS_PRESENTATION[computedStatus];
  const readyToClose = isSprintReadyToClose(sprint);
  const completedAt = sprint.completedAt ?? sprint.updatedAt ?? null;
  const canOpenMenu =
    (permissions.canComplete && readyToClose) ||
    (permissions.canWrite && sprint.status !== "archived");

  return (
    <header className="mb-8 flex items-start justify-between gap-4 border-b border-zinc-200 pb-5 dark:border-zinc-800">
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 className="text-xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
                {sprint.name}
              </h2>
              {goal ? <span className="text-zinc-400">—</span> : null}
              {goal ? (
                <p className="text-base text-zinc-600 dark:text-zinc-300">
                  {goal}
                </p>
              ) : null}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                  status.toneClassName,
                )}
              >
                {status.label}
              </span>
              {sprint.startDate || sprint.endDate ? (
                <span className="text-sm text-zinc-500">
                  {formatSprintDateRange(sprint.startDate, sprint.endDate)}
                </span>
              ) : null}
              {computedStatus === "planning" ? (
                <span className="text-xs text-zinc-500">
                  Starts automatically on schedule
                </span>
              ) : computedStatus === "completed" && completedAt ? (
                <span className="text-xs text-zinc-500">
                  Completed {formatSprintTimelineStamp(completedAt)}
                </span>
              ) : readyToClose ? (
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  Close-out required
                </span>
              ) : null}
            </div>

            {description ? (
              <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                {description}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <span className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">
              {sprint.code}
            </span>

            {permissions.canWrite || canOpenMenu ? (
              <div className="flex shrink-0 items-center gap-2">
                {permissions.canWrite && computedStatus === "planning" ? (
                  <button
                    type="button"
                    onClick={onEdit}
                    disabled={isMutatingLifecycle}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                    Edit
                  </button>
                ) : null}

                {canOpenMenu ? (
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Sprint lifecycle options"
                        disabled={isMutatingLifecycle}
                        className={cn(
                          "inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 hover:bg-zinc-50",
                          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50",
                          "dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900",
                        )}
                      >
                        <MoreHorizontal
                          aria-hidden="true"
                          className="h-4 w-4"
                        />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {permissions.canComplete && readyToClose ? (
                        <DropdownMenuItem onSelect={onComplete}>
                          <CheckCircle2
                            aria-hidden="true"
                            className="h-4 w-4"
                          />
                          Close sprint
                        </DropdownMenuItem>
                      ) : null}
                      {permissions.canComplete &&
                      readyToClose &&
                      permissions.canWrite ? (
                        <DropdownMenuSeparator />
                      ) : null}
                      {permissions.canWrite &&
                      (computedStatus === "planning" ||
                        computedStatus === "active") ? (
                        <DropdownMenuItem
                          className="text-red-600 focus:text-red-600"
                          onSelect={onCancel}
                        >
                          <XCircle aria-hidden="true" className="h-4 w-4" />
                          Cancel sprint
                        </DropdownMenuItem>
                      ) : null}
                      {permissions.canWrite &&
                      (computedStatus === "completed" ||
                        computedStatus === "cancelled") ? (
                        <DropdownMenuItem onSelect={onArchive}>
                          <Archive aria-hidden="true" className="h-4 w-4" />
                          Archive sprint
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
