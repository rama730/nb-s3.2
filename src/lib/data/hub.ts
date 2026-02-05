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
    cursor?: string,
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

    // Cursor Pagination (PURE OPTIMIZATION: Composite Cursor for absolute robustness)
    if (cursor) {
        const [cursorDate, cursorId] = cursor.split('|');
        if (cursorDate && cursorId) {
            conditions.push(sql`(${projects.createdAt}, ${projects.id}) < (${new Date(cursorDate).toISOString()}, ${cursorId})`);
        } else if (cursorDate) {
            conditions.push(sql`${projects.createdAt} < ${new Date(cursorDate).toISOString()}`);
        }
    }

    // Sort Logic
    let orderBy = desc(projects.createdAt);
    if (filters.sort === SORT_OPTIONS.OLDEST) {
        orderBy = sql`${projects.createdAt} ASC`;
    } else if (filters.sort === SORT_OPTIONS.MOST_VIEWED) {
        // Fix: Logic Bug - was sorting by updatedAt, now using correct viewCount
        // Utilizing feedMostViewedIdx (visibility, status, viewCount)
        orderBy = desc(projects.viewCount);
    }

    // 1. Fetch Projects (Raw)
    // IMPORTANT: Hub only needs a small subset of project fields.
    // Selecting only what's needed prevents runtime failures when the DB is behind
    // newer migrations (e.g. missing `import_source`, `sync_status`, `conversation_id`, etc.).
    //
    // We also keep this resilient to older DBs that might not yet have `slug` / `view_count`.
    let rawProjects: Array<{
        id: string;
        ownerId: string;
        title: string;
        slug: string | null;
        description: string | null;
        shortDescription: string | null;
        coverImage: string | null;
        category: string | null;
        viewCount: number | null;
        tags: string[] | null;
        skills: string[] | null;
        visibility: string | null;
        status: string | null;
        createdAt: Date;
        updatedAt: Date;
    }>;

    try {
        rawProjects = await db
            .select({
                id: projects.id,
                ownerId: projects.ownerId,
                title: projects.title,
                slug: projects.slug,
                description: projects.description,
                shortDescription: projects.shortDescription,
                coverImage: projects.coverImage,
                category: projects.category,
                viewCount: projects.viewCount,
                tags: projects.tags,
                skills: projects.skills,
                visibility: projects.visibility,
                status: projects.status,
                createdAt: projects.createdAt,
                updatedAt: projects.updatedAt,
            })
            .from(projects)
            .where(and(...conditions))
            .orderBy(orderBy)
            .limit(pageSize);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const looksLikeMissingColumn =
            msg.toLowerCase().includes('column') &&
            (msg.toLowerCase().includes('slug') || msg.toLowerCase().includes('view_count'));

        if (!looksLikeMissingColumn) throw e;

        // Fallback: omit the missing columns and default them client-side.
        const fallbackOrderBy =
            filters.sort === SORT_OPTIONS.MOST_VIEWED ? desc(projects.createdAt) : orderBy;

        rawProjects = await db
            .select({
                id: projects.id,
                ownerId: projects.ownerId,
                title: projects.title,
                slug: sql<string | null>`null`,
                description: projects.description,
                shortDescription: projects.shortDescription,
                coverImage: projects.coverImage,
                category: projects.category,
                viewCount: sql<number | null>`null`,
                tags: projects.tags,
                skills: projects.skills,
                visibility: projects.visibility,
                status: projects.status,
                createdAt: projects.createdAt,
                updatedAt: projects.updatedAt,
            })
            .from(projects)
            .where(and(...conditions))
            .orderBy(fallbackOrderBy)
            .limit(pageSize);
    }

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
        // Owners - PURE OPTIMIZATION: Partial Select (Payload Reduction ~70%)
        db.select({
            id: profiles.id,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl
        }).from(profiles).where(inArray(profiles.id, ownerIds)),

        // Open Roles
        db.select()
            .from(projectOpenRoles)
            .where(inArray(projectOpenRoles.projectId, projectIds))
            .catch((e) => {
                const msg = e instanceof Error ? e.message : String(e);
                // Allow Hub to render even if older DB doesn't have open roles yet.
                if (msg.toLowerCase().includes('project_open_roles') && msg.toLowerCase().includes('does not exist')) {
                    return [];
                }
                throw e;
            }),
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
    type OpenRoleRow = typeof projectOpenRoles.$inferSelect;
    const rolesMap = new Map<string, OpenRoleRow[]>();
    (roles as OpenRoleRow[]).forEach((r) => {
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

        const normalizedStatus: Project['status'] =
            project.status === 'draft' ||
                project.status === 'active' ||
                project.status === 'completed' ||
                project.status === 'archived'
                ? project.status
                : 'draft';

        return {
            id: project.id,
            title: project.title,
            description: project.description,
            shortDescription: project.shortDescription,
            slug: project.slug || project.id,
            status: normalizedStatus,
            category: project.category,
            coverImage: project.coverImage,
            tags: project.tags || [],
            skills: project.skills || [],
            visibility: project.visibility || 'public',
            viewCount: project.viewCount || 0,
            ownerId: project.ownerId,
            owner: owner ? {
                id: owner.id,
                username: owner.username,
                fullName: owner.fullName,
                avatarUrl: owner.avatarUrl
            } : null,

            collaborators: pMembers.map(m => m.user ? ({
                userId: m.member.userId,
                membershipRole: m.member.role,
                user: {
                    id: m.user.id,
                    username: m.user.username,
                    fullName: m.user.fullName,
                    avatarUrl: m.user.avatarUrl,
                }
            }) : null).filter(Boolean) as any[],

            openRoles: pRoles.map(role => ({
                id: role.id,
                role: role.role,
                count: role.count,
                filled: role.filled,
                projectId: role.projectId,
                title: role.title || undefined,
                description: role.description || undefined,
                skills: role.skills || [],
            })),

            followers: [],
            createdAt: project.createdAt.toISOString(),
            updatedAt: project.updatedAt.toISOString(),
        };
    });

    // Return in React Query InfiniteQuery structure
    return {
        projects: mappedProjects,
        nextCursor: mappedProjects.length === pageSize
            ? `${mappedProjects[mappedProjects.length - 1].createdAt}|${mappedProjects[mappedProjects.length - 1].id}`
            : undefined,
        hasMore: mappedProjects.length === pageSize
    };
});
