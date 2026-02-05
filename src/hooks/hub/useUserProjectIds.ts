'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

export function useUserProjectIds(userId: string | null) {
    const supabase = createClient();

    const { data, ...rest } = useQuery<string[]>({
        queryKey: ['user-project-ids', userId],
        queryFn: async () => {
            if (!userId) return [];

            const { data, error } = await supabase
                .from('projects')
                .select('id')
                .eq('owner_id', userId);

            if (error) throw error;

            return (data || []).map((p: { id: string }) => p.id);
        },
        enabled: !!userId,
    });

    return {
        projectIds: new Set(data || []),
        ...rest,
    };
}
