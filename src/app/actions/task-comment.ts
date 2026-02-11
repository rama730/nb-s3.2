"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { getProjectAccessById } from "@/lib/data/project-access";
import { createClient } from "@/lib/supabase/server";

async function assertTaskWriteAccess(taskId: string, projectId: string, userId: string) {
    const task = await db.query.tasks.findFirst({
        where: eq(tasks.id, taskId),
        columns: { projectId: true },
    });
    if (!task) throw new Error("Task not found");
    if (task.projectId !== projectId) throw new Error("Task does not belong to this project");

    const access = await getProjectAccessById(projectId, userId);
    if (!access.project || !access.canWrite) throw new Error("Forbidden");
}

async function assertCommentWriteAccess(commentId: string, projectId: string, userId: string) {
    const supabase = await createClient();
    const { data: comment, error } = await supabase
        .from("task_comments")
        .select("id, task_id, user_id")
        .eq("id", commentId)
        .single();
    if (error || !comment) throw new Error("Comment not found");

    await assertTaskWriteAccess(comment.task_id, projectId, userId);
    return comment;
}

/**
 * Create a comment
 */
export async function createCommentAction(
    taskId: string,
    content: string,
    projectId: string
) {
    try {
        const supabase = await createClient();

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }

        const trimmedContent = content.trim();
        if (!trimmedContent) {
            return { success: false, error: "Comment cannot be empty" };
        }

        await assertTaskWriteAccess(taskId, projectId, user.id);

        const { data, error } = await supabase
            .from("task_comments")
            .insert({
                task_id: taskId,
                user_id: user.id,
                content: trimmedContent,
            })
            .select(`
                *,
                user_profile:profiles!task_comments_user_id_fkey(
                    id,
                    full_name,
                    username,
                    avatar_url
                )
            `)
            .single();

        if (error) {
            console.error("Error creating comment:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/projects/${projectId}`);
        return { success: true, data };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to create comment" };
    }
}

/**
 * Toggle comment like
 */
export async function toggleCommentLikeAction(
    commentId: string,
    projectId: string
) {
    try {
        const supabase = await createClient();

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }

        await assertCommentWriteAccess(commentId, projectId, user.id);

        const { data: existingLike } = await supabase
            .from("task_comment_likes")
            .select("id")
            .eq("comment_id", commentId)
            .eq("user_id", user.id)
            .maybeSingle();

        if (existingLike) {
            const { error } = await supabase
                .from("task_comment_likes")
                .delete()
                .eq("id", existingLike.id);

            if (error) {
                console.error("Error unliking comment:", error);
                return { success: false, error: error.message };
            }
        } else {
            const { error } = await supabase
                .from("task_comment_likes")
                .insert({
                    comment_id: commentId,
                    user_id: user.id,
                });

            if (error) {
                console.error("Error liking comment:", error);
                return { success: false, error: error.message };
            }
        }

        revalidatePath(`/projects/${projectId}`);
        return { success: true, liked: !existingLike };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to toggle like" };
    }
}

/**
 * Delete a comment
 */
export async function deleteCommentAction(
    commentId: string,
    projectId: string
) {
    try {
        const supabase = await createClient();

        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return { success: false, error: "Unauthorized" };
        }

        const comment = await assertCommentWriteAccess(commentId, projectId, user.id);
        if (comment.user_id !== user.id) {
            return { success: false, error: "You can only delete your own comments" };
        }

        const { error } = await supabase
            .from("task_comments")
            .delete()
            .eq("id", commentId)
            .eq("user_id", user.id);

        if (error) {
            console.error("Error deleting comment:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/projects/${projectId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error?.message || "Failed to delete comment" };
    }
}
