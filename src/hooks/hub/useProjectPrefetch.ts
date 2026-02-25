'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useProjectPrefetch() {
    const queryClient = useQueryClient();
    const supabase = useMemo(() => createClient(), []);

    const prefetchProject = useCallback(async (projectId: string) => {
        await queryClient.prefetchQuery({
            queryKey: ['project', projectId],
            queryFn: async () => {
                const { data, error } = await supabase
                    .from('projects')
                    .select(`
            *,
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
