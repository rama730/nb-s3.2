import { db } from '@/lib/db'
import { profiles, projects, connections, type Profile } from '@/lib/db/schema'
import { eq, or, and, desc, ne } from 'drizzle-orm'
import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import type { ConnectionState } from '@/components/profile/v2/types'
import { createClient } from '@/lib/supabase/server'
import { getProfile, type StandardProfile } from '@/lib/services/profile-service'
import { resolvePrivacyRelationship } from '@/lib/privacy/resolver'
import { logger } from '@/lib/logger'
import { normalizeUsername, validateUsername } from '@/lib/validations/username'
export { normalizeProfile } from '@/lib/utils/normalize-profile'
import { normalizeProfile } from '@/lib/utils/normalize-profile'

function toBootstrapProfile(
    profile: Pick<
        StandardProfile,
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
        | 'experience'
        | 'education'
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
): StandardProfile {
    return {
        ...profile,
        skills: profile.skills ?? [],
        interests: profile.interests ?? [],
        experience: profile.experience ?? [],
        education: profile.education ?? [],
        openTo: profile.openTo ?? [],
        availabilityStatus: profile.availabilityStatus ?? 'available',
        socialLinks: profile.socialLinks ?? {},
        experienceLevel: null,
        hoursPerWeek: null,
        genderIdentity: null,
        pronouns: null,
        connectionPrivacy: profile.connectionPrivacy ?? 'everyone',
        workspaceLayout: null,
        hasRecoveryCodes: false,
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
                experience: profiles.experience,
                education: profiles.education,
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

export type ProfilePrivacyStatus = 'not_found' | 'private' | 'public';

export interface ProfileDetailsResult {
    privacyStatus: ProfilePrivacyStatus;
    visibilityReason?: string;
    profile: ReturnType<typeof normalizeProfile> | null;
    projects: any[];
    posts: any[];
    stats: {
        connectionsCount: number;
        projectsCount: number;
        followersCount: number;
        mutualCount?: number;
    };
    connectionStatus: ConnectionState;
    privacyRelationship: {
        canViewProfile: boolean;
        canSendMessage: boolean;
        canSendConnectionRequest: boolean;
        blockedByViewer: boolean;
        blockedByTarget: boolean;
        visibilityReason: string;
        connectionState: ConnectionState | string;
    } | null;
    lockedShell: boolean;
    isOwner: boolean;
    currentUser: User | null;
}

export async function getProfileDetails(username?: string, options: ProfileDetailsOptions = {}) {
    const viewerUser = options.viewerUser ?? null;

    // 2. Fetch Target Profile (Optimized Parallel approach)
    let profileData = null;
    if (username) {
        const normalizedUsername = normalizeUsername(username)
        // We do a soft UUID format check. If it matches a UUID format, we can safely attempt ID lookup fallback
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(username);

        if (!isUuid && !validateUsername(normalizedUsername).valid) {
            profileData = null
        } else {
            profileData = await db.query.profiles.findFirst({
                where: isUuid
                    ? or(eq(profiles.username, normalizedUsername), eq(profiles.id, username))
                    : eq(profiles.username, normalizedUsername)
            });
        }
    } else if (viewerUser) {
        profileData = await getProfile(viewerUser.id);
    }

    if (!profileData) {
        return {
            privacyStatus: 'not_found',
            profile: null,
            projects: [],
            posts: [],
            stats: {
                connectionsCount: 0,
                projectsCount: 0,
                followersCount: 0,
                mutualCount: 0,
            },
            connectionStatus: 'none',
            privacyRelationship: null,
            lockedShell: false,
            isOwner: false,
            currentUser: viewerUser,
        } satisfies ProfileDetailsResult;
    }

    const isOwner = viewerUser?.id === profileData.id;
    const shouldResolveViewerState = !!viewerUser && !isOwner;
    const privacyRelationship = await resolvePrivacyRelationship(viewerUser?.id ?? null, profileData.id);
    if (!privacyRelationship) {
        return {
            privacyStatus: 'not_found',
            profile: null,
            projects: [],
            posts: [],
            stats: {
                connectionsCount: 0,
                projectsCount: 0,
                followersCount: 0,
                mutualCount: 0,
            },
            connectionStatus: 'none',
            privacyRelationship: null,
            lockedShell: false,
            isOwner: !!isOwner,
            currentUser: viewerUser,
        } satisfies ProfileDetailsResult;
    }
    const canViewProfile = privacyRelationship.canViewProfile;
    const lockedShell = !canViewProfile;
    if (lockedShell) {
        logger.metric('privacy.profile.locked_shell', {
            hasViewer: !!viewerUser?.id,
            visibilityReason: privacyRelationship.visibilityReason,
            connectionState: privacyRelationship.connectionState,
            lockedShell,
            isOwner: !!isOwner,
        });
    }

    const shouldLoadProjects = !options.skipHeavyData && canViewProfile;
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
        privacyStatus: lockedShell ? 'private' : 'public',
        visibilityReason: privacyRelationship.visibilityReason,
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
    } satisfies ProfileDetailsResult;
}

export const getProfileVisibilityMeta = cache(async (username: string) => {
    if (!username) return null;
    const normalizedUsername = normalizeUsername(username)
    if (!validateUsername(normalizedUsername).valid) return null
    const [profile] = await db
        .select({
            id: profiles.id,
            visibility: profiles.visibility,
        })
        .from(profiles)
        .where(eq(profiles.username, normalizedUsername))
        .limit(1);

    return profile || null;
});

export const getPublicProfileMeta = cache(async (username: string) => {
    if (!username) return null;
    const normalizedUsername = normalizeUsername(username)
    if (!validateUsername(normalizedUsername).valid) return null
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
                    eq(profiles.username, normalizedUsername),
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
