import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'

function encodeBase64Url(value: string) {
    return Buffer.from(value, 'utf8').toString('base64url')
}

function createUnsignedToken(payload: Record<string, unknown>) {
    const header = { alg: 'HS256', typ: 'JWT' }
    return [
        encodeBase64Url(JSON.stringify(header)),
        encodeBase64Url(JSON.stringify(payload)),
        encodeBase64Url('signature'),
    ].join('.')
}

describe('auth snapshot remote fallback', () => {
    it('falls back to verified auth-server user lookup when symmetric jwt secret is unavailable', async () => {
        const previousJwtSecret = process.env.SUPABASE_JWT_SECRET
        Reflect.deleteProperty(process.env, 'SUPABASE_JWT_SECRET')

        try {
            const moduleUrl = `${pathToFileURL(path.resolve('src/lib/auth/snapshot.ts')).href}?fallback=${Date.now()}`
            const mod = await import(moduleUrl)
            const nowSeconds = Math.floor(Date.now() / 1000)
            const accessToken = createUnsignedToken({
                sub: 'user-remote-1',
                email: 'remote@example.com',
                session_id: 'session-remote-1',
                role: 'authenticated',
                iat: nowSeconds,
                exp: nowSeconds + 60,
                user_metadata: { username: 'remote-user', onboarded: true },
                app_metadata: { role: 'member' },
            })

            let getUserCalls = 0
            const user = {
                id: 'user-remote-1',
                email: 'remote@example.com',
                email_confirmed_at: '2026-03-12T10:00:00.000Z',
                app_metadata: { role: 'member' },
                user_metadata: { username: 'remote-user', onboarded: true },
            }

            const resolution = await mod.resolveAuthSnapshot({
                auth: {
                    getSession: async () => ({
                        data: {
                            session: {
                                access_token: accessToken,
                                expires_at: nowSeconds + 60,
                            },
                        },
                    }),
                    getUser: async (jwt?: string) => {
                        assert.equal(jwt, accessToken)
                        getUserCalls += 1
                        return {
                            data: { user },
                            error: null,
                        }
                    },
                },
            } as never)

            assert.equal(getUserCalls, 1)
            assert.equal(resolution.error, null)
            assert.equal(resolution.user?.id, 'user-remote-1')
            assert.equal(resolution.snapshot?.emailVerified, true)
            assert.equal(resolution.snapshot?.onboardingComplete, true)
            assert.equal(resolution.snapshot?.sessionId, 'session-remote-1')
        } finally {
            if (previousJwtSecret === undefined) {
                Reflect.deleteProperty(process.env, 'SUPABASE_JWT_SECRET')
            } else {
                Reflect.set(process.env, 'SUPABASE_JWT_SECRET', previousJwtSecret)
            }
        }
    })
})
