import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

describe('logger', () => {
    let originalEnv: string | undefined
    let captured: string[] = []

    const capture = (...args: unknown[]) => {
        captured.push(args.map(String).join(' '))
    }

    beforeEach(() => {
        originalEnv = process.env.NODE_ENV
        captured = []
    })

    afterEach(() => {
        ;(process.env as Record<string, string | undefined>).NODE_ENV = originalEnv
    })

    it('exports debug, info, warn, error, metric methods', async () => {
        const { logger } = await import('../../src/lib/logger')
        assert.equal(typeof logger.debug, 'function')
        assert.equal(typeof logger.info, 'function')
        assert.equal(typeof logger.warn, 'function')
        assert.equal(typeof logger.error, 'function')
        assert.equal(typeof logger.metric, 'function')
    })

    it('does not throw when called without context', async () => {
        const { logger } = await import('../../src/lib/logger')
        assert.doesNotThrow(() => logger.info('test'))
        assert.doesNotThrow(() => logger.error('oops'))
        assert.doesNotThrow(() => logger.debug('debug msg'))
        assert.doesNotThrow(() => logger.warn('warning'))
    })

    it('does not throw when called with context', async () => {
        const { logger } = await import('../../src/lib/logger')
        assert.doesNotThrow(() =>
            logger.info('test', { module: 'test', userId: 'u1' })
        )
    })

    it('metric accepts a payload', async () => {
        const { logger } = await import('../../src/lib/logger')
        assert.doesNotThrow(() =>
            logger.metric('files.save.latency_ms', { value: 42, projectId: 'p1' })
        )
    })
})
