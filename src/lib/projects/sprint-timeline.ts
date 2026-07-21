import {
  type SprintFileTimelineEntity,
  type SprintHealthSummary,
  type SprintListItem,
  type SprintTaskTimelineEntity,
  type SprintTimelineRow,
} from "@/lib/projects/sprint-detail";

export type SprintTimelineTaskInput = SprintTaskTimelineEntity & {
  files: SprintFileTimelineEntity[];
};

function toTimestamp(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function getActivityTaskId(row: Extract<SprintTimelineRow, { kind: "task" | "file" | "file_version" }>) {
  return row.kind === "task" ? row.task.id : row.task.id;
}

export function compareSprintTimelineActivityRows(
  left: Extract<SprintTimelineRow, { kind: "task" | "file" | "file_version" }>,
  right: Extract<SprintTimelineRow, { kind: "task" | "file" | "file_version" }>,
) {
  const leftAt = toTimestamp(left.occurredAt);
  const rightAt = toTimestamp(right.occurredAt);
  if (leftAt !== rightAt) return leftAt - rightAt;

  const leftTaskId = getActivityTaskId(left);
  const rightTaskId = getActivityTaskId(right);
  if (leftTaskId === rightTaskId && left.kind !== right.kind) {
    // task rows come before file rows, file rows come before file_version rows
    const kindOrder = { task: 0, file: 1, file_version: 2 };
    return kindOrder[left.kind] - kindOrder[right.kind];
  }

  if (left.kind !== right.kind) {
    const kindOrder = { task: 0, file: 1, file_version: 2 };
    return kindOrder[left.kind] - kindOrder[right.kind];
  }

  return left.id.localeCompare(right.id);
}

export function buildSprintTimeline(input: {
  sprint: SprintListItem;
  tasks: SprintTimelineTaskInput[];
  summary: SprintHealthSummary;
  includeKickoff?: boolean;
  includeCloseout?: boolean;
}) {
  const tasks = [...input.tasks].sort((left, right) => {
    const leftAt = toTimestamp(left.activityAt ?? left.createdAt ?? left.updatedAt ?? null);
    const rightAt = toTimestamp(right.activityAt ?? right.createdAt ?? right.updatedAt ?? null);
    if (leftAt !== rightAt) return leftAt - rightAt;
    return left.id.localeCompare(right.id);
  });

  const rows: SprintTimelineRow[] = [];
  const activityRows: Extract<SprintTimelineRow, { kind: "task" | "file" | "file_version" }>[] = [];

  if (input.includeKickoff ?? true) {
    rows.push({
      id: `${input.sprint.id}:kickoff`,
      kind: "kickoff",
      occurredAt: input.sprint.startDate ?? input.sprint.createdAt ?? null,
      sprint: input.sprint,
    });
  }

  for (const task of tasks) {
    activityRows.push({
      id: task.id,
      kind: "task",
      occurredAt: task.activityAt ?? task.createdAt ?? task.updatedAt ?? null,
      task,
    });

    const files = [...task.files].sort((left, right) => {
      const leftAt = toTimestamp(left.linkedAt ?? left.lastEventAt ?? null);
      const rightAt = toTimestamp(right.linkedAt ?? right.lastEventAt ?? null);
      if (leftAt !== rightAt) return leftAt - rightAt;
      return left.id.localeCompare(right.id);
    });

    for (const file of files) {
      activityRows.push({
        id: `${task.id}:${file.id}`,
        kind: "file",
        occurredAt: file.linkedAt ?? file.lastEventAt ?? null,
        task: {
          id: task.id,
          title: task.title,
          taskNumber: task.taskNumber,
          status: task.status,
          priority: task.priority,
        },
        file,
      });

      // Render version events as inline sub-rows beneath the linked file row
      if (file.versionEvents && file.versionEvents.length > 0) {
        for (const versionEvent of file.versionEvents) {
          activityRows.push({
            id: `${task.id}:${file.id}:v${versionEvent.versionNumber}`,
            kind: "file_version",
            occurredAt: versionEvent.createdAt,
            task: {
              id: task.id,
              title: task.title,
              taskNumber: task.taskNumber,
              status: task.status,
              priority: task.priority,
            },
            file: {
              id: file.id,
              nodeId: file.nodeId,
              nodeName: file.nodeName,
              nodePath: file.nodePath,
              nodeType: file.nodeType,
            },
            versionEvent,
          });
        }
      }
    }
  }

  activityRows.sort(compareSprintTimelineActivityRows);
  rows.push(...activityRows);

  if (input.includeCloseout ?? true) {
    const latestRow = activityRows[activityRows.length - 1] ?? null;
    rows.push({
      id: `${input.sprint.id}:closeout`,
      kind: "closeout",
      occurredAt:
        input.sprint.status === "completed"
          ? input.sprint.endDate ?? latestRow?.occurredAt ?? input.sprint.updatedAt ?? null
          : latestRow?.occurredAt ?? input.sprint.updatedAt ?? input.sprint.endDate ?? null,
      sprint: input.sprint,
      summary: input.summary,
    });
  }

  return rows;
}
