import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { projects, profiles, projectFollows, projectMembers, savedProjects } from '@/lib/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import ProjectDashboardClient from '@/components/projects/dashboard/ProjectDashboardClient';
import type { Project as HubProject } from '@/types/hub';

export const dynamic = 'force-dynamic';

async function getProject(slug: string, currentUserId?: string | null, searchTab?: string) {
    // Simple direct query - try slug first, then id
    const isMissingColumnError = (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        return msg.toLowerCase().includes('column') && msg.toLowerCase().includes('does not exist');
    };

    const selectProject = async (where: any) => {
        try {
            return await db
                .select({
                    id: projects.id,
                    ownerId: projects.ownerId,
                    conversationId: projects.conversationId,
                    title: projects.title,
                    slug: projects.slug,
                    description: projects.description,
                    shortDescription: projects.shortDescription,
                    problemStatement: projects.problemStatement,
                    solutionStatement: projects.solutionStatement,
                    coverImage: projects.coverImage,
                    category: projects.category,
                    tags: projects.tags,
                    skills: projects.skills,
                    visibility: projects.visibility,
                    status: projects.status,
                    lifecycleStages: projects.lifecycleStages,
                    currentStageIndex: projects.currentStageIndex,
                    importSource: projects.importSource,
                    syncStatus: projects.syncStatus,
                    viewCount: projects.viewCount,
                })
                .from(projects)
                .where(where)
                .limit(1);
        } catch (e) {
            if (!isMissingColumnError(e)) throw e;

            // Fallback for older DBs missing newer columns (import_source, sync_status, conversation_id, etc.).
            return await db
                .select({
                    id: projects.id,
                    ownerId: projects.ownerId,
                    conversationId: sql<string | null>`null`,
                    title: projects.title,
                    slug: sql<string | null>`null`,
                    description: projects.description,
                    shortDescription: projects.shortDescription,
                    problemStatement: sql<string | null>`null`,
                    solutionStatement: sql<string | null>`null`,
                    coverImage: projects.coverImage,
                    category: projects.category,
                    tags: projects.tags,
                    skills: projects.skills,
                    visibility: projects.visibility,
                    status: projects.status,
                    lifecycleStages: sql<string[] | null>`null`,
                    currentStageIndex: sql<number | null>`null`,
                    importSource: sql<unknown>`null`,
                    syncStatus: sql<string | null>`null`,
                    viewCount: sql<number | null>`null`,
                })
                .from(projects)
                .where(where)
                .limit(1);
        }
    };

    let project: Awaited<ReturnType<typeof selectProject>>[number] | null = null;

    // Try by slug first (if the DB is missing `slug`, fall through to id)
    try {
        const [bySlug] = await selectProject(eq(projects.slug, slug));
        project = bySlug ?? null;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!(msg.toLowerCase().includes('column') && msg.toLowerCase().includes('slug') && msg.toLowerCase().includes('does not exist'))) {
            throw e;
        }
    }

    // Fallback: try by id if slug didn't match (or slug column doesn't exist)
    if (!project) {
        // Only attempt to query by ID if the string is actually a UUID.
        // This prevents Postgres "invalid input syntax for type uuid" errors when passing a non-existent slug.
        const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(slug);

        if (isUuid) {
            const [byId] = await selectProject(eq(projects.id, slug));
            project = byId ?? null;
        }
    }

    if (!project) return null;

    // Get owner
    const [owner] = await db.select().from(profiles).where(eq(profiles.id, project.ownerId)).limit(1);

    // Get followers count
    const followersResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(projectFollows)
        .where(eq(projectFollows.projectId, project.id));
    const followersCount = Number(followersResult[0]?.count || 0);

    // Get user interaction status if logged in
    let isFollowed = false;
    let isSaved = false;

    if (currentUserId) {
        const [follow] = await db.select()
            .from(projectFollows)
            .where(and(
                eq(projectFollows.projectId, project.id),
                eq(projectFollows.userId, currentUserId)
            ))
            .limit(1);
        isFollowed = !!follow;

        const [save] = await db.select()
            .from(savedProjects)
            .where(and(
                eq(savedProjects.projectId, project.id),
                eq(savedProjects.userId, currentUserId)
            ))
            .limit(1);
        isSaved = !!save;
    }

    // OPTIMIZATION: High-Scale Architecture (Shell + Lazy Hydration)
    // We intentionally DO NOT fetch potentially large lists (tasks, sprints, files) on the server.
    // These are fetched client-side by the respective tabs using React Query.
    // This ensures TTFB is O(1) and largely independent of project size.
    
    let projectSprints: any[] = [];
    let projectTasks: any[] = [];
    let openRoles: any[] = [];
    let collaborators: any[] = [];
    let initialFileNodes: any[] = [];

    // Fetch ONLY critical shell data (Collaborators/Members) for access control
    try {
         // We still need members to determine if user is a member (for "isMember" prop)
         // But we can limit this or optimize it if the team size is massive (10k+).
         // For now, assuming team size is < 100, fetching members is O(1) relative to Task count.
        const membersResult = await db.query.projectMembers.findMany({
            where: (members, { eq }) => eq(members.projectId, project.id),
            with: {
                user: true
            },
            limit: 20
        });

        collaborators = membersResult.map(m => ({
            userId: m.userId,
            membershipRole: m.role, // owner/admin/member/viewer
            user: m.user ? {
                id: m.user.id,
                username: m.user.username,
                fullName: m.user.fullName,
                avatarUrl: m.user.avatarUrl,
            } : null
        })).filter((m: any) => !!m.user);

        // Fetch open roles (small dataset, needed for Dashboard OpenRolesCard)
        const rolesResult = await db.query.projectOpenRoles.findMany({
            where: (roles, { eq }) => eq(roles.projectId, project.id)
        });
        openRoles = rolesResult;

        // DO NOT FETCH: projectTasks, projectSprints here.
        // They remain empty arrays []

    } catch (e) {
        console.warn("Failed to fetch project members or roles.", e);
        // Fallback to empty arrays so the UI still renders
    }

    const ownerDto = owner ? {
        id: owner.id,
        username: owner.username,
        fullName: owner.fullName,
        avatarUrl: owner.avatarUrl
    } : null;

    const normalizedStatus: HubProject['status'] =
        project.status === 'draft' ||
            project.status === 'active' ||
            project.status === 'completed' ||
            project.status === 'archived'
            ? project.status
            : 'draft';

    const normalizedSyncStatus: HubProject['syncStatus'] =
        project.syncStatus === 'pending' ||
            project.syncStatus === 'cloning' ||
            project.syncStatus === 'indexing' ||
            project.syncStatus === 'ready' ||
            project.syncStatus === 'failed'
            ? project.syncStatus
            : 'ready';

    return {
        // Base identity
        id: project.id,
        ownerId: project.ownerId,
        conversationId: project.conversationId,
        title: project.title,
        slug: project.slug || undefined,

        // Core content
        description: project.description || null,
        shortDescription: project.shortDescription || null,
        problemStatement: project.problemStatement || null,
        solutionStatement: project.solutionStatement || null,
        coverImage: project.coverImage || null,
        category: project.category || null,
        tags: project.tags || [],
        skills: project.skills || [],

        // Visibility/status
        visibility: project.visibility || "private",
        status: normalizedStatus,

        // Lifecycle
        lifecycleStages: project.lifecycleStages || [],
        currentStageIndex: project.currentStageIndex ?? 0,

        // Import/files sync
        importSource: project.importSource || null,
        syncStatus: normalizedSyncStatus,

        // Stats + user interaction
        viewCount: project.viewCount ?? 0,
        followersCount,
        isFollowed,
        isSaved,

        // Lightweight relations for shell UI
        sprints: projectSprints,
        tasks: projectTasks,
        openRoles,
        collaborators,
        initialFileNodes,

        owner: ownerDto,
    };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const project = await getProject(slug);

    if (!project) {
        return { title: 'Project Not Found' };
    }

    return {
        title: `${project.title} | Edge`,
        description: project.shortDescription || project.description
    };
}

export default async function ProjectDetailPage({ 
    params, 
    searchParams 
}: { 
    params: Promise<{ slug: string }>,
    searchParams: Promise<{ tab?: string }>
}) {
    const { slug } = await params;
    const { tab } = await searchParams;

    // Server-side Auth Check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const project = await getProject(slug, user?.id, tab);

    if (!project) {
        notFound();
    }

    const isOwner = user?.id === project.ownerId;
    let isMember = false;

    if (user && !isOwner) {
        const [member] = await db.select()
            .from(projectMembers)
            .where(and(
                eq(projectMembers.projectId, project.id),
                eq(projectMembers.userId, user.id)
            ))
            .limit(1);
        isMember = !!member;
    }

    return (
        <ProjectDashboardClient
            project={project}
            currentUserId={user?.id || null}
            isOwner={isOwner}
            isMember={isMember}
        />
    );
}
