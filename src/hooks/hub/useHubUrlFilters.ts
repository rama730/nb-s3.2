'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { FILTER_VIEWS, PROJECT_STATUS, PROJECT_TYPE, SORT_OPTIONS, FilterView, ProjectStatus, ProjectType, SortOption } from '@/constants/hub';

interface UrlFilters {
    q: string;
    view: FilterView;
    status: ProjectStatus;
    type: ProjectType;
    sort: SortOption;
    tech: string[];
    hideOpened: boolean;
}

export function useHubUrlFilters() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const urlFilters: UrlFilters = useMemo(() => ({
        q: searchParams.get('q') || '',
        view: (searchParams.get('view') as FilterView) || FILTER_VIEWS.ALL,
        status: (searchParams.get('status') as ProjectStatus) || PROJECT_STATUS.ALL,
        type: (searchParams.get('type') as ProjectType) || PROJECT_TYPE.ALL,
        sort: (searchParams.get('sort') as SortOption) || SORT_OPTIONS.NEWEST,
        tech: searchParams.get('tech')?.split(',').filter(Boolean) || [],
        hideOpened: searchParams.get('hideOpened') === 'true',
    }), [searchParams]);

    const updateUrlFilters = useCallback((newFilters: Partial<UrlFilters>) => {
        const params = new URLSearchParams(searchParams.toString());

        Object.entries(newFilters).forEach(([key, value]) => {
            if (
                value === undefined ||
                value === '' ||
                value === FILTER_VIEWS.ALL ||
                value === PROJECT_STATUS.ALL ||
                value === PROJECT_TYPE.ALL ||
                value === SORT_OPTIONS.NEWEST ||
                (Array.isArray(value) && value.length === 0) ||
                (key === 'hideOpened' && value === false)
            ) {
                params.delete(key);
            } else if (Array.isArray(value)) {
                params.set(key, value.join(','));
            } else {
                params.set(key, String(value));
            }
        });

        const queryString = params.toString();
        router.push(`${pathname}${queryString ? `?${queryString}` : ''}`, { scroll: false });
    }, [searchParams, router, pathname]);

    const clearFilters = useCallback(() => {
        router.push(pathname, { scroll: false });
    }, [router, pathname]);

    const hasActiveFilters = useMemo(() => {
        return !!(
            urlFilters.q ||
            urlFilters.view !== FILTER_VIEWS.ALL ||
            urlFilters.status !== PROJECT_STATUS.ALL ||
            urlFilters.type !== PROJECT_TYPE.ALL ||
            urlFilters.sort !== SORT_OPTIONS.NEWEST ||
            urlFilters.tech.length > 0 ||
            urlFilters.hideOpened
        );
    }, [urlFilters]);

    return {
        urlFilters,
        updateUrlFilters,
        clearFilters,
        hasActiveFilters,
    };
}
