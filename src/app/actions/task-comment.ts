"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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

        const { data, error } = await supabase
            .from("task_comments")
            .insert({
                task_id: taskId,
                user_id: user.id,
                content
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
        return { success: false, error: error.message || "Failed to create comment" };
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

        // Check if like exists
        const { data: existingLike } = await supabase
            .from("task_comment_likes")
            .select("id")
            .eq("comment_id", commentId)
            .eq("user_id", user.id)
            .single();

        if (existingLike) {
            // Unlike
            const { error } = await supabase
                .from("task_comment_likes")
                .delete()
                .eq("id", existingLike.id);

            if (error) {
                console.error("Error unliking comment:", error);
                return { success: false, error: error.message };
            }
        } else {
            // Like
            const { error } = await supabase
                .from("task_comment_likes")
                .insert({
                    comment_id: commentId,
                    user_id: user.id
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
        return { success: false, error: error.message || "Failed to toggle like" };
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

        const { error } = await supabase
            .from("task_comments")
            .delete()
            .eq("id", commentId)
            .eq("user_id", user.id); // Ensure user can only delete their own comments

        if (error) {
            console.error("Error deleting comment:", error);
            return { success: false, error: error.message };
        }

        revalidatePath(`/projects/${projectId}`);
        return { success: true };
    } catch (error: any) {
        console.error("Unexpected error:", error);
        return { success: false, error: error.message || "Failed to delete comment" };
    }
}
