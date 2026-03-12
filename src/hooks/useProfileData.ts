"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getProfileProjectsAction, getProfileStatsAction } from "@/app/actions/profile";
import { queryKeys } from "@/lib/query-keys";

export const PROFILE_KEYS = {
    projects: (userId: string) => queryKeys.profile.projects(userId),
    stats: (userId: string) => queryKeys.profile.stats(userId),
};

export function useProfileProjects(userId: string, initialData?: any[], enabled: boolean = true) {
    const hasInitialData = Array.isArray(initialData);
    return useQuery({
        queryKey: PROFILE_KEYS.projects(userId),
        queryFn: async () => {
            const result = await getProfileProjectsAction(userId);
            return result || [];
        },
        enabled: !!userId && enabled,
        initialData: initialData,
        staleTime: 1000 * 60 * 5, // 5 min
        refetchOnMount: hasInitialData ? false : true,
        refetchOnWindowFocus: false,
    });
}

export function useProfileStats(userId: string, initialData?: any, enabled: boolean = true) {
    const hasInitialData = !!initialData;
    return useQuery({
        queryKey: PROFILE_KEYS.stats(userId),
        queryFn: async () => {
            const result = await getProfileStatsAction(userId);
            return result;
        },
        enabled: !!userId && enabled,
        initialData: initialData,
        staleTime: 1000 * 60 * 2, // 2 min
        refetchOnMount: hasInitialData ? false : true,
        refetchOnWindowFocus: false,
    });
}

interface UseProfileReadModelOptions {
    profileId: string;
    initialProjects?: any[];
    initialStats?: any;
    projectsEnabled?: boolean;
}

export function useProfileReadModel({
    profileId,
    initialProjects,
    initialStats,
    projectsEnabled = true,
}: UseProfileReadModelOptions) {
    const projectsQuery = useProfileProjects(profileId, initialProjects, projectsEnabled);
    const statsQuery = useProfileStats(profileId, initialStats, true);

    return useMemo(
        () => ({
            projects: projectsQuery.data || [],
            stats: statsQuery.data || initialStats || null,
            projectsLoading: projectsQuery.isLoading,
            statsLoading: statsQuery.isLoading,
            loading: projectsQuery.isLoading || statsQuery.isLoading,
        }),
        [
            initialStats,
            projectsQuery.data,
            projectsQuery.isLoading,
            statsQuery.data,
            statsQuery.isLoading,
        ]
    );
}
