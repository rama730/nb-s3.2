"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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

        // Get current max position
        const { data: existingSubtasks } = await supabase
            .from("task_subtasks")
            .select("position")
            .eq("task_id", taskId)
            .order("position", { ascending: false })
            .limit(1);

        const nextPosition = existingSubtasks && existingSubtasks.length > 0
            ? existingSubtasks[0].position + 1
            : 0;

        const { data, error } = await supabase
            .from("task_subtasks")
            .insert({
                task_id: taskId,
                title,
                position: nextPosition
            })
            .select()
            .single();

        if (error) {
            console.error("Error creating subtask:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/projects/${projectId}`);
        return { success: true, data };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error.message || "Failed to create subtask" };
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

        const { error } = await supabase
            .from("task_subtasks")
            .update({
                completed,
                updated_at: new Date().toISOString()
            })
            .eq("id", subtaskId);

        if (error) {
            console.error("Error toggling subtask:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/projects/${projectId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error.message || "Failed to toggle subtask" };
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

        const { error } = await supabase
            .from("task_subtasks")
            .delete()
            .eq("id", subtaskId);

        if (error) {
            console.error("Error deleting subtask:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/projects/${projectId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error.message || "Failed to delete subtask" };
    }
}
