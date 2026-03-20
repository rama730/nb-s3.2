import { db } from '@/lib/db'
import { profiles, projects, connections, type Profile } from '@/lib/db/schema'
import { eq, or, and, desc, ne } from 'drizzle-orm'
import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import type { ConnectionState } from '@/components/profile/v2/types'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/services/profile-service'
import { resolvePrivacyRelationship } from '@/lib/privacy/resolver'
import { logger } from '@/lib/logger'
export { normalizeProfile } from '@/lib/utils/normalize-profile'
import { normalizeProfile } from '@/lib/utils/normalize-profile'

function toBootstrapProfile(
    profile: Pick<
        Profile,
        | 'id'
        | 'email'
        | 'username'
        | 'fullName'
        | 'avatarUrl'
        | 'bannerUrl'
        | 'bio'
        | 'headline'
        | 'location'
        | 'website'
        | 'skills'
        | 'interests'
        | 'openTo'
        | 'availabilityStatus'
        | 'socialLinks'
        | 'visibility'
        | 'messagePrivacy'
        | 'connectionPrivacy'
        | 'createdAt'
        | 'updatedAt'
        | 'deletedAt'
        | 'connectionsCount'
        | 'projectsCount'
        | 'followersCount'
        | 'workspaceInboxCount'
        | 'workspaceDueTodayCount'
        | 'workspaceOverdueCount'
        | 'workspaceInProgressCount'
    >
): Profile {
    return {
        ...profile,
        skills: profile.skills ?? [],
        interests: profile.interests ?? [],
        experience: [],
        education: [],
        openTo: profile.openTo ?? [],
        availabilityStatus: profile.availabilityStatus ?? 'available',
        socialLinks: profile.socialLinks ?? {},
        experienceLevel: null,
        hoursPerWeek: null,
        genderIdentity: null,
        pronouns: null,
        connectionPrivacy: profile.connectionPrivacy ?? 'everyone',
        workspaceLayout: null,
        securityRecoveryCodes: [],
        recoveryCodesGeneratedAt: null,
    }
}

// Thin authenticated-shell bootstrap: explicit columns only, no wildcard profile load.
export const getUserProfile = cache(async (userId: string) => {
    if (!userId) return null;
    try {
        const [data] = await db
            .select({
                id: profiles.id,
                email: profiles.email,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                bannerUrl: profiles.bannerUrl,
                bio: profiles.bio,
                headline: profiles.headline,
                location: profiles.location,
                website: profiles.website,
                skills: profiles.skills,
                interests: profiles.interests,
                openTo: profiles.openTo,
                availabilityStatus: profiles.availabilityStatus,
                socialLinks: profiles.socialLinks,
                visibility: profiles.visibility,
                messagePrivacy: profiles.messagePrivacy,
                connectionPrivacy: profiles.connectionPrivacy,
                createdAt: profiles.createdAt,
                updatedAt: profiles.updatedAt,
                deletedAt: profiles.deletedAt,
                connectionsCount: profiles.connectionsCount,
                projectsCount: profiles.projectsCount,
                followersCount: profiles.followersCount,
                workspaceInboxCount: profiles.workspaceInboxCount,
                workspaceDueTodayCount: profiles.workspaceDueTodayCount,
                workspaceOverdueCount: profiles.workspaceOverdueCount,
                workspaceInProgressCount: profiles.workspaceInProgressCount,
            })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);

        if (!data) return null;
        return toBootstrapProfile(data);
    } catch (error) {
        console.error('Error fetching user profile:', error);
        return null;
    }
});

interface ProfileDetailsOptions {
    skipHeavyData?: boolean;
    viewerUser?: User | null;
}

export async function getProfileDetails(username?: string, options: ProfileDetailsOptions = {}) {
    const viewerUser = options.viewerUser ?? null;

    // 2. Fetch Target Profile (Optimized Parallel approach)
    const profileData = username
        ? await db.query.profiles.findFirst({ where: eq(profiles.username, username) })
        : viewerUser
            ? await getProfile(viewerUser.id)
            : null;

    if (!profileData) return null;

    const isOwner = viewerUser?.id === profileData.id;
    const shouldResolveViewerState = !!viewerUser && !isOwner;
    const privacyRelationship = await resolvePrivacyRelationship(viewerUser?.id ?? null, profileData.id);
    if (!privacyRelationship) return null;
    const canViewProfile = privacyRelationship.canViewProfile;
    const lockedShell = !canViewProfile;
    if (lockedShell) {
        logger.metric('privacy.profile.locked_shell', {
            viewerId: viewerUser?.id ?? 'anon',
            targetUserId: profileData.id,
            visibilityReason: privacyRelationship.visibilityReason,
        })
    }

    const shouldLoadProjects = !options.skipHeavyData;
    const shouldLoadMutualCount = shouldResolveViewerState && !options.skipHeavyData && canViewProfile;
    const canViewAllProjects = !!isOwner;

    const projectVisibilityFilter = canViewAllProjects
        ? eq(projects.ownerId, profileData.id)
        : and(
            eq(projects.ownerId, profileData.id),
            eq(projects.visibility, 'public'),
            ne(projects.status, 'draft')
        );

    // 3. PURE OPTIMIZATION: Lightweight shell first, heavy data only on-demand.
    const [userProjects, conn, mutualCount] = await Promise.all([
        shouldLoadProjects
            ? db.query.projects.findMany({
                where: projectVisibilityFilter,
                orderBy: [desc(projects.viewCount), desc(projects.updatedAt), desc(projects.createdAt)],
                limit: 12,
                columns: {
                    id: true,
                    ownerId: true,
                    title: true,
                    slug: true,
                    description: true,
                    shortDescription: true,
                    coverImage: true,
                    category: true,
                    viewCount: true,
                    followersCount: true,
                    tags: true,
                    skills: true,
                    visibility: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                }
            })
            : Promise.resolve([]),
        shouldResolveViewerState
            ? db.query.connections.findFirst({
                where: or(
                    and(eq(connections.requesterId, viewerUser!.id), eq(connections.addresseeId, profileData.id)),
                    and(eq(connections.requesterId, profileData.id), eq(connections.addresseeId, viewerUser!.id))
                ),
                columns: { status: true, requesterId: true },
                orderBy: [desc(connections.updatedAt)]
            })
            : Promise.resolve(null),
        shouldLoadMutualCount && viewerUser
            ? (async () => {
                try {
                    const supabase = await createClient()
                    const res = await supabase.rpc('get_mutual_connections', {
                        p_viewer_id: viewerUser.id,
                        p_profile_id: profileData.id
                    });
                    return (res.data as any)?.count || 0;
                } catch {
                    return 0;
                }
            })()
            : Promise.resolve(0),
    ]);

    // Map Connection Status
    let connectionStatus: ConnectionState = 'none';
    if (conn) {
        if (conn.status === 'accepted') connectionStatus = 'accepted';
        else if (conn.status === 'pending') {
            connectionStatus = conn.requesterId === viewerUser?.id ? 'pending_outgoing' : 'pending_incoming';
        } else connectionStatus = 'rejected';
    }

    return {
        profile: normalizeProfile(profileData),
        projects: canViewProfile ? userProjects : [],
        posts: [],
        stats: {
            connectionsCount: profileData.connectionsCount || 0,
            projectsCount: profileData.projectsCount || 0,
            followersCount: profileData.followersCount || 0,
            mutualCount,
        },
        connectionStatus,
        privacyRelationship: {
            canViewProfile: privacyRelationship.canViewProfile,
            canSendMessage: privacyRelationship.canSendMessage,
            canSendConnectionRequest: privacyRelationship.canSendConnectionRequest,
            blockedByViewer: privacyRelationship.blockedByViewer,
            blockedByTarget: privacyRelationship.blockedByTarget,
            visibilityReason: privacyRelationship.visibilityReason,
            connectionState: privacyRelationship.connectionState,
        },
        lockedShell,
        isOwner: !!isOwner,
        currentUser: viewerUser,
    };
}

export const getProfileVisibilityMeta = cache(async (username: string) => {
    if (!username) return null;
    const [profile] = await db
        .select({
            id: profiles.id,
            visibility: profiles.visibility,
        })
        .from(profiles)
        .where(eq(profiles.username, username))
        .limit(1);

    return profile || null;
});

export const getPublicProfileMeta = cache(async (username: string) => {
    if (!username) return null;
    try {
        const [profile] = await db
            .select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                bio: profiles.bio,
                avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(
                and(
                    eq(profiles.username, username),
                    eq(profiles.visibility, 'public')
                )
            )
            .limit(1);

        return profile || null;
    } catch (error) {
        console.error('Error fetching public profile meta:', error);
        return null;
    }
});

// For generateStaticParams
export const getPopularUsernames = cache(async (limit = 100) => {
    const data = await db
        .select({ username: profiles.username })
        .from(profiles)
        .orderBy(desc(profiles.createdAt))
        .limit(limit);

    return data.map(p => p.username).filter(Boolean) as string[];
});
