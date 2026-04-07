import { pingDb } from '@/lib/db'
import { consumeRateLimitForRoute } from '@/lib/security/rate-limit'
import { getRequestId, jsonSuccess, jsonError, logApiRoute } from '@/app/api/v1/_shared'
import { getRedisClient } from '@/lib/redis'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    const startedAt = Date.now()
    const requestId = getRequestId(request)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
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
    const dbOk = await pingDb()
    if (probe !== 'readiness') {
        const status = dbOk ? 200 : 503
        if (!dbOk) {
            logApiRoute(request, {
                requestId,
                action: 'health.get',
                startedAt,
                status,
                success: false,
                errorCode: 'DB_UNAVAILABLE',
            })
            return jsonError('Database unavailable', status, 'DB_UNAVAILABLE')
        }
        return jsonSuccess({ status: 'ok', probe: 'liveness', db: dbOk })
    }

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
        redisOk = true // Redis not configured — not a failure
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
        return jsonError('Service degraded', 503, 'READINESS_DEGRADED')
    }
    return jsonSuccess({ status: 'ok', probe: 'readiness', db: dbOk, redis: redisOk })
}
