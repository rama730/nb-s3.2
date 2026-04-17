import { timingSafeEqual } from 'node:crypto'

import { pingDb } from '@/lib/db'
import { consumeRateLimitForRoute } from '@/lib/security/rate-limit'
import { getRequestId, jsonSuccess, jsonError, logApiRoute } from '@/app/api/v1/_shared'
import { getRedisClient } from '@/lib/redis'
import { getTrustedRequestIp } from '@/lib/security/request-ip'

export const dynamic = 'force-dynamic'

const HEALTH_PROBE_HEADER = 'x-probe-secret'

/**
 * SEC-H1: the public health endpoint returns only `{ status: 'ok' }` or a 503
 * envelope. Internal monitors that need the component breakdown (db, redis,
 * redisConfigured) must present the shared secret in `x-probe-secret`. We
 * compare with `timingSafeEqual` so the validity of the header isn't leaked
 * by early-returning on length or first mismatching byte.
 */
function isAuthenticatedProbe(request: Request): boolean {
    const configured = (process.env.HEALTH_PROBE_SECRET || '').trim()
    if (!configured) return false
    const provided = request.headers.get(HEALTH_PROBE_HEADER)?.trim() || ''
    if (!provided || provided.length !== configured.length) return false
    try {
        return timingSafeEqual(Buffer.from(provided), Buffer.from(configured))
    } catch {
        return false
    }
}

export async function GET(request: Request) {
    const startedAt = Date.now()
    const requestId = getRequestId(request)
    const ip = getTrustedRequestIp(request) ?? 'unknown'
    const { allowed } = await consumeRateLimitForRoute('health', `health:${ip}`, 60, 60)
    if (!allowed) {
        logApiRoute(request, {
            requestId,
            action: 'health.get',
            startedAt,
            status: 429,
            success: false,
            errorCode: 'RATE_LIMITED',
        })
        return jsonError('Rate limit exceeded', 429, 'RATE_LIMITED')
    }

    const { searchParams } = new URL(request.url)
    const probe = (searchParams.get('probe') || 'liveness').toLowerCase()
    const detailed = isAuthenticatedProbe(request)
    const dbOk = await pingDb()

    if (probe !== 'readiness') {
        if (!dbOk) {
            logApiRoute(request, {
                requestId,
                action: 'health.get',
                startedAt,
                status: 503,
                success: false,
                errorCode: 'DB_UNAVAILABLE',
            })
            return jsonError(
                detailed ? 'Database unavailable' : 'unavailable',
                503,
                detailed ? 'DB_UNAVAILABLE' : 'UNAVAILABLE',
            )
        }
        return jsonSuccess(
            detailed
                ? { status: 'ok', probe: 'liveness', db: dbOk }
                : { status: 'ok' },
        )
    }

    const redisConfigured = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
    const requireRedisForReadiness = process.env.NODE_ENV === 'production' || redisConfigured
    let redisOk = false
    const redis = getRedisClient()
    if (redis) {
        try {
            const pong = await redis.ping()
            redisOk = pong === 'PONG'
        } catch {
            redisOk = false
        }
    } else {
        redisOk = !requireRedisForReadiness
    }

    // TODO: Add an explicit Inngest health check when one is available.
    const healthy = dbOk && redisOk
    if (!healthy) {
        logApiRoute(request, {
            requestId,
            action: 'health.get',
            startedAt,
            status: 503,
            success: false,
            errorCode: 'READINESS_DEGRADED',
        })
        return jsonError(
            detailed ? 'Service degraded' : 'unavailable',
            503,
            detailed ? 'READINESS_DEGRADED' : 'UNAVAILABLE',
        )
    }
    return jsonSuccess(
        detailed
            ? {
                status: 'ok',
                probe: 'readiness',
                db: dbOk,
                redis: redisOk,
                redisConfigured,
            }
            : { status: 'ok' },
    )
}
