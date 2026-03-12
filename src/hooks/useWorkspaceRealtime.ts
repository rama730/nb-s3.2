'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/query-keys';
import type { WorkspaceOverviewBaseData } from '@/app/actions/workspace';
import type { WorkspaceRefreshTarget } from '@/lib/realtime/refresh-reasons';

type DbRealtimePayload = {
    eventType?: 'INSERT' | 'UPDATE' | 'DELETE';
    new?: Record<string, unknown>;
    old?: Record<string, unknown>;
};

function toSafeDate(value: unknown): Date | null {
    if (!value) return null;
    const date = new Date(value as string | number | Date);
    return Number.isNaN(date.getTime()) ? null : date;
}

function clampNonNegative(value: number) {
    return Math.max(0, Number.isFinite(value) ? value : 0);
}

function taskCountersForViewer(row: Record<string, unknown> | undefined, userId: string, now: Date, todayEnd: Date) {
    if (!row) {
        return {
            inProgressCount: 0,
            overdueCount: 0,
            tasksDueCount: 0,
        };
    }

    const assigneeId = typeof row.assignee_id === 'string' ? row.assignee_id : null;
    if (assigneeId !== userId) {
        return {
            inProgressCount: 0,
            overdueCount: 0,
            tasksDueCount: 0,
        };
    }

    const status = typeof row.status === 'string' ? row.status : 'todo';
    const dueDate = toSafeDate(row.due_date ?? row.dueDate);
    const isDone = status === 'done';
    const hasDue = !!dueDate && !isDone;

    return {
        inProgressCount: status === 'in_progress' ? 1 : 0,
        overdueCount: hasDue && !!dueDate && dueDate < now ? 1 : 0,
        tasksDueCount: hasDue && !!dueDate && dueDate <= todayEnd ? 1 : 0,
    };
}

function connectionInboxCounter(row: Record<string, unknown> | undefined, userId: string) {
    if (!row) return 0;
    const addresseeId = typeof row.addressee_id === 'string' ? row.addressee_id : null;
    const status = typeof row.status === 'string' ? row.status : null;
    return addresseeId === userId && status === 'pending' ? 1 : 0;
}

/**
 * useWorkspaceRealtime
 *
 * Subscribes to task assignments and connection requests for the current user.
 * On any change, debounced invalidation of workspace queries triggers a refetch.
 * Only 2 Supabase channels — uses existing DB indexes (tasks_assignee_idx, connections_addressee_idx).
 */
export function useWorkspaceRealtime(userId: string | null) {
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!userId) return;

        const supabase = createSupabaseBrowserClient();
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        const pendingTargets = new Set<WorkspaceRefreshTarget>();

        const patchOverviewBaseFromTaskPayload = (payload: DbRealtimePayload) => {
            const now = new Date();
            const todayEnd = new Date(now);
            todayEnd.setHours(23, 59, 59, 999);

            const before = taskCountersForViewer(payload.old, userId, now, todayEnd);
            const after = taskCountersForViewer(payload.new, userId, now, todayEnd);
            const delta = {
                inProgressCount: after.inProgressCount - before.inProgressCount,
                overdueCount: after.overdueCount - before.overdueCount,
                tasksDueCount: after.tasksDueCount - before.tasksDueCount,
            };

            if (delta.inProgressCount === 0 && delta.overdueCount === 0 && delta.tasksDueCount === 0) {
                return false;
            }

            queryClient.setQueryData<WorkspaceOverviewBaseData | undefined>(
                queryKeys.workspace.overviewBase(),
                (prev) => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        inProgressCount: clampNonNegative(prev.inProgressCount + delta.inProgressCount),
                        overdueCount: clampNonNegative(prev.overdueCount + delta.overdueCount),
                        tasksDueCount: clampNonNegative(prev.tasksDueCount + delta.tasksDueCount),
                    };
                }
            );
            return true;
        };

        const patchOverviewBaseFromConnectionPayload = (payload: DbRealtimePayload) => {
            const before = connectionInboxCounter(payload.old, userId);
            const after = connectionInboxCounter(payload.new, userId);
            const delta = after - before;
            if (delta === 0) return false;

            queryClient.setQueryData<WorkspaceOverviewBaseData | undefined>(
                queryKeys.workspace.overviewBase(),
                (prev) => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        inboxCount: clampNonNegative(prev.inboxCount + delta),
                    };
                }
            );
            return true;
        };

        const flushInvalidations = () => {
            if (pendingTargets.has('overviewBase')) {
                queryClient.invalidateQueries({ queryKey: queryKeys.workspace.overviewBase() });
            }
            if (pendingTargets.has('overviewTasks')) {
                queryClient.invalidateQueries({ queryKey: queryKeys.workspace.overviewSection.tasks() });
            }
            if (pendingTargets.has('overviewMentions')) {
                queryClient.invalidateQueries({ queryKey: queryKeys.workspace.overviewSection.mentionsRequests() });
            }
            if (pendingTargets.has('tasks')) {
                queryClient.invalidateQueries({ queryKey: queryKeys.workspace.tasksRoot() });
            }
            if (pendingTargets.has('inbox')) {
                queryClient.invalidateQueries({ queryKey: queryKeys.workspace.inboxRoot() });
            }
            if (pendingTargets.has('activity')) {
                queryClient.invalidateQueries({ queryKey: queryKeys.workspace.activity() });
            }
            pendingTargets.clear();
        };

        const queueInvalidation = (targets: WorkspaceRefreshTarget[]) => {
            for (const target of targets) pendingTargets.add(target);
            if (debounceTimer) return;
            debounceTimer = setTimeout(() => {
                debounceTimer = null;
                flushInvalidations();
            }, 200);
        };

        const ch1 = supabase
            .channel(`ws-tasks-${userId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'tasks', filter: `assignee_id=eq.${userId}` },
                (payload: DbRealtimePayload) => {
                    const basePatched = patchOverviewBaseFromTaskPayload(payload);
                    queueInvalidation(basePatched ? ['overviewTasks', 'tasks', 'activity'] : ['overviewBase', 'overviewTasks', 'tasks', 'activity']);
                }
            )
            .subscribe();

        const ch2 = supabase
            .channel(`ws-connections-${userId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'connections', filter: `addressee_id=eq.${userId}` },
                (payload: DbRealtimePayload) => {
                    const basePatched = patchOverviewBaseFromConnectionPayload(payload);
                    queueInvalidation(basePatched ? ['overviewMentions', 'inbox', 'activity'] : ['overviewBase', 'overviewMentions', 'inbox', 'activity']);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(ch1);
            supabase.removeChannel(ch2);
            if (debounceTimer) clearTimeout(debounceTimer);
            pendingTargets.clear();
        };
    }, [userId, queryClient]);
}
