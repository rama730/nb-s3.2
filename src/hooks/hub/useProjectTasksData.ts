'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { fetchProjectSprintDetailAction, fetchProjectSprintTimelinePageAction, fetchProjectSprintsAction, fetchProjectTasksAction } from '@/app/actions/project';
import type { Task } from '@/components/projects/v2/tasks/TaskCard';
import { queryKeys } from '@/lib/query-keys';
import type { SprintDetailPayload } from '@/lib/projects/sprint-detail';
import { normalizeTaskSurfaceRecord } from '@/lib/projects/task-presentation';

export type ProjectTaskScope = 'all' | 'backlog' | 'sprint';

const normalizeScope = (scope: ProjectTaskScope): ProjectTaskScope => (scope === 'backlog' || scope === 'sprint' ? scope : 'all');

const filterTasksByScope = (tasks: any[], scope: ProjectTaskScope) => {
    if (!Array.isArray(tasks) || tasks.length === 0) return [];
    const normalized = tasks.map(normalizeTaskSurfaceRecord);
    if (scope === 'backlog') return normalized.filter((task) => !task.sprintId);
    if (scope === 'sprint') return normalized.filter((task) => !!task.sprintId);
    return normalized;
};

export const PROJECT_TASKS_QUERY_KEY = (projectId: string, scope: ProjectTaskScope = 'all') => queryKeys.project.detail.tasks(projectId, normalizeScope(scope));
export const SPRINT_TASKS_QUERY_KEY = (projectId: string, sprintId: string) => queryKeys.project.detail.sprintTasks(projectId, sprintId);
export const SPRINT_DETAIL_QUERY_KEY = (projectId: string, sprintId: string) => queryKeys.project.detail.sprintDetail(projectId, sprintId);
export const PROJECT_SPRINTS_QUERY_KEY = (projectId: string) => queryKeys.project.detail.sprints(projectId);

export function useProjectInfiniteTasks(projectId: string, initialData?: any, scope: ProjectTaskScope = 'all') {
    const normalizedScope = normalizeScope(scope);
    const initialTasksRaw = Array.isArray(initialData) ? initialData : [];
    const initialTasks = filterTasksByScope(initialTasksRaw, normalizedScope);
    const lastCreatedAt = initialTasks?.length ? (initialTasks[initialTasks.length - 1] as any)?.createdAt : undefined;
    const initialQueryData = initialTasks?.length
        ? {
              pages: [
                  {
                      success: true,
                      tasks: initialTasks,
                      nextCursor: lastCreatedAt ? new Date(lastCreatedAt).toISOString() : undefined,
                      hasMore: initialTasks.length >= 50,
                  },
              ],
              pageParams: [undefined],
          }
        : undefined;

    return useInfiniteQuery({
        queryKey: PROJECT_TASKS_QUERY_KEY(projectId, normalizedScope),
        queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
            const result = await fetchProjectTasksAction(projectId, 50, pageParam, normalizedScope);
            if (!result.success) throw new Error(result.error);
            return result;
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialData: initialQueryData,
        staleTime: 1000 * 60,
        gcTime: 1000 * 60 * 5,
    });
}

export function useSprintDetail(projectId: string | undefined, sprintId: string | null | undefined, initialPage?: SprintDetailPayload, pageSize: number = 24) {
    const normalizedProjectId = projectId?.trim() || '';
    const normalizedSprintId = sprintId?.trim() || '__default__';
    const requestSprintId = sprintId?.trim() || null;
    const isValidProjectId = normalizedProjectId.length > 0;

    return useInfiniteQuery({
        queryKey: SPRINT_DETAIL_QUERY_KEY(normalizedProjectId || '__project__', normalizedSprintId),
        queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
            const result =
                pageParam && requestSprintId
                    ? await fetchProjectSprintTimelinePageAction({
                          projectId: normalizedProjectId,
                          sprintId: requestSprintId,
                          cursor: pageParam,
                          limit: pageSize,
                      })
                    : await fetchProjectSprintDetailAction({
                          projectId: normalizedProjectId,
                          sprintId: requestSprintId,
                          cursor: pageParam,
                          limit: pageSize,
                      });
            if (!result.success) {
                throw new Error(result.error ?? 'Failed to fetch sprint detail');
            }
            return result.data;
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialData: initialPage
            ? {
                  pages: [initialPage],
                  pageParams: [undefined],
              }
            : undefined,
        staleTime: 1000 * 60 * 2,
        refetchOnWindowFocus: false,
        enabled: isValidProjectId,
    });
}

export function useProjectSprints(projectId: string, initialData?: any[], enabled = true) {
    return useQuery({
        queryKey: PROJECT_SPRINTS_QUERY_KEY(projectId),
        queryFn: async () => {
            const result = await fetchProjectSprintsAction(projectId);
            if (!result.success) throw new Error(result.error);
            return result.sprints;
        },
        initialData: initialData?.length ? initialData : undefined,
        staleTime: 1000 * 60 * 5,
        enabled,
    });
}
