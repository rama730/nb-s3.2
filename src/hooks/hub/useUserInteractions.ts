'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/query-keys';



export function useUserFollowedProjects(
    userId: string | null | undefined,
    projectIds: readonly string[],
) {
    const supabase = createClient();
    const visibleProjectIds = Array.from(new Set(projectIds)).sort();

    return useQuery<Set<string>>({
        queryKey: [...queryKeys.hub.userFollowedProjects(userId), visibleProjectIds.join(',')],
        queryFn: async () => {
            if (!userId || visibleProjectIds.length === 0) return new Set();

            const { data, error } = await supabase
                .from('project_follows')
                .select('project_id')
                .eq('user_id', userId)
                .in('project_id', visibleProjectIds);

            if (error) throw error;

            return new Set((data || []).map((row: { project_id: string }) => row.project_id));
        },
        enabled: !!userId && visibleProjectIds.length > 0,
        staleTime: 60_000,
        gcTime: 5 * 60_000,
    });
}
