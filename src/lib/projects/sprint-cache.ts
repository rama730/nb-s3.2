import {
  buildSprintFilterCounts,
  type SprintCompareSummary,
  type SprintDetailPayload,
  type SprintFileTimelineEntity,
  type SprintHealthSummary,
  type SprintTimelinePerson,
  type SprintTimelineRow,
  type SprintTaskTimelineEntity,
} from "@/lib/projects/sprint-detail";
import { buildSprintDrawerPreviews } from "@/lib/projects/sprint-presentation";
import type { TaskSurfaceRecord } from "@/lib/projects/task-presentation";

type SprintTaskMutationRecord = Pick<
  TaskSurfaceRecord,
  | "id"
  | "projectKey"
  | "title"
  | "description"
  | "status"
  | "priority"
  | "storyPoints"
  | "sprintId"
  | "createdAt"
  | "updatedAt"
  | "taskNumber"
  | "assignee"
  | "creator"
> & {
  projectId: string;
  linkedFileCount?: number | null;
  linkedFiles?: SprintFileTimelineEntity[] | null;
};

function cloneSummary(summary: SprintHealthSummary): SprintHealthSummary {
  return { ...summary };
}

function clampSummary(summary: SprintHealthSummary): SprintHealthSummary {
  const totalTasks = Math.max(0, summary.totalTasks);
  const completedTasks = Math.max(0, Math.min(totalTasks, summary.completedTasks));
  const blockedTasks = Math.max(0, Math.min(totalTasks, summary.blockedTasks));
  const linkedFileCount = Math.max(0, summary.linkedFileCount);
  const totalStoryPoints = Math.max(0, summary.totalStoryPoints);
  const completedStoryPoints = Math.max(0, Math.min(totalStoryPoints, summary.completedStoryPoints));

  return {
    totalTasks,
    completedTasks,
    blockedTasks,
    linkedFileCount,
    totalStoryPoints,
    completedStoryPoints,
    completionPercentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
  };
}

function applyTaskDelta(summary: SprintHealthSummary, task: SprintTaskMutationRecord, direction: 1 | -1) {
  summary.totalTasks += direction;
  summary.totalStoryPoints += (task.storyPoints ?? 0) * direction;
  summary.linkedFileCount += (task.linkedFileCount ?? 0) * direction;
  if (task.status === "done") {
    summary.completedTasks += direction;
    summary.completedStoryPoints += (task.storyPoints ?? 0) * direction;
  }
  if (task.status === "blocked") {
    summary.blockedTasks += direction;
  }
}

function patchCompareSummary(compareSummary: SprintCompareSummary | null, summary: SprintHealthSummary) {
  if (!compareSummary) return null;

  const withDelta = (previous: number | null, current: number, higherIsBetter: boolean) => {
    if (previous === null) {
      return {
        current,
        previous,
        delta: null,
        direction: "none" as const,
        isPositive: null,
      };
    }

    const delta = current - previous;
    return {
      current,
      previous,
      delta,
      direction: delta === 0 ? ("flat" as const) : delta > 0 ? ("up" as const) : ("down" as const),
      isPositive: delta === 0 ? null : higherIsBetter ? delta > 0 : delta < 0,
    };
  };

  return {
    ...compareSummary,
    completionRate: withDelta(compareSummary.completionRate.previous, summary.completionPercentage, true),
    blockedTasks: withDelta(compareSummary.blockedTasks.previous, summary.blockedTasks, false),
    linkedFiles: withDelta(compareSummary.linkedFiles.previous, summary.linkedFileCount, true),
    completedStoryPoints: withDelta(compareSummary.completedStoryPoints.previous, summary.completedStoryPoints, true),
  };
}

function toTimelineTask(task: SprintTaskMutationRecord): SprintTaskTimelineEntity {
  const toPerson = (
    person: SprintTaskMutationRecord["assignee"] | SprintTaskMutationRecord["creator"],
    fallbackId: string,
  ): SprintTimelinePerson => {
    if (!person) return null;
    return {
      id: person.id ?? fallbackId,
      fullName: person.fullName,
      avatarUrl: person.avatarUrl,
    };
  };

  return {
    id: task.id,
    projectId: task.projectId,
    sprintId: task.sprintId ?? "",
    taskNumber: task.taskNumber,
    title: task.title,
    description: task.description,
    status: task.status as SprintTaskTimelineEntity["status"],
    priority: task.priority as SprintTaskTimelineEntity["priority"],
    storyPoints: task.storyPoints,
    dueDate: null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    activityAt: task.updatedAt ?? task.createdAt,
    linkedFileCount: task.linkedFileCount ?? 0,
    assignee: toPerson(task.assignee, `assignee:${task.id}`),
    creator: toPerson(task.creator, `creator:${task.id}`),
  };
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function compareActivityRows(
  left: Extract<SprintTimelineRow, { kind: "task" | "file" }>,
  right: Extract<SprintTimelineRow, { kind: "task" | "file" }>,
) {
  const leftAt = toTimestamp(left.occurredAt);
  const rightAt = toTimestamp(right.occurredAt);
  if (leftAt !== rightAt) return leftAt - rightAt;

  if (left.task.id === right.task.id && left.kind !== right.kind) {
    return left.kind === "task" ? -1 : 1;
  }

  if (left.kind !== right.kind) {
    return left.kind === "task" ? -1 : 1;
  }

  return left.id.localeCompare(right.id);
}

function buildFileRowsForTask(
  task: SprintTaskMutationRecord,
  timelineTask: SprintTaskTimelineEntity,
): Extract<SprintTimelineRow, { kind: "file" }>[] {
  const linkedFiles = [...(task.linkedFiles ?? [])].sort((left, right) => {
    const byLinkedAt = toTimestamp(left.linkedAt ?? left.lastEventAt) - toTimestamp(right.linkedAt ?? right.lastEventAt);
    if (byLinkedAt !== 0) return byLinkedAt;
    return left.id.localeCompare(right.id);
  });

  return linkedFiles.map((file) => ({
    id: `${timelineTask.id}:${file.id}`,
    kind: "file",
    occurredAt: file.linkedAt ?? file.lastEventAt ?? timelineTask.activityAt ?? timelineTask.createdAt ?? null,
    task: {
      id: timelineTask.id,
      title: timelineTask.title,
      taskNumber: timelineTask.taskNumber,
      status: timelineTask.status,
      priority: timelineTask.priority,
    },
    file,
  }));
}

function patchRows(
  rows: SprintDetailPayload["rows"],
  selectedSprintId: string | null,
  beforeTask: SprintTaskMutationRecord | null,
  afterTask: SprintTaskMutationRecord | null,
  isHeadPage: boolean,
) {
  const kickoffRows = rows.filter((row): row is Extract<SprintTimelineRow, { kind: "kickoff" }> => row.kind === "kickoff");
  const closeoutRows = rows.filter((row): row is Extract<SprintTimelineRow, { kind: "closeout" }> => row.kind === "closeout");
  let activityRows = rows.filter((row): row is Extract<SprintTimelineRow, { kind: "task" | "file" }> => row.kind === "task" || row.kind === "file");

  const shouldRemoveBeforeTask =
    !!beforeTask &&
    beforeTask.sprintId === selectedSprintId &&
    (!afterTask || afterTask.id !== beforeTask.id || afterTask.sprintId !== selectedSprintId);

  if (shouldRemoveBeforeTask && beforeTask) {
    activityRows = activityRows.filter((row) => row.task.id !== beforeTask.id);
  }

  if (afterTask && afterTask.sprintId === selectedSprintId) {
    const timelineTask = toTimelineTask(afterTask);
    const hadTaskRow = activityRows.some((row) => row.kind === "task" && row.task.id === afterTask.id);
    const shouldMaterializeTask = hadTaskRow || isHeadPage;

    activityRows = activityRows.filter((row) => {
      if (row.task.id !== afterTask.id) return true;
      if (row.kind === "task") return false;
      if (afterTask.linkedFiles) return false;
      return true;
    });

    if (shouldMaterializeTask) {
      activityRows.push({
        id: timelineTask.id,
        kind: "task",
        occurredAt: timelineTask.activityAt ?? timelineTask.createdAt ?? null,
        task: timelineTask,
      });

      if (afterTask.linkedFiles) {
        activityRows.push(...buildFileRowsForTask(afterTask, timelineTask));
      } else {
        activityRows = activityRows.map((row) => {
          if (row.kind === "file" && row.task.id === afterTask.id) {
            return {
              ...row,
              task: {
                ...row.task,
                title: timelineTask.title,
                taskNumber: timelineTask.taskNumber,
                status: timelineTask.status,
                priority: timelineTask.priority,
              },
            };
          }

          return row;
        });
      }
    }
  }

  activityRows.sort(compareActivityRows);
  return [...kickoffRows, ...activityRows, ...closeoutRows];
}

function patchPage(
  page: SprintDetailPayload,
  beforeTask: SprintTaskMutationRecord | null,
  afterTask: SprintTaskMutationRecord | null,
  isHeadPage: boolean,
): SprintDetailPayload {
  const selectedSprintId = page.selectedSprintId;
  const beforeSelected = !!beforeTask && beforeTask.sprintId === selectedSprintId;
  const afterSelected = !!afterTask && afterTask.sprintId === selectedSprintId;

  if (!beforeSelected && !afterSelected) {
    return page;
  }

  const nextSummary = page.summary ? cloneSummary(page.summary) : null;
  if (nextSummary) {
    if (beforeSelected && beforeTask) {
      applyTaskDelta(nextSummary, beforeTask, -1);
    }
    if (afterSelected && afterTask) {
      applyTaskDelta(nextSummary, afterTask, 1);
    }
  }

  const clampedSummary = nextSummary ? clampSummary(nextSummary) : null;
  const nextRows = patchRows(page.rows, selectedSprintId, beforeTask, afterTask, isHeadPage).map((row) => {
    if (row.kind !== "closeout" || !clampedSummary) return row;
    return {
      ...row,
      summary: clampedSummary,
    };
  });

  return {
    ...page,
    summary: clampedSummary,
    compareSummary: clampedSummary ? patchCompareSummary(page.compareSummary, clampedSummary) : page.compareSummary,
    filterCounts: clampedSummary
      ? buildSprintFilterCounts({
          totalTasks: clampedSummary.totalTasks,
          completedTasks: clampedSummary.completedTasks,
          blockedTasks: clampedSummary.blockedTasks,
          linkedFileCount: clampedSummary.linkedFileCount,
        })
      : page.filterCounts,
    rows: nextRows,
    drawerPreviews: buildSprintDrawerPreviews(nextRows),
  };
}

export function patchSprintDetailInfiniteData(
  existing: unknown,
  beforeTask: SprintTaskMutationRecord | null,
  afterTask: SprintTaskMutationRecord | null,
) {
  if (
    !existing ||
    typeof existing !== "object" ||
    !("pages" in existing) ||
    !Array.isArray((existing as { pages: unknown }).pages)
  ) {
    return existing;
  }

  const infiniteData = existing as { pages: SprintDetailPayload[]; pageParams: unknown[] };
  return {
    ...infiniteData,
    pages: infiniteData.pages.map((page, index) => patchPage(page, beforeTask, afterTask, index === 0)),
  };
}

export type { SprintTaskMutationRecord };
