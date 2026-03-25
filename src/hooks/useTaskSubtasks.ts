import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import { subscribeTaskResource } from "@/lib/realtime/task-resource";
import { createVisibilityAwareInterval } from "@/lib/utils/visibility";

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
    const { isConnected } = useRealtime();
    const [resourceConnected, setResourceConnected] = useState(false);

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
        if (!taskId) {
            setResourceConnected(false);
            return;
        }

        setResourceConnected(false);

        const unsubscribe = subscribeTaskResource({
            taskId,
            onEvent: (event) => {
                if (event.kind !== "subtask") return;
                if (event.payload.eventType === "INSERT") {
                    const inserted = event.payload.new as Subtask;
                    setSubtasks((prev) => {
                        if (prev.some((st) => st.id === inserted.id)) return prev;
                        return sortByPosition([...prev, inserted]);
                    });
                } else if (event.payload.eventType === "UPDATE") {
                    const updated = event.payload.new as Subtask;
                    setSubtasks((prev) => {
                        const next = prev.map((st) => (st.id === updated.id ? updated : st));
                        return sortByPosition(next);
                    });
                } else if (event.payload.eventType === "DELETE") {
                    const previousRow = (event.payload.old ?? null) as Record<string, unknown> | null;
                    const deletedId = typeof previousRow?.id === "string" ? previousRow.id : null;
                    if (!deletedId) return;
                    setSubtasks((prev) => prev.filter((st) => st.id !== deletedId));
                }
            },
            onStatus: (status) => {
                setResourceConnected(status === "SUBSCRIBED");
            },
        });

        return () => {
            unsubscribe();
        };
    }, [taskId]);

    useEffect(() => {
        if (!taskId) return;
        if (isConnected && resourceConnected) return;

        const cleanup = createVisibilityAwareInterval(() => {
            void fetchSubtasks();
        }, 30000);

        return cleanup;
    }, [fetchSubtasks, isConnected, resourceConnected, taskId]);

    return { subtasks, isLoading };
}
