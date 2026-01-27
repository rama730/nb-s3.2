import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { countTaskAttachments } from "@/app/actions/files";

export function useTaskCounts(taskId: string) {
    const [counts, setCounts] = useState({
        subtasks: 0,
        comments: 0,
        files: 0
    });
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const supabase = createClient();

        const fetchCounts = async () => {
            try {
                const [subtasks, comments, filesCount] = await Promise.all([
                    supabase.from("task_subtasks").select("*", { count: "exact", head: true }).eq("task_id", taskId),
                    supabase.from("task_comments").select("*", { count: "exact", head: true }).eq("task_id", taskId),
                    countTaskAttachments(taskId),
                ]);

                setCounts({
                    subtasks: subtasks.count || 0,
                    comments: comments.count || 0,
                    files: filesCount || 0
                });
            } catch (error) {
                console.error("Error fetching task counts:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchCounts();
    }, [taskId]);

    return { counts, isLoading };
}
