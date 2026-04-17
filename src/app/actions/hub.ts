'use server';

import { FILTER_VIEWS, type FilterView } from '@/constants/hub';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { getHubProjects } from '@/lib/data/hub';
import { HUB_RANKING_SCHEMA_VERSION } from '@/lib/hub/ranking-config';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { HubFilters } from '@/types/hub';
import { headers } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { runInFlightDeduped } from '@/lib/async/inflight-dedupe';
import { getTrustedHeadersIp } from '@/lib/security/request-ip';

export async function fetchHubProjectsAction(
    filters: HubFilters,
    cursor?: string,
    limit: number = 24,
    view: FilterView = FILTER_VIEWS.ALL,
) {
    try {
        const { user } = await getViewerAuthContext();
        const headerStore = await headers();
        const ipAddress = getTrustedHeadersIp(headerStore) ?? 'unknown';
        const normalizedSearch = (filters.search || '').trim();
        const viewerKey = user?.id || `anon:${ipAddress}`;

        if (normalizedSearch.length > 0) {
            const searchLimit = await consumeRateLimit(`hub-search:${viewerKey}`, 90, 60);
            if (!searchLimit.allowed) {
                return {
                    success: false as const,
                    projects: [],
                    hasMore: false,
                    schemaVersion: HUB_RANKING_SCHEMA_VERSION,
                    error: 'Too many searches. Please wait a moment and try again.',
                };
            }
        }

        const normalizedLimit = Math.max(1, Math.min(limit, 60));
        const normalizedCursor = cursor || undefined;
        const normalizedView = view || FILTER_VIEWS.ALL;
        const normalizedFilters: HubFilters = {
            status: filters.status || 'all',
            type: filters.type || 'all',
            tech: Array.isArray(filters.tech) ? filters.tech : [],
            sort: filters.sort || 'newest',
            search: normalizedSearch || undefined,
            hideOpened: filters.hideOpened || false,
        };

        const shouldUseAnonEdgeCache = !user && !normalizedCursor;

        if (shouldUseAnonEdgeCache) {
            const getCachedAnonymousHubPage = unstable_cache(
                async () => getHubProjects(normalizedFilters, undefined, normalizedLimit, {
                    view: normalizedView,
                    viewerId: null,
                }),
                ['hub-anon', JSON.stringify({ normalizedFilters, normalizedLimit, normalizedView })],
                { revalidate: 45 },
            );

            const result = await getCachedAnonymousHubPage();
            return {
                success: true as const,
                ...result,
            };
        }

        const dedupeKey = [
            'hub:projects',
            user?.id ?? `anon:${ipAddress}`,
            normalizedView,
            normalizedLimit,
            normalizedCursor ?? '',
            JSON.stringify(normalizedFilters),
        ].join(':');

        return await runInFlightDeduped(dedupeKey, async () => {
            const result = await getHubProjects(normalizedFilters, normalizedCursor, normalizedLimit, {
                view: normalizedView,
                viewerId: user?.id ?? null,
            });

            return {
                success: true as const,
                ...result,
            };
        });
    } catch (error) {
        console.error('Error fetching hub projects:', error);
        return {
            success: false as const,
            schemaVersion: HUB_RANKING_SCHEMA_VERSION,
            projects: [],
            hasMore: false,
            error: 'Failed to fetch projects'
        };
    }
}
