'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

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
        const pendingTargets = new Set<'overview' | 'tasks' | 'inbox' | 'activity'>();

        const flushInvalidations = () => {
            if (pendingTargets.has('overview')) {
                queryClient.invalidateQueries({ queryKey: ['workspace', 'overview'] });
            }
            if (pendingTargets.has('tasks')) {
                queryClient.invalidateQueries({ queryKey: ['workspace', 'tasks'] });
            }
            if (pendingTargets.has('inbox')) {
                queryClient.invalidateQueries({ queryKey: ['workspace', 'inbox'] });
            }
            if (pendingTargets.has('activity')) {
                queryClient.invalidateQueries({ queryKey: ['workspace', 'activity'] });
            }
            pendingTargets.clear();
        };

        const queueInvalidation = (targets: Array<'overview' | 'tasks' | 'inbox' | 'activity'>) => {
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
                () => queueInvalidation(['overview', 'tasks', 'activity'])
            )
            .subscribe();

        const ch2 = supabase
            .channel(`ws-connections-${userId}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'connections', filter: `addressee_id=eq.${userId}` },
                () => queueInvalidation(['overview', 'inbox', 'activity'])
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
