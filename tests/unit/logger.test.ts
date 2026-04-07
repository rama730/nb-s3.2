import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

describe('logger', () => {
    let originalEnv: string | undefined
    let originalVerboseEnv: string | undefined
    let capturedInfo: string[] = []
    let capturedWarn: string[] = []
    let capturedError: string[] = []
    let capturedDebug: string[] = []
    let originalConsoleInfo: typeof console.info
    let originalConsoleWarn: typeof console.warn
    let originalConsoleError: typeof console.error
    let originalConsoleDebug: typeof console.debug

    const importFreshLogger = async (suffix: string) => {
        const url = new URL('../../src/lib/logger.ts', import.meta.url)
        url.searchParams.set('case', suffix)
        return import(url.href)
    }

    beforeEach(() => {
        originalEnv = process.env.NODE_ENV
        originalVerboseEnv = process.env.VERBOSE_APP_LOGS
        capturedInfo = []
        capturedWarn = []
        capturedError = []
        capturedDebug = []
        originalConsoleInfo = console.info
        originalConsoleWarn = console.warn
        originalConsoleError = console.error
        originalConsoleDebug = console.debug
        console.info = (...args: unknown[]) => {
            capturedInfo.push(args.map(String).join(' '))
        }
        console.warn = (...args: unknown[]) => {
            capturedWarn.push(args.map(String).join(' '))
        }
        console.error = (...args: unknown[]) => {
            capturedError.push(args.map(String).join(' '))
        }
        console.debug = (...args: unknown[]) => {
            capturedDebug.push(args.map(String).join(' '))
        }
    })

    afterEach(() => {
        ;(process.env as Record<string, string | undefined>).NODE_ENV = originalEnv
        ;(process.env as Record<string, string | undefined>).VERBOSE_APP_LOGS = originalVerboseEnv
        console.info = originalConsoleInfo
        console.warn = originalConsoleWarn
        console.error = originalConsoleError
        console.debug = originalConsoleDebug
    })

    it('exports debug, info, warn, error, metric methods', async () => {
        const { logger } = await importFreshLogger('exports')
        assert.equal(typeof logger.debug, 'function')
        assert.equal(typeof logger.info, 'function')
        assert.equal(typeof logger.warn, 'function')
        assert.equal(typeof logger.error, 'function')
        assert.equal(typeof logger.metric, 'function')
    })

    it('does not throw when called without context', async () => {
        const { logger } = await importFreshLogger('no-context')
        assert.doesNotThrow(() => logger.info('test'))
        assert.doesNotThrow(() => logger.error('oops'))
        assert.doesNotThrow(() => logger.debug('debug msg'))
        assert.doesNotThrow(() => logger.warn('warning'))
    })

    it('does not throw when called with context', async () => {
        const { logger } = await importFreshLogger('with-context')
        assert.doesNotThrow(() =>
            logger.info('test', { module: 'test', userId: 'u1' })
        )
    })

    it('metric accepts a payload', async () => {
        const { logger } = await importFreshLogger('metric')
        assert.doesNotThrow(() =>
            logger.metric('files.save.latency_ms', { value: 42, projectId: 'p1' })
        )
    })

    it('suppresses info-level console noise by default', async () => {
        ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
        delete (process.env as Record<string, string | undefined>).VERBOSE_APP_LOGS

        const { logger } = await importFreshLogger('quiet-default')
        logger.info('test')
        logger.debug('debug')
        logger.metric('files.save.latency_ms', { value: 42 })
        logger.warn('warned')
        logger.error('failed')

        assert.equal(capturedInfo.length, 0)
        assert.equal(capturedDebug.length, 0)
        assert.equal(capturedWarn.length, 1)
        assert.equal(capturedError.length, 1)
    })

    it('enables info and debug console logs when verbose mode is set', async () => {
        ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
        ;(process.env as Record<string, string | undefined>).VERBOSE_APP_LOGS = '1'

        const { logger } = await importFreshLogger('verbose-dev')
        logger.info('test')
        logger.debug('debug')

        assert.equal(capturedInfo.length, 1)
        assert.equal(capturedDebug.length, 1)
    })
})
