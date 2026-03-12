import { NextResponse } from 'next/server'
import { pingDb } from '@/lib/db'
import { consumeRateLimitForRoute } from '@/lib/security/rate-limit'
import { getEnv } from '@/lib/env'
import { getRequestId, logApiRequest } from '@/app/api/_shared'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    const startedAt = Date.now()
    const requestId = getRequestId(request)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const { allowed } = await consumeRateLimitForRoute('health', `health:${ip}`, 60, 60)
    if (!allowed) {
        logApiRequest(request, {
            requestId,
            action: 'health.get',
            startedAt,
            status: 429,
            success: false,
            errorCode: 'RATE_LIMITED',
        })
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    const { searchParams } = new URL(request.url)
    const probe = (searchParams.get('probe') || 'liveness').toLowerCase()
    const dbOk = await pingDb()
    if (probe !== 'readiness') {
        const status = dbOk ? 200 : 503
        const response = NextResponse.json(
            { status: dbOk ? 'ok' : 'degraded', probe: 'liveness', db: dbOk },
            { status },
        )
        if (!dbOk) {
            logApiRequest(request, {
                requestId,
                action: 'health.get',
                startedAt,
                status,
                success: false,
                errorCode: 'DB_UNAVAILABLE',
            })
        }
        return response
    }

    let redisOk = false
    const env = getEnv()
    if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
        try {
            const { Redis } = await import('@upstash/redis')
            const redis = new Redis({
                url: env.UPSTASH_REDIS_REST_URL,
                token: env.UPSTASH_REDIS_REST_TOKEN,
            })
            const pong = await redis.ping()
            redisOk = pong === 'PONG'
        } catch {
            redisOk = false
        }
    } else {
        redisOk = true
    }

    const healthy = dbOk && redisOk
    const status = healthy ? 200 : 503
    const response = NextResponse.json(
        { status: healthy ? 'ok' : 'degraded', probe: 'readiness', db: dbOk, redis: redisOk },
        { status },
    )
    if (!healthy) {
        logApiRequest(request, {
            requestId,
            action: 'health.get',
            startedAt,
            status,
            success: false,
            errorCode: 'READINESS_DEGRADED',
        })
    }
    return response
}
