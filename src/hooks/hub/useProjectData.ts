"use client";

import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import {
    fetchProjectTasksAction,
    fetchProjectSprintsAction,
    fetchSprintTasksAction,
    getProjectAnalyticsAction,
    getProjectMembersAction
} from "@/app/actions/project";
import { Task } from "@/components/projects/v2/tasks/TaskCard";

// Types matching the server action return (or inferred)
export const PROJECT_TASKS_QUERY_KEY = (projectId: string) => ['project-tasks', projectId];
export const SPRINT_TASKS_QUERY_KEY = (sprintId: string) => ['sprint-tasks', sprintId];
export const PROJECT_SPRINTS_QUERY_KEY = (projectId: string) => ['project-sprints', projectId];
export const PROJECT_ANALYTICS_QUERY_KEY = (projectId: string) => ['project-analytics', projectId];
export const PROJECT_MEMBERS_QUERY_KEY = (projectId: string) => ['project-members', projectId];

export function useProjectInfiniteTasks(projectId: string, initialData?: any) {
    return useInfiniteQuery({
        queryKey: PROJECT_TASKS_QUERY_KEY(projectId),
        queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
            const result = await fetchProjectTasksAction(projectId, 50, pageParam);
            if (!result.success) throw new Error(result.error);
            return result;
        },
        initialPageParam: undefined as string | undefined, // Explicit type
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        staleTime: 1000 * 60,
    });
}

// Legacy support or single-page fetch
export function useProjectTasks(projectId: string, initialData?: any[]) {
    return useQuery({
        queryKey: PROJECT_TASKS_QUERY_KEY(projectId),
        queryFn: async () => {
            const result = await fetchProjectTasksAction(projectId);
            if (!result.success) throw new Error(result.error);
            return result.tasks as unknown as Task[];
        },
        initialData: initialData?.length ? initialData : undefined,
        staleTime: 1000 * 60,
        refetchOnWindowFocus: false,
    });
}

export function useSprintTasks(sprintId: string) {
    return useQuery({
        queryKey: SPRINT_TASKS_QUERY_KEY(sprintId),
        queryFn: async () => {
            const result = await fetchSprintTasksAction(sprintId);
            if (!result.success) throw new Error(result.error);
            return result.tasks as unknown as Task[];
        },
        staleTime: 1000 * 60 * 2, // 2 minutes
        enabled: !!sprintId,
    });
}

export function useProjectSprints(projectId: string, initialData?: any[]) {
    return useQuery({
        queryKey: PROJECT_SPRINTS_QUERY_KEY(projectId),
        queryFn: async () => {
            const result = await fetchProjectSprintsAction(projectId);
            if (!result.success) throw new Error(result.error);
            return result.sprints;
        },
        initialData: initialData?.length ? initialData : undefined,
        staleTime: 1000 * 60 * 5,
    });
}

export function useProjectAnalytics(projectId: string) {
    return useQuery({
        queryKey: PROJECT_ANALYTICS_QUERY_KEY(projectId),
        queryFn: async () => {
            const result = await getProjectAnalyticsAction(projectId);
            if (!result.success) throw new Error(result.error);
            return result.analytics;
        },
        staleTime: 1000 * 60 * 10, // 10 minutes (semi-static)
    });
}

export function useProjectMembers(projectId: string, initialData?: any[]) {
    return useInfiniteQuery({
        queryKey: PROJECT_MEMBERS_QUERY_KEY(projectId),
        queryFn: async ({ pageParam = 0 }) => {
            const result = await getProjectMembersAction(projectId, 20, pageParam as number);
            if (!result.success) throw new Error(result.error);
            return result;
        },
        initialPageParam: 0,
        getNextPageParam: (lastPage, allPages) => {
            if (!lastPage.hasMore) return undefined;
            return allPages.length * 20;
        },
        staleTime: 1000 * 60 * 15,
    });
}
