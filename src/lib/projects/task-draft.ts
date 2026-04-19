import { z } from "zod";

import type { ProjectNode } from "@/lib/db/schema";
import { taskPriorityEnum, taskStatusEnum } from "@/lib/validations/task";

const optionalTrimmedText = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : ""));

const optionalUuid = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null))
  .refine((value) => value === null || z.string().uuid().safeParse(value).success, "Invalid value");

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null))
  .refine((value) => value === null || Number.isFinite(Date.parse(value)), "Invalid due date");

export const taskEditorDraftSchema = z.object({
  title: z.string().trim().min(1, "Task title is required").max(500, "Task title is too long"),
  description: optionalTrimmedText,
  sprintId: optionalUuid,
  status: taskStatusEnum.default("todo"),
  priority: taskPriorityEnum.default("medium"),
  assigneeId: optionalUuid,
  dueDate: optionalDate,
});

export type TaskEditorDraft = z.infer<typeof taskEditorDraftSchema>;
export type TaskEditorSubtaskDraft = {
  id: string;
  title: string;
};

export function buildTaskEditorDraft(input?: {
  task?: Partial<{
    title: string | null;
    description: string | null;
    sprintId: string | null;
    sprint_id: string | null;
    status: string | null;
    priority: string | null;
    assigneeId: string | null;
    assignee_id: string | null;
    dueDate: string | null;
    due_date: string | null;
  }> | null;
}): TaskEditorDraft {
  const task = input?.task ?? null;
  const dueDateValue = task?.dueDate ?? task?.due_date ?? null;

  return {
    title: task?.title?.trim() || "",
    description: task?.description?.trim() || "",
    sprintId: task?.sprintId ?? task?.sprint_id ?? null,
    status:
      task?.status && taskStatusEnum.safeParse(task.status).success
        ? (task.status as TaskEditorDraft["status"])
        : "todo",
    priority:
      task?.priority && taskPriorityEnum.safeParse(task.priority).success
        ? (task.priority as TaskEditorDraft["priority"])
        : "medium",
    assigneeId: task?.assigneeId ?? task?.assignee_id ?? null,
    dueDate: typeof dueDateValue === "string" && dueDateValue ? dueDateValue.slice(0, 10) : null,
  };
}

export function buildTaskSubmitPayload(input: {
  draft: TaskEditorDraft;
  projectId: string;
  subtasks: TaskEditorSubtaskDraft[];
  attachments: ProjectNode[];
}) {
  return {
    projectId: input.projectId,
    title: input.draft.title,
    description: input.draft.description || "",
    sprintId: input.draft.sprintId,
    status: input.draft.status,
    priority: input.draft.priority,
    assigneeId: input.draft.assigneeId,
    dueDate: input.draft.dueDate,
    attachmentNodeIds: input.attachments.map((attachment) => attachment.id),
    subtasks: input.subtasks
      .map((subtask) => ({ title: subtask.title.trim(), completed: false }))
      .filter((subtask) => subtask.title.length > 0),
  };
}
