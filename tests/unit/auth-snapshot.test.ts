import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { before, describe, it } from 'node:test'

type AuthSnapshotModule = typeof import('../../src/lib/auth/snapshot')

function encodeBase64Url(value: string) {
    return Buffer.from(value, 'utf8').toString('base64url')
}

function createSignedToken(payload: Record<string, unknown>, secret: string) {
    const header = { alg: 'HS256', typ: 'JWT' }
    const encodedHeader = encodeBase64Url(JSON.stringify(header))
    const encodedPayload = encodeBase64Url(JSON.stringify(payload))
    const signature = createHmac('sha256', secret)
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest('base64url')
    return `${encodedHeader}.${encodedPayload}.${signature}`
}

describe('auth snapshot helpers', () => {
    let mod: AuthSnapshotModule

    before(async () => {
        process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret'
        mod = await import('../../src/lib/auth/snapshot')
    })

    it('verifies HS256 access tokens locally', async () => {
        const nowSeconds = Math.floor(Date.now() / 1000)
        const token = createSignedToken({
            sub: 'user-123',
            email: 'user@example.com',
            email_confirmed_at: '2026-03-12T10:00:00.000Z',
            session_id: 'session-123',
            role: 'authenticated',
            iat: nowSeconds,
            exp: nowSeconds + 60,
            app_metadata: { role: 'member', roles: ['member', 'builder'] },
            user_metadata: { username: 'edge-user', onboarded: true },
        }, process.env.SUPABASE_JWT_SECRET as string)

        const claims = await mod.verifySupabaseAccessToken(token)
        const snapshot = mod.buildAuthSnapshotFromClaims(claims)

        assert.ok(snapshot)
        assert.equal(snapshot?.userId, 'user-123')
        assert.equal(snapshot?.sessionId, 'session-123')
        assert.equal(snapshot?.email, 'user@example.com')
        assert.equal(snapshot?.emailVerified, true)
        assert.equal(snapshot?.onboardingComplete, true)
        assert.deepEqual(snapshot?.roles, ['authenticated', 'member', 'builder'])
    })

    it('builds a user object from an auth snapshot', () => {
        const user = mod.buildUserFromSnapshot({
            userId: 'user-456',
            sessionId: 'session-456',
            onboardingComplete: false,
            emailVerified: true,
            issuedAt: 1_700_000_000,
            expiresAt: 1_700_000_600,
            roles: ['authenticated'],
            email: 'another@example.com',
            appMetadata: { role: 'authenticated' },
            userMetadata: { username: 'another-user' },
        })

        assert.equal(user.id, 'user-456')
        assert.equal(user.email, 'another@example.com')
        assert.equal(user.user_metadata.username, 'another-user')
        assert.equal(user.app_metadata.role, 'authenticated')
    })
})
