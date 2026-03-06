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
        openTo: ['Freelance', 'freelance', 'Mentorship'],
        socialLinks: {
            github: 'github.com/builder',
            portfolio: 'https://builder.dev',
        },
        pronouns: '  they/them  ',
        visibility: 'public',
    })

    assert.equal(payload.username, 'builder_42')
    assert.equal(payload.fullName, 'Builder User')
    assert.deepEqual(payload.skills, ['React', 'TypeScript'])
    assert.deepEqual(payload.interests, ['AI', 'Open Source'])
    assert.deepEqual(payload.openTo, ['Freelance', 'Mentorship'])
    assert.equal(payload.socialLinks.github, 'https://github.com/builder')
    assert.equal(payload.pronouns, 'they/them')
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
