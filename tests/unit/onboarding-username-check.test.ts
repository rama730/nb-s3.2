import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOnboardingRateLimitKeys } from '@/lib/onboarding/username-check'

test('buildOnboardingRateLimitKeys composes deterministic keys', () => {
    const keys = buildOnboardingRateLimitKeys({
        viewerKey: 'user-1',
        normalizedUsername: 'builder_42',
        ipAddress: '203.0.113.10',
        userAgent: 'Mozilla/5.0 Test',
    })

    assert.equal(keys.user, 'onboarding:username-check:user:user-1')
    assert.equal(keys.ip, 'onboarding:username-check:ip:203.0.113.10')
    assert.equal(keys.fingerprint, 'onboarding:username-check:fingerprint:203.0.113.10:mozilla/5.0 test')
    assert.equal(keys.target, 'onboarding:username-check:target:builder_42')
})
