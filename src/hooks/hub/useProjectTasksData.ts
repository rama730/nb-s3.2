'use client';

import { useQuery, useInfiniteQuery } from '@tanstack/react-query';

import { fetchProjectSprintDetailAction, fetchProjectSprintTimelinePageAction, fetchProjectSprintsAction, fetchProjectTasksAction } from '@/app/actions/project';
import { queryKeys } from '@/lib/query-keys';
import type { SprintDetailPayload } from '@/lib/projects/sprint-detail';
import { mergeSprintTimelineRows } from '@/lib/projects/sprint-timeline';
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

export const PROJECT_TASKS_QUERY_KEY = (projectId: string, scope: ProjectTaskScope = 'all', search = '') => queryKeys.project.detail.tasks(projectId, normalizeScope(scope), search.trim().slice(0, 100));
export const SPRINT_DETAIL_QUERY_KEY = (projectId: string, sprintId: string, taskReference?: string | null) => [
    ...queryKeys.project.detail.sprintDetail(projectId, sprintId),
    taskReference?.trim() || '__timeline__',
] as const;

function mergeSprintDetailPages(pages: SprintDetailPayload[]): SprintDetailPayload | undefined {
    const first = pages[0];
    if (!first) return undefined;

    const last = pages[pages.length - 1] ?? first;
    return {
        ...first,
        rows: mergeSprintTimelineRows(pages.map((page) => page.rows)),
        nextCursor: last.nextCursor,
        hasMore: last.hasMore,
    };
}

export function useProjectInfiniteTasks(projectId: string, initialData?: any, scope: ProjectTaskScope = 'all', search = '') {
    const normalizedScope = normalizeScope(scope);
    const normalizedSearch = search.trim().slice(0, 100);
    const initialTasksRaw = Array.isArray(initialData) ? initialData : [];
    const initialTasks = filterTasksByScope(initialTasksRaw, normalizedScope);
    const lastTask = initialTasks?.length ? initialTasks[initialTasks.length - 1] as any : undefined;
    const initialQueryData = !normalizedSearch && initialTasks?.length
        ? {
              pages: [
                  {
                      success: true,
                      tasks: initialTasks,
                      nextCursor: lastTask?.createdAt
                          ? JSON.stringify({
                              createdAt: new Date(lastTask.createdAt).toISOString(),
                              id: lastTask.id,
                              position: Number(lastTask.position ?? 0),
                          })
                          : undefined,
                      hasMore: initialTasks.length >= 50,
                  },
              ],
              pageParams: [undefined],
          }
        : undefined;

    return useInfiniteQuery({
        queryKey: PROJECT_TASKS_QUERY_KEY(projectId, normalizedScope, normalizedSearch),
        queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
            const result = await fetchProjectTasksAction(projectId, 50, pageParam, normalizedScope, normalizedSearch);
            if (!result.success) throw new Error(result.error);
            return result;
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialData: initialQueryData,
        staleTime: 1000 * 60,
        gcTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });
}

export function useSprintDetail(
    projectId: string | undefined,
    sprintId: string | null | undefined,
    taskReference?: string | null,
    initialData?: SprintDetailPayload,
    pageSize: number = 50,
) {
    const normalizedProjectId = projectId?.trim() || '';
    const normalizedSprintId = sprintId?.trim() || '__default__';
    const requestSprintId = sprintId?.trim() || null;
    const isValidProjectId = normalizedProjectId.length > 0;

    const query = useInfiniteQuery({
        queryKey: SPRINT_DETAIL_QUERY_KEY(normalizedProjectId || '__project__', normalizedSprintId, taskReference),
        queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
            const result = pageParam
                ? await fetchProjectSprintTimelinePageAction({
                    projectId: normalizedProjectId,
                    sprintId: requestSprintId,
                    cursor: pageParam,
                    limit: pageSize,
                })
                : await fetchProjectSprintDetailAction({
                    projectId: normalizedProjectId,
                    sprintId: requestSprintId,
                    taskReference: taskReference ?? null,
                    limit: pageSize,
                });
            if (!result.success) {
                throw new Error(result.error ?? 'Failed to fetch sprint detail');
            }
            return result.data;
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor ?? undefined : undefined,
        initialData: initialData ? { pages: [initialData], pageParams: [undefined] } : undefined,
        staleTime: 1000 * 30,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        enabled: isValidProjectId,
    });

    return {
        ...query,
        data: query.data ? mergeSprintDetailPages(query.data.pages) : undefined,
    };
}

export function useProjectSprints(projectId: string, initialData?: any[], enabled = true) {
    return useQuery({
        queryKey: queryKeys.project.detail.sprints(projectId),
        queryFn: async () => {
            const result = await fetchProjectSprintsAction(projectId);
            if (!result.success) throw new Error(result.error);
            return result.sprints;
        },
        initialData: initialData?.length ? initialData : undefined,
        enabled,
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });
}
