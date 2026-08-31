import {
  type SprintHealthSummary,
  type SprintListItem,
  type SprintTimelineRow,
  type SprintTaskTimelineEntity,
} from "@/lib/projects/sprint-detail";

/**
 * The Sprint surface is a summary of work that entered the sprint, not a
 * second activity log.  A task owns its files, discussion, and status trail
 * inside its disclosure panel; the outer trail owns exactly one row per task.
 */
export type SprintTimelineTaskInput = SprintTaskTimelineEntity & {
  /** Retained for cache compatibility; files are intentionally not outer rows. */
  files?: unknown[];
};

function timestamp(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : Number.POSITIVE_INFINITY;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function compareRows(left: SprintTimelineRow, right: SprintTimelineRow) {
  if (left.kind === "kickoff") return right.kind === "kickoff" ? left.id.localeCompare(right.id) : -1;
  if (right.kind === "kickoff") return 1;
  if (left.kind === "closeout") return right.kind === "closeout" ? left.id.localeCompare(right.id) : 1;
  if (right.kind === "closeout") return -1;

  const delta = timestamp(left.occurredAt) - timestamp(right.occurredAt);
  return delta || left.id.localeCompare(right.id);
}

/** Cache callers use the same stable ordering as the visible summary trail. */
export const compareSprintTimelineActivityRows = compareRows;

/** Keep overlapping cursor pages idempotent after a refetch or optimistic task mutation. */
export function mergeSprintTimelineRows(groups: ReadonlyArray<ReadonlyArray<SprintTimelineRow>>) {
  const rows = new Map<string, SprintTimelineRow>();
  for (const group of groups) for (const row of group) rows.set(row.id, row);
  return [...rows.values()].sort(compareRows);
}

export function buildSprintTimeline(input: {
  sprint: SprintListItem;
  tasks: SprintTimelineTaskInput[];
  summary: SprintHealthSummary;
  includeKickoff?: boolean;
  includeCloseout?: boolean;
}) {
  const rows: SprintTimelineRow[] = [];

  if (input.includeKickoff ?? true) {
    rows.push({
      id: `${input.sprint.id}:kickoff`,
      kind: "kickoff",
      occurredAt: input.sprint.startedAt ?? input.sprint.createdAt ?? input.sprint.startDate ?? null,
      sprint: input.sprint,
    });
  }

  for (const task of [...input.tasks].sort((left, right) => {
    const delta = timestamp(left.addedAt ?? left.activityAt ?? left.createdAt) - timestamp(right.addedAt ?? right.activityAt ?? right.createdAt);
    return delta || left.id.localeCompare(right.id);
  })) {
    rows.push({
      id: `task:${task.id}`,
      kind: "task",
      // Sprint membership is the stable outer-trail origin. Later task work
      // stays inside the disclosure and never reorders the Sprint trail.
      occurredAt: task.addedAt ?? task.activityAt ?? task.createdAt ?? null,
      task,
    });
  }

  if (
    (input.includeCloseout ?? true) &&
    (input.sprint.status === "completed" ||
      (input.sprint.status === "archived" && Boolean(input.sprint.completedAt)))
  ) {
    rows.push({
      id: `${input.sprint.id}:closeout`,
      kind: "closeout",
      occurredAt: input.sprint.completedAt ?? input.sprint.updatedAt ?? input.sprint.endDate ?? null,
      sprint: input.sprint,
      summary: input.summary,
    });
  }

  return rows;
}
