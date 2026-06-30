"use client";

import React from "react";
import {
  Check,
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  PlayCircle,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatSprintDateRange,
  type SprintListItem,
  type SprintPermissionSet,
  type SprintTimelineFilter,
  type SprintVisibleCounts,
} from "@/lib/projects/sprint-detail";
import { cn } from "@/lib/utils";

interface SprintHeaderProps {
  sprint: SprintListItem;
  permissions: SprintPermissionSet;
  isMutatingLifecycle: boolean;
  filter: SprintTimelineFilter;
  visibleCounts: SprintVisibleCounts;
  onFilterChange: (filter: SprintTimelineFilter) => void;
  onEdit: () => void;
  onStart: () => void;
  onComplete: () => void;
}

const FILTER_MENU_ITEMS: Array<{
  id: SprintTimelineFilter;
  label: string;
}> = [
  { id: "all", label: "All work items" },
  { id: "work", label: "Work items" },
  { id: "blocked", label: "Blocked" },
  { id: "completed", label: "Complete" },
  { id: "files", label: "Files" },
];

function SprintActionButton({
  children,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3.5 text-sm font-medium text-zinc-800 transition-colors",
        "hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        "disabled:pointer-events-none disabled:opacity-60",
        "dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-zinc-700 dark:hover:bg-zinc-900 dark:focus-visible:ring-zinc-600 dark:focus-visible:ring-offset-zinc-950",
      )}
    >
      {children}
    </button>
  );
}

function SprintMoreMenu({
  sprint,
  permissions,
  isMutatingLifecycle,
  filter,
  visibleCounts,
  onFilterChange,
  onStart,
  onComplete,
}: Omit<SprintHeaderProps, "onEdit">) {
  const canRunLifecycle = permissions.canComplete && sprint.status === "active";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Sprint options"
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition-colors",
            "hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 active:scale-[0.99]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
            "dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-600 dark:focus-visible:ring-offset-zinc-950",
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          View
        </DropdownMenuLabel>
        {FILTER_MENU_ITEMS.map((item) => {
          const count = visibleCounts[item.id];
          const isActive = filter === item.id;
          return (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => onFilterChange(item.id)}
              className="justify-between"
            >
              <span>{item.label}</span>
              <span className="ml-3 inline-flex items-center gap-2 text-xs text-zinc-500">
                {typeof count === "number" ? count : null}
                {isActive ? (
                  <Check className="h-3.5 w-3.5 text-zinc-900 dark:text-zinc-100" />
                ) : null}
              </span>
            </DropdownMenuItem>
          );
        })}

        {canRunLifecycle ? <DropdownMenuSeparator /> : null}
        {permissions.canComplete && sprint.status === "active" ? (
          <DropdownMenuItem
            disabled={isMutatingLifecycle}
            onSelect={onComplete}
          >
            <CheckCircle2 className="h-4 w-4" />
            Complete sprint
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SprintHeader({
  sprint,
  permissions,
  isMutatingLifecycle,
  filter,
  visibleCounts,
  onFilterChange,
  onEdit,
  onStart,
  onComplete,
}: SprintHeaderProps) {
  const goal = sprint.goal?.trim();
  const description = sprint.description?.trim();
  const dateRange = formatSprintDateRange(sprint.startDate, sprint.endDate);

  return (
    <header className="px-0 py-6 border-b border-zinc-100 dark:border-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
              {sprint.name}
            </h2>
            <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              {dateRange}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {permissions.canWrite ? (
            <SprintActionButton disabled={isMutatingLifecycle} onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit
            </SprintActionButton>
          ) : null}
          <SprintMoreMenu
            sprint={sprint}
            permissions={permissions}
            isMutatingLifecycle={isMutatingLifecycle}
            filter={filter}
            visibleCounts={visibleCounts}
            onFilterChange={onFilterChange}
            onStart={onStart}
            onComplete={onComplete}
          />
        </div>
      </div>

      <div className="mt-6 border-t border-zinc-100 pt-5 dark:border-zinc-900">
        <div className="max-w-3xl space-y-2">
          <p className="text-base font-medium leading-7 text-zinc-900 dark:text-zinc-100">
            {goal || "No sprint focus has been written yet."}
          </p>
          {description ? (
            <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              {description}
            </p>
          ) : null}
        </div>
      </div>
    </header>
  );
}
