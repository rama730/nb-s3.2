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

export const getProfileDetails = cache(async (username?: string) => {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    let profileData = null

    // 1. Fetch Profile via Drizzle
    if (username) {
        profileData = await db.query.profiles.findFirst({
            where: eq(profiles.username, username)
        })
    } else if (user) {
        profileData = await db.query.profiles.findFirst({
            where: eq(profiles.id, user.id)
        })
    }

    if (!profileData) return null

    // 2. Fetch related data (Projects, Counts) in parallel
    // Projects
    const projectsPromise = db.query.projects.findMany({
        where: eq(projects.ownerId, profileData.id),
        orderBy: [desc(projects.createdAt)],
        limit: 6
    });

    // Connections Count
    const connectionsCountPromise = db
        .select({ count: sql<number>`count(*)` })
        .from(connections)
        .where(
            and(
                eq(connections.status, 'accepted'),
                or(
                    eq(connections.requesterId, profileData.id),
                    eq(connections.addresseeId, profileData.id)
                )
            )
        )
        .then(res => Number(res[0]?.count || 0));

    // Projects Count
    const projectsCountPromise = db
        .select({ count: sql<number>`count(*)` })
        .from(projects)
        .where(eq(projects.ownerId, profileData.id))
        .then(res => Number(res[0]?.count || 0));

    const [
        userProjects,
        connectionsCount,
        projectsCount
    ] = await Promise.all([
        projectsPromise,
        connectionsCountPromise,
        projectsCountPromise
    ])

    // 3. Determine Connection Status
    let connectionStatus: ConnectionState = 'none'

    if (user && user.id !== profileData.id) {
        const conn = await db.query.connections.findFirst({
            where: or(
                and(eq(connections.requesterId, user.id), eq(connections.addresseeId, profileData.id)),
                and(eq(connections.requesterId, profileData.id), eq(connections.addresseeId, user.id))
            ),
            columns: {
                status: true,
                requesterId: true
            }
        });

        if (conn) {
            if (conn.status === 'accepted') {
                connectionStatus = 'accepted'
            } else if (conn.status === 'pending') {
                connectionStatus = conn.requesterId === user.id ? 'pending_outgoing' : 'pending_incoming'
            } else if (conn.status === 'rejected') {
                connectionStatus = 'rejected'
            } else if (conn.status === 'blocked') {
                connectionStatus = 'rejected' // Treat blocked as rejected for public view generally
            }
        }
    }

    // 4. Map Drizzle (CamelCase) to Component Props
    // Drizzle already provides camelCase for columns defined that way.
    // We just need to ensure fields like socialLinks are handled if they are JSON.

    // Note: The UI components might still expect some 'snake_case' props if they haven't been fully typed with Drizzle inferred types?
    // Based on previous file, 'mappedProfile' was creating camelCase properties.
    // Drizzle returns camelCase properties directly (e.g. fullName, avatarUrl).

    const mappedProfile = {
        ...profileData,
        // Ensure strictly required fields match what components expect
        // If components use `fullName` and `avatarUrl`, we are good.
        // If they use legacy snake_case, we might need to alias, but we are moving to standard.
        // Let's keep the object spread, which includes fullName/avatarUrl.
        // Add JSON defaults if Drizzle didn't (it should with default([])).

        socialLinks: profileData.socialLinks || {},
        openTo: profileData.openTo || [],
        experience: profileData.experience || [],
        education: profileData.education || [],
    }

    return {
        profile: mappedProfile,
        projects: userProjects,
        posts: [],
        stats: {
            connectionsCount,
            projectsCount,
            followersCount: 0
        },
        connectionStatus,
        isOwner: user?.id === profileData.id,
        currentUser: user,
    }
})

// For generateStaticParams
export const getPopularUsernames = cache(async (limit = 100) => {
    const data = await db
        .select({ username: profiles.username })
        .from(profiles)
        .orderBy(desc(profiles.createdAt))
        .limit(limit);

    return data.map(p => p.username).filter(Boolean) as string[];
});
