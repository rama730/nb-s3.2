import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeRateLimit } from '@/lib/security/rate-limit';

const ORIGINAL_ENV = { ...process.env };

test.afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
});

test('consumeRateLimit uses local fallback in best-effort mode when Redis is unavailable', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.RATE_LIMIT_MODE = 'best-effort';

    const first = await consumeRateLimit('unit-best-effort', 2, 60);
    const second = await consumeRateLimit('unit-best-effort', 2, 60);
    const third = await consumeRateLimit('unit-best-effort', 2, 60);

    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(third.allowed, false);
});

test('consumeRateLimit fails closed in distributed-only mode when Redis is unavailable', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.RATE_LIMIT_MODE = 'distributed-only';

    const result = await consumeRateLimit('unit-distributed-only', 5, 60);
    assert.equal(result.allowed, false);
    assert.equal(result.count, 0);
    assert.equal(result.limit, 5);
});
