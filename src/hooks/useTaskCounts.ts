import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import { subscribeTaskResource } from "@/lib/realtime/task-resource";
import { countTaskAttachments } from "@/app/actions/files";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";

type TaskCounts = {
    subtasks: number;
    comments: number;
    files: number;
};

const EMPTY_COUNTS: TaskCounts = {
    subtasks: 0,
    comments: 0,
    files: 0,
};

export function useTaskCounts(taskId: string) {
    const [counts, setCounts] = useState<TaskCounts>(EMPTY_COUNTS);
    const [isLoading, setIsLoading] = useState(true);
    const supabase = useMemo(() => createClient(), []);
    const { isConnected } = useRealtime();
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isMountedRef = useRef(true);
    const [resourceConnected, setResourceConnected] = useState(false);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const fetchCounts = useCallback(async () => {
        if (!isMountedRef.current) return;
        if (!taskId) {
            if (isMountedRef.current) {
                setCounts(EMPTY_COUNTS);
                setIsLoading(false);
            }
            return;
        }

        try {
            const [subtasks, comments, filesCount] = await Promise.all([
                supabase.from("task_subtasks").select("*", { count: "exact", head: true }).eq("task_id", taskId),
                supabase.from("task_comments").select("*", { count: "exact", head: true }).eq("task_id", taskId),
                countTaskAttachments(taskId),
            ]);

            if (isMountedRef.current) {
                setCounts({
                    subtasks: subtasks.count || 0,
                    comments: comments.count || 0,
                    files: filesCount || 0,
                });
            }
        } catch (error) {
            console.error("Error fetching task counts:", error);
        } finally {
            if (isMountedRef.current) {
                setIsLoading(false);
            }
        }
    }, [supabase, taskId]);

    const scheduleRefresh = useCallback(() => {
        if (!isMountedRef.current) return;
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
            if (!isMountedRef.current) return;
            void fetchCounts();
        }, 120);
    }, [fetchCounts]);

    useEffect(() => {
        void fetchCounts();
    }, [fetchCounts]);

    useEffect(() => {
        if (!taskId) return;

        setResourceConnected(false);

        const unsubscribe = subscribeTaskResource({
            taskId,
            onEvent: (event) => {
                const nextPayload = event.payload.new as Record<string, unknown> | undefined
                const previousPayload = event.payload.old as Record<string, unknown> | undefined

                if (event.kind === "subtask") {
                    setCounts((prev) => ({
                        ...prev,
                        subtasks: Math.max(
                            0,
                            prev.subtasks + (
                                event.payload.eventType === "INSERT"
                                    ? 1
                                    : event.payload.eventType === "DELETE"
                                        ? -1
                                        : 0
                            ),
                        ),
                    }));
                    return;
                }

                if (event.kind === "comment") {
                    setCounts((prev) => ({
                        ...prev,
                        comments: Math.max(
                            0,
                            prev.comments + (
                                event.payload.eventType === "INSERT"
                                    ? 1
                                    : event.payload.eventType === "DELETE"
                                        ? -1
                                        : 0
                            ),
                        ),
                    }));
                    return;
                }

                if (event.kind === "attachment_link") {
                    const nextTaskId = typeof nextPayload?.task_id === "string" ? nextPayload.task_id : null;
                    const previousTaskId = typeof previousPayload?.task_id === "string" ? previousPayload.task_id : null;
                    const delta =
                        event.payload.eventType === "INSERT" && nextTaskId === taskId
                            ? 1
                            : event.payload.eventType === "DELETE" && previousTaskId === taskId
                                ? -1
                                : 0;

                    if (delta === 0) {
                        scheduleRefresh();
                        return;
                    }

                    setCounts((prev) => ({
                        ...prev,
                        files: Math.max(0, prev.files + delta),
                    }));
                }
            },
            onStatus: (status) => {
                setResourceConnected(status === "SUBSCRIBED");
            },
        });

        return () => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            unsubscribe();
        };
    }, [scheduleRefresh, taskId]);

    useEffect(() => {
        if (!taskId || (isConnected && resourceConnected)) return;

        const cleanup = createVisibilityAwareInterval(() => {
            void fetchCounts();
        }, 30000);

        return () => {
            cleanup();
        };
    }, [fetchCounts, isConnected, resourceConnected, taskId]);

    return { counts, isLoading };
}
