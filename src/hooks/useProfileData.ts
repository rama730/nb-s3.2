"use client";

import { useQuery } from "@tanstack/react-query";
import { getProfileProjectsAction, getProfileStatsAction } from "@/app/actions/profile";

export const PROFILE_KEYS = {
    projects: (userId: string) => ['profile', 'projects', userId],
    stats: (userId: string) => ['profile', 'stats', userId]
};

export function useProfileProjects(userId: string, initialData?: any[]) {
    return useQuery({
        queryKey: PROFILE_KEYS.projects(userId),
        queryFn: async () => {
            const result = await getProfileProjectsAction(userId);
            return result || [];
        },
        enabled: !!userId,
        initialData: initialData,
        staleTime: 1000 * 60 * 5, // 5 min
    });
}

export function useProfileStats(userId: string, initialData?: any) {
    return useQuery({
        queryKey: PROFILE_KEYS.stats(userId),
        queryFn: async () => {
            const result = await getProfileStatsAction(userId);
            return result;
        },
        enabled: !!userId,
        initialData: initialData,
        staleTime: 1000 * 60 * 2, // 2 min
    });
}
