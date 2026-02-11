import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface Subtask {
    id: string;
    task_id: string;
    title: string;
    completed: boolean;
    position: number;
    created_at: string;
    updated_at: string;
}

function sortByPosition(items: Subtask[]) {
    return [...items].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
}

export function useTaskSubtasks(taskId: string) {
    const [subtasks, setSubtasks] = useState<Subtask[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const supabase = useMemo(() => createClient(), []);

    const fetchSubtasks = useCallback(async () => {
        if (!taskId) {
            setSubtasks([]);
            setIsLoading(false);
            return;
        }

        const { data, error } = await supabase
            .from("task_subtasks")
            .select("*")
            .eq("task_id", taskId)
            .order("position", { ascending: true });

        if (!error && data) {
            setSubtasks(sortByPosition(data as Subtask[]));
        }
        setIsLoading(false);
    }, [supabase, taskId]);

    useEffect(() => {
        void fetchSubtasks();
    }, [fetchSubtasks]);

    useEffect(() => {
        if (!taskId) return;

        const channel = supabase
            .channel(`task_subtasks:${taskId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "task_subtasks",
                    filter: `task_id=eq.${taskId}`,
                },
                (payload: any) => {
                    if (payload.eventType === "INSERT") {
                        const inserted = payload.new as Subtask;
                        setSubtasks((prev) => {
                            if (prev.some((st) => st.id === inserted.id)) return prev;
                            return sortByPosition([...prev, inserted]);
                        });
                    } else if (payload.eventType === "UPDATE") {
                        const updated = payload.new as Subtask;
                        setSubtasks((prev) => {
                            const next = prev.map((st) => (st.id === updated.id ? updated : st));
                            return sortByPosition(next);
                        });
                    } else if (payload.eventType === "DELETE") {
                        setSubtasks((prev) => prev.filter((st) => st.id !== payload.old.id));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [supabase, taskId]);

    return { subtasks, isLoading };
}
