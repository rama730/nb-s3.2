export const runtime = 'edge';

import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope';
import { fetchWithBoundedRetry } from '@/app/api/v1/_shared';
import { cacheData, getCachedData } from '@/lib/redis';
import { logger } from '@/lib/logger';

const EDGE_BUCKETS_MAX = 5_000;
const CLEANUP_INTERVAL_MS = 10_000;
const edgeRateBuckets = new Map<string, { count: number; resetAt: number }>();
let lastCleanup = 0;

function checkEdgeRateLimit(ip: string, limit: number, windowMs: number): boolean {
    const now = Date.now();

    if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
        lastCleanup = now;
        for (const [key, b] of edgeRateBuckets) {
            if (b.resetAt <= now) edgeRateBuckets.delete(key);
        }
        if (edgeRateBuckets.size > EDGE_BUCKETS_MAX) {
            const excess = edgeRateBuckets.size - EDGE_BUCKETS_MAX;
            const iter = edgeRateBuckets.keys();
            for (let i = 0; i < excess; i++) {
                const key = iter.next().value;
                if (key) edgeRateBuckets.delete(key);
            }
        }
    }

    const bucket = edgeRateBuckets.get(ip);
    if (!bucket || bucket.resetAt <= now) {
        edgeRateBuckets.set(ip, { count: 1, resetAt: now + windowMs });
        return true;
    }
    bucket.count += 1;
    return bucket.count <= limit;
}

const DEFAULT_PAGE = 0;
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const MAX_PAGE = 10_000;

function getRequestId(request: Request) {
    const fromHeader = request.headers.get('x-request-id')?.trim();
    return fromHeader && fromHeader.length > 0 ? fromHeader : crypto.randomUUID();
}

function getRequestPath(request: Request) {
    try {
        return new URL(request.url).pathname;
    } catch {
        return '/api/v1/projects';
    }
}

function logProjectsRequest(
    request: Request,
    params: {
        requestId: string;
        startedAt: number;
        status: number;
        success: boolean;
        errorCode?: string;
        errorMessage?: string;
        errorStack?: string;
    },
) {
    const durationMs = Date.now() - params.startedAt;
    logger.info('api.v1.request', {
        requestId: params.requestId,
        route: getRequestPath(request),
        action: 'projects.get',
        durationMs,
        status: params.status,
        success: params.success,
        errorCode: params.errorCode ?? null,
        errorMessage: params.errorMessage ?? null,
        errorStack: params.errorStack ?? null,
    });
    logger.metric('api.latency', {
        requestId: params.requestId,
        route: getRequestPath(request),
        action: 'projects.get',
        durationMs,
        status: params.status,
        success: params.success,
    });
}

function parseNonNegativeInt(value: string | null, fallback: number) {
    if (value === null || value.trim() === '') return { ok: true as const, value: fallback };
    if (!/^\d+$/.test(value)) return { ok: false as const };
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return { ok: false as const };
    return { ok: true as const, value: parsed };
}

export async function GET(request: Request) {
    const startedAt = Date.now();
    const requestId = getRequestId(request);
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!checkEdgeRateLimit(ip, 100, 60_000)) {
        logProjectsRequest(request, {
            requestId,
            startedAt,
            status: 429,
            success: false,
            errorCode: 'RATE_LIMITED',
        });
        return jsonError('Rate limit exceeded', 429, 'RATE_LIMITED');
    }

    const { searchParams } = new URL(request.url);

    const parsedPage = parseNonNegativeInt(searchParams.get('page'), DEFAULT_PAGE);
    const parsedLimit = parseNonNegativeInt(searchParams.get('limit'), DEFAULT_LIMIT);

    if (!parsedPage.ok || !parsedLimit.ok) {
        logProjectsRequest(request, {
            requestId,
            startedAt,
            status: 400,
            success: false,
            errorCode: 'BAD_REQUEST',
        });
        return jsonError('Invalid pagination parameters', 400, 'BAD_REQUEST');
    }
    if (parsedLimit.value === 0) {
        logProjectsRequest(request, {
            requestId,
            startedAt,
            status: 400,
            success: false,
            errorCode: 'BAD_REQUEST',
        });
        return jsonError('Limit must be at least 1', 400, 'BAD_REQUEST');
    }

    const page = Math.min(parsedPage.value, MAX_PAGE);
    const limit = Math.min(parsedLimit.value, MAX_LIMIT);

    // Construct cache key based on params
    const cacheKey = `projects:public:page:${page}:limit:${limit}`;

    // 1. Try Redis Cache
    try {
        const cached = await getCachedData(cacheKey);
        if (cached) {
            logger.metric('cache.hit_rate', {
                requestId,
                route: getRequestPath(request),
                cache: 'redis',
                key: 'projects.public',
                hit: true,
            });
            logProjectsRequest(request, {
                requestId,
                startedAt,
                status: 200,
                success: true,
            });
            return jsonSuccess(
                {
                    projects: cached,
                    source: 'redis-edge-cache',
                },
                undefined,
                {
                headers: {
                    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
                    'X-Edge-Region': 'global'
                }
                },
            );
        }
        logger.metric('cache.hit_rate', {
            requestId,
            route: getRequestPath(request),
            cache: 'redis',
            key: 'projects.public',
            hit: false,
        });
    } catch (error) {
        console.warn('Projects cache read failed, continuing without cache', error);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    const missingEnvVars: string[] = [];
    if (!supabaseUrl) missingEnvVars.push('NEXT_PUBLIC_SUPABASE_URL');
    if (!supabaseKey) missingEnvVars.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    if (missingEnvVars.length > 0) {
        logger.error('api.v1.projects.config_missing', {
            requestId,
            route: getRequestPath(request),
            action: 'projects.get',
            missingEnvVars,
        });
        logProjectsRequest(request, {
            requestId,
            startedAt,
            status: 500,
            success: false,
            errorCode: 'INTERNAL_ERROR',
        });
        return jsonError(
            'Server configuration error',
            500,
            'INTERNAL_ERROR',
        );
    }
    const validatedSupabaseUrl = supabaseUrl as string;
    const validatedSupabaseKey = supabaseKey as string;
    const selectColumns = [
        'id',
        'slug',
        'title',
        'description',
        'status',
        'visibility',
        'owner_id',
        'view_count',
        'followers_count',
        'saves_count',
        'cover_image',
        'created_at',
        'updated_at',
        'profiles:owner_id(id,username,full_name,avatar_url)'
    ].join(',');

    try {
        const response = await fetchWithBoundedRetry(
            `${validatedSupabaseUrl}/rest/v1/projects?select=${selectColumns}&visibility=eq.public&order=created_at.desc,id.desc&limit=${limit}&offset=${page * limit}`,
            {
                headers: {
                    'apikey': validatedSupabaseKey,
                    'Authorization': `Bearer ${validatedSupabaseKey}`
                },
                timeoutMs: 4_000,
                maxAttempts: 2,
            }
        );

        if (!response.ok) {
            const bodyText = await response.text().catch(() => '');
            throw new Error(`Supabase fetch failed (${response.status}): ${bodyText.slice(0, 300)}`);
        }

        const data = await response.json();

        // 3. Cache Result
        try {
            await cacheData(cacheKey, data, 60); // Cache for 60s
        } catch (error) {
            console.warn('Projects cache write failed, continuing without cache', error);
        }

        logProjectsRequest(request, {
            requestId,
            startedAt,
            status: 200,
            success: true,
        });
        return jsonSuccess(
            {
                projects: data,
                source: 'database',
            },
            undefined,
            {
            headers: {
                'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
                'X-Edge-Region': 'global'
            }
            },
        );
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorStack = err instanceof Error ? err.stack : undefined;
        logger.error('api.v1.projects.error', {
            requestId,
            route: getRequestPath(request),
            action: 'projects.get',
            errorMessage,
            errorStack: errorStack ?? null,
        });
        logProjectsRequest(request, {
            requestId,
            startedAt,
            status: 500,
            success: false,
            errorCode: 'INTERNAL_ERROR',
            errorMessage,
            errorStack,
        });
        return jsonError('Internal Server Error', 500, 'INTERNAL_ERROR');
    }
}
