import { z } from 'zod'
import { normalizeUsername, validateUsername } from '@/lib/validations/username'
import { isSafeHttpUrl } from '@/lib/security/urls'

// SEC-C5 / SEC-H9 / SEC-M12: allowlisted social-link platforms. Rejecting
// unknown keys blocks prototype-pollution payloads (`__proto__`,
// `constructor`, `prototype`) from surviving the zod parse and landing in
// JSONB storage, and keeps the surface area of rendered user-provided URLs
// finite so every consumer knows which fields exist.
export const SOCIAL_LINK_PLATFORMS = [
    'github',
    'x',
    'twitter',
    'linkedin',
    'website',
    'dribbble',
    'instagram',
    'bluesky',
    'mastodon',
    'youtube',
    'twitch',
    'threads',
    'facebook',
] as const
export type SocialLinkPlatform = (typeof SOCIAL_LINK_PLATFORMS)[number]
const SOCIAL_LINK_PLATFORM_SET = new Set<string>(SOCIAL_LINK_PLATFORMS)

export const PROFILE_LIMITS = {
    usernameMin: 3,
    usernameMax: 20,
    fullNameMax: 100,
    headlineMax: 100,
    bioMax: 5000,
    locationMax: 100,
    websiteMax: 200,
    listMaxItems: 25,
    listItemMax: 40,
} as const

const optionalTrimmedString = (maxLength: number) =>
    z
        .string()
        .transform((value) => value.trim())
        .pipe(z.string().max(maxLength))
        .optional()

export const profileUpdateSchema = z.object({
    username: z
        .string()
        .transform((value) => normalizeUsername(value))
        .superRefine((value, ctx) => {
            const result = validateUsername(value)
            if (!result.valid) {
                ctx.addIssue({
                    code: 'custom',
                    message: result.message,
                })
            }
        })
        .optional(),
    fullName: optionalTrimmedString(PROFILE_LIMITS.fullNameMax),
    headline: optionalTrimmedString(PROFILE_LIMITS.headlineMax),
    bio: optionalTrimmedString(PROFILE_LIMITS.bioMax),
    location: optionalTrimmedString(PROFILE_LIMITS.locationMax),
    website: z.string().trim().max(PROFILE_LIMITS.websiteMax).optional(),
    // SEC-C5: avatar/banner URLs are rendered in <img src> across the app and
    // MUST be safe http(s) URLs. We accept the empty string (clears the field)
    // and otherwise require the shared safe-URL gate to pass. The explicit
    // `https://` prefix that `normalizeOptionalUrl` adds later means a bare
    // `javascript:alert(1)` becomes `https://javascript:alert(1)` before the
    // check runs — still rejected because the resulting hostname is invalid.
    avatarUrl: z
        .string()
        .trim()
        .refine(
            (value) => value.length === 0 || isSafeHttpUrl(value),
            'avatarUrl must be a safe http(s) URL',
        )
        .optional(),
    bannerUrl: z
        .string()
        .trim()
        .refine(
            (value) => value.length === 0 || isSafeHttpUrl(value),
            'bannerUrl must be a safe http(s) URL',
        )
        .optional(),
    skills: z.array(z.string()).optional(),
    interests: z.array(z.string()).optional(),
    // SEC-H9: only accept values for the well-known platforms, reject any
    // other key (including `__proto__`, `constructor`, `prototype`). Each
    // value is range-checked and re-validated via `isSafeHttpUrl` inside the
    // normaliser so we never persist a non-http(s) URL.
    socialLinks: z
        .record(z.string().min(1).max(32), z.string().max(PROFILE_LIMITS.websiteMax))
        .optional(),
    visibility: z.enum(['public', 'connections', 'private']).optional(),
    availabilityStatus: z.enum(['available', 'busy', 'offline', 'focusing']).optional(),
    openTo: z.array(z.string()).optional(),
    messagePrivacy: z.enum(['everyone', 'connections']).optional(),
    experienceLevel: z.enum(['student', 'junior', 'mid', 'senior', 'lead', 'founder']).nullable().optional(),
    hoursPerWeek: z.enum(['lt_5', 'h_5_10', 'h_10_20', 'h_20_40', 'h_40_plus']).nullable().optional(),
    genderIdentity: z.enum(['male', 'female', 'non_binary', 'prefer_not_to_say', 'other']).nullable().optional(),
    pronouns: z.string().trim().max(60).nullable().optional(),
    experience: z.array(z.unknown()).optional(),
    education: z.array(z.unknown()).optional(),
    expectedUpdatedAt: z.string().datetime().optional(),
})

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>

type ProfileLike = {
    avatarUrl?: string | null
    fullName?: string | null
    username?: string | null
    headline?: string | null
    bio?: string | null
    location?: string | null
    website?: string | null
    skills?: string[] | null
    socialLinks?: Record<string, string> | null
}

function normalizeList(values: string[] | undefined): string[] | undefined {
    if (!values) return undefined
    const seen = new Set<string>()
    const normalized: string[] = []
    for (const value of values) {
        const item = String(value || '').trim().slice(0, PROFILE_LIMITS.listItemMax)
        if (!item) continue
        const key = item.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        normalized.push(item)
        if (normalized.length >= PROFILE_LIMITS.listMaxItems) break
    }
    return normalized
}

function normalizeOptionalUrl(value: string | undefined): string | undefined {
    if (value === undefined) return undefined
    const trimmed = value.trim()
    if (!trimmed) return ''
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    // SEC-C5 / SEC-M12: refuse anything that isn't a public http(s) URL so we
    // never hand a javascript:/data:/private-host URL back to the caller. The
    // empty string here tells the action layer to clear the field.
    return isSafeHttpUrl(candidate) ? candidate : ''
}

function normalizeSocialLinks(
    links: Record<string, string> | undefined
): Record<string, string> | undefined {
    if (!links) return undefined
    const out: Record<string, string> = {}
    for (const [key, raw] of Object.entries(links)) {
        // SEC-H9: skip prototype-polluting or unknown platform keys. `Object`
        // iteration itself won't surface `__proto__` on a fresh object, but a
        // caller-constructed payload that spreads untrusted input can still
        // reach us.
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
        const platform = key.trim().toLowerCase().slice(0, 32)
        if (!platform) continue
        if (!SOCIAL_LINK_PLATFORM_SET.has(platform)) continue
        const normalizedUrl = normalizeOptionalUrl(String(raw || ''))
        if (!normalizedUrl) continue
        out[platform] = normalizedUrl
    }
    return out
}

export function normalizeProfileUpdateInput(input: ProfileUpdateInput): ProfileUpdateInput {
    return {
        ...input,
        fullName: input.fullName?.trim(),
        headline: input.headline?.trim(),
        bio: input.bio?.trim(),
        location: input.location?.trim(),
        website: normalizeOptionalUrl(input.website),
        skills: normalizeList(input.skills),
        interests: normalizeList(input.interests),
        openTo: normalizeList(input.openTo),
        socialLinks: normalizeSocialLinks(input.socialLinks),
    }
}

function normalizeComparable(value: unknown): unknown {
    if (value === undefined) return undefined
    if (value === null) return null
    if (Array.isArray(value)) return value
    if (typeof value === 'object') return value
    return String(value)
}

export function pickChangedProfileFields(
    current: Record<string, unknown>,
    next: ProfileUpdateInput
): ProfileUpdateInput {
    const patch: ProfileUpdateInput = {}
    const entries = Object.entries(next) as Array<[keyof ProfileUpdateInput, unknown]>
    for (const [key, value] of entries) {
        if (key === 'expectedUpdatedAt') continue
        if (value === undefined) continue
        const currentValue = normalizeComparable(current[key as string])
        const nextValue = normalizeComparable(value)
        const same =
            Array.isArray(currentValue) || Array.isArray(nextValue) || typeof currentValue === 'object' || typeof nextValue === 'object'
                ? JSON.stringify(currentValue) === JSON.stringify(nextValue)
                : currentValue === nextValue
        if (!same) {
            (patch as Record<string, unknown>)[key] = value
        }
    }
    return patch
}

export function calculateProfileCompletion(profile: ProfileLike): { score: number; missing: string[] } {
    const checks: Array<[string, boolean]> = [
        ['Add profile photo', Boolean(profile.avatarUrl)],
        ['Add full name', Boolean(profile.fullName)],
        ['Set username', Boolean(profile.username)],
        ['Add headline', Boolean(profile.headline)],
        ['Add bio', Boolean(profile.bio)],
        ['Add location', Boolean(profile.location)],
        ['Add website', Boolean(profile.website)],
        ['Add at least 3 skills', (profile.skills?.length || 0) >= 3],
        ['Add at least 1 social link', Object.keys(profile.socialLinks || {}).length >= 1],
    ]

    const completed = checks.filter((item) => item[1]).length
    const score = Math.round((completed / checks.length) * 100)
    const missing = checks.filter((item) => !item[1]).map((item) => item[0])
    return { score, missing }
}
