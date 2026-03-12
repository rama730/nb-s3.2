import { db } from '@/lib/db'
import { profiles, projects, connections } from '@/lib/db/schema'
import { eq, or, and, desc, ne } from 'drizzle-orm'
import { cache } from 'react'
import type { ConnectionState } from '@/components/profile/v2/types'
import { createClient } from '@/lib/supabase/server'
import { canViewerAccessProfile } from '@/lib/security/profile-visibility'
import { getProfile } from '@/lib/services/profile-service'
export { normalizeProfile } from '@/lib/utils/normalize-profile'
import { normalizeProfile } from '@/lib/utils/normalize-profile'

// Pure Optimization: Use Supabase SELECT * which only returns columns that
// actually exist in the live DB — immune to Drizzle schema/DB drift.
// AuthProvider.transformProfile already handles the snake_case → camelCase mapping.
export const getUserProfile = cache(async (userId: string) => {
    if (!userId) return null;
    try {
        const supabase = await createClient();
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .maybeSingle();

        if (error || !data) return null;
        return data;
    } catch (error) {
        console.error('Error fetching user profile:', error);
        return null;
    }
});

interface ProfileDetailsOptions {
    skipHeavyData?: boolean;
}

export async function getProfileDetails(username?: string, options: ProfileDetailsOptions = {}) {
    const supabase = await createClient()

    // 1. Initial Authorization Check
    const { data: { user } } = await supabase.auth.getUser();

    // 2. Fetch Target Profile (Optimized Parallel approach)
    const profileData = username
        ? await db.query.profiles.findFirst({ where: eq(profiles.username, username) })
        : user
            ? await getProfile(user.id)
            : null;

    if (!profileData) return null;

    const isOwner = user?.id === profileData.id;
    const shouldResolveViewerState = !!user && !isOwner;

    const viewerConnection = shouldResolveViewerState
        ? await db.query.connections.findFirst({
            where: or(
                and(eq(connections.requesterId, user!.id), eq(connections.addresseeId, profileData.id)),
                and(eq(connections.requesterId, profileData.id), eq(connections.addresseeId, user!.id))
            ),
            columns: { status: true, requesterId: true },
            orderBy: [desc(connections.updatedAt)]
        })
        : null;

    const canViewProfile = canViewerAccessProfile(
        profileData.visibility,
        !!isOwner,
        viewerConnection?.status === 'accepted'
    );
    if (!canViewProfile) return null;

    const shouldLoadProjects = !options.skipHeavyData;
    const shouldLoadMutualCount = shouldResolveViewerState && !options.skipHeavyData;
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
        Promise.resolve(viewerConnection),
        shouldLoadMutualCount
            ? (async () => {
                try {
                    const res = await supabase.rpc('get_mutual_connections', {
                        p_viewer_id: user!.id,
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
            connectionStatus = conn.requesterId === user?.id ? 'pending_outgoing' : 'pending_incoming';
        } else connectionStatus = 'rejected';
    }

    return {
        profile: normalizeProfile(profileData),
        projects: userProjects,
        posts: [],
        stats: {
            connectionsCount: profileData.connectionsCount || 0,
            projectsCount: profileData.projectsCount || 0,
            followersCount: profileData.followersCount || 0,
            mutualCount,
        },
        connectionStatus,
        isOwner: !!isOwner,
        currentUser: user,
    };
}

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
