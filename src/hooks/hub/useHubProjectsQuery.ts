'use client';

import { useMemo } from 'react';
import { HubFilters } from '@/types/hub';
import { type FilterView } from '@/constants/hub';
import { useHubProjectsSimple } from './useHubProjectsSimple';

interface UseHubProjectsQueryParams {
    filters: HubFilters;
    view: FilterView;
}

export function useHubProjectsQuery({ filters, view }: UseHubProjectsQueryParams) {
    const query = useHubProjectsSimple(filters, view);
    const projects = useMemo(
        () => query.data?.pages.flatMap((page) => page.projects) || [],
        [query.data]
    );

    return {
        ...query,
        projects,
        hasMore: query.hasNextPage,
        loadMore: query.fetchNextPage,
    };
}
