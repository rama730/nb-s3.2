import {
  buildSprintFilterCounts,
  type SprintCompareMetric,
  type SprintCompareSummary,
  type SprintDrawerPreview,
  type SprintHealthSummary,
  type SprintListItem,
  type SprintTimelineFilter,
  type SprintTimelineRow,
  type SprintVisibleCounts,
} from "@/lib/projects/sprint-detail";

export type SprintTimelineViewModel = {
  mode: "chronological";
  rows: SprintTimelineRow[];
  visibleCounts: SprintVisibleCounts;
};

function toSprintTimelineTimestamp(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function toMetric(current: number, previous: number | null, higherIsBetter: boolean): SprintCompareMetric {
  if (previous === null) {
    return {
      current,
      previous: null,
      delta: null,
      direction: "none",
      isPositive: null,
    };
  }

  const delta = current - previous;
  return {
    current,
    previous,
    delta,
    direction: delta === 0 ? "flat" : delta > 0 ? "up" : "down",
    isPositive: delta === 0 ? null : higherIsBetter ? delta > 0 : delta < 0,
  };
}

function getSprintBaselineTimestamp(sprint: SprintListItem) {
  return toSprintTimelineTimestamp(
    sprint.startDate ??
      sprint.createdAt ??
      sprint.endDate ??
      sprint.updatedAt ??
      null,
  );
}

export function buildSprintCompareSummary(input: {
  selectedSprint: SprintListItem;
  summary: SprintHealthSummary;
  previousSprint: SprintListItem | null;
  previousSummary: SprintHealthSummary | null;
}): SprintCompareSummary {
  return {
    baselineKind: input.previousSprint ? "previous_sprint" : "first_sprint",
    baselineSprintId: input.previousSprint?.id ?? null,
    baselineSprintName: input.previousSprint?.name ?? null,
    completionRate: toMetric(
      input.summary.completionPercentage,
      input.previousSummary?.completionPercentage ?? null,
      true,
    ),
    blockedTasks: toMetric(
      input.summary.blockedTasks,
      input.previousSummary?.blockedTasks ?? null,
      false,
    ),
    linkedFiles: toMetric(
      input.summary.linkedFileCount,
      input.previousSummary?.linkedFileCount ?? null,
      true,
    ),
    completedStoryPoints: toMetric(
      input.summary.completedStoryPoints,
      input.previousSummary?.completedStoryPoints ?? null,
      true,
    ),
  };
}

export function findPreviousSprintBaseline(
  sprints: SprintListItem[],
  selectedSprintId: string | null | undefined,
) {
  if (!selectedSprintId) return null;

  const ordered = [...sprints].sort((left, right) => {
    const byTimeline = getSprintBaselineTimestamp(right) - getSprintBaselineTimestamp(left);
    if (byTimeline !== 0) return byTimeline;

    const byUpdated = toSprintTimelineTimestamp(right.updatedAt) - toSprintTimelineTimestamp(left.updatedAt);
    if (byUpdated !== 0) return byUpdated;

    return left.id.localeCompare(right.id);
  });

  const selectedIndex = ordered.findIndex((sprint) => sprint.id === selectedSprintId);
  if (selectedIndex < 0) return null;
  return ordered[selectedIndex + 1] ?? null;
}

export function buildSprintDrawerPreviews(rows: SprintTimelineRow[]): SprintDrawerPreview[] {
  const previews: SprintDrawerPreview[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (row.kind !== "task") continue;
    const key = `task:${row.task.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    previews.push({
      type: "task",
      id: row.task.id,
      title: row.task.taskNumber ? `NB-${row.task.taskNumber} · ${row.task.title}` : row.task.title,
      subtitle: row.task.description?.trim() || "Task detail",
      occurredAt: row.occurredAt,
      badgeText: row.task.status,
    });
  }

  return previews;
}

export function buildSprintVisibleCounts(rows: SprintTimelineRow[]): SprintVisibleCounts {
  const taskRows = rows.filter((row): row is Extract<SprintTimelineRow, { kind: "task" }> => row.kind === "task");
  const fileRows = rows.filter((row): row is Extract<SprintTimelineRow, { kind: "file" }> => row.kind === "file");
  return buildSprintFilterCounts({
    totalTasks: taskRows.length,
    completedTasks: taskRows.filter((row) => row.task.status === "done").length,
    blockedTasks: taskRows.filter((row) => row.task.status === "blocked").length,
    linkedFileCount: fileRows.length,
  });
}

export function buildSprintTimelineViewModel(input: {
  rows: SprintTimelineRow[];
  filter: SprintTimelineFilter;
}): SprintTimelineViewModel {
  const rows = input.rows.filter((row) => {
    if (row.kind === "kickoff" || row.kind === "closeout") return true;
    if (input.filter === "files") return row.kind === "file" || row.kind === "file_version";
    if (input.filter === "work") return row.kind === "task";
    if (input.filter === "blocked") return row.kind === "task" && row.task.status === "blocked";
    if (input.filter === "completed") return row.kind === "task" && row.task.status === "done";
    return true;
  });

  return {
    mode: "chronological",
    rows,
    visibleCounts: buildSprintVisibleCounts(input.rows),
  };
}
