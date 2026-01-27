"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Update task field
 */
export async function updateTaskFieldAction(
    taskId: string,
    field: string,
    value: any,
    projectId: string
) {
    try {
        const supabase = await createClient();

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }

        // Update the task
        const { error } = await supabase
            .from("tasks")
            .update({
                [field]: value,
                updated_at: new Date().toISOString()
            })
            .eq("id", taskId);

        if (error) {
            console.error("Error updating task:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/projects/${projectId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error.message || "Failed to update task" };
    }
}

/**
 * Update task status
 */
export async function updateTaskStatusAction(
    taskId: string,
    status: "todo" | "in_progress" | "done",
    projectId: string
) {
    try {
        const supabase = await createClient();

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }

        const updateData: any = {
            status,
            updated_at: new Date().toISOString()
        };

        // Set timestamps based on status
        if (status === "in_progress") {
            updateData.started_at = new Date().toISOString();
        } else if (status === "done") {
            updateData.completed_at = new Date().toISOString();
        }

        const { error } = await supabase
            .from("tasks")
            .update(updateData)
            .eq("id", taskId);

        if (error) {
            console.error("Error updating task status:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/projects/${projectId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error.message || "Failed to update task status" };
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

        const { error } = await supabase
            .from("tasks")
            .update({
                assigned_to: assigneeId,
                updated_at: new Date().toISOString()
            })
            .eq("id", taskId);

        if (error) {
            console.error("Error assigning task:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/projects/${projectId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error.message || "Failed to assign task" };
    }
}
