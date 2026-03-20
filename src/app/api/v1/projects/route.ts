import { jsonError, jsonSuccess } from '@/app/api/v1/_envelope'
import { consumeRateLimitForRoute } from '@/lib/security/rate-limit'
import { decodePublicProjectsCursor } from '@/lib/projects/public-feed'
import {
    getPublicProjectsFeedPage,
    PUBLIC_PROJECTS_FEED_DEFAULT_LIMIT,
    PUBLIC_PROJECTS_FEED_MAX_LIMIT,
    readPublicProjectsFeedCache,
} from '@/lib/projects/public-feed-service'
import { consumeRouteClassLoadShedding } from '@/lib/routing/load-shedding'
import { logger } from '@/lib/logger'

function getRequestId(request: Request) {
    const fromHeader = request.headers.get('x-request-id')?.trim()
    return fromHeader && fromHeader.length > 0 ? fromHeader : crypto.randomUUID()
}

function getRequestPath(request: Request) {
    try {
        return new URL(request.url).pathname
    } catch {
        return '/api/v1/projects'
    }
}

function getRequestIp(request: Request) {
    return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

function parsePositiveInt(value: string | null, fallback: number) {
    if (value === null || value.trim() === '') return { ok: true as const, value: fallback }
    if (!/^\d+$/.test(value)) return { ok: false as const, value: fallback }
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return { ok: false as const, value: fallback }
    return { ok: true as const, value: parsed }
}

function cacheHeaders(state: 'fresh' | 'stale') {
    if (state === 'stale') {
        return {
            'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=300',
            'X-Cache-State': 'stale',
        }
    }

    return {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        'X-Cache-State': 'fresh',
    }
}

function logProjectsRequest(
    request: Request,
    params: {
        requestId: string
        startedAt: number
        status: number
        success: boolean
        source: string
        cacheState?: 'fresh' | 'stale' | 'miss'
        errorCode?: string
    },
) {
    logger.info('api.v1.projects.request', {
        requestId: params.requestId,
        route: getRequestPath(request),
        action: 'projects.get',
        durationMs: Date.now() - params.startedAt,
        status: params.status,
        success: params.success,
        source: params.source,
        cacheState: params.cacheState ?? null,
        errorCode: params.errorCode ?? null,
        sampleRate: params.success ? 0.02 : 1,
    })
}

export async function GET(request: Request) {
    const startedAt = Date.now()
    const requestId = getRequestId(request)
    const { searchParams } = new URL(request.url)
    const parsedLimit = parsePositiveInt(searchParams.get('limit'), PUBLIC_PROJECTS_FEED_DEFAULT_LIMIT)
    const cursor = decodePublicProjectsCursor(searchParams.get('cursor'))

    if (!parsedLimit.ok) {
        logProjectsRequest(request, {
            requestId,
            startedAt,
            status: 400,
            success: false,
            source: 'request',
            errorCode: 'BAD_REQUEST',
        })
        return jsonError('Invalid pagination parameters', 400, 'BAD_REQUEST')
    }

    const limit = Math.min(Math.max(1, parsedLimit.value), PUBLIC_PROJECTS_FEED_MAX_LIMIT)
    const cached = await readPublicProjectsFeedCache(limit, cursor)
    const freshCache = cached.fresh
    const staleCache = cached.stale
    const loadShedding = await consumeRouteClassLoadShedding('public_cached')

    if (!loadShedding.allowed) {
        if (staleCache) {
            logProjectsRequest(request, {
                requestId,
                startedAt,
                status: 200,
                success: true,
                source: 'redis',
                cacheState: 'stale',
            })
            return jsonSuccess(
                {
                    projects: staleCache.value.projects,
                    nextCursor: staleCache.value.nextCursor,
                    source: 'redis-stale',
                },
                undefined,
                {
                    headers: {
                        ...cacheHeaders('stale'),
                        'X-Request-Id': requestId,
                    },
                },
            )
        }

        logProjectsRequest(request, {
            requestId,
            startedAt,
            status: 503,
            success: false,
            source: 'load-shed',
            cacheState: 'miss',
            errorCode: 'INTERNAL_ERROR',
        })
        return jsonError('Feed temporarily unavailable', 503, 'INTERNAL_ERROR')
    }

    const rateLimitKey = `api:v1:projects:get:${getRequestIp(request)}`
    const rateLimit = await consumeRateLimitForRoute('publicRead', rateLimitKey, 180, 60)

    if (freshCache) {
        logProjectsRequest(request, {
            requestId,
            startedAt,
            status: 200,
            success: true,
            source: 'redis',
            cacheState: 'fresh',
        })
        return jsonSuccess(
            {
                projects: freshCache.value.projects,
                nextCursor: freshCache.value.nextCursor,
                source: 'redis',
            },
            undefined,
            {
                headers: {
                    ...cacheHeaders('fresh'),
                    'X-Request-Id': requestId,
                },
            },
        )
    }

    if (!rateLimit.allowed) {
        if (rateLimit.degraded && staleCache) {
            logProjectsRequest(request, {
                requestId,
                startedAt,
                status: 200,
                success: true,
                source: 'redis',
                cacheState: 'stale',
            })
            return jsonSuccess(
                {
                    projects: staleCache.value.projects,
                    nextCursor: staleCache.value.nextCursor,
                    source: 'redis-stale',
                },
                undefined,
                {
                    headers: {
                        ...cacheHeaders('stale'),
                        'X-Request-Id': requestId,
                    },
                },
            )
        }

        const status = rateLimit.degraded ? 503 : 429
        logProjectsRequest(request, {
            requestId,
            startedAt,
            status,
            success: false,
            source: 'rate-limit',
            cacheState: 'miss',
            errorCode: rateLimit.degraded ? 'SERVICE_UNAVAILABLE' : 'RATE_LIMITED',
        })
        return jsonError(
            rateLimit.degraded ? 'Feed temporarily unavailable' : 'Rate limit exceeded',
            status,
            rateLimit.degraded ? 'INTERNAL_ERROR' : 'RATE_LIMITED',
        )
    }

    try {
        const payload = await getPublicProjectsFeedPage(limit, cursor)

        logProjectsRequest(request, {
            requestId,
            startedAt,
            status: 200,
            success: true,
            source: payload.source,
            cacheState: payload.cacheState,
        })
        return jsonSuccess(
            {
                projects: payload.projects,
                nextCursor: payload.nextCursor,
                source: payload.source,
            },
            undefined,
            {
                headers: {
                    ...cacheHeaders(payload.cacheState === 'stale' ? 'stale' : 'fresh'),
                    'X-Request-Id': requestId,
                },
            },
        )
    } catch (error) {
        if (staleCache) {
            logger.warn('api.v1.projects.origin_failed_serving_stale', {
                requestId,
                route: getRequestPath(request),
                error: error instanceof Error ? error.message : String(error),
            })
            logProjectsRequest(request, {
                requestId,
                startedAt,
                status: 200,
                success: true,
                source: 'redis',
                cacheState: 'stale',
            })
            return jsonSuccess(
                {
                    projects: staleCache.value.projects,
                    nextCursor: staleCache.value.nextCursor,
                    source: 'redis-stale',
                },
                undefined,
                {
                    headers: {
                        ...cacheHeaders('stale'),
                        'X-Request-Id': requestId,
                    },
                },
            )
        }

        logger.error('api.v1.projects.error', {
            requestId,
            route: getRequestPath(request),
            errorMessage: error instanceof Error ? error.message : String(error),
        })
        logProjectsRequest(request, {
            requestId,
            startedAt,
            status: 503,
            success: false,
            source: 'database',
            cacheState: 'miss',
            errorCode: 'INTERNAL_ERROR',
        })
        return jsonError('Feed temporarily unavailable', 503, 'INTERNAL_ERROR')
    }
}
