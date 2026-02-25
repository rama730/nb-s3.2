import { NextResponse } from 'next/server'
import { pingDb } from '@/lib/db'
import { consumeRateLimit } from '@/lib/security/rate-limit'
import { getEnv } from '@/lib/env'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const { allowed } = await consumeRateLimit(`health:${ip}`, 60, 60)
    if (!allowed) {
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
    }

    const dbOk = await pingDb()

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
    return NextResponse.json(
        { status: healthy ? 'ok' : 'degraded', db: dbOk, redis: redisOk },
        { status: healthy ? 200 : 503 },
    )
}
