import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveAuthPageErrorMessage } from '@/lib/auth/error-messages'

describe('auth error messages', () => {
    it('maps callback exchange failures to a visible login-page message', () => {
        assert.match(
            resolveAuthPageErrorMessage('auth-code-error') || '',
            /sign-in could not be completed/i,
        )
    })

    it('returns null for unknown auth page error codes', () => {
        assert.equal(resolveAuthPageErrorMessage('unexpected-error'), null)
        assert.equal(resolveAuthPageErrorMessage(null), null)
    })
})
