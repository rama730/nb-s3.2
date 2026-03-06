import { calculateProfileCompletion } from '@/lib/validations/profile'

/**
 * Single point of truth for profile field defaults.
 * Handles both camelCase (Drizzle) and snake_case (Supabase REST) inputs.
 * Safe for use in both client and server code.
 */
export function normalizeProfile(p: any) {
    if (!p) return null;
    const avatarUrl = p.avatarUrl ?? p.avatar_url ?? null;
    const fullName = p.fullName ?? p.full_name ?? null;
    const socialLinks =
        (p.socialLinks && typeof p.socialLinks === 'object' ? p.socialLinks : null) ||
        (p.social_links && typeof p.social_links === 'object' ? p.social_links : null) ||
        {};
    const openTo = Array.isArray(p.openTo) ? p.openTo : (Array.isArray(p.open_to) ? p.open_to : []);

    const completion = calculateProfileCompletion({
        avatarUrl,
        fullName,
        username: p.username || null,
        headline: p.headline || null,
        bio: p.bio || null,
        location: p.location || null,
        website: p.website || null,
        skills: Array.isArray(p.skills) ? p.skills : [],
        socialLinks,
    })
    return {
        ...p,
        avatarUrl,
        fullName,
        bannerUrl: p.bannerUrl ?? p.banner_url ?? null,
        socialLinks,
        openTo,
        availabilityStatus: p.availabilityStatus ?? p.availability_status ?? 'available',
        experienceLevel: p.experienceLevel ?? p.experience_level ?? null,
        hoursPerWeek: p.hoursPerWeek ?? p.hours_per_week ?? null,
        genderIdentity: p.genderIdentity ?? p.gender_identity ?? null,
        pronouns: p.pronouns ?? null,
        experience: p.experience || [],
        education: p.education || [],
        profileStrength: completion.score,
        completionMissing: completion.missing,
        connectionsCount: p.connectionsCount || 0,
        projectsCount: p.projectsCount || 0,
        followersCount: p.followersCount || 0,
    };
}
