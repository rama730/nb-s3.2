import { db } from '@/lib/db'
import { profiles, projects, connections } from '@/lib/db/schema'
import { eq, or, and, desc, sql } from 'drizzle-orm'
import { cache } from 'react'
import type { ConnectionState } from '@/components/profile/v2/types'
import { createClient } from '@/lib/supabase/server'

// Use Drizzle for consistent data access
export const getUserProfile = cache(async (userId: string) => {
    if (!userId) return null;
    try {
        const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
        return profile || null;
    } catch (error) {
        console.error('Error fetching user profile:', error);
        return null;
    }
});

interface ProfileDetailsOptions {
    skipHeavyData?: boolean;
}

/**
 * normalizeProfile - Architectural Purity: Single point of truth for field defaults.
 */
function normalizeProfile(p: any) {
    if (!p) return null;
    return {
        ...p,
        socialLinks: p.socialLinks || {},
        openTo: p.openTo || [],
        experience: p.experience || [],
        education: p.education || [],
        // CamelCase ensuring for Drizzle if needed, though Drizzle handles it usually
        connectionsCount: p.connectionsCount || 0,
        projectsCount: p.projectsCount || 0,
        followersCount: p.followersCount || 0,
    };
}

export const getProfileDetails = cache(async (username?: string, options: ProfileDetailsOptions = {}) => {
    const supabase = await createClient()

    // 1. Initial Authorization Check
    const { data: { user } } = await supabase.auth.getUser();

    // 2. Fetch Target Profile (Optimized Parallel approach)
    let profileData = await (username
        ? db.query.profiles.findFirst({ where: eq(profiles.username, username) })
        : user ? db.query.profiles.findFirst({ where: eq(profiles.id, user.id) }) : Promise.resolve(null)
    );

    if (!profileData) return null;

    // 3. PURE OPTIMIZATION: Parallelize everything else
    // Fetch Projects, Connection Status, and Mutual Counts in one go
    const [userProjects, conn, mutualCount] = await Promise.all([
        // Projects (Keep limited for initial shell)
        options.skipHeavyData ? Promise.resolve([]) : db.query.projects.findMany({
            where: eq(projects.ownerId, profileData.id),
            orderBy: [desc(projects.viewCount), desc(projects.updatedAt), desc(projects.createdAt)],
            limit: 12
        }),

        // Connection Status
        (user && user.id !== profileData.id) ? db.query.connections.findFirst({
            where: or(
                and(eq(connections.requesterId, user.id), eq(connections.addresseeId, profileData.id)),
                and(eq(connections.requesterId, profileData.id), eq(connections.addresseeId, user.id))
            ),
            columns: { status: true, requesterId: true }
        }) : Promise.resolve(null),

        // Mutual Connection Count (Batching into server fetch to avoid client waterfalls)
        (user && user.id !== profileData.id) ? supabase.rpc('get_mutual_connections', {
            p_viewer_id: user.id,
            p_profile_id: profileData.id
        }).then(res => (res.data as any)?.count || 0) : Promise.resolve(0)
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
            connectionsCount: profileData.connectionsCount || 0, // Using denormalized column
            projectsCount: profileData.projectsCount || 0,       // Using denormalized column
            followersCount: profileData.followersCount || 0,
            mutualCount, // New: Batched mutual count
        },
        connectionStatus,
        isOwner: user?.id === profileData.id,
        currentUser: user,
    };
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
