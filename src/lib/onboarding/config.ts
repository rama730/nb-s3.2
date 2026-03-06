import type { OnboardingStepId } from '@/lib/onboarding/events'

export const ONBOARDING_VARIANT = 'default' as const

export const ONBOARDING_FEATURE_FLAGS = {
    enableStep2Sections: true,
    enableCustomOpenTo: true,
    enableProfileStrengthChecklist: true,
} as const

export const ONBOARDING_REQUIRED_FIELDS: Record<OnboardingStepId, readonly string[]> = {
    1: ['username', 'fullName'],
    2: [],
    3: ['skills'],
    4: [],
}

export const ONBOARDING_STEP2_SECTIONS = [
    {
        id: 'identity',
        label: 'Identity',
        description: 'Gender and pronouns',
    },
    {
        id: 'work',
        label: 'Work prefs',
        description: 'Experience, time, open-to, and availability',
    },
    {
        id: 'profile',
        label: 'Profile',
        description: 'Headline, bio, and location',
    },
    {
        id: 'social',
        label: 'Social',
        description: 'Optional social links',
    },
] as const

export type OnboardingStep2SectionId = typeof ONBOARDING_STEP2_SECTIONS[number]['id']
