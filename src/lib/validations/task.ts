import { z } from "zod";

import {
  TASK_PRIORITY_VALUES,
  TASK_WORKFLOW_STATUSES,
} from "@/lib/projects/task-workflow";

export const taskStatusEnum = z.enum(TASK_WORKFLOW_STATUSES);
export const taskPriorityEnum = z.enum(TASK_PRIORITY_VALUES);

export const TASK_TITLE_MAX_LENGTH = 500;
export const TASK_DESCRIPTION_MAX_LENGTH = 10_000;
export const TASK_SUBTASK_TITLE_MAX_LENGTH = 500;
export const TASK_COMMENT_MAX_LENGTH = 10_000;
export const TASK_COMMENT_MAX_MENTIONS = 50;

export const taskTitleSchema = z.string().trim().min(1).max(TASK_TITLE_MAX_LENGTH);
export const taskDescriptionSchema = z.string().trim().max(TASK_DESCRIPTION_MAX_LENGTH);
export const taskSubtaskTitleSchema = z.string().trim().min(1).max(TASK_SUBTASK_TITLE_MAX_LENGTH);
export const taskCommentContentSchema = z.string().trim().min(1).max(TASK_COMMENT_MAX_LENGTH);

export const taskDueDateSchema = z
  .string()
  .trim()
  .max(40)
  .refine((value) => Number.isFinite(Date.parse(value)), "Invalid due date");

export const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: taskTitleSchema,
  description: taskDescriptionSchema.optional(),
  status: taskStatusEnum.default("todo"),
  priority: taskPriorityEnum.default("medium"),
  sprintId: z.string().uuid().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: taskDueDateSchema.nullable().optional(),
  storyPoints: z.number().int().min(0).max(100).nullable().optional(),
});

export const updateTaskFieldSchema = z.object({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  field: z.enum(["title", "description", "priority", "sprintId", "dueDate"]),
  value: z.unknown(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskFieldInput = z.infer<typeof updateTaskFieldSchema>;
