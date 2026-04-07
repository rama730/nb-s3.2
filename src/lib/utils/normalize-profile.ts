import { calculateProfileCompletion } from '@/lib/validations/profile'
import { trimOptionalDisplayText } from '@/lib/profile/display'

/**
 * Single point of truth for profile field defaults.
 * Handles both camelCase (Drizzle) and snake_case (Supabase REST) inputs.
 * Safe for use in both client and server code.
 */
export function normalizeProfile(p: any) {
    if (!p) return null;
    const avatarUrl = trimOptionalDisplayText(p.avatarUrl ?? p.avatar_url);
    const fullName = trimOptionalDisplayText(p.fullName ?? p.full_name);
    const socialLinks =
        (p.socialLinks && typeof p.socialLinks === 'object' ? p.socialLinks : null) ||
        (p.social_links && typeof p.social_links === 'object' ? p.social_links : null) ||
        {};
    const openTo = Array.isArray(p.openTo) ? p.openTo : (Array.isArray(p.open_to) ? p.open_to : []);
    const username = trimOptionalDisplayText(p.username);
    const bio = trimOptionalDisplayText(p.bio);
    const headline = trimOptionalDisplayText(p.headline);
    const location = trimOptionalDisplayText(p.location);
    const website = trimOptionalDisplayText(p.website);

    const completion = calculateProfileCompletion({
        avatarUrl,
        fullName,
        username,
        headline,
        bio,
        location,
        website,
        skills: Array.isArray(p.skills) ? p.skills : [],
        socialLinks,
    })
    return {
        ...p,
        avatarUrl,
        fullName,
        username,
        bio,
        headline,
        location,
        website,
        bannerUrl: trimOptionalDisplayText(p.bannerUrl ?? p.banner_url),
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
        workspaceInboxCount: p.workspaceInboxCount ?? p.workspace_inbox_count ?? 0,
        workspaceDueTodayCount: p.workspaceDueTodayCount ?? p.workspace_due_today_count ?? 0,
        workspaceOverdueCount: p.workspaceOverdueCount ?? p.workspace_overdue_count ?? 0,
        workspaceInProgressCount: p.workspaceInProgressCount ?? p.workspace_in_progress_count ?? 0,
    };
}
