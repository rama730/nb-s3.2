import { ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding/contracts'
import { ONBOARDING_STEP2_SECTIONS, type OnboardingStep2SectionId } from '@/lib/onboarding/config'

export const ONBOARDING_SCHEMA_VERSION = 3
export const ONBOARDING_LOCAL_DRAFT_TTL_MS = 24 * 60 * 60 * 1000

export type OnboardingStatus = 'not_started' | 'in_progress' | 'completed'

export type OnboardingProgress = {
    step: number
    completedThrough: number
    activeSection: OnboardingStep2SectionId
    version: number
    schemaVersion: number
}

export function clampOnboardingStep(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 1
    return Math.min(ONBOARDING_TOTAL_STEPS, Math.max(1, Math.floor(value)))
}

export function clampCompletedThrough(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0
    return Math.min(ONBOARDING_TOTAL_STEPS, Math.max(0, Math.floor(value)))
}

export function normalizeOnboardingSection(value: unknown): OnboardingStep2SectionId {
    if (typeof value === 'string') {
        const section = ONBOARDING_STEP2_SECTIONS.find((candidate) => candidate.id === value)
        if (section) return section.id
    }
    return ONBOARDING_STEP2_SECTIONS[0].id
}

export function onboardingStorageKeys(userId: string) {
    const scope = userId.trim()
    return {
        draft: `onboarding:${scope}:draft:v${ONBOARDING_SCHEMA_VERSION}`,
        submit: `onboarding:${scope}:submit-key:v2`,
    }
}

export function isCompletedOnboardingStatus(value: unknown, legacyUsername?: string | null): boolean {
    if (value === 'completed') return true
    if (value === 'not_started' || value === 'in_progress') return false
    return Boolean(legacyUsername?.trim())
}
