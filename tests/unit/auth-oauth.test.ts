import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { continueBrowserOAuthRedirect } from '@/lib/auth/oauth'

describe('auth oauth helpers', () => {
    it('navigates the browser when oauth returns a redirect url', () => {
        const originalWindow = globalThis.window
        const assigned: string[] = []

        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                location: {
                    href: 'http://localhost:3000/login',
                    assign: (url: string) => {
                        assigned.push(url)
                    },
                },
            },
        })

        try {
            continueBrowserOAuthRedirect({
                data: { url: 'http://localhost:3000/auth/callback?next=%2Fhub' },
                error: null,
            })

            assert.deepEqual(assigned, ['http://localhost:3000/auth/callback?next=%2Fhub'])
        } finally {
            if (originalWindow === undefined) {
                Reflect.deleteProperty(globalThis, 'window')
            } else {
                Object.defineProperty(globalThis, 'window', {
                    configurable: true,
                    value: originalWindow,
                })
            }
        }
    })

    it('skips navigation when the oauth result has no redirect url', () => {
        continueBrowserOAuthRedirect({ data: null, error: null })
        continueBrowserOAuthRedirect(null)
        assert.ok(true)
    })
})
