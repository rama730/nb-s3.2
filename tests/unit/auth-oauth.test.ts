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
            continueBrowserOAuthRedirect({ data: null, error: null })
            continueBrowserOAuthRedirect(null)

            assert.deepEqual(assigned, [])
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

    it('skips navigation when a relative redirect resolves to the current url', () => {
        const originalWindow = globalThis.window
        const assigned: string[] = []

        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                location: {
                    href: 'http://localhost:3000/auth/callback?next=%2Fhub',
                    assign: (url: string) => {
                        assigned.push(url)
                    },
                },
            },
        })

        try {
            continueBrowserOAuthRedirect({
                data: { url: '/auth/callback?next=%2Fhub' },
                error: null,
            })

            assert.deepEqual(assigned, [])
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

    it('skips navigation when the only difference is a single trailing slash', () => {
        const originalWindow = globalThis.window
        const assigned: string[] = []

        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                location: {
                    href: 'http://localhost:3000/auth/callback/?next=%2Fhub',
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

            assert.deepEqual(assigned, [])
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

    it('skips navigation for unsafe protocols', () => {
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
                data: { url: 'javascript:alert(1)' },
                error: null,
            })
            continueBrowserOAuthRedirect({
                data: { url: 'data:text/html,hi' },
                error: null,
            })

            assert.deepEqual(assigned, [])
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

    it('skips navigation for untrusted cross-origin redirects', () => {
        const originalWindow = globalThis.window
        const originalTrustedOrigins = process.env.NEXT_PUBLIC_TRUSTED_OAUTH_REDIRECT_ORIGINS
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

        delete process.env.NEXT_PUBLIC_TRUSTED_OAUTH_REDIRECT_ORIGINS

        try {
            continueBrowserOAuthRedirect({
                data: { url: 'https://evil.example/auth/callback' },
                error: null,
            })

            assert.deepEqual(assigned, [])
        } finally {
            if (originalTrustedOrigins === undefined) {
                delete process.env.NEXT_PUBLIC_TRUSTED_OAUTH_REDIRECT_ORIGINS
            } else {
                process.env.NEXT_PUBLIC_TRUSTED_OAUTH_REDIRECT_ORIGINS = originalTrustedOrigins
            }

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
})
