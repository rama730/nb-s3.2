'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Project, HubFilters } from '@/types/hub';
import { fetchHubProjectsAction } from '@/app/actions/hub';
import { type FilterView } from '@/constants/hub';

const PAGE_SIZE = 24;

export function useHubProjectsSimple(
    filters: HubFilters,
    view: FilterView,
    initialProjectsPage?: {
        projects?: Project[];
        nextCursor?: string;
        hasMore?: boolean;
    } | null,
) {
    return useInfiniteQuery({
        queryKey: ['hub-projects-simple', view, filters],
        queryFn: async ({ pageParam = undefined as string | undefined }) => {
            const result = await fetchHubProjectsAction(filters, pageParam, PAGE_SIZE, view);

            if (!result.success) {
                throw new Error(result.error);
            }

            // Explicitly cast to the success shape
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
        getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
        // Keep previous data when fetching new filters for smooth transition
        placeholderData: (previousData) => previousData,
        // Use initial data if provided and filters match default (empty/all)
        // Note: infinite query initialData structure needs { pages: [...], pageParams: [...] }
        initialData: (initialProjectsPage && view === 'all' && isDefaultFilters(filters)) ? {
            pages: [{
                projects: initialProjectsPage.projects || [],
                nextCursor: initialProjectsPage.nextCursor,
                hasMore: initialProjectsPage.hasMore
            }],
            pageParams: [undefined]
        } : undefined,
    });
}

function isDefaultFilters(filters: HubFilters) {
    // Check if filters match the default fetched server-side
    return (
        (!filters.status || filters.status === 'all') &&
        (!filters.type || filters.type === 'all') &&
        (!filters.sort || filters.sort === 'newest') &&
        (!filters.tech || filters.tech.length === 0) &&
        !filters.search &&
        !filters.includedIds
    );
}
