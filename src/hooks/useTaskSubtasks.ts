import { useState, useEffect } from "react";
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

export function useTaskSubtasks(taskId: string) {
    const [subtasks, setSubtasks] = useState<Subtask[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const supabase = createClient();

        // Initial fetch
        const fetchSubtasks = async () => {
            const { data, error } = await supabase
                .from("task_subtasks")
                .select("*")
                .eq("task_id", taskId)
                .order("position", { ascending: true });

            if (!error && data) {
                setSubtasks(data);
            }
            setIsLoading(false);
        };

        fetchSubtasks();

        // Real-time subscription
        const channel = supabase
            .channel(`task_subtasks:${taskId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "task_subtasks",
                    filter: `task_id=eq.${taskId}`
                },
                (payload) => {
                    if (payload.eventType === "INSERT") {
                        setSubtasks((prev) => [...prev, payload.new as Subtask]);
                    } else if (payload.eventType === "UPDATE") {
                        setSubtasks((prev) =>
                            prev.map((st) =>
                                st.id === payload.new.id ? (payload.new as Subtask) : st
                            )
                        );
                    } else if (payload.eventType === "DELETE") {
                        setSubtasks((prev) => prev.filter((st) => st.id !== payload.old.id));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [taskId]);

    return { subtasks, isLoading };
}
