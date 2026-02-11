import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { countTaskAttachments } from "@/app/actions/files";

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
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchCounts = useCallback(async () => {
        if (!taskId) {
            setCounts(EMPTY_COUNTS);
            setIsLoading(false);
            return;
        }

        try {
            const [subtasks, comments, filesCount] = await Promise.all([
                supabase.from("task_subtasks").select("*", { count: "exact", head: true }).eq("task_id", taskId),
                supabase.from("task_comments").select("*", { count: "exact", head: true }).eq("task_id", taskId),
                countTaskAttachments(taskId),
            ]);

            setCounts({
                subtasks: subtasks.count || 0,
                comments: comments.count || 0,
                files: filesCount || 0,
            });
        } catch (error) {
            console.error("Error fetching task counts:", error);
        } finally {
            setIsLoading(false);
        }
    }, [supabase, taskId]);

    const scheduleRefresh = useCallback(() => {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
            void fetchCounts();
        }, 120);
    }, [fetchCounts]);

    useEffect(() => {
        void fetchCounts();
    }, [fetchCounts]);

    useEffect(() => {
        if (!taskId) return;

        const subtasksChannel = supabase
            .channel(`task_counts_subtasks:${taskId}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "task_subtasks", filter: `task_id=eq.${taskId}` },
                scheduleRefresh
            )
            .subscribe();

        const commentsChannel = supabase
            .channel(`task_counts_comments:${taskId}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "task_comments", filter: `task_id=eq.${taskId}` },
                scheduleRefresh
            )
            .subscribe();

        const attachmentsChannel = supabase
            .channel(`task_counts_attachments:${taskId}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "task_node_links", filter: `task_id=eq.${taskId}` },
                scheduleRefresh
            )
            .subscribe();

        return () => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            supabase.removeChannel(subtasksChannel);
            supabase.removeChannel(commentsChannel);
            supabase.removeChannel(attachmentsChannel);
        };
    }, [scheduleRefresh, supabase, taskId]);

    return { counts, isLoading };
}
