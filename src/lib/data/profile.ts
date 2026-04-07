import { db } from '@/lib/db'
import { profiles, projects, connections, projectMembers } from '@/lib/db/schema'
import { eq, or, and, desc, ne, inArray, asc, sql } from 'drizzle-orm'
import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import type { ConnectionState } from '@/components/profile/v2/types'
import { createClient } from '@/lib/supabase/server'
import { type StandardProfile } from '@/lib/services/profile-service'
import { resolvePrivacyRelationship } from '@/lib/privacy/resolver'
import { logger } from '@/lib/logger'
import { normalizeUsername, validateUsername } from '@/lib/validations/username'
import {
    buildProfileMetadataDescription,
    buildPublicProfileTitle,
    normalizeProjectDescription,
    normalizeProjectTitle,
    trimDisplayText,
    trimOptionalDisplayText,
} from '@/lib/profile/display'
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
        lastActiveAt: null,
        hasRecoveryCodes: false,
    }
}

function toLockedShellProfile(profile: ReturnType<typeof normalizeProfile>) {
    if (!profile) return null
    return {
        id: profile.id,
        username: profile.username,
        fullName: profile.fullName,
        avatarUrl: profile.avatarUrl,
        headline: profile.headline,
        location: profile.location,
        visibility: profile.visibility,
        messagePrivacy: profile.messagePrivacy,
        connectionPrivacy: profile.connectionPrivacy,
        availabilityStatus: profile.availabilityStatus,
        bio: null,
        website: null,
        bannerUrl: null,
        socialLinks: {},
        openTo: [],
        skills: [],
        experience: [],
        education: [],
        profileStrength: profile.profileStrength,
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
        logger.error('[profile.data] failed to fetch bootstrap profile', {
            module: 'profile',
            userId,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        return null;
    }
});

interface ProfileDetailsOptions {
    skipHeavyData?: boolean;
    viewerUser?: User | null;
}

export interface ProfileProjectMemberPreview {
    id: string;
    displayName: string;
    username: string | null;
    avatarUrl: string | null;
}

export interface ProfileProjectPreview {
    id: string;
    ownerId: string;
    title: string;
    slug: string | null;
    description: string;
    shortDescription: string | null;
    coverImage: string | null;
    category: string | null;
    viewCount: number | null;
    followersCount: number | null;
    tags: string[];
    skills: string[];
    visibility: string | null;
    status: string | null;
    createdAt: Date;
    updatedAt: Date;
    href: string;
    image: string | null;
    url: string;
    members: ProfileProjectMemberPreview[];
}

export interface ProfileMetadataRead {
    title: string;
    description: string;
    image: string | null;
}

export type ProfilePrivacyStatus = 'not_found' | 'private' | 'public';

export interface ProfileDetailsResult {
    privacyStatus: ProfilePrivacyStatus;
    visibilityReason?: string;
    profile: ReturnType<typeof normalizeProfile> | null;
    projects: ProfileProjectPreview[];
    posts: any[];
    stats: {
        connectionsCount: number;
        projectsCount: number;
        followersCount: number;
        mutualCount?: number;
    };
    metadata: ProfileMetadataRead | null;
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

function buildProjectHref(project: { id: string; slug: string | null }) {
    return project.slug ? `/projects/${project.slug}` : `/projects/${project.id}`;
}

async function fetchProjectMembers(projectRows: Array<{ id: string; ownerId: string }>) {
    const projectIds = projectRows.map((project) => project.id);
    if (projectIds.length === 0) {
        return new Map<string, ProfileProjectMemberPreview[]>();
    }

    const [membershipRows, ownerRows] = await Promise.all([
        db
            .select({
                projectId: projectMembers.projectId,
                userId: profiles.id,
                fullName: profiles.fullName,
                username: profiles.username,
                avatarUrl: profiles.avatarUrl,
            })
            .from(projectMembers)
            .innerJoin(profiles, eq(projectMembers.userId, profiles.id))
            .where(inArray(projectMembers.projectId, projectIds))
            .orderBy(asc(projectMembers.joinedAt)),
        db
            .select({
                id: profiles.id,
                fullName: profiles.fullName,
                username: profiles.username,
                avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(inArray(profiles.id, Array.from(new Set(projectRows.map((project) => project.ownerId))))),
    ]);

    const ownerById = new Map(
        ownerRows.map((owner) => [
            owner.id,
            {
                id: owner.id,
                displayName: trimDisplayText(owner.fullName) || trimDisplayText(owner.username) || "Project owner",
                username: trimOptionalDisplayText(owner.username),
                avatarUrl: trimOptionalDisplayText(owner.avatarUrl),
            } satisfies ProfileProjectMemberPreview,
        ]),
    );

    const byProject = new Map<string, ProfileProjectMemberPreview[]>();
    for (const project of projectRows) {
        byProject.set(project.id, []);
        const owner = ownerById.get(project.ownerId);
        if (owner) {
            byProject.get(project.id)!.push(owner);
        }
    }

    for (const row of membershipRows) {
        const current = byProject.get(row.projectId) ?? [];
        if (current.some((member) => member.id === row.userId) || current.length >= 3) {
            byProject.set(row.projectId, current);
            continue;
        }
        current.push({
            id: row.userId,
            displayName: trimDisplayText(row.fullName) || trimDisplayText(row.username) || "Collaborator",
            username: trimOptionalDisplayText(row.username),
            avatarUrl: trimOptionalDisplayText(row.avatarUrl),
        });
        byProject.set(row.projectId, current);
    }

    return byProject;
}

function toProjectPreview(
    project: {
        id: string;
        ownerId: string;
        title: string;
        slug: string | null;
        description: string | null;
        shortDescription: string | null;
        coverImage: string | null;
        category: string | null;
        viewCount: number | null;
        followersCount: number | null;
        tags: string[] | null;
        skills: string[] | null;
        visibility: string | null;
        status: string | null;
        createdAt: Date;
        updatedAt: Date;
    },
    members: ProfileProjectMemberPreview[],
): ProfileProjectPreview {
    const title = normalizeProjectTitle(project.title);
    const description = normalizeProjectDescription(project.shortDescription, project.description);
    const href = buildProjectHref(project);

    return {
        id: project.id,
        ownerId: project.ownerId,
        title,
        slug: project.slug,
        description,
        shortDescription: trimOptionalDisplayText(project.shortDescription),
        coverImage: trimOptionalDisplayText(project.coverImage),
        category: trimOptionalDisplayText(project.category),
        viewCount: project.viewCount,
        followersCount: project.followersCount,
        tags: Array.isArray(project.tags) ? project.tags : [],
        skills: Array.isArray(project.skills) ? project.skills : [],
        visibility: project.visibility,
        status: project.status,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        href,
        image: trimOptionalDisplayText(project.coverImage),
        url: href,
        members,
    };
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
        profileData = await db.query.profiles.findFirst({
            where: eq(profiles.id, viewerUser.id),
        });
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
            metadata: null,
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
            metadata: null,
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
    const shouldLoadMutualCount = shouldResolveViewerState && canViewProfile;
    const canViewAllProjects = !!isOwner;

    const projectVisibilityFilter = canViewAllProjects
        ? eq(projects.ownerId, profileData.id)
        : and(
            eq(projects.ownerId, profileData.id),
            eq(projects.visibility, 'public'),
            ne(projects.status, 'draft')
        );

    // 3. PURE OPTIMIZATION: Lightweight shell first, heavy data only on-demand.
    const [projectRows, projectCountResult, conn, mutualCount] = await Promise.all([
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
        canViewProfile
            ? db
                .select({ count: sql<number>`count(*)::int` })
                .from(projects)
                .where(projectVisibilityFilter)
                .then((rows) => rows[0]?.count ?? 0)
            : Promise.resolve(0),
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

    const projectMembersByProject = shouldLoadProjects
        ? await fetchProjectMembers(projectRows.map((project) => ({
            id: project.id,
            ownerId: project.ownerId,
        })))
        : new Map<string, ProfileProjectMemberPreview[]>();

    const userProjects = shouldLoadProjects
        ? projectRows.map((project) => toProjectPreview(project, projectMembersByProject.get(project.id) ?? []))
        : [];

    // Map Connection Status
    let connectionStatus: ConnectionState = 'none';
    if (conn) {
        if (conn.status === 'accepted') connectionStatus = 'accepted';
        else if (conn.status === 'pending') {
            connectionStatus = conn.requesterId === viewerUser?.id ? 'pending_outgoing' : 'pending_incoming';
        } else connectionStatus = 'rejected';
    }

    const normalizedProfile = normalizeProfile(profileData)
    const metadata = normalizedProfile
        ? {
            title: buildPublicProfileTitle({
                username: normalizedProfile.username,
                fullName: normalizedProfile.fullName,
            }),
            description: buildProfileMetadataDescription({
                username: normalizedProfile.username,
                fullName: normalizedProfile.fullName,
                headline: normalizedProfile.headline,
                location: normalizedProfile.location,
                bio: normalizedProfile.bio,
            }),
            image: normalizedProfile.avatarUrl,
        }
        : null
    const visibleProfile = canViewProfile && !lockedShell
        ? normalizedProfile
        : toLockedShellProfile(normalizedProfile)

    return {
        privacyStatus: lockedShell ? 'private' : 'public',
        visibilityReason: privacyRelationship.visibilityReason,
        profile: visibleProfile,
        projects: canViewProfile ? userProjects : [],
        posts: [],
        stats: {
            connectionsCount: profileData.connectionsCount || 0,
            projectsCount: projectCountResult || 0,
            followersCount: profileData.followersCount || 0,
            mutualCount,
        },
        metadata: canViewProfile && !lockedShell ? metadata : null,
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
                headline: profiles.headline,
                location: profiles.location,
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
        logger.error('[profile.data] failed to fetch public profile metadata', {
            module: 'profile',
            username: normalizedUsername,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
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
