import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOnboardingPayload } from '@/lib/validations/onboarding'

test('normalizeOnboardingPayload sanitizes optional fields and dedupes tags', () => {
    const payload = normalizeOnboardingPayload({
        username: 'Builder_42',
        fullName: '  Builder User  ',
        headline: '  Full Stack Developer  ',
        bio: '  Building useful products.  ',
        location: '  San Francisco  ',
        website: 'https://example.com',
        skills: ['React', 'react', 'TypeScript'],
        interests: ['AI', 'ai', 'Open Source'],
        visibility: 'public',
    })

    assert.equal(payload.username, 'builder_42')
    assert.equal(payload.fullName, 'Builder User')
    assert.deepEqual(payload.skills, ['React', 'TypeScript'])
    assert.deepEqual(payload.interests, ['AI', 'Open Source'])
})

test('normalizeOnboardingPayload rejects invalid website protocol', () => {
    assert.throws(() =>
        normalizeOnboardingPayload({
            username: 'builder_42',
            fullName: 'Builder User',
            website: 'javascript:alert(1)',
            visibility: 'public',
        })
    )
})
