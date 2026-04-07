/**
 * C6: Single source of truth for profile normalization.
 * Handles camelCase (Drizzle) ↔ snake_case (Supabase REST) conversions,
 * form state, server payload, and optimistic update transformations.
 */

// ── Form State (used by EditProfileModal) ───────────────────────────

export type ProfileFormState = {
    full_name: string;
    username: string;
    headline: string;
    bio: string;
    location: string;
    website: string;
    avatar_url: string;
    banner_url: string;
    availabilityStatus: string;
    openTo: string[];
    skills: string[];
    socialLinks: Record<string, string>;
    experience: unknown[];
    education: unknown[];
};

/**
 * Convert a raw profile (either camelCase or snake_case) to form state.
 */
export function toFormState(profile: Record<string, unknown> | null | undefined): ProfileFormState {
    const s = (profile || {}) as Record<string, unknown>;
    return {
        full_name: str(s.fullName ?? s.full_name),
        username: str(s.username),
        headline: str(s.headline),
        bio: str(s.bio),
        location: str(s.location),
        website: str(s.website),
        avatar_url: str(s.avatarUrl ?? s.avatar_url),
        banner_url: str(s.bannerUrl ?? s.banner_url),
        availabilityStatus: str(s.availabilityStatus ?? s.availability_status) || "available",
        openTo: arr(s.openTo ?? s.open_to),
        skills: arr(s.skills),
        socialLinks: obj(s.socialLinks ?? s.social_links),
        experience: arr(s.experience),
        education: arr(s.education),
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
    availabilityStatus: string;
    openTo: string[];
    experience: unknown[];
    education: unknown[];
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
        fullName: formState.full_name,
        username: formState.username,
        headline: formState.headline,
        bio: formState.bio,
        location: formState.location,
        website: formState.website,
        avatarUrl: formState.avatar_url,
        bannerUrl: formState.banner_url,
        skills: formState.skills,
        socialLinks: formState.socialLinks,
        availabilityStatus: formState.availabilityStatus,
        openTo: formState.openTo,
        experience: formState.experience,
        education: formState.education,
        ...(normalizedExpectedUpdatedAt ? { expectedUpdatedAt: normalizedExpectedUpdatedAt } : {}),
    };
}

// ── Optimistic Update (used by ProfileV2Client) ─────────────────────

const OPTIMISTIC_KEYS = [
    "fullName", "username", "headline", "bio", "location", "website",
    "avatarUrl", "bannerUrl", "skills", "socialLinks",
    "availabilityStatus", "openTo", "experience", "education",
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
    return {
        ...base,
        full_name: payload.fullName !== undefined ? str(payload.fullName) : base.full_name,
        username: payload.username !== undefined ? str(payload.username) : base.username,
        headline: payload.headline !== undefined ? str(payload.headline) : base.headline,
        bio: payload.bio !== undefined ? str(payload.bio) : base.bio,
        location: payload.location !== undefined ? str(payload.location) : base.location,
        website: payload.website !== undefined ? str(payload.website) : base.website,
        avatar_url: payload.avatarUrl !== undefined ? str(payload.avatarUrl) : base.avatar_url,
        banner_url: payload.bannerUrl !== undefined ? str(payload.bannerUrl) : base.banner_url,
        availabilityStatus: payload.availabilityStatus !== undefined ? str(payload.availabilityStatus) : base.availabilityStatus,
        openTo: payload.openTo !== undefined ? arr(payload.openTo) : base.openTo,
        skills: payload.skills !== undefined ? arr(payload.skills) : base.skills,
        socialLinks: payload.socialLinks !== undefined ? obj(payload.socialLinks) : base.socialLinks,
        experience: payload.experience !== undefined ? arr(payload.experience) : base.experience,
        education: payload.education !== undefined ? arr(payload.education) : base.education,
    };
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

    const add = (label: string, url: string) => {
        const u = String(url || "").trim();
        if (!u || seen.has(u)) return;
        if (!/^https?:\/\//i.test(u)) return;
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
