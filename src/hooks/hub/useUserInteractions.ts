'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

export function useUserBookmarks(userId: string | null | undefined) {
    const supabase = createClient();

    return useQuery<Set<string>>({
        queryKey: ['user-bookmarks', userId],
        queryFn: async () => {
            if (!userId) return new Set();

            // For now, return empty set - bookmarks table can be added later
            // const { data } = await supabase
            //   .from('bookmarks')
            //   .select('entity_id')
            //   .eq('user_id', userId)
            //   .eq('entity_type', 'project');

            return new Set();
        },
        enabled: !!userId,
    });
}

export function useUserFollowedProjects(userId: string | null | undefined) {
    const supabase = createClient();

    return useQuery<Set<string>>({
        queryKey: ['user-followed-projects', userId],
        queryFn: async () => {
            if (!userId) return new Set();

            // For now, return empty set - project_followers table can be added later
            return new Set();
        },
        enabled: !!userId,
    });
}
