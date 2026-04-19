import { z } from 'zod'
import { TASK_PRIORITY_VALUES, TASK_WORKFLOW_STATUSES } from "@/lib/projects/task-workflow"

export const taskStatusEnum = z.enum(TASK_WORKFLOW_STATUSES)
export const taskPriorityEnum = z.enum(TASK_PRIORITY_VALUES)

export const createTaskSchema = z.object({
    projectId: z.string().uuid(),
    title: z.string().min(1).max(500).trim(),
    description: z.string().max(10_000).trim().optional(),
    status: taskStatusEnum.default('todo'),
    priority: taskPriorityEnum.default('medium'),
    sprintId: z.string().uuid().nullable().optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    dueDate: z.string().datetime().nullable().optional(),
    storyPoints: z.number().int().min(0).max(100).nullable().optional(),
})

export const updateTaskFieldSchema = z.object({
    taskId: z.string().uuid(),
    projectId: z.string().uuid(),
    field: z.enum(['title', 'description', 'priority', 'sprintId', 'dueDate']),
    value: z.unknown(),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskFieldInput = z.infer<typeof updateTaskFieldSchema>
