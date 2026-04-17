"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import {
  buildProjectSprintDetailHref,
  formatSprintDateRange,
  SPRINT_STATUS_PRESENTATION,
  type SprintListItem,
  type SprintTimelineFilter,
  type SprintTimelineMode,
} from "@/lib/projects/sprint-detail";
import { cn } from "@/lib/utils";

interface SprintLeftRailProps {
  projectSlug: string;
  sprints: SprintListItem[];
  selectedSprintId: string | null;
  filter: SprintTimelineFilter;
  mode: SprintTimelineMode;
  canCreate: boolean;
  onCreate: () => void;
  onSelect: (sprintId: string) => void;
  onPrefetch: (sprintId: string) => void;
}

export function SprintLeftRail({
  projectSlug,
  sprints,
  selectedSprintId,
  filter,
  mode,
  canCreate,
  onCreate,
  onSelect,
  onPrefetch,
}: SprintLeftRailProps) {
  return (
    <aside className="w-[280px] min-h-0 flex-shrink-0 overflow-y-auto pr-2 app-scroll app-scroll-y app-scroll-gutter">
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Sprint history</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Move between sprints quickly and keep the work focused in one place.
          </p>
        </div>

        {canCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
          >
            <Plus className="h-4 w-4" />
            New Sprint
          </button>
        ) : null}

        <div className="space-y-2 pb-10">
          {sprints.map((sprint) => {
            const isSelected = selectedSprintId === sprint.id;
            return (
              <Link
                key={sprint.id}
                href={buildProjectSprintDetailHref(projectSlug, sprint.id, { filter, mode })}
                prefetch={false}
                onClick={() => onSelect(sprint.id)}
                onMouseEnter={() => onPrefetch(sprint.id)}
                onFocus={() => onPrefetch(sprint.id)}
                className={cn(
                  "block rounded-2xl border px-4 py-3 transition-colors",
                  isSelected
                    ? "border-zinc-900 bg-zinc-50 shadow-sm dark:border-zinc-100 dark:bg-zinc-900"
                    : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-1.5 flex flex-shrink-0 items-center">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-2.5 w-2.5 rounded-full",
                        SPRINT_STATUS_PRESENTATION[sprint.status].dotClassName,
                      )}
                    />
                    <span className="sr-only">{SPRINT_STATUS_PRESENTATION[sprint.status].label}</span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{sprint.name}</p>
                    <p className="line-clamp-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                      {sprint.goal?.trim() || "No sprint goal has been set yet."}
                    </p>
                    {(sprint.startDate || sprint.endDate) ? (
                      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                        {formatSprintDateRange(sprint.startDate, sprint.endDate)}
                      </p>
                    ) : null}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
