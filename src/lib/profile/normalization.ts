/**
 * C6: Single source of truth for profile normalization.
 * Handles camelCase (Drizzle) ↔ snake_case (Supabase REST) conversions,
 * form state, server payload, and optimistic update transformations.
 */

import { isSafeHttpUrl } from '@/lib/security/urls';

export const SOCIAL_LINK_PLATFORMS = [
    'github', 'x', 'twitter', 'linkedin', 'website', 'portfolio', 'dribbble',
    'instagram', 'bluesky', 'mastodon', 'youtube', 'twitch', 'threads',
    'facebook', 'other',
] as const;
export type SocialLinkPlatform = (typeof SOCIAL_LINK_PLATFORMS)[number];
const SOCIAL_LINK_PLATFORM_SET = new Set<string>(SOCIAL_LINK_PLATFORMS);

export function normalizeOptionalProfileUrl(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return '';
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return isSafeHttpUrl(candidate) ? candidate : '';
}

export function normalizeSocialLinkRecord(links: Record<string, string> | undefined): Record<string, string> | undefined {
    if (!links) return undefined;
    const out: Record<string, string> = {};
    for (const [key, raw] of Object.entries(links)) {
        const platform = key.trim().toLowerCase().slice(0, 32);
        if (!SOCIAL_LINK_PLATFORM_SET.has(platform)) continue;
        const url = normalizeOptionalProfileUrl(String(raw || ''));
        if (url) out[platform] = url;
    }
    return out;
}

// ── Form State (used by EditProfileModal) ───────────────────────────

export type ProfileFormState = {
    fullName: string;
    username: string;
    headline: string;
    bio: string;
    location: string;
    website: string;
    avatarUrl: string;
    bannerUrl: string;
    openTo: string[];
    experienceLevel: string;
    hoursPerWeek: string;
    skills: string[];
    socialLinks: Record<string, string>;
    experience: unknown[];
    education: unknown[];
    openToCustomRoles: string[];
    preferredCategories: string[];
};

/**
 * Convert a raw profile (either camelCase or snake_case) to form state.
 */
export function toFormState(profile: Record<string, unknown> | null | undefined): ProfileFormState {
    const s = (profile || {}) as Record<string, unknown>;
    return {
        fullName: str(s.fullName ?? s.full_name),
        username: str(s.username),
        headline: str(s.headline),
        bio: str(s.bio),
        location: str(s.location),
        website: str(s.website),
        avatarUrl: str(s.avatarUrl ?? s.avatar_url),
        bannerUrl: str(s.bannerUrl ?? s.banner_url),
        openTo: arr(s.openTo ?? s.open_to),
        experienceLevel: str(s.experienceLevel ?? s.experience_level),
        hoursPerWeek: str(s.hoursPerWeek ?? s.hours_per_week),
        skills: arr(s.skills),
        socialLinks: obj(s.socialLinks ?? s.social_links),
        experience: arr(s.experience),
        education: arr(s.education),
        openToCustomRoles: arr(s.openToCustomRoles ?? s.open_to_custom_roles),
        preferredCategories: arr(s.preferredCategories ?? s.preferred_categories),
    };
}

// ── Server Payload (used by updateProfileAction) ────────────────────

export type ProfileServerPayload = {
    fullName: string;
    username: string;
    headline: string;
    bio: string;
    location: string;
    website: string;
    avatarUrl: string;
    bannerUrl: string;
    skills: string[];
    socialLinks: Record<string, string>;
    openTo: string[];
    experienceLevel: string | null;
    hoursPerWeek: string | null;
    education: unknown[];
    openToCustomRoles: string[];
    preferredCategories: string[];
    expectedUpdatedAt?: string;
};

/**
 * Convert form state to the server action payload format.
 */
export function toServerPayload(
    formState: ProfileFormState,
    expectedUpdatedAt?: string,
): ProfileServerPayload {
    const normalizedExpectedUpdatedAt = (() => {
        if (!expectedUpdatedAt || typeof expectedUpdatedAt !== "string") return undefined;
        const parsed = new Date(expectedUpdatedAt);
        if (!Number.isFinite(parsed.getTime())) return undefined;
        return parsed.toISOString();
    })();

    return {
        fullName: formState.fullName,
        username: formState.username,
        headline: formState.headline,
        bio: formState.bio,
        location: formState.location,
        website: formState.website,
        avatarUrl: formState.avatarUrl,
        bannerUrl: formState.bannerUrl,
        skills: formState.skills,
        socialLinks: formState.socialLinks,
        openTo: formState.openTo,
        experienceLevel: formState.experienceLevel || null,
        hoursPerWeek: formState.hoursPerWeek || null,
        education: formState.education,
        openToCustomRoles: formState.openToCustomRoles || [],
        preferredCategories: formState.preferredCategories || [],
        ...(normalizedExpectedUpdatedAt ? { expectedUpdatedAt: normalizedExpectedUpdatedAt } : {}),
    };
}

// ── Optimistic Update (used by ProfileV2Client) ─────────────────────

const OPTIMISTIC_KEYS = [
    "fullName", "username", "headline", "bio", "location", "website",
    "avatarUrl", "bannerUrl", "skills", "socialLinks",
    "openTo", "experienceLevel", "hoursPerWeek", "education",
    "openToCustomRoles", "preferredCategories",
] as const;

/**
 * Apply a server payload as an optimistic update to a live profile object.
 * Only overwrites fields that are present in `updates`.
 */
export function applyOptimisticUpdate(
    current: Record<string, unknown>,
    updates: Record<string, unknown>,
): Record<string, unknown> {
    const next = { ...current };
    for (const key of OPTIMISTIC_KEYS) {
        if (updates[key] !== undefined) {
            next[key] = updates[key];
        }
    }
    return next;
}

/**
 * Apply a server payload back onto a form-state-shaped base.
 * Used when syncing server response back to local form state.
 */
export function applyPayloadToFormBase(
    base: ProfileFormState,
    payload: Record<string, unknown>,
): ProfileFormState {
    const next = { ...base };
    for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined && k in next) {
            (next as any)[k] = Array.isArray(v) ? arr(v) : (v && typeof v === "object" ? obj(v) : str(v));
        }
    }
    return next;
}

// ── Social Links Normalization (used by ProfileRightRail) ───────────

export type NormalizedSocialLink = { label: string; url: string };

/**
 * Normalize social links from multiple possible formats into a consistent array.
 * Deduplicates by URL, capitalizes labels, and filters non-http(s) URLs.
 */
export function normalizeSocialLinks(
    profile: Record<string, unknown>,
    list?: Array<{ label?: string; url?: string; platform?: string }> | null,
): NormalizedSocialLink[] {
    const out: NormalizedSocialLink[] = [];
    const seen = new Set<string>();

    // SEC-M12: rendering-time defense in depth. The server-side zod schema
    // already passes socialLinks through `isSafeHttpUrl`, but stale rows,
    // legacy imports, and future data sources can sneak unsafe URLs in. Run
    // the same gate here so `<a href={link.url}>` can never render a
    // javascript:/data:/private-host URL.
    const add = (label: string, url: string) => {
        const u = String(url || "").trim();
        if (!u || seen.has(u)) return;
        if (!isSafeHttpUrl(u)) return;
        const l = String(label || "Link").trim();
        const formatted = l.charAt(0).toUpperCase() + l.slice(1);
        seen.add(u);
        out.push({ label: formatted, url: u });
    };

    // Object format: { github: "https://...", twitter: "https://..." }
    const json = profile?.socialLinks || profile?.social_links;
    if (json && typeof json === "object" && !Array.isArray(json)) {
        for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
            add(k, v as string);
        }
    }

    // Array or legacy table format
    if (Array.isArray(list)) {
        for (const row of list) {
            add(row?.platform || row?.label || "", row?.url || "");
        }
    } else if (list && typeof list === "object") {
        for (const [k, v] of Object.entries(list as Record<string, unknown>)) {
            add(k, v as string);
        }
    }

    return out;
}

// ── Helpers ─────────────────────────────────────────────────────────

function str(v: unknown): string {
    return typeof v === "string" ? v : "";
}

function arr(v: unknown): any[] {
    return Array.isArray(v) ? v : [];
}

function obj(v: unknown): Record<string, string> {
    return v && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, string>)
        : {};
}
