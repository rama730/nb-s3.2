'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Project, HubFilters } from '@/types/hub';
import { fetchHubProjectsAction } from '@/app/actions/hub';

const PAGE_SIZE = 24;

export function useHubProjectsSimple(filters: HubFilters, initialProjectsPage?: any) {
    return useInfiniteQuery({
        queryKey: ['hub-projects-simple', filters],
        queryFn: async ({ pageParam = undefined as string | undefined }) => {
            const result = await fetchHubProjectsAction(filters, pageParam, PAGE_SIZE);

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
        initialData: (initialProjectsPage && isDefaultFilters(filters)) ? {
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
        (!filters.status || filters.status === 'ALL') &&
        (!filters.type || filters.type === 'ALL') &&
        (!filters.sort || filters.sort === 'NEWEST') &&
        (!filters.tech || filters.tech.length === 0) &&
        !filters.search &&
        !filters.includedIds
    );
}
