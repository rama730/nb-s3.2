'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Project, HubFilters } from '@/types/hub';
import { fetchHubProjectsAction } from '@/app/actions/hub';
import { FILTER_VIEWS, SORT_OPTIONS, type FilterView } from '@/constants/hub';
import { queryKeys } from '@/lib/query-keys';
import { mapPublicProjectToHubProject, type PublicProjectsFeedItem } from '@/lib/projects/public-feed';

const PAGE_SIZE = 24;

type PublicProjectsApiResponse = {
    success: true
    data: {
        projects: PublicProjectsFeedItem[]
        nextCursor: string | null
    }
} | {
    success: false
    message?: string
}

function canUsePublicProjectsFeed(filters: HubFilters, view: FilterView) {
    return view === FILTER_VIEWS.ALL
        && (!filters.status || filters.status === 'all')
        && (!filters.type || filters.type === 'all')
        && (!filters.sort || filters.sort === SORT_OPTIONS.NEWEST)
        && (!filters.tech || filters.tech.length === 0)
        && !filters.search
        && !filters.includedIds
}

async function fetchPublicProjectsPage(cursor: string | undefined) {
    const searchParams = new URLSearchParams({
        limit: String(PAGE_SIZE),
    })
    if (cursor) {
        searchParams.set('cursor', cursor)
    }

    const response = await fetch(`/api/v1/projects?${searchParams.toString()}`, {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
            'Accept': 'application/json',
        },
    })
    const payload = await response.json() as PublicProjectsApiResponse

    if (!response.ok || !payload.success) {
        const errorMessage =
            'message' in payload && typeof payload.message === 'string'
                ? payload.message
                : 'Failed to fetch projects'
        throw new Error(errorMessage)
    }

    return {
        projects: payload.data.projects.map(mapPublicProjectToHubProject),
        nextCursor: payload.data.nextCursor || undefined,
        hasMore: Boolean(payload.data.nextCursor),
    }
}

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
        queryKey: queryKeys.hub.projectsSimple(view, filters),
        queryFn: async ({ pageParam = undefined as string | undefined }) => {
            if (canUsePublicProjectsFeed(filters, view)) {
                return fetchPublicProjectsPage(pageParam)
            }

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
        canUsePublicProjectsFeed(filters, FILTER_VIEWS.ALL) &&
        !filters.hideOpened
    );
}
