"use server";

import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { taskSubtasks, tasks } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { createClient } from "@/lib/supabase/server";

async function assertTaskWriteAccess(taskId: string, projectId: string, userId: string) {
    const task = await db.query.tasks.findFirst({
        where: eq(tasks.id, taskId),
        columns: { id: true, projectId: true },
    });
    if (!task) throw new Error("Task not found");
    if (task.projectId !== projectId) throw new Error("Task does not belong to this project");

    const access = await getProjectAccessById(projectId, userId);
    if (!access.project || !access.canWrite) throw new Error("Forbidden");
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

    const access = await getProjectAccessById(projectId, userId);
    if (!access.project || !access.canWrite) throw new Error("Forbidden");
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

        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
            return { success: false, error: "Subtask title is required" };
        }

        await assertTaskWriteAccess(taskId, projectId, user.id);

        const currentMax = await db.query.taskSubtasks.findFirst({
            where: eq(taskSubtasks.taskId, taskId),
            columns: { position: true },
            orderBy: [desc(taskSubtasks.position)],
        });
        const nextPosition = (currentMax?.position ?? -1) + 1;

        const [created] = await db.insert(taskSubtasks).values({
            taskId,
            title: trimmedTitle,
            completed: false,
            position: nextPosition,
        }).returning();

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

        await db.update(taskSubtasks).set({
            completed,
            updatedAt: new Date(),
        }).where(eq(taskSubtasks.id, subtaskId));

        revalidatePath(`/projects/${projectId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to toggle subtask" };
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
