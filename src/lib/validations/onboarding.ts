import { z } from 'zod'
import { normalizeUsername, validateUsername } from '@/lib/validations/username'

const MAX_HEADLINE_CHARS = 120
const MAX_BIO_CHARS = 500
const MAX_LOCATION_CHARS = 120
const MAX_WEBSITE_CHARS = 200
const MAX_AVATAR_DATAURL_LENGTH = 700_000
const MAX_TAG_ITEMS = 25
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

const websiteSchema = z
    .string()
    .trim()
    .max(MAX_WEBSITE_CHARS)
    .optional()
    .nullable()
    .transform((value) => {
        const normalized = (value || '').trim()
        return normalized.length > 0 ? normalized : undefined
    })
    .refine((value) => {
        if (!value) return true
        try {
            const parsed = new URL(value)
            return parsed.protocol === 'http:' || parsed.protocol === 'https:'
        } catch {
            return false
        }
    }, 'Website must be a valid http(s) URL')

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
    visibility: z.enum(['public', 'connections', 'private']).optional().default('public'),
})

export type OnboardingPayloadInput = z.input<typeof onboardingPayloadSchema>
export type OnboardingPayload = z.output<typeof onboardingPayloadSchema>

export function normalizeOnboardingPayload(input: OnboardingPayloadInput): OnboardingPayload {
    return onboardingPayloadSchema.parse(input)
}
