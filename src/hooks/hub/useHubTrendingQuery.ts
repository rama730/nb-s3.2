'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchHubProjectsAction } from '@/app/actions/hub';

export function useHubTrendingQuery() {
    return useQuery<Record<string, number>>({
        queryKey: ['hub-trending'],
        queryFn: async () => {
            // Get most recently updated projects via Server Action
            // We reuse fetchHubProjectsAction but ignore result format and mapping
            const result = await fetchHubProjectsAction({
                status: 'active', // Only active
                type: 'all',
                tech: [],
                sort: 'most_viewed', // Maps to updated_at desc in backend for now
                search: undefined,
                includedIds: undefined
            }, undefined, 20);

            if (!result.success) throw new Error(result.error);

            // Create a score map
            const scores: Record<string, number> = {};
            (result.projects || []).forEach((p: any, index: number) => {
                if (p.id) {
                    scores[p.id] = 20 - index;
                }
            });

            return scores;
        },
        staleTime: 5 * 60 * 1000, // 5 minutes
    });
}
