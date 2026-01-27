import { db } from '@/lib/db';
import { projects, projectFollows, projectOpenRoles, profiles, projectMembers } from '@/lib/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { cache } from 'react';

// Removing cache for debug
export const getProjectDetails = async (rawProjectId: string) => {
    const projectId = decodeURIComponent(rawProjectId).trim();
    console.log(`[getProjectDetails] Lookup: "${projectId}"`);

    // UUID Regex
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);
    console.log(`[getProjectDetails] isUuid: ${isUuid}`);

    try {
        const conditions = isUuid ? eq(projects.id, projectId) : eq(projects.slug, projectId);

        // Optimized Query: Fetch Project + Owner + Members + Open Roles in one go
        const project = await db.query.projects.findFirst({
            where: conditions,
            with: {
                owner: true,
                openRoles: true,
                members: {
                    with: {
                        user: true
                    }
                }
            }
        });

        if (!project) {
            // If the input wasn't UUID and we tried slug first, it's failed.
            // If it WAS UUID and failed, we might check if it's a slug that looks like UUID (rare edge case)
            // But for now, assuming standard behavior:
            console.log(`[getProjectDetails] Not found for: ${projectId}`);
            // One last fallback: if we assumed UUID but it didn't match, maybe it IS a slug? 
            // Only relevant if a slug looks exactly like a UUID but isn't the primary ID, which is unlikely.
            return null;
        }

        // Parallelize follower count fetch (separate query is cleaner for counts in Drizzle)
        const followersCountPromise = db
            .select({ count: sql<number>`count(*)` })
            .from(projectFollows)
            .where(eq(projectFollows.projectId, project.id))
            .then(res => Number(res[0]?.count || 0));

        const followersCount = await followersCountPromise;

        // Transform to match expected frontend shape
        return {
            ...project,
            view_count: project.viewCount ?? 0,

            // Owner Profile
            profiles: project.owner ? {
                ...project.owner,
                full_name: project.owner.fullName,
                avatar_url: project.owner.avatarUrl,
            } : null,

            // Followers
            followers_count: followersCount,

            // Roles & Collabs
            // Map snake_case for frontend compatibility if needed
            project_open_roles: project.openRoles.map(r => ({
                ...r,
                project_id: r.projectId,
                created_at: r.createdAt.toISOString(),
                updated_at: r.updatedAt.toISOString(),
                // Fix potential null vs undefined
                title: r.title || undefined,
                description: r.description || undefined,
                skills: r.skills || []
            })),

            project_collaborators: project.members.map(m => ({
                ...m,
                profile: m.user ? {
                    ...m.user,
                    full_name: m.user.fullName,
                    avatar_url: m.user.avatarUrl
                } : null
            })),

            technologies_used: project.tags || [],
        };

    } catch (error) {
        console.error(`[getProjectDetails] Error fetching project ${projectId}:`, error);
        return null;
    }
};

export const getPopularProjectIds = cache(async (limit: number = 20) => {
    const data = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.visibility, 'public'))
        .orderBy(desc(projects.viewCount))
        .limit(limit);

    return data.map(p => p.id);
});
