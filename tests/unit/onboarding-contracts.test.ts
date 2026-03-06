import test from 'node:test'
import assert from 'node:assert/strict'
import {
    ONBOARDING_AVAILABILITY_VALUES,
    ONBOARDING_EXPERIENCE_LEVEL_VALUES,
    ONBOARDING_GENDER_VALUES,
    ONBOARDING_HOURS_PER_WEEK_VALUES,
    ONBOARDING_MESSAGE_PRIVACY_VALUES,
    ONBOARDING_TOTAL_STEPS,
    ONBOARDING_VISIBILITY_VALUES,
} from '@/lib/onboarding/contracts'
import { onboardingEventInputSchema } from '@/lib/onboarding/events'
import { normalizeOnboardingPayload } from '@/lib/validations/onboarding'
import { profileUpdateSchema } from '@/lib/validations/profile'

test('onboarding contracts align with payload schema enums', () => {
    for (const availabilityStatus of ONBOARDING_AVAILABILITY_VALUES) {
        const payload = normalizeOnboardingPayload({
            username: 'contract_user',
            fullName: 'Contract User',
            availabilityStatus,
            visibility: 'public',
        })
        assert.equal(payload.availabilityStatus, availabilityStatus)
    }

    for (const messagePrivacy of ONBOARDING_MESSAGE_PRIVACY_VALUES) {
        const payload = normalizeOnboardingPayload({
            username: 'contract_user',
            fullName: 'Contract User',
            messagePrivacy,
            visibility: 'public',
        })
        assert.equal(payload.messagePrivacy, messagePrivacy)
    }

    for (const experienceLevel of ONBOARDING_EXPERIENCE_LEVEL_VALUES) {
        const payload = normalizeOnboardingPayload({
            username: 'contract_user',
            fullName: 'Contract User',
            experienceLevel,
            visibility: 'public',
        })
        assert.equal(payload.experienceLevel, experienceLevel)
    }

    for (const hoursPerWeek of ONBOARDING_HOURS_PER_WEEK_VALUES) {
        const payload = normalizeOnboardingPayload({
            username: 'contract_user',
            fullName: 'Contract User',
            hoursPerWeek,
            visibility: 'public',
        })
        assert.equal(payload.hoursPerWeek, hoursPerWeek)
    }

    for (const genderIdentity of ONBOARDING_GENDER_VALUES) {
        const payload = normalizeOnboardingPayload({
            username: 'contract_user',
            fullName: 'Contract User',
            genderIdentity,
            visibility: 'public',
        })
        assert.equal(payload.genderIdentity, genderIdentity)
    }

    for (const visibility of ONBOARDING_VISIBILITY_VALUES) {
        const payload = normalizeOnboardingPayload({
            username: 'contract_user',
            fullName: 'Contract User',
            visibility,
        })
        assert.equal(payload.visibility, visibility)
    }
})

test('profile update schema accepts onboarding enum values (db constraint alignment)', () => {
    for (const availabilityStatus of ONBOARDING_AVAILABILITY_VALUES) {
        const result = profileUpdateSchema.safeParse({ availabilityStatus })
        assert.equal(result.success, true)
    }
    for (const messagePrivacy of ONBOARDING_MESSAGE_PRIVACY_VALUES) {
        const result = profileUpdateSchema.safeParse({ messagePrivacy })
        assert.equal(result.success, true)
    }
    for (const experienceLevel of ONBOARDING_EXPERIENCE_LEVEL_VALUES) {
        const result = profileUpdateSchema.safeParse({ experienceLevel })
        assert.equal(result.success, true)
    }
    for (const hoursPerWeek of ONBOARDING_HOURS_PER_WEEK_VALUES) {
        const result = profileUpdateSchema.safeParse({ hoursPerWeek })
        assert.equal(result.success, true)
    }
    for (const genderIdentity of ONBOARDING_GENDER_VALUES) {
        const result = profileUpdateSchema.safeParse({ genderIdentity })
        assert.equal(result.success, true)
    }
})

test('onboarding event schema validates known event types and step constraints', () => {
    const ok = onboardingEventInputSchema.safeParse({
        eventType: 'step_view',
        step: ONBOARDING_TOTAL_STEPS,
        metadata: { durationMs: 42, source: 'test' },
    })
    assert.equal(ok.success, true)

    const badEvent = onboardingEventInputSchema.safeParse({
        eventType: 'custom_event',
        step: 1,
    })
    assert.equal(badEvent.success, false)

    const badStep = onboardingEventInputSchema.safeParse({
        eventType: 'step_view',
        step: ONBOARDING_TOTAL_STEPS + 1,
    })
    assert.equal(badStep.success, false)
})
