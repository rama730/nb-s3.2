"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";

import {
  buildProjectSprintDetailHref,
  SPRINT_STATUS_PRESENTATION,
  computeSprintStatus,
  type SprintListItem,
} from "@/lib/projects/sprint-detail";
import { cn } from "@/lib/utils";

interface SprintLeftRailProps {
  projectSlug: string;
  sprints: SprintListItem[];
  selectedSprintId: string | null;
  canCreate: boolean;
  onCreate: () => void;
}

const SPRINT_GROUPS = [
  { status: "active", label: "Current" },
  { status: "planning", label: "Upcoming" },
  { status: "completed", label: "Completed" },
  { status: "cancelled", label: "Cancelled" },
  { status: "archived", label: "Archived" },
] as const;

export function SprintLeftRail({
  projectSlug,
  sprints,
  selectedSprintId,
  canCreate,
  onCreate,
}: SprintLeftRailProps) {
  // ponytail: group once instead of mapping over groups and filtering all sprints each time
  const sprintsByStatus = useMemo(() => {
    const grouped = new Map<string, SprintListItem[]>();
    for (const group of SPRINT_GROUPS) grouped.set(group.status, []);
    for (const sprint of sprints) {
      const computedStatus = computeSprintStatus(sprint);
      if (grouped.has(computedStatus)) {
        grouped.get(computedStatus)!.push(sprint);
      }
    }
    const timestamp = (value: string | null | undefined) => {
      const parsed = value ? Date.parse(value) : Number.NaN;
      return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
    };
    const compareNewestFirst = (
      left: SprintListItem,
      right: SprintListItem,
      resolve: (sprint: SprintListItem) => string | null | undefined,
    ) => {
      const difference = timestamp(resolve(right)) - timestamp(resolve(left));
      return Number.isFinite(difference)
        ? difference
        : left.id.localeCompare(right.id);
    };
    const compareEarliestFirst = (
      left: SprintListItem,
      right: SprintListItem,
    ) => {
      const leftDate = timestamp(left.startDate);
      const rightDate = timestamp(right.startDate);
      const difference =
        (leftDate === Number.NEGATIVE_INFINITY
          ? Number.POSITIVE_INFINITY
          : leftDate) -
        (rightDate === Number.NEGATIVE_INFINITY
          ? Number.POSITIVE_INFINITY
          : rightDate);
      return Number.isFinite(difference)
        ? difference
        : left.id.localeCompare(right.id);
    };
    grouped
      .get("active")
      ?.sort((left, right) =>
        compareNewestFirst(
          left,
          right,
          (sprint) => sprint.startedAt ?? sprint.startDate,
        ),
      );
    grouped.get("planning")?.sort(compareEarliestFirst);
    for (const status of ["completed", "cancelled", "archived"] as const) {
      grouped
        .get(status)
        ?.sort((left, right) =>
          compareNewestFirst(
            left,
            right,
            (sprint) =>
              sprint.completedAt ??
              sprint.cancelledAt ??
              sprint.archivedAt ??
              sprint.updatedAt,
          ),
        );
    }
    return grouped;
  }, [sprints]);

  return (
    <aside className="w-full min-h-0 overflow-y-auto pr-2 app-scroll app-scroll-y app-scroll-gutter lg:sticky lg:top-[calc(var(--project-tabs-height,0px)+1rem)] lg:max-h-[calc(100dvh-var(--project-tabs-height,0px)-2rem)]">
      <div className="space-y-6">
        {canCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
          >
            <Plus className="h-4 w-4" />
            New Sprint
          </button>
        ) : null}

        <nav className="space-y-6 pb-10">
          {SPRINT_GROUPS.map((group) => {
            const groupedSprints = sprintsByStatus.get(group.status) || [];
            if (groupedSprints.length === 0) return null;

            return (
              <section key={group.status} className="space-y-1">
                <p className="flex items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  <span>{group.label}</span>
                  <span
                    aria-label={`${groupedSprints.length} ${group.label.toLowerCase()} sprints`}
                  >
                    {groupedSprints.length}
                  </span>
                </p>
                {groupedSprints.map((sprint) => {
                  const isSelected = selectedSprintId === sprint.id;
                  const computedStatus = computeSprintStatus(sprint);
                  return (
                    <Link
                      key={sprint.id}
                      href={buildProjectSprintDetailHref(
                        projectSlug,
                        sprint.id,
                        { sprintCode: sprint.code },
                      )}
                      prefetch={false}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-2 py-2 transition-colors",
                        isSelected
                          ? "bg-zinc-100 text-zinc-950 dark:bg-zinc-800/80 dark:text-white"
                          : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900/50",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          SPRINT_STATUS_PRESENTATION[computedStatus]
                            .dotClassName,
                        )}
                      />
                      <div className="min-w-0 flex-1 flex flex-col">
                        <div className="flex justify-between items-start gap-2">
                          <span className="truncate text-sm font-medium leading-tight">
                            {sprint.name}
                          </span>
                          <span className="text-[10px] shrink-0 text-zinc-400 font-semibold tracking-wider">
                            {sprint.code}
                          </span>
                        </div>
                        {sprint.goal ? (
                          <span className="truncate text-[11px] text-zinc-500 mt-0.5">
                            {sprint.goal}
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  );
                })}
              </section>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
