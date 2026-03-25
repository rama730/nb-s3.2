"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { projectMembers, projectSprints, tasks } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { queueCounterRefreshBestEffort } from "@/lib/workspace/counter-buffer";

type MutableTaskField = "title" | "description" | "priority" | "sprintId" | "dueDate";

const ALLOWED_FIELDS: ReadonlySet<MutableTaskField> = new Set([
    "title",
    "description",
    "priority",
    "sprintId",
    "dueDate",
]);

type Priority = "low" | "medium" | "high" | "urgent";
type Status = "todo" | "in_progress" | "done";

async function assertTaskWriteAccess(taskId: string, userId: string) {
    const existingTask = await db.query.tasks.findFirst({
        where: eq(tasks.id, taskId),
        columns: { id: true, projectId: true },
    });
    if (!existingTask) {
        throw new Error("Task not found");
    }

    const access = await getProjectAccessById(existingTask.projectId, userId);
    if (!access.project || !access.canWrite) {
        throw new Error("Forbidden");
    }

    return existingTask.projectId;
}

/**
 * Update task field
 */
export async function updateTaskFieldAction(
    taskId: string,
    field: string,
    value: unknown,
    projectId: string
) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }
        const { allowed: taskRlOk } = await consumeRateLimit(`task:${user.id}`, 60, 60);
        if (!taskRlOk) return { success: false, error: "Rate limit exceeded" };

        if (!ALLOWED_FIELDS.has(field as MutableTaskField)) {
            return { success: false, error: "Invalid field" };
        }

        const canonicalProjectId = await assertTaskWriteAccess(taskId, user.id);
        if (canonicalProjectId !== projectId) {
            return { success: false, error: "Task does not belong to this project" };
        }
        const existingTask = await db.query.tasks.findFirst({
            where: eq(tasks.id, taskId),
            columns: {
                assigneeId: true,
            },
        });

        const updates: Partial<typeof tasks.$inferInsert> = {
            updatedAt: new Date(),
        };

        if (field === "title") {
            const title = typeof value === "string" ? value.trim() : "";
            if (!title) return { success: false, error: "Title is required" };
            updates.title = title;
        } else if (field === "description") {
            updates.description = typeof value === "string" && value.trim() ? value : null;
        } else if (field === "priority") {
            const priority = typeof value === "string" ? value : "";
            if (!["low", "medium", "high", "urgent"].includes(priority)) {
                return { success: false, error: "Invalid priority" };
            }
            updates.priority = priority as Priority;
        } else if (field === "sprintId") {
            const sprintId = typeof value === "string" && value ? value : null;
            if (sprintId) {
                const sprint = await db.query.projectSprints.findFirst({
                    where: and(eq(projectSprints.id, sprintId), eq(projectSprints.projectId, canonicalProjectId)),
                    columns: { id: true },
                });
                if (!sprint) {
                    return { success: false, error: "Sprint must belong to this project" };
                }
            }
            updates.sprintId = sprintId;
        } else if (field === "dueDate") {
            if (typeof value === "string" && value) {
                const parsed = new Date(value);
                if (Number.isNaN(parsed.getTime())) {
                    return { success: false, error: "Invalid due date" };
                }
                updates.dueDate = parsed;
            } else {
                updates.dueDate = null;
            }
        }

        await db.update(tasks).set(updates).where(eq(tasks.id, taskId));
        await queueCounterRefreshBestEffort([existingTask?.assigneeId ?? null]);

        revalidatePath(`/projects/${canonicalProjectId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to update task" };
    }
}

/**
 * Update task status
 */
export async function updateTaskStatusAction(
    taskId: string,
    status: Status,
    projectId: string
) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }

        if (!["todo", "in_progress", "done"].includes(status)) {
            return { success: false, error: "Invalid status" };
        }

        const canonicalProjectId = await assertTaskWriteAccess(taskId, user.id);
        if (canonicalProjectId !== projectId) {
            return { success: false, error: "Task does not belong to this project" };
        }
        const existingTask = await db.query.tasks.findFirst({
            where: eq(tasks.id, taskId),
            columns: {
                assigneeId: true,
            },
        });

        await db.update(tasks).set({
            status,
            updatedAt: new Date(),
        }).where(eq(tasks.id, taskId));
        await queueCounterRefreshBestEffort([existingTask?.assigneeId ?? null]);

        revalidatePath(`/projects/${canonicalProjectId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to update task status" };
    }
}

/**
 * Assign task to user
 */
export async function assignTaskAction(
    taskId: string,
    assigneeId: string | null,
    projectId: string
) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }

        const canonicalProjectId = await assertTaskWriteAccess(taskId, user.id);
        if (canonicalProjectId !== projectId) {
            return { success: false, error: "Task does not belong to this project" };
        }
        const existingTask = await db.query.tasks.findFirst({
            where: eq(tasks.id, taskId),
            columns: {
                assigneeId: true,
            },
        });

        if (assigneeId) {
            const isProjectMember = await db.query.projectMembers.findFirst({
                where: and(eq(projectMembers.projectId, canonicalProjectId), eq(projectMembers.userId, assigneeId)),
                columns: { id: true },
            });
            if (!isProjectMember) {
                return { success: false, error: "Assignee must be a project member" };
            }
        }

        await db.update(tasks).set({
            assigneeId: assigneeId || null,
            updatedAt: new Date(),
        }).where(eq(tasks.id, taskId));
        await queueCounterRefreshBestEffort([existingTask?.assigneeId ?? null, assigneeId]);

        revalidatePath(`/projects/${canonicalProjectId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to assign task" };
    }
}
