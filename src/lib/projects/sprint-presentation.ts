import {
  buildSprintFilterCounts,
  type SprintCompareMetric,
  type SprintCompareSummary,
  type SprintDetailPayload,
  type SprintDrawerPreview,
  type SprintHealthSummary,
  type SprintListItem,
  type SprintRouteState,
  type SprintTimelineFilter,
  type SprintTimelineMode,
  type SprintTimelineRow,
  type SprintViewPreference,
  type SprintVisibleCounts,
} from "@/lib/projects/sprint-detail";

export type SprintGroupedTimelineItem = {
  taskRow: Extract<SprintTimelineRow, { kind: "task" }>;
  fileRows: Extract<SprintTimelineRow, { kind: "file" }>[];
};

export type SprintTimelineViewModel =
  | {
      mode: "chronological" | "files";
      rows: SprintTimelineRow[];
      groups: [];
      kickoff: null;
      closeout: null;
      visibleCounts: SprintVisibleCounts;
    }
  | {
      mode: "grouped";
      rows: [];
      groups: SprintGroupedTimelineItem[];
      kickoff: Extract<SprintTimelineRow, { kind: "kickoff" }> | null;
      closeout: Extract<SprintTimelineRow, { kind: "closeout" }> | null;
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

function normalizeFilterForMode(mode: SprintTimelineMode, filter: SprintTimelineFilter): SprintTimelineFilter {
  if (mode === "files" && filter === "files") {
    return "all";
  }
  return filter;
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

function getFileRowsForFilter(
  rows: SprintTimelineRow[],
  filter: "all" | "blocked" | "completed",
): SprintTimelineRow[] {
  return rows.filter((row) => {
    if (row.kind === "kickoff" || row.kind === "closeout") return true;
    if (row.kind !== "file") return false;
    if (filter === "blocked") return row.task.status === "blocked";
    if (filter === "completed") return row.task.status === "done";
    return true;
  });
}

export function getSprintFiltersForMode(mode: SprintTimelineMode): SprintTimelineFilter[] {
  if (mode === "files") {
    return ["all", "blocked", "completed"];
  }
  return ["all", "work", "blocked", "completed", "files"];
}

export function resolveSprintViewState(input: {
  routeState: SprintRouteState;
  preference: SprintViewPreference | null;
}): {
  mode: SprintTimelineMode;
  filter: SprintTimelineFilter;
} {
  const mode = input.routeState.hasExplicitMode
    ? input.routeState.mode
    : input.preference?.mode ?? "chronological";

  const candidateFilter = input.routeState.hasExplicitFilter
    ? input.routeState.filter
    : input.preference?.filter ?? "all";

  const normalizedFilter = normalizeFilterForMode(mode, candidateFilter);
  const allowedFilters = new Set(getSprintFiltersForMode(mode));

  return {
    mode,
    filter: allowedFilters.has(normalizedFilter) ? normalizedFilter : "all",
  };
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
    if (row.kind === "task") {
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
      continue;
    }

    if (row.kind === "file") {
      const key = `file:${row.file.nodeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      previews.push({
        type: "file",
        id: row.file.nodeId,
        title: row.file.nodeName,
        subtitle: row.file.nodePath || row.task.title,
        occurredAt: row.occurredAt,
        badgeText: row.file.nodeType,
      });
    }
  }

  return previews;
}

export function buildSprintVisibleCounts(
  rows: SprintTimelineRow[],
  mode: SprintTimelineMode,
): SprintVisibleCounts {
  if (mode === "files") {
    const fileRows = rows.filter((row) => row.kind === "file");
    return {
      all: fileRows.length,
      blocked: fileRows.filter((row) => row.kind === "file" && row.task.status === "blocked").length,
      completed: fileRows.filter((row) => row.kind === "file" && row.task.status === "done").length,
    };
  }

  if (mode === "grouped") {
    const taskRows = rows.filter((row): row is Extract<SprintTimelineRow, { kind: "task" }> => row.kind === "task");
    return {
      all: taskRows.length,
      work: taskRows.length,
      blocked: taskRows.filter((row) => row.task.status === "blocked").length,
      completed: taskRows.filter((row) => row.task.status === "done").length,
      files: taskRows.filter((row) => row.task.linkedFileCount > 0).length,
    };
  }

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
  mode: SprintTimelineMode;
  filter: SprintTimelineFilter;
}): SprintTimelineViewModel {
  const normalizedFilter = normalizeFilterForMode(input.mode, input.filter);

  if (input.mode === "files") {
    const fileFilter = normalizedFilter === "blocked" || normalizedFilter === "completed" ? normalizedFilter : "all";
    return {
      mode: "files",
      rows: getFileRowsForFilter(input.rows, fileFilter),
      groups: [],
      kickoff: null,
      closeout: null,
      visibleCounts: buildSprintVisibleCounts(input.rows, "files"),
    };
  }

  if (input.mode === "grouped") {
    const kickoff = input.rows.find((row): row is Extract<SprintTimelineRow, { kind: "kickoff" }> => row.kind === "kickoff");
    const closeout = [...input.rows].reverse().find((row): row is Extract<SprintTimelineRow, { kind: "closeout" }> => row.kind === "closeout");
    const filesByTaskId = new Map<string, Extract<SprintTimelineRow, { kind: "file" }>[]>();

    for (const row of input.rows) {
      if (row.kind !== "file") continue;
      const current = filesByTaskId.get(row.task.id) ?? [];
      current.push(row);
      filesByTaskId.set(row.task.id, current);
    }

    const groups = input.rows
      .filter((row): row is Extract<SprintTimelineRow, { kind: "task" }> => row.kind === "task")
      .filter((row) => {
        if (normalizedFilter === "blocked") return row.task.status === "blocked";
        if (normalizedFilter === "completed") return row.task.status === "done";
        if (normalizedFilter === "files") return (filesByTaskId.get(row.task.id) ?? []).length > 0;
        return true;
      })
      .map((taskRow) => ({
        taskRow,
        fileRows: filesByTaskId.get(taskRow.task.id) ?? [],
      }));

    return {
      mode: "grouped",
      rows: [],
      groups,
      kickoff: kickoff ?? null,
      closeout: closeout ?? null,
      visibleCounts: buildSprintVisibleCounts(input.rows, "grouped"),
    };
  }

  const chronologicalRows = input.rows.filter((row) => {
    if (row.kind === "kickoff" || row.kind === "closeout") return true;
    if (normalizedFilter === "files") return row.kind === "file";
    if (normalizedFilter === "work") return row.kind === "task";
    if (normalizedFilter === "blocked") return row.kind === "task" && row.task.status === "blocked";
    if (normalizedFilter === "completed") return row.kind === "task" && row.task.status === "done";
    return true;
  });

  return {
    mode: "chronological",
    rows: chronologicalRows,
    groups: [],
    kickoff: null,
    closeout: null,
    visibleCounts: buildSprintVisibleCounts(input.rows, "chronological"),
  };
}

export function buildSprintShellSlice(payload: SprintDetailPayload) {
  return {
    projectId: payload.projectId,
    projectSlug: payload.projectSlug,
    sprints: payload.sprints,
    selectedSprintId: payload.selectedSprintId,
    permissions: payload.permissions,
    timelineMode: payload.timelineMode,
  };
}

export function buildSprintSummarySlice(payload: SprintDetailPayload) {
  return {
    projectId: payload.projectId,
    selectedSprintId: payload.selectedSprintId,
    summary: payload.summary,
    compareSummary: payload.compareSummary,
    filterCounts: payload.filterCounts,
  };
}

export function buildSprintTimelineSlice(payload: SprintDetailPayload) {
  return {
    projectId: payload.projectId,
    selectedSprintId: payload.selectedSprintId,
    rows: payload.rows,
    drawerPreviews: payload.drawerPreviews,
    nextCursor: payload.nextCursor,
    hasMore: payload.hasMore,
  };
}
