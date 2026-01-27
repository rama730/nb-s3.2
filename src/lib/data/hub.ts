import { db } from '@/lib/db';
import { projects, profiles, projectOpenRoles, projectMembers } from '@/lib/db/schema';
import { eq, and, desc, ilike, or, inArray, sql } from 'drizzle-orm';
import { Project, HubFilters } from '@/types/hub';
import { PROJECT_STATUS, SORT_OPTIONS } from '@/constants/hub';
import { cache } from 'react';

// Default filters for ISR
export const DEFAULT_FILTERS: HubFilters = {
    status: PROJECT_STATUS.ALL,
    type: 'all',
    tech: [],
    sort: SORT_OPTIONS.NEWEST,
    search: undefined,
    includedIds: undefined
};

export const getHubProjects = cache(async (
    filters: HubFilters = DEFAULT_FILTERS,
    page: number = 0,
    pageSize: number = 24
) => {
    // Start building query
    const conditions = [eq(projects.visibility, 'public')];

    // Status Filter
    if (filters.status && filters.status !== PROJECT_STATUS.ALL) {
        conditions.push(eq(projects.status, filters.status as 'draft' | 'active' | 'completed' | 'archived'));
    }

    // Search Filter
    if (filters.search) {
        const searchPattern = `%${filters.search}%`;
        conditions.push(
            or(
                ilike(projects.title, searchPattern),
                ilike(projects.description, searchPattern)
            )!
        );
    }

    // Included IDs
    if (filters.includedIds && filters.includedIds.length > 0) {
        conditions.push(inArray(projects.id, filters.includedIds));
    }

    // Sort Logic
    let orderBy = desc(projects.createdAt);
    if (filters.sort === SORT_OPTIONS.OLDEST) {
        orderBy = sql`${projects.createdAt} ASC`;
    } else if (filters.sort === SORT_OPTIONS.MOST_VIEWED) {
        orderBy = desc(projects.updatedAt);
    }

    // 1. Fetch Projects (Raw)
    const rawProjects = await db.select()
        .from(projects)
        .where(and(...conditions))
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(page * pageSize);

    if (rawProjects.length === 0) {
        return {
            projects: [],
            nextCursor: undefined,
            hasMore: false
        };
    }

    const projectIds = rawProjects.map(p => p.id);
    const ownerIds = [...new Set(rawProjects.map(p => p.ownerId))];

    // 2. Fetch Relations in Parallel
    const [owners, roles, members] = await Promise.all([
        // Owners
        db.select().from(profiles).where(inArray(profiles.id, ownerIds)),
        // Open Roles
        db.select().from(projectOpenRoles).where(inArray(projectOpenRoles.projectId, projectIds)),
        // Members
        db.select({
            member: projectMembers,
            user: profiles
        })
            .from(projectMembers)
            .leftJoin(profiles, eq(projectMembers.userId, profiles.id))
            .where(inArray(projectMembers.projectId, projectIds))
    ]);

    // 3. Map relations to dictionaries for O(1) Access
    const ownerMap = new Map(owners.map(o => [o.id, o]));

    // Group Roles by Project
    const rolesMap = new Map<string, typeof roles>();
    roles.forEach(r => {
        if (!rolesMap.has(r.projectId)) rolesMap.set(r.projectId, []);
        rolesMap.get(r.projectId)!.push(r);
    });

    // Group Members by Project
    const membersMap = new Map<string, Array<{ member: typeof projectMembers.$inferSelect, user: typeof profiles.$inferSelect | null }>>();
    members.forEach(m => {
        if (!membersMap.has(m.member.projectId)) membersMap.set(m.member.projectId, []);
        membersMap.get(m.member.projectId)!.push(m);
    });

    // 4. Transform to Client Type
    const mappedProjects: Project[] = rawProjects.map((project) => {
        const owner = ownerMap.get(project.ownerId);
        const pRoles = rolesMap.get(project.id) || [];
        const pMembers = membersMap.get(project.id) || [];

        return {
            id: project.id,
            title: project.title,
            description: project.description,
            short_description: project.shortDescription,
            slug: project.slug || project.id,
            status: project.status || 'draft',
            category: project.category,
            cover_image: project.coverImage,
            technologies_used: project.tags || [],
            tags: project.tags || [],
            skills: project.skills || [],
            visibility: project.visibility || 'public',
            view_count: project.viewCount || 0,
            creator_id: project.ownerId,
            owner_id: project.ownerId,
            profiles: owner ? {
                id: owner.id,
                username: owner.username,
                full_name: owner.fullName,
                avatar_url: owner.avatarUrl
            } : undefined,

            project_collaborators: pMembers.map(m => m.user ? ({
                user_id: m.member.userId,
                ...m.user
            }) : null).filter(Boolean) as any[], // fallback cast

            project_open_roles: pRoles.map(role => ({
                id: role.id,
                role: role.role,
                count: role.count,
                filled: role.filled,
                project_id: role.projectId,
                title: role.title || undefined,
                description: role.description || undefined,
                skills: role.skills || [],
                created_at: role.createdAt.toISOString(),
                updated_at: role.updatedAt.toISOString(),
            })),

            project_followers: [],
            created_at: project.createdAt.toISOString(),
            updated_at: project.updatedAt.toISOString(),
            last_activity_at: project.updatedAt.toISOString(),
        };
    });

    // Return in React Query InfiniteQuery structure
    return {
        projects: mappedProjects,
        nextCursor: mappedProjects.length === pageSize ? page + pageSize : undefined,
        hasMore: mappedProjects.length === pageSize
    };
});
