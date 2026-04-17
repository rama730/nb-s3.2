import { SPRINT_STATUS_PRESENTATION, type SprintStatus } from "@/lib/projects/sprint-detail";

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
  title: string;
  description: string | null;
  status: string;
  priority: string;
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

  return {
    id: String(value?.id ?? ""),
    title: asTrimmedString(value?.title) ?? "Untitled task",
    description: asTrimmedString(value?.description),
    status: asTrimmedString(value?.status) ?? "todo",
    priority: asTrimmedString(value?.priority) ?? "medium",
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
