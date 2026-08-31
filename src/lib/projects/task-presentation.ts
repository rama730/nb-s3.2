import {
  SPRINT_STATUS_PRESENTATION,
  computeSprintStatus,
  type SprintStatus,
  type SprintListItem,
} from "@/lib/projects/sprint-detail";
import type { ProjectNode } from "@/lib/db/schema";
import {
  getTaskPriorityPresentation,
  getTaskStatusPresentation,
  isTaskPriority,
  isTaskWorkflowStatus,
  type TaskPriority,
  type TaskWorkflowStatus,
} from "@/lib/projects/task-workflow";

export type TaskSurfacePerson = {
  id: string | null;
  fullName: string | null;
  avatarUrl: string | null;
};

export type AssignableTaskMember = {
  id: string;
  identity: TaskSurfacePerson;
  label: string;
};

export type TaskSurfaceSprint = {
  id: string;
  name: string;
  status: SprintStatus | null;
};

export type TaskSurfaceRecord = {
  id: string;
  projectId: string | null;
  workflowColumnId?: string | null;
  title: string;
  description?: string | null;
  status: TaskWorkflowStatus;
  reviewStatus: "none" | "pending" | "rejected";
  priority: TaskPriority;
  assigneeId: string | null;
  creatorId: string | null;
  sprintId: string | null;
  dueDate: string | null;
  storyPoints: number | null;
  taskNumber: number | null;
  position: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  projectKey: string | null;
  assignee: TaskSurfacePerson | null;
  creator: TaskSurfacePerson | null;
  sprint: TaskSurfaceSprint | null;
  subtaskCount?: number;
  completedSubtaskCount?: number;
  newSubtaskCount?: number;
  fileCount?: number;
  newFileCount?: number;
  commentCount?: number;
  newCommentCount?: number;
};

export type TaskTitlePresentation = {
  isCompleted: boolean;
  className: string;
  ariaLabel?: string;
};

/**
 * One presentation rule for every task-oriented surface. A task is visually
 * complete whenever its canonical workflow status is Done; review state does
 * not alter the title treatment.
 */
export function getTaskTitlePresentation(task: {
  status?: string | null;
  title?: string | null;
}): TaskTitlePresentation {
  const isCompleted = task.status === "done";
  return {
    isCompleted,
    className: isCompleted
      ? "line-through decoration-1 decoration-zinc-400 text-zinc-500 dark:decoration-zinc-500 dark:text-zinc-400"
      : "",
    ...(isCompleted && task.title
      ? { ariaLabel: `Completed task: ${task.title}` }
      : {}),
  };
}

export type SprintOption = {
  id: string;
  name: string;
  status: SprintStatus | null;
  startDate: string | null;
  endDate: string | null;
};

function asTrimmedString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asSprintStatus(value: unknown): SprintStatus | null {
  const trimmed = asTrimmedString(value);
  return trimmed && Object.hasOwn(SPRINT_STATUS_PRESENTATION, trimmed)
    ? (trimmed as SprintStatus)
    : null;
}

function asIsoString(value: unknown) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? asTrimmedString(value)
      : value.toISOString();
  }
  return asTrimmedString(value);
}

export function normalizeTaskSurfacePerson(
  value: any,
): TaskSurfacePerson | null {
  if (!value) return null;
  return {
    id:
      asTrimmedString(value.id) ??
      asTrimmedString(value.userId) ??
      asTrimmedString(value.user_id),
    fullName:
      asTrimmedString(value.fullName) ?? asTrimmedString(value.full_name),
    avatarUrl:
      asTrimmedString(value.avatarUrl) ?? asTrimmedString(value.avatar_url),
  };
}

export function normalizeAssignableMembers(
  values: any[],
): AssignableTaskMember[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((member) => {
    const role = asTrimmedString(
      member?.membershipRole ?? member?.role,
    )?.toLowerCase();
    if (role === "viewer") return [];
    const identity = normalizeTaskSurfacePerson(member?.user ?? member);
    const id =
      asTrimmedString(member?.userId) ??
      asTrimmedString(member?.user_id) ??
      asTrimmedString(member?.user?.id) ??
      identity?.id ??
      asTrimmedString(member?.id);
    if (!id || !identity?.fullName) return [];
    return [{ id, identity: { ...identity, id }, label: identity.fullName }];
  });
}

export function normalizeSprintOption(value: any): SprintOption {
  const dbStatus = asSprintStatus(value?.status);

  const tempItem = {
    ...value,
    status: dbStatus,
  } as SprintListItem;

  return {
    id: String(value?.id ?? ""),
    name: asTrimmedString(value?.name) ?? "Untitled sprint",
    status: computeSprintStatus(tempItem),
    startDate: asIsoString(value?.startDate),
    endDate: asIsoString(value?.endDate),
  };
}

export function normalizeSprintOptions(values: any[]): SprintOption[] {
  return Array.isArray(values)
    ? values
        .filter(Boolean)
        .map(normalizeSprintOption)
        .filter((value) => value.id)
    : [];
}

export function isAssignableSprintOption(sprint: SprintOption) {
  return sprint.status === "planning" || sprint.status === "active";
}

export type TaskTimeHealth =
  | "on-time"
  | "overtime"
  | "overdue"
  | "unfinished"
  | "none";

export function calculateTaskTimeHealth(
  task: {
    status: string;
    dueDate?: string | null;
    completedAt?: string | null;
    updatedAt?: string | null;
  },
  sprint: {
    status: string | null;
    endDate?: string | null;
    completedAt?: string | null;
  } | null,
): { state: TaskTimeHealth; label: string; daysLate?: number } {
  const isTaskDone = task.status === "done" || !!task.completedAt;
  const isSprintFinished =
    sprint?.status === "completed" || sprint?.status === "archived";

  const referenceDateStr = task.dueDate || sprint?.endDate || null;
  const referenceDate = referenceDateStr ? Date.parse(referenceDateStr) : null;

  if (!referenceDate) {
    if (isSprintFinished && !isTaskDone) {
      return { state: "unfinished", label: "Unfinished" };
    }
    return { state: "none", label: "" };
  }

  // A task row does not persist a dedicated completion timestamp. Its latest
  // status transition updates `updatedAt`, which is the durable completion
  // signal available to these presentation-only surfaces.
  const completionTimestamp =
    task.completedAt ?? (task.status === "done" ? task.updatedAt ?? null : null);

  // ponytail: a task completed after its due day remains Done and is also
  // Overdue, independently of whether its Sprint is still active.
  if (isTaskDone) {
    const finishDate = completionTimestamp
      ? Date.parse(completionTimestamp)
      : null;
    if (finishDate && finishDate > referenceDate + 86400000) {
      const days = Math.ceil((finishDate - referenceDate) / 86400000);
      return { state: "overdue", label: "Overdue", daysLate: days };
    }
    return { state: "on-time", label: "On Time" };
  }

  // If task is not done
  const now = Date.now();
  if (now > referenceDate + 86400000) {
    const days = Math.ceil((now - referenceDate) / 86400000);
    // If the sprint is completed and the task is overdue, it's a severe Rollover/Overdue
    if (isSprintFinished) {
      return { state: "overdue", label: "Overdue", daysLate: days };
    }
    // Otherwise it's just currently overtime/late
    return { state: "overtime", label: "Late", daysLate: days };
  }

  // If sprint is completed but task is not done (and not technically past due date)
  if (isSprintFinished) {
    return { state: "unfinished", label: "Rolled Over" };
  }

  return { state: "none", label: "" };
}

export function normalizeTaskSurfaceRecord(value: any): TaskSurfaceRecord {
  const sprintRecord = value?.sprint ?? null;
  const rawStatus = asTrimmedString(value?.status);
  const rawPriority = asTrimmedString(value?.priority);

  return {
    id: String(value?.id ?? ""),
    projectId:
      asTrimmedString(value?.projectId) ?? asTrimmedString(value?.project_id),
    workflowColumnId:
      asTrimmedString(value?.workflowColumnId) ??
      asTrimmedString(value?.workflow_column_id),
    title: asTrimmedString(value?.title) ?? "Untitled task",
    description: asTrimmedString(value?.description),
    status: isTaskWorkflowStatus(rawStatus) ? rawStatus : "todo",
    reviewStatus: (value?.reviewStatus || value?.review_status || "none") as
      | "none"
      | "pending"
      | "rejected",
    priority: isTaskPriority(rawPriority) ? rawPriority : "medium",
    assigneeId:
      asTrimmedString(value?.assigneeId) ?? asTrimmedString(value?.assignee_id),
    creatorId:
      asTrimmedString(value?.creatorId) ?? asTrimmedString(value?.creator_id),
    sprintId:
      asTrimmedString(value?.sprintId) ?? asTrimmedString(value?.sprint_id),
    dueDate: asIsoString(value?.dueDate) ?? asIsoString(value?.due_date),
    storyPoints: asNumber(value?.storyPoints) ?? asNumber(value?.story_points),
    taskNumber: asNumber(value?.taskNumber) ?? asNumber(value?.task_number),
    position: asNumber(value?.position),
    createdAt: asIsoString(value?.createdAt) ?? asIsoString(value?.created_at),
    updatedAt: asIsoString(value?.updatedAt) ?? asIsoString(value?.updated_at),
    projectKey:
      asTrimmedString(value?.project?.key) ??
      asTrimmedString(value?.projectKey) ??
      asTrimmedString(value?.project_key),
    assignee: normalizeTaskSurfacePerson(value?.assignee),
    creator: normalizeTaskSurfacePerson(value?.creator),
    sprint:
      sprintRecord || value?.sprintName
        ? {
            id:
              asTrimmedString(sprintRecord?.id) ??
              asTrimmedString(value?.sprintId) ??
              asTrimmedString(value?.sprint_id) ??
              "",
            name:
              asTrimmedString(sprintRecord?.name) ??
              asTrimmedString(value?.sprintName) ??
              "Untitled sprint",
            status: asSprintStatus(sprintRecord?.status),
          }
        : null,
    subtaskCount: asNumber(value?.subtaskCount) ?? 0,
    completedSubtaskCount: asNumber(value?.completedSubtaskCount) ?? 0,
    newSubtaskCount: asNumber(value?.newSubtaskCount) ?? 0,
    fileCount: asNumber(value?.fileCount) ?? 0,
    newFileCount: asNumber(value?.newFileCount) ?? 0,
    commentCount: asNumber(value?.commentCount) ?? 0,
    newCommentCount: asNumber(value?.newCommentCount) ?? 0,
  };
}

export function mergeTaskSurfaceRecords(
  current: TaskSurfaceRecord | null | undefined,
  incoming: TaskSurfaceRecord,
): TaskSurfaceRecord {
  if (!current) return incoming;

  const nextAssignee =
    incoming.assignee || incoming.assigneeId !== current.assigneeId
      ? incoming.assignee
      : current.assignee;
  const nextCreator =
    incoming.creator || incoming.creatorId !== current.creatorId
      ? incoming.creator
      : current.creator;
  const nextSprint =
    incoming.sprint || incoming.sprintId !== current.sprintId
      ? incoming.sprint
      : current.sprint;

  return {
    ...current,
    ...incoming,
    assignee: nextAssignee,
    creator: nextCreator,
    sprint: nextSprint,
    projectKey: incoming.projectKey ?? current.projectKey,
  };
}

export function compareTaskSurfaceRecords(
  left: TaskSurfaceRecord,
  right: TaskSurfaceRecord,
) {
  const leftCreatedAt = Date.parse(left.createdAt ?? "") || 0;
  const rightCreatedAt = Date.parse(right.createdAt ?? "") || 0;
  if (leftCreatedAt !== rightCreatedAt) return rightCreatedAt - leftCreatedAt;
  return right.id.localeCompare(left.id);
}

export function taskSurfaceVersionMs(
  task: Partial<TaskSurfaceRecord> | null | undefined,
) {
  const raw = task?.updatedAt ?? task?.createdAt ?? null;
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getTaskStatusLabel(status: string | null | undefined) {
  return getTaskStatusPresentation(status).label;
}

export function getTaskPriorityLabel(priority: string | null | undefined) {
  return getTaskPriorityPresentation(priority).label;
}

export function toLinkedSprintFiles(
  nodes: ProjectNode[],
  taskId: string,
  occurredAt: string | null,
) {
  return nodes.map((node, index) => ({
    id: `linked-file:${taskId}:${node.id}:${index}`,
    taskId,
    nodeId: node.id,
    nodeName: node.name,
    nodePath: node.path ?? node.name,
    nodeType: node.type === "folder" ? ("folder" as const) : ("file" as const),
    annotation: null,
    linkedAt: occurredAt ?? null,
    lastEventType: null,
    lastEventAt:
      node.updatedAt instanceof Date ? node.updatedAt.toISOString() : null,
    lastEventBy: null,
  }));
}
