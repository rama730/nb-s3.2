import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'

// Ensure test mode - no Redis connection
;(process.env as Record<string, string | undefined>).NODE_ENV = 'test'
;(process.env as Record<string, string | undefined>).RATE_LIMIT_MODE = 'best-effort'
delete process.env.UPSTASH_REDIS_REST_URL
delete process.env.UPSTASH_REDIS_REST_TOKEN

let consumeRateLimit: (key: string, limit: number, windowSeconds: number) => Promise<{
    allowed: boolean
    count: number
    limit: number
    resetAt: number
}>

describe('consumeRateLimit (local fallback)', () => {
    before(async () => {
        ;({ consumeRateLimit } = await import('../../src/lib/security/rate-limit'))
    })

    it('allows requests within the limit', async () => {
        const key = `test-allow-${Date.now()}`
        const result = await consumeRateLimit(key, 5, 60)
        assert.equal(result.allowed, true)
        assert.equal(result.count, 1)
        assert.equal(result.limit, 5)
    })

    it('blocks requests exceeding the limit', async () => {
        const key = `test-block-${Date.now()}`
        for (let i = 0; i < 5; i++) {
            await consumeRateLimit(key, 5, 60)
        }
        const result = await consumeRateLimit(key, 5, 60)
        assert.equal(result.allowed, false)
        assert.equal(result.count, 6)
    })

    it('resets after window expires', async () => {
        const key = `test-reset-${Date.now()}`
        const result1 = await consumeRateLimit(key, 2, 1)
        assert.equal(result1.allowed, true)

        await consumeRateLimit(key, 2, 1)
        const result2 = await consumeRateLimit(key, 2, 1)
        assert.equal(result2.allowed, false)

        await new Promise((r) => setTimeout(r, 1100))
        const result3 = await consumeRateLimit(key, 2, 1)
        assert.equal(result3.allowed, true)
        assert.equal(result3.count, 1)
    })

    it('tracks different keys independently', async () => {
        const keyA = `test-indep-a-${Date.now()}`
        const keyB = `test-indep-b-${Date.now()}`

        await consumeRateLimit(keyA, 1, 60)
        const resultA = await consumeRateLimit(keyA, 1, 60)
        assert.equal(resultA.allowed, false)

        const resultB = await consumeRateLimit(keyB, 1, 60)
        assert.equal(resultB.allowed, true)
    })
})
