"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Task } from "@/components/projects/v2/tasks/TaskCard"; // Import shared Task type

/**
 * useRealtimeTasks
 * 
 * Subscribes to the `tasks` table changes for a specific project.
 * Implements the "Alive Dashboard" concept from the architecture plan.
 */
export function useRealtimeTasks(projectId: string, initialTasks: Task[] = []) {
    const [tasks, setTasks] = useState<Task[]>(initialTasks);
    const supabase = useMemo(() => createClient(), []);

    const buildSignature = (items: Task[]) => {
        if (!items || items.length === 0) return "0";
        const first = items[0];
        const last = items[items.length - 1];
        const lastUpdated = (last as any).updatedAt || (last as any).updated_at || "";
        return `${items.length}:${first.id}:${last.id}:${lastUpdated}`;
    };

    // REF STABILITY FIX: Prevent infinite loop if initialTasks is a new reference but same content
    const prevInitialTasksSig = useRef(buildSignature(initialTasks));

    // Reset local state ONLY if content actually changes (server revalidation)
    useEffect(() => {
        const currentSig = buildSignature(initialTasks);
        if (prevInitialTasksSig.current !== currentSig) {
            setTasks(initialTasks);
            prevInitialTasksSig.current = currentSig;
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
                    if (payload.eventType === 'INSERT') {
                        const newTask = normalizeTask(payload.new);
                        setTasks((prev) => {
                            if (prev.some((task) => task.id === newTask.id)) return prev;
                            return [newTask, ...prev];
                        });
                    } else if (payload.eventType === 'UPDATE') {
                        const updatedTask = normalizeTask(payload.new);
                        setTasks((prev) => {
                            const exists = prev.some((t) => t.id === updatedTask.id);
                            if (!exists) return [updatedTask, ...prev];
                            return prev.map((t) => (t.id === updatedTask.id ? { ...t, ...updatedTask } as Task : t));
                        });
                    } else if (payload.eventType === 'DELETE') {
                        setTasks((prev) => prev.filter((t) => t.id !== payload.old.id));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [projectId, supabase]);

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
