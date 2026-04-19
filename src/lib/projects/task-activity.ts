import type { TaskActivityItem, TaskSurfacePerson } from "@/lib/projects/task-presentation";

type ActivityActorInput =
  | {
      id?: string | null;
      fullName?: string | null;
      full_name?: string | null;
      avatarUrl?: string | null;
      avatar_url?: string | null;
    }
  | null
  | undefined;

type ActivityTaskInput = {
  id: string;
  title?: string | null;
  createdAt?: Date | string | null;
  created_at?: Date | string | null;
  updatedAt?: Date | string | null;
  updated_at?: Date | string | null;
  creator?: ActivityActorInput;
};

type ActivityCommentInput = {
  id: string;
  content?: string | null;
  createdAt?: Date | string | null;
  created_at?: Date | string | null;
  userProfile?: ActivityActorInput;
  user_profile?: ActivityActorInput;
};

type ActivitySubtaskInput = {
  id: string;
  title?: string | null;
  completed?: boolean | null;
  createdAt?: Date | string | null;
  created_at?: Date | string | null;
  updatedAt?: Date | string | null;
  updated_at?: Date | string | null;
};

type ActivityLinkInput = {
  id: string;
  linkedAt?: Date | string | null;
  linked_at?: Date | string | null;
  creator?: ActivityActorInput;
  node?: {
    name?: string | null;
  } | null;
};

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function toActor(value: ActivityActorInput): TaskSurfacePerson | null {
  if (!value) return null;
  const id = typeof value.id === "string" && value.id ? value.id : null;
  const fullName =
    typeof value.fullName === "string" && value.fullName
      ? value.fullName
      : typeof value.full_name === "string" && value.full_name
        ? value.full_name
        : null;
  const avatarUrl =
    typeof value.avatarUrl === "string" && value.avatarUrl
      ? value.avatarUrl
      : typeof value.avatar_url === "string" && value.avatar_url
        ? value.avatar_url
        : null;

  return { id, fullName, avatarUrl };
}

export function sortTaskActivityItems(items: TaskActivityItem[]) {
  return [...items].sort((left, right) => {
    const byOccurredAt = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
    if (byOccurredAt !== 0) return byOccurredAt;
    return right.id.localeCompare(left.id);
  });
}

export function buildTaskActivityItems(input: {
  task: ActivityTaskInput;
  comments?: ActivityCommentInput[];
  subtasks?: ActivitySubtaskInput[];
  links?: ActivityLinkInput[];
  limit?: number;
}) {
  const items: TaskActivityItem[] = [];
  const limit = Math.min(Math.max(input.limit ?? 40, 1), 100);

  const taskCreatedAt = toIsoString(input.task.createdAt ?? input.task.created_at);
  const taskUpdatedAt = toIsoString(input.task.updatedAt ?? input.task.updated_at);

  if (taskCreatedAt) {
    items.push({
      id: `task-created:${input.task.id}`,
      type: "task_created",
      occurredAt: taskCreatedAt,
      actor: toActor(input.task.creator),
      summary: "Task created",
      detail: input.task.title ?? null,
    });
  }

  if (taskUpdatedAt && taskCreatedAt && taskUpdatedAt > taskCreatedAt) {
    items.push({
      id: `task-updated:${input.task.id}:${taskUpdatedAt}`,
      type: "task_updated",
      occurredAt: taskUpdatedAt,
      actor: null,
      summary: "Task updated",
      detail: null,
    });
  }

  for (const comment of input.comments ?? []) {
    const occurredAt = toIsoString(comment.createdAt ?? comment.created_at);
    if (!occurredAt) continue;

    items.push({
      id: `comment-created:${comment.id}`,
      type: "comment_created",
      occurredAt,
      actor: toActor(comment.userProfile ?? comment.user_profile),
      summary: "Comment added",
      detail: comment.content ?? null,
    });
  }

  for (const subtask of input.subtasks ?? []) {
    const createdAt = toIsoString(subtask.createdAt ?? subtask.created_at);
    const updatedAt = toIsoString(subtask.updatedAt ?? subtask.updated_at);
    if (!createdAt) continue;

    items.push({
      id: `subtask-created:${subtask.id}`,
      type: "subtask_created",
      occurredAt: createdAt,
      actor: null,
      summary: "Subtask added",
      detail: subtask.title ?? null,
    });

    if (updatedAt && updatedAt > createdAt) {
      items.push({
        id: `subtask-updated:${subtask.id}:${updatedAt}`,
        type: "subtask_updated",
        occurredAt: updatedAt,
        actor: null,
        summary: subtask.completed ? "Subtask completed" : "Subtask updated",
        detail: subtask.title ?? null,
      });
    }
  }

  for (const link of input.links ?? []) {
    const occurredAt = toIsoString(link.linkedAt ?? link.linked_at);
    if (!occurredAt) continue;

    items.push({
      id: `file-linked:${link.id}`,
      type: "file_linked",
      occurredAt,
      actor: toActor(link.creator),
      summary: "File linked",
      detail: link.node?.name ?? null,
    });
  }

  return sortTaskActivityItems(items).slice(0, limit);
}
