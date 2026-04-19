import { SPRINT_STATUS_PRESENTATION, type SprintStatus } from "@/lib/projects/sprint-detail";
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

export type TaskSurfaceSprint = {
  id: string;
  name: string;
  status: SprintStatus | null;
};

export type TaskSurfaceRecord = {
  id: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: TaskWorkflowStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  creatorId: string | null;
  sprintId: string | null;
  dueDate: string | null;
  storyPoints: number | null;
  taskNumber: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  projectKey: string | null;
  assignee: TaskSurfacePerson | null;
  creator: TaskSurfacePerson | null;
  sprint: TaskSurfaceSprint | null;
};

export type TaskActivityItem =
  | {
      id: string;
      type: "task_created" | "task_updated" | "subtask_created" | "subtask_updated";
      occurredAt: string;
      actor: TaskSurfacePerson | null;
      summary: string;
      detail: string | null;
    }
  | {
      id: string;
      type: "comment_created";
      occurredAt: string;
      actor: TaskSurfacePerson | null;
      summary: string;
      detail: string | null;
    }
  | {
      id: string;
      type: "file_linked";
      occurredAt: string;
      actor: TaskSurfacePerson | null;
      summary: string;
      detail: string | null;
    };

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
    return Number.isNaN(value.getTime()) ? asTrimmedString(value) : value.toISOString();
  }
  return asTrimmedString(value);
}

export function normalizeTaskSurfacePerson(value: any): TaskSurfacePerson | null {
  if (!value) return null;
  return {
    id: asTrimmedString(value.id) ?? asTrimmedString(value.userId) ?? asTrimmedString(value.user_id),
    fullName: asTrimmedString(value.fullName) ?? asTrimmedString(value.full_name),
    avatarUrl: asTrimmedString(value.avatarUrl) ?? asTrimmedString(value.avatar_url),
  };
}

export function normalizeSprintOption(value: any): SprintOption {
  return {
    id: String(value?.id ?? ""),
    name: asTrimmedString(value?.name) ?? "Untitled sprint",
    status: asSprintStatus(value?.status),
    startDate: asIsoString(value?.startDate),
    endDate: asIsoString(value?.endDate),
  };
}

export function normalizeSprintOptions(values: any[]): SprintOption[] {
  return Array.isArray(values) ? values.filter(Boolean).map(normalizeSprintOption).filter((value) => value.id) : [];
}

export function normalizeTaskSurfaceRecord(value: any): TaskSurfaceRecord {
  const sprintRecord = value?.sprint ?? null;
  const rawStatus = asTrimmedString(value?.status);
  const rawPriority = asTrimmedString(value?.priority);

  return {
    id: String(value?.id ?? ""),
    projectId: asTrimmedString(value?.projectId) ?? asTrimmedString(value?.project_id),
    title: asTrimmedString(value?.title) ?? "Untitled task",
    description: asTrimmedString(value?.description),
    status: isTaskWorkflowStatus(rawStatus) ? rawStatus : "todo",
    priority: isTaskPriority(rawPriority) ? rawPriority : "medium",
    assigneeId: asTrimmedString(value?.assigneeId) ?? asTrimmedString(value?.assignee_id),
    creatorId: asTrimmedString(value?.creatorId) ?? asTrimmedString(value?.creator_id),
    sprintId: asTrimmedString(value?.sprintId) ?? asTrimmedString(value?.sprint_id),
    dueDate: asIsoString(value?.dueDate) ?? asIsoString(value?.due_date),
    storyPoints: asNumber(value?.storyPoints) ?? asNumber(value?.story_points),
    taskNumber: asNumber(value?.taskNumber) ?? asNumber(value?.task_number),
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
            id: asTrimmedString(sprintRecord?.id) ?? asTrimmedString(value?.sprintId) ?? asTrimmedString(value?.sprint_id) ?? "",
            name: asTrimmedString(sprintRecord?.name) ?? asTrimmedString(value?.sprintName) ?? "Untitled sprint",
            status: asSprintStatus(sprintRecord?.status),
          }
        : null,
  };
}

export function mergeTaskSurfaceRecords(
  current: TaskSurfaceRecord | null | undefined,
  incoming: TaskSurfaceRecord,
): TaskSurfaceRecord {
  if (!current) return incoming;

  const nextAssignee =
    incoming.assignee || incoming.assigneeId !== current.assigneeId ? incoming.assignee : current.assignee;
  const nextCreator =
    incoming.creator || incoming.creatorId !== current.creatorId ? incoming.creator : current.creator;
  const nextSprint =
    incoming.sprint || incoming.sprintId !== current.sprintId ? incoming.sprint : current.sprint;

  return {
    ...current,
    ...incoming,
    assignee: nextAssignee,
    creator: nextCreator,
    sprint: nextSprint,
    projectKey: incoming.projectKey ?? current.projectKey,
  };
}

export function compareTaskSurfaceRecords(left: TaskSurfaceRecord, right: TaskSurfaceRecord) {
  const leftCreatedAt = Date.parse(left.createdAt ?? "") || 0;
  const rightCreatedAt = Date.parse(right.createdAt ?? "") || 0;
  if (leftCreatedAt !== rightCreatedAt) return rightCreatedAt - leftCreatedAt;
  return right.id.localeCompare(left.id);
}

export function taskSurfaceVersionMs(task: Partial<TaskSurfaceRecord> | null | undefined) {
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
