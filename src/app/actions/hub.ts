'use server';

import { FILTER_VIEWS, type FilterView } from '@/constants/hub';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { getHubProjects, InvalidHubCursorError } from '@/lib/data/hub';
import { getCachedData, cacheData } from '@/lib/redis';
import { HUB_RANKING_SCHEMA_VERSION } from '@/lib/hub/ranking-config';
import { buildHubSnapshotKey } from '@/lib/hub/snapshot-cache';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { HubFilters } from '@/types/hub';
import { headers } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { runInFlightDeduped } from '@/lib/utils/inflight-dedupe';
import { getTrustedHeadersIp } from '@/lib/security/request-ip';
import { normalizeSearchQuery, tokenizeSearchQuery } from '@/lib/search/query';
import { recordGlobalSearchMetric } from '@/lib/search/observability';
import { z } from 'zod';

const hubSearchInputSchema = z.object({
    filters: z.object({
        status: z.string().trim().min(1).max(40),
        type: z.string().trim().min(1).max(60),
        tech: z.array(z.string().trim().min(1).max(100)).max(20),
        sort: z.string().trim().min(1).max(40),
        search: z.string().max(200).optional(),
        includedIds: z.array(z.string().trim().min(1).max(100)).max(200).optional(),
        hideOpened: z.boolean().optional(),
    }).strict(),
    cursor: z.string().max(1_000).optional(),
    limit: z.number().int().min(1).max(60),
    view: z.enum(['all', 'trending', 'recommendations', 'my_projects', 'following']),
    surface: z.enum(['full', 'preview']),
}).strict();

export async function fetchHubProjectsAction(
    filters: HubFilters,
    cursor?: string,
    limit: number = 24,
    view: FilterView = FILTER_VIEWS.ALL,
    surface: 'full' | 'preview' = 'full',
) {
    const startedAt = performance.now();
    const validation = hubSearchInputSchema.safeParse({ filters, cursor, limit, view, surface });
    if (!validation.success) {
        return {
            success: false as const,
            schemaVersion: HUB_RANKING_SCHEMA_VERSION,
            projects: [],
            hasMore: false,
            code: 'VALIDATION' as const,
            error: 'Invalid project search request',
        };
    }
    ({ filters, cursor, limit, view, surface } = validation.data);
    const normalizedSearch = normalizeSearchQuery(filters.search);
    const recordPreview = (outcome: 'success' | 'empty' | 'rate-limited' | 'error', resultCount: number) => {
        if (surface !== 'preview' || !normalizedSearch) return;
        recordGlobalSearchMetric({
            domain: 'hub',
            scope: view,
            outcome,
            durationMs: performance.now() - startedAt,
            resultCount,
            queryLength: normalizedSearch.length,
            tokenCount: tokenizeSearchQuery(normalizedSearch).length,
        });
    };

    try {
        const { user } = await getViewerAuthContext();
        const headerStore = await headers();
        const ipAddress = getTrustedHeadersIp(headerStore) ?? 'unknown';
        const viewerKey = user?.id || `anon:${ipAddress}`;

        if (normalizedSearch.length > 0) {
            const searchLimit = await consumeRateLimit(`hub-search:${viewerKey}`, 90, 60);
            if (!searchLimit.allowed) {
                recordPreview('rate-limited', 0);
                return {
                    success: false as const,
                    projects: [],
                    hasMore: false,
                    schemaVersion: HUB_RANKING_SCHEMA_VERSION,
                    code: 'RATE_LIMITED' as const,
                    retryAfterMs: 1_000,
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
            includedIds: filters.includedIds?.length
                ? Array.from(new Set(filters.includedIds)).sort()
                : undefined,
            hideOpened: filters.hideOpened || false,
        };

        const shouldUseAnonEdgeCache = !user && !normalizedCursor;

        if (shouldUseAnonEdgeCache) {
            const getCachedAnonymousHubPage = unstable_cache(
                async () => getHubProjects(normalizedFilters, undefined, normalizedLimit, {
                    view: normalizedView,
                    viewerId: null,
                    surface,
                }),
                ['hub-anon', JSON.stringify({ normalizedFilters, normalizedLimit, normalizedView, surface })],
                { revalidate: 45 },
            );

            const result = await getCachedAnonymousHubPage();
            recordPreview(result.projects.length > 0 ? 'success' : 'empty', result.projects.length);
            return {
                success: true as const,
                ...result,
            };
        }

        const cacheKey = surface === 'preview' && normalizedSearch && !normalizedCursor
            ? `search:preview:hub:${viewerKey}:${buildHubSnapshotKey({ normalizedFilters, normalizedView, normalizedLimit })}`
            : null;

        if (cacheKey) {
            const cached = await getCachedData<any>(cacheKey);
            if (cached) {
                recordPreview('success', cached.projects.length);
                return {
                    success: true as const,
                    projects: cached.projects as Awaited<ReturnType<typeof getHubProjects>>['projects'],
                    nextCursor: cached.nextCursor as Awaited<ReturnType<typeof getHubProjects>>['nextCursor'],
                    hasMore: cached.hasMore as boolean,
                    schemaVersion: cached.schemaVersion as string | number,
                };
            }
        }

        const dedupeKey = [
            'hub:projects',
            user?.id ?? `anon:${ipAddress}`,
            normalizedView,
            normalizedLimit,
            normalizedCursor ?? '',
            surface,
            JSON.stringify(normalizedFilters),
        ].join(':');

        return await runInFlightDeduped(dedupeKey, async () => {
            const result = await getHubProjects(normalizedFilters, normalizedCursor, normalizedLimit, {
                view: normalizedView,
                viewerId: user?.id ?? null,
                surface,
            });

            recordPreview(result.projects.length > 0 ? 'success' : 'empty', result.projects.length);

            const response = {
                projects: result.projects,
                nextCursor: result.nextCursor,
                hasMore: result.hasMore,
                schemaVersion: result.schemaVersion,
            };

            if (cacheKey && result && result.projects.length > 0) {
                await cacheData(cacheKey, response, 180);
            }

            return {
                success: true as const,
                ...response,
            };
        });
    } catch (error) {
        recordPreview('error', 0);
        if (error instanceof InvalidHubCursorError) {
            return {
                success: false as const,
                schemaVersion: HUB_RANKING_SCHEMA_VERSION,
                projects: [],
                hasMore: false,
                code: 'VALIDATION' as const,
                error: error.message,
            };
        }
        console.error('Error fetching hub projects:', error);
        return {
            success: false as const,
            schemaVersion: HUB_RANKING_SCHEMA_VERSION,
            projects: [],
            hasMore: false,
            code: 'TRANSIENT' as const,
            error: 'Failed to fetch projects'
        };
    }
}
