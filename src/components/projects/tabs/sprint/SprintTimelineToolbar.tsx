"use client";

import {
  SPRINT_FILTER_LABELS,
  SPRINT_TIMELINE_MODE_LABELS,
  type SprintTimelineFilter,
  type SprintTimelineMode,
  type SprintVisibleCounts,
} from "@/lib/projects/sprint-detail";
import { getSprintFiltersForMode } from "@/lib/projects/sprint-presentation";
import { cn } from "@/lib/utils";

interface SprintTimelineToolbarProps {
  mode: SprintTimelineMode;
  filter: SprintTimelineFilter;
  visibleCounts: SprintVisibleCounts;
  onModeChange: (mode: SprintTimelineMode) => void;
  onFilterChange: (filter: SprintTimelineFilter) => void;
}

export function SprintTimelineToolbar({
  mode,
  filter,
  visibleCounts,
  onModeChange,
  onFilterChange,
}: SprintTimelineToolbarProps) {
  const availableFilters = getSprintFiltersForMode(mode);

  return (
    <div className="border-b border-zinc-200 px-8 py-4 dark:border-zinc-800">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900">
          {(Object.keys(SPRINT_TIMELINE_MODE_LABELS) as SprintTimelineMode[]).map((modeOption) => (
            <button
              key={modeOption}
              type="button"
              onClick={() => onModeChange(modeOption)}
              aria-pressed={mode === modeOption}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                mode === modeOption
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
              )}
            >
              {SPRINT_TIMELINE_MODE_LABELS[modeOption]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {availableFilters.map((filterOption) => {
            const count = visibleCounts[filterOption];
            return (
              <button
                key={filterOption}
                type="button"
                onClick={() => onFilterChange(filterOption)}
                aria-pressed={filter === filterOption}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  filter === filterOption
                    ? "border-zinc-900 bg-zinc-900 text-zinc-100 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100",
                )}
              >
                <span>{SPRINT_FILTER_LABELS[filterOption]}</span>
                {typeof count === "number" ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px]",
                      filter === filterOption
                        ? "bg-zinc-100/15 text-inherit dark:bg-zinc-900/15"
                        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400",
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
