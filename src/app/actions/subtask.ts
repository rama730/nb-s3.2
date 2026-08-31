"use server";

import { desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { taskSubtasks, tasks } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { requireProjectCapability } from "@/lib/projects/collaborator-lifecycle";
import { taskSubtaskTitleSchema } from "@/lib/validations/task";

async function assertTaskWriteAccess(taskId: string, projectId: string, userId: string) {
    const task = await db.query.tasks.findFirst({
        where: eq(tasks.id, taskId),
        columns: { id: true, projectId: true },
    });
    if (!task) throw new Error("Task not found");
    if (task.projectId !== projectId) throw new Error("Task does not belong to this project");

    await requireProjectCapability(projectId, userId, "create_tasks");
}

async function assertSubtaskWriteAccess(subtaskId: string, projectId: string, userId: string) {
    const subtask = await db.query.taskSubtasks.findFirst({
        where: eq(taskSubtasks.id, subtaskId),
        columns: { id: true, taskId: true },
        with: {
            task: {
                columns: { projectId: true },
            },
        },
    });

    if (!subtask?.task?.projectId) throw new Error("Subtask not found");
    if (subtask.task.projectId !== projectId) throw new Error("Subtask does not belong to this project");

    await requireProjectCapability(projectId, userId, "create_tasks");
}

/**
 * Create a subtask
 */
export async function createSubtaskAction(
    taskId: string,
    title: string,
    projectId: string
) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }

        const parsedTitle = taskSubtaskTitleSchema.safeParse(title);
        if (!parsedTitle.success) {
            return { success: false, error: parsedTitle.error.issues[0]?.message || "Invalid subtask title" };
        }
        const trimmedTitle = parsedTitle.data;

        await assertTaskWriteAccess(taskId, projectId, user.id);

        const created = await db.transaction(async (tx) => {
            // ponytail: serialize only appends for this task; drag-and-drop is not a requirement.
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${taskId}))`);
            const currentMax = await tx.query.taskSubtasks.findFirst({
                where: eq(taskSubtasks.taskId, taskId),
                columns: { position: true },
                orderBy: [desc(taskSubtasks.position)],
            });
            const [next] = await tx.insert(taskSubtasks).values({
                taskId,
                title: trimmedTitle,
                completed: false,
                position: (currentMax?.position ?? -1) + 1,
            }).returning();
            return next;
        });

        revalidatePath(`/projects/${projectId}`);
        return { success: true, data: created };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to create subtask" };
    }
}

/**
 * Toggle subtask completion
 */
export async function toggleSubtaskAction(
    subtaskId: string,
    completed: boolean,
    projectId: string
) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }

        await assertSubtaskWriteAccess(subtaskId, projectId, user.id);

        const [updated] = await db.update(taskSubtasks).set({
            completed,
            updatedAt: new Date(),
        }).where(eq(taskSubtasks.id, subtaskId)).returning();
        if (!updated) throw new Error("Subtask not found");

        revalidatePath(`/projects/${projectId}`);
        return { success: true, data: updated };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to toggle subtask" };
    }
}

/** Update a subtask title without expanding the checklist data model. */
export async function updateSubtaskAction(
    subtaskId: string,
    title: string,
    projectId: string,
) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) return { success: false, error: "Unauthorized" };

        const parsedTitle = taskSubtaskTitleSchema.safeParse(title);
        if (!parsedTitle.success) {
            return { success: false, error: parsedTitle.error.issues[0]?.message || "Invalid subtask title" };
        }
        const trimmedTitle = parsedTitle.data;

        await assertSubtaskWriteAccess(subtaskId, projectId, user.id);
        const [updated] = await db.update(taskSubtasks).set({
            title: trimmedTitle,
            updatedAt: new Date(),
        }).where(eq(taskSubtasks.id, subtaskId)).returning();
        if (!updated) throw new Error("Subtask not found");

        revalidatePath(`/projects/${projectId}`);
        return { success: true, data: updated };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to update subtask" };
    }
}

/**
 * Delete a subtask
 */
export async function deleteSubtaskAction(
    subtaskId: string,
    projectId: string
) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }

        await assertSubtaskWriteAccess(subtaskId, projectId, user.id);

        await db.delete(taskSubtasks).where(eq(taskSubtasks.id, subtaskId));

        revalidatePath(`/projects/${projectId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to delete subtask" };
    }
}
