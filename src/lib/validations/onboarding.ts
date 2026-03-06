import { z } from 'zod'
import {
    ONBOARDING_AVAILABILITY_VALUES,
    ONBOARDING_EXPERIENCE_LEVEL_VALUES,
    ONBOARDING_GENDER_VALUES,
    ONBOARDING_HOURS_PER_WEEK_VALUES,
    ONBOARDING_MESSAGE_PRIVACY_VALUES,
    ONBOARDING_SOCIAL_KEYS,
    ONBOARDING_VISIBILITY_VALUES,
} from '@/lib/onboarding/contracts'
import { normalizeUsername, validateUsername } from '@/lib/validations/username'

const MAX_HEADLINE_CHARS = 120
const MAX_BIO_CHARS = 500
const MAX_LOCATION_CHARS = 120
const MAX_WEBSITE_CHARS = 200
const MAX_SOCIAL_URL_CHARS = 200
const MAX_PRONOUNS_CHARS = 60
const MAX_AVATAR_DATAURL_LENGTH = 700_000
const MAX_TAG_ITEMS = 25
const MAX_OPEN_TO_ITEMS = 12
const MAX_TAG_ITEM_CHARS = 32

const nonEmptyTrimmed = (min: number, max: number) =>
    z
        .string()
        .trim()
        .min(min)
        .max(max)

const optionalTrimmed = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .optional()
        .nullable()
        .transform((value) => {
            const normalized = (value || '').trim()
            return normalized.length > 0 ? normalized : undefined
        })

const normalizeOptionalUrl = (value: string | null | undefined) => {
    const normalized = (value || '').trim()
    if (!normalized) return undefined
    if (/^https?:\/\//i.test(normalized)) return normalized
    return `https://${normalized}`
}

const optionalHttpUrlSchema = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .optional()
        .nullable()
        .transform((value) => normalizeOptionalUrl(value))
        .refine((value) => {
            if (!value) return true
            try {
                const parsed = new URL(value)
                return parsed.protocol === 'http:' || parsed.protocol === 'https:'
            } catch {
                return false
            }
        }, 'Must be a valid http(s) URL')

const websiteSchema = optionalHttpUrlSchema(MAX_WEBSITE_CHARS)

const socialLinksSchema = z
    .object(
        Object.fromEntries(
            ONBOARDING_SOCIAL_KEYS.map((key) => [key, optionalHttpUrlSchema(MAX_SOCIAL_URL_CHARS)])
        ) as Record<(typeof ONBOARDING_SOCIAL_KEYS)[number], ReturnType<typeof optionalHttpUrlSchema>>
    )
    .optional()
    .transform((value) => {
        const source = value || {}
        const cleaned: Record<string, string> = {}
        for (const [key, raw] of Object.entries(source)) {
            if (typeof raw !== 'string' || !raw) continue
            cleaned[key] = raw
        }
        return cleaned
    })

const tagItemSchema = z
    .string()
    .trim()
    .min(1)
    .max(MAX_TAG_ITEM_CHARS)

const dedupeNormalized = (items: string[]) => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const item of items) {
        const normalized = item.trim()
        if (!normalized) continue
        const key = normalized.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        result.push(normalized)
    }
    return result
}

const openToSchema = z
    .array(tagItemSchema)
    .transform(dedupeNormalized)
    .refine((items) => items.length <= MAX_OPEN_TO_ITEMS, {
        message: `Open-to must have ${MAX_OPEN_TO_ITEMS} items or fewer`,
    })
    .optional()
    .default([])

const availabilityStatusSchema = z.enum(ONBOARDING_AVAILABILITY_VALUES)
const messagePrivacySchema = z.enum(ONBOARDING_MESSAGE_PRIVACY_VALUES)
const experienceLevelSchema = z.enum(ONBOARDING_EXPERIENCE_LEVEL_VALUES)
const hoursPerWeekSchema = z.enum(ONBOARDING_HOURS_PER_WEEK_VALUES)
const genderIdentitySchema = z.enum(ONBOARDING_GENDER_VALUES)

const pronounsSchema = z
    .string()
    .trim()
    .max(MAX_PRONOUNS_CHARS)
    .optional()
    .nullable()
    .transform((value) => {
        const normalized = (value || '').trim()
        return normalized.length > 0 ? normalized : undefined
    })

const avatarUrlSchema = z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((value) => {
        const normalized = (value || '').trim()
        return normalized.length > 0 ? normalized : undefined
    })
    .refine((value) => {
        if (!value) return true
        if (value.startsWith('data:image/')) return true
        try {
            const parsed = new URL(value)
            return parsed.protocol === 'http:' || parsed.protocol === 'https:'
        } catch {
            return false
        }
    }, 'Avatar must be a data URL or valid http(s) URL')
    .refine((value) => {
        if (!value) return true
        if (!value.startsWith('data:image/')) return true
        return value.length <= MAX_AVATAR_DATAURL_LENGTH
    }, `Avatar data URL is too large (max ${MAX_AVATAR_DATAURL_LENGTH} characters)`)

export const onboardingPayloadSchema = z.object({
    username: z
        .string()
        .trim()
        .transform((value) => normalizeUsername(value))
        .refine((value) => validateUsername(value).valid, {
            message: 'Invalid username',
        }),
    fullName: nonEmptyTrimmed(2, 80),
    avatarUrl: avatarUrlSchema,
    headline: optionalTrimmed(MAX_HEADLINE_CHARS),
    bio: optionalTrimmed(MAX_BIO_CHARS),
    location: optionalTrimmed(MAX_LOCATION_CHARS),
    website: websiteSchema,
    skills: z
        .array(tagItemSchema)
        .transform(dedupeNormalized)
        .refine((items) => items.length <= MAX_TAG_ITEMS, {
            message: `Skills must have ${MAX_TAG_ITEMS} items or fewer`,
        })
        .optional()
        .default([]),
    interests: z
        .array(tagItemSchema)
        .transform(dedupeNormalized)
        .refine((items) => items.length <= MAX_TAG_ITEMS, {
            message: `Interests must have ${MAX_TAG_ITEMS} items or fewer`,
        })
        .optional()
        .default([]),
    openTo: openToSchema,
    availabilityStatus: availabilityStatusSchema.optional().default('available'),
    messagePrivacy: messagePrivacySchema.optional().default('connections'),
    socialLinks: socialLinksSchema,
    experienceLevel: experienceLevelSchema.optional(),
    hoursPerWeek: hoursPerWeekSchema.optional(),
    genderIdentity: genderIdentitySchema.optional(),
    pronouns: pronounsSchema,
    visibility: z.enum(ONBOARDING_VISIBILITY_VALUES).optional().default('public'),
})

export type OnboardingPayloadInput = z.input<typeof onboardingPayloadSchema>
export type OnboardingPayload = z.output<typeof onboardingPayloadSchema>

export function normalizeOnboardingPayload(input: OnboardingPayloadInput): OnboardingPayload {
    return onboardingPayloadSchema.parse(input)
}
