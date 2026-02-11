'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Project, HubFilters } from '@/types/hub';
import { fetchHubProjectsAction } from '@/app/actions/hub';
import { type FilterView } from '@/constants/hub';

interface UseHubProjectsQueryParams {
    filters: HubFilters;
    view: FilterView;
}

interface ProjectsPage {
    projects: Project[];
    nextCursor?: string;
    hasMore: boolean;
}

const PAGE_SIZE = 24;

export function useHubProjectsQuery({ filters, view }: UseHubProjectsQueryParams) {
    return useInfiniteQuery<ProjectsPage>({
        queryKey: ['hub-projects', filters, view],
        queryFn: async ({ pageParam }) => {
            const result = await fetchHubProjectsAction(
                filters,
                pageParam as string | undefined,
                PAGE_SIZE,
                view,
            );

            if (!result.success) {
                throw new Error(result.error);
            }

            // We know it's successful here.
            // Explicitly cast to the success shape to avoid union type issues
            const successResult = result as {
                success: true;
                projects: Project[];
                nextCursor?: string;
                hasMore: boolean;
            };

            return {
                projects: successResult.projects || [],
                nextCursor: successResult.nextCursor,
                hasMore: successResult.hasMore,
            };
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialData: { pages: [{ projects: [], hasMore: false }], pageParams: [undefined] },
    });
}
