'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Project, HubFilters } from '@/types/hub';
import { fetchHubProjectsAction } from '@/app/actions/hub';

interface UseHubProjectsQueryParams {
    filters: HubFilters;
    view: string;
}

interface ProjectsPage {
    projects: Project[];
    nextCursor?: number;
    hasMore: boolean;
}

const PAGE_SIZE = 24;

export function useHubProjectsQuery({ filters, view }: UseHubProjectsQueryParams) {
    return useInfiniteQuery<ProjectsPage>({
        queryKey: ['hub-projects', filters, view],
        queryFn: async ({ pageParam = 0 }) => {
            const result = await fetchHubProjectsAction(filters, pageParam as number, PAGE_SIZE);

            if (!result.success) {
                throw new Error(result.error);
            }

            // We know it's successful here.
            // Explicitly cast to the success shape to avoid union type issues
            const successResult = result as {
                success: true;
                projects: Project[];
                nextCursor?: number;
                hasMore: boolean;
            };

            return {
                projects: successResult.projects || [],
                nextCursor: successResult.nextCursor,
                hasMore: successResult.hasMore,
            };
        },
        initialPageParam: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialData: { pages: [{ projects: [], hasMore: false }], pageParams: [0] },
    });
}
