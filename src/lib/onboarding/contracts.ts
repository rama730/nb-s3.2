export const ONBOARDING_TOTAL_STEPS = 4 as const

export const ONBOARDING_VISIBILITY_VALUES = ['public', 'connections', 'private'] as const
export type OnboardingVisibility = typeof ONBOARDING_VISIBILITY_VALUES[number]

export const ONBOARDING_AVAILABILITY_VALUES = ['available', 'busy', 'offline', 'focusing'] as const
export type OnboardingAvailabilityStatus = typeof ONBOARDING_AVAILABILITY_VALUES[number]

export const ONBOARDING_MESSAGE_PRIVACY_VALUES = ['everyone', 'connections'] as const
export type OnboardingMessagePrivacy = typeof ONBOARDING_MESSAGE_PRIVACY_VALUES[number]

export const ONBOARDING_EXPERIENCE_LEVEL_VALUES = ['student', 'junior', 'mid', 'senior', 'lead', 'founder'] as const
export type OnboardingExperienceLevel = typeof ONBOARDING_EXPERIENCE_LEVEL_VALUES[number]

export const ONBOARDING_HOURS_PER_WEEK_VALUES = ['lt_5', 'h_5_10', 'h_10_20', 'h_20_40', 'h_40_plus'] as const
export type OnboardingHoursPerWeek = typeof ONBOARDING_HOURS_PER_WEEK_VALUES[number]

export const ONBOARDING_GENDER_VALUES = ['male', 'female', 'non_binary', 'prefer_not_to_say', 'other'] as const
export type OnboardingGenderIdentity = typeof ONBOARDING_GENDER_VALUES[number]

export const ONBOARDING_SOCIAL_KEYS = ['github', 'linkedin', 'x', 'portfolio'] as const
export type OnboardingSocialLinkKey = typeof ONBOARDING_SOCIAL_KEYS[number]
export type OnboardingSocialLinks = Partial<Record<OnboardingSocialLinkKey, string>>

export type OnboardingPayloadContract = {
    username: string
    fullName: string
    avatarUrl?: string
    headline?: string
    bio?: string
    location?: string
    website?: string
    skills: string[]
    interests: string[]
    openTo: string[]
    availabilityStatus: OnboardingAvailabilityStatus
    messagePrivacy: OnboardingMessagePrivacy
    socialLinks: OnboardingSocialLinks
    experienceLevel?: OnboardingExperienceLevel
    hoursPerWeek?: OnboardingHoursPerWeek
    genderIdentity?: OnboardingGenderIdentity
    pronouns?: string
    visibility: OnboardingVisibility
}
