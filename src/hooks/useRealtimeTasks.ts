"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Task } from "@/components/projects/v2/tasks/TaskCard"; // Import shared Task type
import { subscribeActiveResource } from "@/lib/realtime/subscriptions";

const taskVersionMs = (task: Partial<Task> | null | undefined) => {
    const raw = (task as any)?.updatedAt ?? (task as any)?.updated_at ?? (task as any)?.createdAt ?? (task as any)?.created_at;
    if (!raw) return 0;
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : 0;
};

const mergePreferNewest = (incoming: Task[], existing: Task[]) => {
    const byId = new Map<string, Task>();
    for (const item of incoming) byId.set(item.id, item);
    for (const item of existing) {
        const current = byId.get(item.id);
        if (!current) {
            byId.set(item.id, item);
            continue;
        }
        if (taskVersionMs(item) >= taskVersionMs(current)) {
            byId.set(item.id, { ...current, ...item });
        }
    }
    return Array.from(byId.values()).sort((a, b) => {
        const byUpdated = taskVersionMs(b) - taskVersionMs(a);
        if (byUpdated !== 0) return byUpdated;
        return a.id.localeCompare(b.id);
    });
};

const buildSignature = (items: Task[]) => {
    if (!items || items.length === 0) return "0";
    const newest = items.reduce((max, item) => Math.max(max, taskVersionMs(item)), 0);
    const first = items[0]?.id ?? "";
    const last = items[items.length - 1]?.id ?? "";
    let checksum = 2166136261;
    for (const item of items) {
        const token = `${item.id ?? ""}:${taskVersionMs(item)}|`;
        for (let i = 0; i < token.length; i += 1) {
            checksum ^= token.charCodeAt(i);
            checksum = Math.imul(checksum, 16777619);
        }
    }
    const contentHash = (checksum >>> 0).toString(36);
    return `${items.length}:${first}:${last}:${newest}:${contentHash}`;
};

/**
 * useRealtimeTasks
 * 
 * Subscribes to the `tasks` table changes for a specific project.
 * Implements the "Alive Dashboard" concept from the architecture plan.
 */
export function useRealtimeTasks(projectId: string, initialTasks: Task[] = []) {
    const [tasks, setTasks] = useState<Task[]>(initialTasks);
    const supabase = useMemo(() => createClient(), []);

    // REF STABILITY FIX: Prevent infinite loop if initialTasks is a new reference but same content
    const prevInitialTasksSig = useRef(buildSignature(initialTasks));

    // Reset local state ONLY if content actually changes (server revalidation)
    useEffect(() => {
        const currentSig = buildSignature(initialTasks);
        if (prevInitialTasksSig.current !== currentSig) {
            setTasks((prev) => mergePreferNewest(initialTasks, prev));
            prevInitialTasksSig.current = currentSig;
        }
    }, [initialTasks]);

    useEffect(() => {
        if (!projectId) return;

        const channel = subscribeActiveResource({
            supabase,
            resourceType: 'workspace',
            resourceId: `project-tasks:${projectId}`,
            bindings: [
                {
                    event: '*',
                    table: 'tasks',
                    filter: `project_id=eq.${projectId}`,
                    handler: (payload) => {
                        if (payload.eventType === 'INSERT') {
                            const newTask = normalizeTask(payload.new);
                            setTasks((prev) => {
                                const existing = prev.find((task) => task.id === newTask.id);
                                if (!existing) return [newTask, ...prev];
                                if (taskVersionMs(existing) > taskVersionMs(newTask)) return prev;
                                return prev.map((task) =>
                                    task.id === newTask.id ? ({ ...task, ...newTask } as Task) : task
                                );
                            });
                        } else if (payload.eventType === 'UPDATE') {
                            const updatedTask = normalizeTask(payload.new);
                            setTasks((prev) => {
                                const exists = prev.some((t) => t.id === updatedTask.id);
                                if (!exists) return [updatedTask, ...prev];
                                return prev.map((t) => {
                                    if (t.id !== updatedTask.id) return t;
                                    if (taskVersionMs(t) > taskVersionMs(updatedTask)) return t;
                                    return { ...t, ...updatedTask } as Task;
                                });
                            });
                        } else if (payload.eventType === 'DELETE') {
                            const previousRow = (payload.old ?? null) as Record<string, unknown> | null;
                            const deletedId = typeof previousRow?.id === 'string' ? previousRow.id : null;
                            if (!deletedId) {
                                console.warn("[useRealtimeTasks] DELETE payload missing old.id", payload);
                                return;
                            }
                            setTasks((prev) => prev.filter((t) => t.id !== deletedId));
                        }
                    },
                },
            ],
        });

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
