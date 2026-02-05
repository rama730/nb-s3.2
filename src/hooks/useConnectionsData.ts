"use client";

import { useQuery } from "@tanstack/react-query";
import {
    getSuggestedPeople,
    getConnectionStats,
    getPendingRequests
} from "@/app/actions/connections";

export const CONNECTIONS_KEYS = {
    suggestions: (limit: number) => ['people', 'suggestions', limit],
    stats: (userId?: string) => ['people', 'stats', userId],
    requests: ['people', 'requests']
};

export function useSuggestedPeople(limit = 20, initialData?: any[]) {
    return useQuery({
        queryKey: CONNECTIONS_KEYS.suggestions(limit),
        queryFn: async () => {
            const result = await getSuggestedPeople(limit, 0);
            return result.profiles;
        },
        initialData: initialData,
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: false,
    });
}

export function useConnectionStats(userId?: string, initialData?: any) {
    return useQuery({
        queryKey: CONNECTIONS_KEYS.stats(userId),
        queryFn: async () => {
            return await getConnectionStats(userId);
        },
        initialData: initialData,
        staleTime: 1000 * 60, // 1 minute
        refetchOnWindowFocus: false,
    });
}

export function usePendingRequests(limit = 20, initialData?: any) {
    return useQuery({
        queryKey: CONNECTIONS_KEYS.requests,
        queryFn: async () => {
            // For now we just fetch the first page. Full infinite scroll layout would require UI refactor.
            // This ensures we at least limit the backend load.
            return await getPendingRequests(limit, 0);
        },
        initialData: initialData,
        staleTime: 1000 * 30, // 30 seconds
        refetchOnWindowFocus: true,
    });
}
