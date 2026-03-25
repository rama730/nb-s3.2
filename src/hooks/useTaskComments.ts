import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import { subscribeTaskResource } from "@/lib/realtime/task-resource";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";

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

function mapComments(data: any[]) {
    return data.map((comment: any) => ({
        ...comment,
        like_count: comment.likes?.length || 0,
    })) as Comment[];
}

export function useTaskComments(taskId: string, currentUserId?: string) {
    const [comments, setComments] = useState<Comment[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const supabase = useMemo(() => createClient(), []);
    const { isConnected } = useRealtime();
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isMountedRef = useRef(true);
    const resourceConnectedRef = useRef(false);
    const pollingRef = useRef<ReturnType<typeof createVisibilityAwareInterval> | null>(null);
    const isConnectedRef = useRef(isConnected);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const refreshComments = useCallback(async () => {
        if (!isMountedRef.current) return;
        if (!taskId) {
            if (isMountedRef.current) {
                setComments([]);
                setIsLoading(false);
            }
            return;
        }

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

        if (!isMountedRef.current) return;
        if (!error && data) {
            setComments(mapComments(data));
        }
        if (isMountedRef.current) {
            setIsLoading(false);
        }
    }, [supabase, taskId]);

    const scheduleRefresh = useCallback(() => {
        if (!isMountedRef.current) return;
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
            if (!isMountedRef.current) return;
            void refreshComments();
        }, 120);
    }, [refreshComments]);

    const syncPolling = useCallback(() => {
        const polling = pollingRef.current;
        if (!polling) return;

        if (isConnectedRef.current && resourceConnectedRef.current) {
            polling.stop();
            return;
        }

        polling.start();
    }, []);

    useEffect(() => {
        isConnectedRef.current = isConnected;
        syncPolling();
    }, [isConnected, syncPolling]);

    useEffect(() => {
        void refreshComments();
    }, [refreshComments]);

    useEffect(() => {
        if (!taskId) {
            resourceConnectedRef.current = false;
            return;
        }

        resourceConnectedRef.current = false;

        const unsubscribe = subscribeTaskResource({
            taskId,
            onEvent: (event) => {
                if (event.kind === "comment") {
                    scheduleRefresh();
                }
            },
            onStatus: (status) => {
                resourceConnectedRef.current = status === "SUBSCRIBED";
                syncPolling();
            },
        });

        return () => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            resourceConnectedRef.current = false;
            unsubscribe();
        };
    }, [scheduleRefresh, syncPolling, taskId]);

    useEffect(() => {
        if (!taskId) return;

        const polling = createVisibilityAwareInterval(() => {
            void refreshComments();
        }, 30000);
        pollingRef.current = polling;
        syncPolling();

        return () => {
            if (pollingRef.current === polling) {
                pollingRef.current = null;
            }
            polling();
        };
    }, [isConnected, refreshComments, syncPolling, taskId]);

    const isLiked = useCallback((comment: Comment) => {
        if (!currentUserId) return false;
        return comment.likes?.some((like) => like.user_id === currentUserId) || false;
    }, [currentUserId]);

    return { comments, isLoading, isLiked, refreshComments };
}
