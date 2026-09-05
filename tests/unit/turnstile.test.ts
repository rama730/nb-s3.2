import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyTurnstileToken, isTurnstileServerConfigured } from '@/lib/security/turnstile';

test('Turnstile Server Validation Suite', async (t) => {
    const originalSecret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;

    t.afterEach(() => {
        if (originalSecret === undefined) {
            delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
        } else {
            process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = originalSecret;
        }
    });

    await t.test('bypasses when secret key is unset in dev/test', async () => {
        delete process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
        delete process.env.TURNSTILE_SECRET_KEY;

        assert.equal(isTurnstileServerConfigured(), false);
        const result = await verifyTurnstileToken({ token: 'test-token', ip: '127.0.0.1' });
        assert.equal(result.success, true);
        assert.equal(result.bypassed, true);
    });

    await t.test('returns error when token is empty and secret key is set', async () => {
        process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = '0x4AAAAAAABBBBBBCCCCCC';
        assert.equal(isTurnstileServerConfigured(), true);

        const result = await verifyTurnstileToken({ token: '', ip: '127.0.0.1' });
        assert.equal(result.success, false);
        assert.match(result.error || '', /required/i);
    });

    await t.test('verifies token successfully against siteverify endpoint', async () => {
        process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = '0x4AAAAAAABBBBBBCCCCCC';
        const originalFetch = global.fetch;
        global.fetch = (async () => {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    success: true,
                    action: 'signup',
                }),
            } as unknown as Response;
        }) as typeof global.fetch;

        try {
            const result = await verifyTurnstileToken({
                token: 'valid-token',
                ip: '127.0.0.1',
                expectedAction: 'signup',
            });
            assert.equal(result.success, true);
            assert.equal(result.degraded, undefined);
        } finally {
            global.fetch = originalFetch;
        }
    });

    await t.test('fails when action mismatch occurs', async () => {
        process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = '0x4AAAAAAABBBBBBCCCCCC';
        const originalFetch = global.fetch;
        global.fetch = (async () => {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    success: true,
                    action: 'login',
                }),
            } as unknown as Response;
        }) as typeof global.fetch;

        try {
            const result = await verifyTurnstileToken({
                token: 'valid-token',
                ip: '127.0.0.1',
                expectedAction: 'signup',
            });
            assert.equal(result.success, false);
            assert.match(result.error || '', /action mismatch/i);
        } finally {
            global.fetch = originalFetch;
        }
    });

    await t.test('degrades gracefully to fail-open when siteverify throws network timeout', async () => {
        process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY = '0x4AAAAAAABBBBBBCCCCCC';
        const originalFetch = global.fetch;
        global.fetch = (async () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            throw err;
        }) as typeof global.fetch;

        try {
            const result = await verifyTurnstileToken({
                token: 'valid-token',
                ip: '127.0.0.1',
                expectedAction: 'signup',
            });
            assert.equal(result.success, true);
            assert.equal(result.degraded, true);
        } finally {
            global.fetch = originalFetch;
        }
    });
});
