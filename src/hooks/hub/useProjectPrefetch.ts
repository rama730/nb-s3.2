'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/query-keys';

export function useProjectPrefetch() {
    const queryClient = useQueryClient();
    const supabase = useMemo(() => createClient(), []);

    const prefetchProject = useCallback(async (projectId: string) => {
        await queryClient.prefetchQuery({
            queryKey: queryKeys.hub.projectPrefetch(projectId),
            queryFn: async () => {
                const { data, error } = await supabase
                    .from('projects')
                    .select(`
            id,
            owner_id,
            title,
            slug,
            key,
            short_description,
            description,
            status,
            visibility,
            cover_image,
            current_stage_index,
            followers_count,
            saves_count,
            view_count,
            created_at,
            updated_at,
            profiles:owner_id (
              id,
              username,
              full_name,
              avatar_url
            )
          `)
                    .eq('id', projectId)
                    .single();

                if (error) throw error;
                return data;
            },
            staleTime: 60 * 1000, // 1 minute
        });
    }, [queryClient, supabase]);

    return { prefetchProject };
}
