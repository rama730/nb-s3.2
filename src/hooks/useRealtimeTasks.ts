"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Task } from "@/components/projects/v2/tasks/TaskCard"; // Import shared Task type

/**
 * useRealtimeTasks
 * 
 * Subscribes to the `tasks` table changes for a specific project.
 * Implements the "Alive Dashboard" concept from the architecture plan.
 */
export function useRealtimeTasks(projectId: string, initialTasks: Task[] = []) {
    const [tasks, setTasks] = useState<Task[]>(initialTasks);
    const router = useRouter();
    const supabase = createClient();

    // Reset local state if initialTasks changes (e.g. server revalidation)
    useEffect(() => {
        setTasks(initialTasks);
    }, [initialTasks]);

    useEffect(() => {
        if (!projectId) return;

        const channel = supabase
            .channel(`project_tasks:${projectId}`)
            .on(
                'postgres_changes',
                {
                    event: '*', // Listen to INSERT, UPDATE, DELETE
                    schema: 'public',
                    table: 'tasks',
                    filter: `project_id=eq.${projectId}`
                },
                (payload) => {
                    console.log("Realtime Task Event:", payload);

                    if (payload.eventType === 'INSERT') {
                        setTasks((prev) => [payload.new as Task, ...prev]);
                        // Optional: Show toast "New task created"
                    } else if (payload.eventType === 'UPDATE') {
                        setTasks((prev) =>
                            prev.map((t) => (t.id === payload.new.id ? { ...t, ...payload.new } as Task : t))
                        );
                    } else if (payload.eventType === 'DELETE') {
                        setTasks((prev) => prev.filter((t) => t.id !== payload.old.id));
                    }

                    // Trigger a soft refresh to ensure consistency (background revalidation)
                    router.refresh();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [projectId, router, supabase]);

    return { tasks, setTasks };
}
