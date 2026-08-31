import { db } from '@/lib/db'
import { profiles } from '@/lib/db/schema'
import { eq, or, and, isNull } from 'drizzle-orm'
import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import type { ConnectionState, ProfileViewerUser } from '@/components/profile/v2/types'
import { recordPrivacyReadEvent } from '@/lib/privacy/audit'
import { buildViewerScopedProfileView } from '@/lib/privacy/profile-views'
import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/db/schema'
import { resolvePrivacyRelationship } from '@/lib/privacy/resolver'
import { logger } from '@/lib/logger'
import { normalizeUsername, validateUsername } from '@/lib/validations/username'
import { isUuid } from '@/lib/validations/uuid'
import { normalizeNotificationPreferences } from '@/lib/notifications/preferences'
export { normalizeProfile } from '@/lib/utils/normalize-profile'
import { normalizeProfile } from '@/lib/utils/normalize-profile'
import {
    getProfileCollaborationSummary,
    type ProfileCollaborationSummary,
} from '@/lib/profile/collaboration'
import { getRedisClient } from '@/lib/redis'

type StandardProfile = Omit<Profile, 'workspaceLayout'> & { hasRecoveryCodes: boolean }

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
        | 'education'
        | 'openTo'
        | 'socialLinks'
        | 'socialLinkMetadata'
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
        | 'onboardingStatus'
        | 'onboardingCompletedAt'
        | 'onboardingVersion'
    > & Partial<Pick<StandardProfile, 'notificationPreferences'>>
): StandardProfile {
    return {
        ...profile,
        skills: profile.skills ?? [],
        interests: profile.interests ?? [],
        // Project contributions are loaded from normalized contribution rows.
        // The retired JSON field must never hydrate a second UI authority.
        experience: [],
        education: profile.education ?? [],
        openTo: profile.openTo ?? [],
        socialLinks: profile.socialLinks ?? {},
        // Compatibility only: the deployed column is no longer read by the safe-link flow.
        socialLinkMetadata: profile.socialLinkMetadata ?? {},
        notificationPreferences: normalizeNotificationPreferences(profile.notificationPreferences),
        experienceLevel: null,
        hoursPerWeek: null,
        genderIdentity: null,
        pronouns: null,
        connectionPrivacy: profile.connectionPrivacy ?? 'everyone',
        onboardingStatus: profile.onboardingStatus ?? 'not_started',
        onboardingCompletedAt: profile.onboardingCompletedAt ?? null,
        onboardingVersion: profile.onboardingVersion ?? 1,
        lastActiveAt: null,
        hasRecoveryCodes: false,
        openToCustomRoles: (profile as any).openToCustomRoles ?? [],
        preferredCategories: (profile as any).preferredCategories ?? [],
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
                education: profiles.education,
                openTo: profiles.openTo,
                socialLinks: profiles.socialLinks,
                socialLinkMetadata: profiles.socialLinkMetadata,
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
                onboardingStatus: profiles.onboardingStatus,
                onboardingCompletedAt: profiles.onboardingCompletedAt,
                onboardingVersion: profiles.onboardingVersion,
            })
            .from(profiles)
            .where(and(eq(profiles.id, userId), isNull(profiles.deletedAt)))
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
    recordViewEvent?: boolean;
}

export type ProfilePrivacyStatus = 'not_found' | 'private' | 'public';

export interface ProfileDetailsResult {
    privacyStatus: ProfilePrivacyStatus;
    visibilityReason?: string;
    profile: ReturnType<typeof normalizeProfile> | null;
    collaborationSummary: ProfileCollaborationSummary;
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
    currentUser: ProfileViewerUser | null;
}

const EMPTY_COLLABORATION_SUMMARY: ProfileCollaborationSummary = {
    version: 1,
    generatedAt: '',
    projects: [],
    contributions: [],
    stats: {
        projectsCount: 0,
        visibleProjectsCount: 0,
        contributionCount: 0,
    },
    cacheStatus: 'miss',
};

function toProfileViewerUser(user: User | null): ProfileViewerUser | null {
    return user?.id ? { id: user.id } : null;
}

async function getProfileMutualCount(viewerId: string, profileId: string) {
    if (!viewerId || !profileId || viewerId === profileId) return 0;
    const redis = getRedisClient();
    if (redis) {
        try {
            const viewerKey = `user:${viewerId}:connections`;
            const profileKey = `user:${profileId}:connections`;
            const [viewerExists, profileExists] = await Promise.all([
                redis.exists(viewerKey),
                redis.exists(profileKey),
            ]);
            if (viewerExists && profileExists) {
                const mutualIds = await redis.sinter(viewerKey, profileKey) as string[];
                return mutualIds.length;
            }
        } catch (error) {
            logger.warn('[profile.data] mutual redis overlay failed', {
                module: 'profile',
                viewerId,
                profileId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return 0;
}

const PROFILE_DETAIL_COLUMNS = {
    id: true,
    username: true,
    fullName: true,
    avatarUrl: true,
    bannerUrl: true,
    bio: true,
    headline: true,
    location: true,
    website: true,
    skills: true,
    interests: true,
    education: true,
    openTo: true,
    experienceLevel: true,
    hoursPerWeek: true,
    socialLinks: true,
    socialLinkMetadata: true,
    visibility: true,
    messagePrivacy: true,
    connectionPrivacy: true,
    createdAt: true,
    updatedAt: true,
    connectionsCount: true,
    projectsCount: true,
    followersCount: true,
    lastActiveAt: true,
} as const;

export async function getProfileDetails(username?: string, options: ProfileDetailsOptions = {}) {
    const viewerUser = options.viewerUser ?? null;
    const shouldRecordViewEvent = options.recordViewEvent ?? true;

    // 2. Fetch Target Profile (Optimized Parallel approach)
    let profileData = null;
    if (username) {
        const normalizedUsername = normalizeUsername(username)
        // We do a soft UUID format check. If it matches a UUID format, we can safely attempt ID lookup fallback
        const isProfileId = isUuid(username);

        if (!isProfileId && !validateUsername(normalizedUsername).valid) {
            profileData = null
        } else {
            profileData = await db.query.profiles.findFirst({
                where: isProfileId
                    ? and(or(eq(profiles.username, normalizedUsername), eq(profiles.id, username)), isNull(profiles.deletedAt))
                    : and(eq(profiles.username, normalizedUsername), isNull(profiles.deletedAt)),
                columns: PROFILE_DETAIL_COLUMNS,
            });
        }
    } else if (viewerUser) {
        profileData = await db.query.profiles.findFirst({
            where: and(eq(profiles.id, viewerUser.id), isNull(profiles.deletedAt)),
            columns: PROFILE_DETAIL_COLUMNS,
        });
    }

    if (!profileData) {
        return {
            privacyStatus: 'not_found',
            profile: null,
            stats: {
                connectionsCount: 0,
                projectsCount: 0,
                followersCount: 0,
                mutualCount: 0,
            },
            collaborationSummary: EMPTY_COLLABORATION_SUMMARY,
            connectionStatus: 'none',
            privacyRelationship: null,
            lockedShell: false,
            isOwner: false,
            currentUser: toProfileViewerUser(viewerUser),
        } satisfies ProfileDetailsResult;
    }

    const isOwner = viewerUser?.id === profileData.id;
    const shouldResolveViewerState = !!viewerUser && !isOwner;

    // Resolve authorization before any contribution/member aggregation. A
    // locked profile must not pay for, cache, or briefly materialize private
    // collaboration data in the request process.
    const privacyRelationship = await resolvePrivacyRelationship(viewerUser?.id ?? null, profileData.id);

    if (!privacyRelationship) {
        return {
            privacyStatus: 'not_found',
            profile: null,
            stats: {
                connectionsCount: 0,
                projectsCount: 0,
                followersCount: 0,
                mutualCount: 0,
            },
            collaborationSummary: EMPTY_COLLABORATION_SUMMARY,
            connectionStatus: 'none',
            privacyRelationship: null,
            lockedShell: false,
            isOwner: !!isOwner,
            currentUser: toProfileViewerUser(viewerUser),
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

    const [collaborationSummary, mutualCount] = canViewProfile
        ? await Promise.all([
            options.skipHeavyData
                ? Promise.resolve(EMPTY_COLLABORATION_SUMMARY)
                : getProfileCollaborationSummary(profileData.id, {
                    includePrivate: !!isOwner,
                    preferCached: !isOwner,
                }),
            shouldResolveViewerState && viewerUser
                ? getProfileMutualCount(viewerUser.id, profileData.id)
                : Promise.resolve(0),
        ])
        : [EMPTY_COLLABORATION_SUMMARY, 0];

    const connectionStatus: ConnectionState =
        privacyRelationship.connectionState === 'connected'
            ? 'accepted'
            : privacyRelationship.connectionState === 'pending_incoming'
                ? 'pending_incoming'
                : privacyRelationship.connectionState === 'pending_outgoing'
                    ? 'pending_outgoing'
                    : privacyRelationship.connectionState === 'blocked_by_viewer' || privacyRelationship.connectionState === 'blocked_by_target'
                        ? 'blocked'
                        : 'none';

    const normalizedProfile = normalizeProfile(profileData)
    const visibleProfile = normalizedProfile
        ? buildViewerScopedProfileView({
            profile: normalizedProfile as Record<string, unknown> & { id: string },
            relationship: privacyRelationship,
            isOwner: !!isOwner,
        })
        : null

    if (shouldRecordViewEvent && viewerUser?.id && viewerUser.id !== profileData.id) {
        void recordPrivacyReadEvent({
            subjectUserId: profileData.id,
            viewerUserId: viewerUser.id,
            eventType: 'profile_viewed',
            route: 'profile.details',
            metadata: {
                visibilityReason: privacyRelationship.visibilityReason,
                canViewProfile: privacyRelationship.canViewProfile,
            },
        })
    }

    return {
        privacyStatus: lockedShell ? 'private' : 'public',
        visibilityReason: privacyRelationship.visibilityReason,
        profile: visibleProfile,
        collaborationSummary: canViewProfile ? collaborationSummary : EMPTY_COLLABORATION_SUMMARY,
        stats: {
            connectionsCount: profileData.connectionsCount || 0,
            projectsCount: collaborationSummary.stats.projectsCount || profileData.projectsCount || 0,
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
        currentUser: toProfileViewerUser(viewerUser),
    } satisfies ProfileDetailsResult;
}
