import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyAuthLookupError, toAuthErrorMessage } from '@/lib/auth/session-lookup'

describe('auth session lookup error classification', () => {
    it('classifies timeout errors', () => {
        const kind = classifyAuthLookupError(new Error('middleware auth lookup timed out after 4000ms'))
        assert.equal(kind, 'timeout')
    })

    it('classifies invalid token errors by status', () => {
        const kind = classifyAuthLookupError({ status: 401, message: 'Unauthorized' })
        assert.equal(kind, 'invalid_token')
    })

    it('classifies invalid token errors by known message markers', () => {
        const kind = classifyAuthLookupError(new Error('refresh_token_not_found'))
        assert.equal(kind, 'invalid_token')
    })

    it('classifies unknown errors as transient', () => {
        const kind = classifyAuthLookupError(new Error('network fetch failed'))
        assert.equal(kind, 'transient')
    })

    it('extracts human readable error messages', () => {
        assert.equal(toAuthErrorMessage('oops'), 'oops')
        assert.equal(toAuthErrorMessage({ message: 'bad request' }), 'bad request')
    })
})
