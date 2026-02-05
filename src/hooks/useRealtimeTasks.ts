"use client";

import { useEffect, useState, useRef } from "react";
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

    // REF STABILITY FIX: Prevent infinite loop if initialTasks is a new reference but same content
    const prevInitialTasksJson = useRef(JSON.stringify(initialTasks));

    // Reset local state ONLY if content actually changes (server revalidation)
    useEffect(() => {
        const currentJson = JSON.stringify(initialTasks);
        if (prevInitialTasksJson.current !== currentJson) {
            setTasks(initialTasks);
            prevInitialTasksJson.current = currentJson;
        }
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
                (payload: any) => {
                    console.log("Realtime Task Event:", payload);

                    if (payload.eventType === 'INSERT') {
                        const newTask = normalizeTask(payload.new);
                        setTasks((prev) => [newTask, ...prev]);
                    } else if (payload.eventType === 'UPDATE') {
                        const updatedTask = normalizeTask(payload.new);
                        setTasks((prev) =>
                            prev.map((t) => (t.id === updatedTask.id ? { ...t, ...updatedTask } as Task : t))
                        );
                    } else if (payload.eventType === 'DELETE') {
                        setTasks((prev) => prev.filter((t) => t.id !== payload.old.id));
                    }

                    // Trigger a soft refresh to ensure consistency (background revalidation)
                    // PERFORMANCE FIX: Removed router.refresh() to prevent massive server load on every event.
                    // The local state update above is sufficient for "Smooth Working".
                    // router.refresh();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [projectId, supabase]); // Removed router dependence

    return { tasks, setTasks };
}

// Helper to normalize Supabase payload (snake_case) to App Model (camelCase)
function normalizeTask(raw: any): Task {
    return {
        ...raw,
        // Map common snake_case fields to camelCase
        assigneeId: raw.assignee_id,
        sprintId: raw.sprint_id,
        creatorId: raw.creator_id,
        projectId: raw.project_id,
        dueDate: raw.due_date,
        storyPoints: raw.story_points,
        // Keep snake_case for now if needed, but primary is camel
    } as Task;
}
