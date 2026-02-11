'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

export function useUserBookmarks(userId: string | null | undefined) {
    const supabase = createClient();

    return useQuery<Set<string>>({
        queryKey: ['user-bookmarks', userId],
        queryFn: async () => {
            if (!userId) return new Set();

            const { data, error } = await supabase
                .from('saved_projects')
                .select('project_id')
                .eq('user_id', userId);

            if (error) throw error;

            return new Set((data || []).map((row: { project_id: string }) => row.project_id));
        },
        enabled: !!userId,
        staleTime: 60_000,
        gcTime: 5 * 60_000,
    });
}

export function useUserFollowedProjects(userId: string | null | undefined) {
    const supabase = createClient();

    return useQuery<Set<string>>({
        queryKey: ['user-followed-projects', userId],
        queryFn: async () => {
            if (!userId) return new Set();

            const { data, error } = await supabase
                .from('project_follows')
                .select('project_id')
                .eq('user_id', userId);

            if (error) throw error;

            return new Set((data || []).map((row: { project_id: string }) => row.project_id));
        },
        enabled: !!userId,
        staleTime: 60_000,
        gcTime: 5 * 60_000,
    });
}
