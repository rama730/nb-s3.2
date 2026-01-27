import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export interface Comment {
    id: string;
    task_id: string;
    user_id: string;
    content: string;
    created_at: string;
    updated_at: string;
    user_profile?: {
        id: string;
        full_name: string | null;
        username: string | null;
        avatar_url: string | null;
    };
    likes?: {
        id: string;
        user_id: string;
    }[];
    like_count?: number;
}

export function useTaskComments(taskId: string, currentUserId?: string) {
    const [comments, setComments] = useState<Comment[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const supabase = createClient();

        // Initial fetch
        const fetchComments = async () => {
            const { data, error } = await supabase
                .from("task_comments")
                .select(`
                    *,
                    user_profile:profiles!task_comments_user_id_fkey(
                        id,
                        full_name,
                        username,
                        avatar_url
                    ),
                    likes:task_comment_likes(id, user_id)
                `)
                .eq("task_id", taskId)
                .order("created_at", { ascending: false });

            if (!error && data) {
                setComments(data.map(comment => ({
                    ...comment,
                    like_count: comment.likes?.length || 0
                })));
            }
            setIsLoading(false);
        };

        fetchComments();

        // Real-time subscription for comments
        const commentsChannel = supabase
            .channel(`task_comments:${taskId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "task_comments",
                    filter: `task_id=eq.${taskId}`
                },
                async (payload) => {
                    if (payload.eventType === "INSERT") {
                        // Fetch the full comment with user profile
                        const { data } = await supabase
                            .from("task_comments")
                            .select(`
                                *,
                                user_profile:profiles!task_comments_user_id_fkey(
                                    id,
                                    full_name,
                                    username,
                                    avatar_url
                                ),
                                likes:task_comment_likes(id, user_id)
                            `)
                            .eq("id", payload.new.id)
                            .single();

                        if (data) {
                            setComments((prev) => [{ ...data, like_count: data.likes?.length || 0 }, ...prev]);
                        }
                    } else if (payload.eventType === "DELETE") {
                        setComments((prev) => prev.filter((c) => c.id !== payload.old.id));
                    }
                }
            )
            .subscribe();

        // Real-time subscription for likes
        const likesChannel = supabase
            .channel(`task_comment_likes:${taskId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "task_comment_likes"
                },
                (payload) => {
                    if (payload.eventType === "INSERT") {
                        setComments((prev) =>
                            prev.map((c) => {
                                if (c.id === payload.new.comment_id) {
                                    return {
                                        ...c,
                                        likes: [...(c.likes || []), payload.new as any],
                                        like_count: (c.like_count || 0) + 1
                                    };
                                }
                                return c;
                            })
                        );
                    } else if (payload.eventType === "DELETE") {
                        setComments((prev) =>
                            prev.map((c) => {
                                if (c.id === payload.old.comment_id) {
                                    return {
                                        ...c,
                                        likes: (c.likes || []).filter((l) => l.id !== payload.old.id),
                                        like_count: Math.max((c.like_count || 0) - 1, 0)
                                    };
                                }
                                return c;
                            })
                        );
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(commentsChannel);
            supabase.removeChannel(likesChannel);
        };
    }, [taskId]);

    const isLiked = (comment: Comment) => {
        if (!currentUserId) return false;
        return comment.likes?.some((like) => like.user_id === currentUserId) || false;
    };

    return { comments, isLoading, isLiked };
}
