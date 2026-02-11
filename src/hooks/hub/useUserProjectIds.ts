'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

export function useUserProjectIds(userId: string | null) {
    const supabase = createClient();

    const { data, ...rest } = useQuery<string[]>({
        queryKey: ['user-project-ids', userId],
        queryFn: async () => {
            if (!userId) return [];

            const { data: ownedData, error: ownedError } = await supabase
                .from('projects')
                .select('id')
                .eq('owner_id', userId);
            if (ownedError) throw ownedError;

            const { data: memberRows, error: memberError } = await supabase
                .from('project_members')
                .select('project_id')
                .eq('user_id', userId);
            if (memberError) throw memberError;

            const ownedIds = (ownedData || []).map((p: { id: string }) => p.id);
            const memberIds = (memberRows || []).map((p: { project_id: string }) => p.project_id);
            return Array.from(new Set([...ownedIds, ...memberIds]));
        },
        enabled: !!userId,
        staleTime: 60_000,
        gcTime: 5 * 60_000,
    });

    return {
        projectIds: new Set(data || []),
        ...rest,
    };
}
