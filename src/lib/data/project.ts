import { db } from '@/lib/db';
import { projects, projectFollows, projectOpenRoles, profiles, projectMembers, savedProjects } from '@/lib/db/schema';
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

        // Optimized: Fetch Project & Owner first
        const project = await db.query.projects.findFirst({
            where: conditions,
            with: {
                owner: true,
                // Remove deep fetches from here
            }
        });

        if (!project) {
            console.log(`[getProjectDetails] Not found for: ${projectId}`);
            return null;
        }

        const followersCount = Number((project as any).followersCount || 0);
        const savesCount = Number((project as any).savesCount || 0);

        const [openRoles, members] = await Promise.all([
            db.select().from(projectOpenRoles).where(eq(projectOpenRoles.projectId, project.id)),

            // Members (LIMIT to 20 to prevent bloat)
            // Frontend should use dedicated "Team" tab or infinite scroll for full list
            db.select({
                member: projectMembers,
                user: profiles
            })
                .from(projectMembers)
                .leftJoin(profiles, eq(projectMembers.userId, profiles.id))
                .where(eq(projectMembers.projectId, project.id))
                .limit(20)
        ]);

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
            saves_count: savesCount,

            // Roles
            project_open_roles: openRoles.map(r => ({
                ...r,
                project_id: r.projectId,
                created_at: r.createdAt.toISOString(),
                updated_at: r.updatedAt.toISOString(),
                title: r.title || undefined,
                description: r.description || undefined,
                skills: r.skills || []
            })),

            // Collaborators (Limited)
            project_collaborators: members.map(row => ({
                ...row.member,
                // Flatten structural profile
                profile: row.user ? {
                    ...row.user,
                    full_name: row.user.fullName,
                    avatar_url: row.user.avatarUrl
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
