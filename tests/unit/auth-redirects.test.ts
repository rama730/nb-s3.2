import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
    buildAuthPageHref,
    buildOAuthRedirectTo,
    normalizeAuthNextPath,
    resolveAuthBaseUrl,
} from '@/lib/auth/redirects'

describe('auth redirects', () => {
    it('requires configured canonical base in production runtime', () => {
        const previousNodeEnv = process.env.NODE_ENV
        const previousAppUrl = process.env.APP_URL
        const previousPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL
        try {
            Reflect.set(process.env, 'NODE_ENV', 'production')
            Reflect.deleteProperty(process.env, 'APP_URL')
            Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_APP_URL')
            assert.throws(() => resolveAuthBaseUrl({ appUrl: null, publicAppUrl: null }), {
                message: /missing APP_URL\/NEXT_PUBLIC_APP_URL/i,
            })
        } finally {
            Reflect.set(process.env, 'NODE_ENV', previousNodeEnv)
            if (previousAppUrl === undefined) Reflect.deleteProperty(process.env, 'APP_URL')
            else Reflect.set(process.env, 'APP_URL', previousAppUrl)
            if (previousPublicAppUrl === undefined) Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_APP_URL')
            else Reflect.set(process.env, 'NEXT_PUBLIC_APP_URL', previousPublicAppUrl)
        }
    })

    it('normalizes valid internal next paths', () => {
        assert.equal(normalizeAuthNextPath('/hub'), '/hub')
        assert.equal(normalizeAuthNextPath('/projects/abc?tab=files'), '/projects/abc?tab=files')
    })

    it('rejects malformed or external next paths', () => {
        assert.equal(normalizeAuthNextPath('https://evil.example/steal'), '/hub')
        assert.equal(normalizeAuthNextPath('//evil.example/steal'), '/hub')
        assert.equal(normalizeAuthNextPath('hub'), '/hub')
        assert.equal(normalizeAuthNextPath('/auth/callback'), '/hub')
    })

    it('resolves canonical auth base URL using APP_URL precedence', () => {
        const previousNodeEnv = process.env.NODE_ENV
        try {
            Reflect.set(process.env, 'NODE_ENV', 'production')
            const baseUrl = resolveAuthBaseUrl({
                appUrl: 'https://app.example.com',
                publicAppUrl: 'https://public.example.com',
                requestUrl: 'https://request.example.com/path',
                browserOrigin: 'https://browser.example.com',
            })
            assert.equal(baseUrl, 'https://app.example.com')
        } finally {
            Reflect.set(process.env, 'NODE_ENV', previousNodeEnv)
        }
    })

    it('falls back to the active request origin in non-production runtimes', () => {
        const baseUrl = resolveAuthBaseUrl({
            requestUrl: 'http://0.0.0.0:3000/login?x=1',
        })
        assert.equal(baseUrl, 'http://0.0.0.0:3000')
    })

    it('keeps the active browser origin for local development oauth flows', () => {
        const previousNodeEnv = process.env.NODE_ENV
        try {
            Reflect.set(process.env, 'NODE_ENV', 'development')
            const baseUrl = resolveAuthBaseUrl({
                appUrl: 'http://localhost:3000',
                browserOrigin: 'http://127.0.0.1:3000',
            })
            assert.equal(baseUrl, 'http://127.0.0.1:3000')
        } finally {
            Reflect.set(process.env, 'NODE_ENV', previousNodeEnv)
        }
    })

    it('builds oauth callback redirect URL with normalized next path', () => {
        const redirectTo = buildOAuthRedirectTo('https://app.example.com', 'https://evil.example')
        assert.equal(
            redirectTo,
            'https://app.example.com/auth/callback?next=%2Fhub',
        )
    })

    it('includes request id in oauth callback redirect URL when provided', () => {
        const redirectTo = buildOAuthRedirectTo('https://app.example.com', '/hub', 'req-123')
        assert.equal(
            redirectTo,
            'https://app.example.com/auth/callback?next=%2Fhub&rid=req-123',
        )
    })

    it('includes provider in oauth callback redirect URL when provided', () => {
        const redirectTo = buildOAuthRedirectTo('https://app.example.com', '/hub', 'req-123', 'github')
        assert.equal(
            redirectTo,
            'https://app.example.com/auth/callback?next=%2Fhub&rid=req-123&provider=github',
        )
    })

    it('preserves local development host aliases in oauth callback URLs', () => {
        const redirectTo = buildOAuthRedirectTo('http://127.0.0.1:3000', '/hub', 'req-456')
        assert.equal(
            redirectTo,
            'http://127.0.0.1:3000/auth/callback?next=%2Fhub&rid=req-456',
        )
    })

    it('builds auth page href from normalized redirect path', () => {
        assert.equal(buildAuthPageHref('/signup', '/hub'), '/signup')
        assert.equal(
            buildAuthPageHref('/login', '/projects/a?tab=files'),
            '/login?redirect=%2Fprojects%2Fa%3Ftab%3Dfiles',
        )
    })
})
