import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { projects, profiles, projectFollows, projectMembers, savedProjects, projectNodes } from '@/lib/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import ProjectDashboardClient from '@/components/projects/dashboard/ProjectDashboardClient';

export const dynamic = 'force-dynamic';

async function getProject(slug: string, currentUserId?: string | null, searchTab?: string) {
    // Simple direct query - try slug first, then id
    let project = null;

    // Try by slug
    const [bySlug] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    project = bySlug;

    // Fallback: try by id if slug didn't match
    if (!project) {
        const [byId] = await db.select().from(projects).where(eq(projects.id, slug)).limit(1);
        project = byId;
    }

    if (!project) return null;

    console.log("[getProject] currentStageIndex from DB:", project.currentStageIndex, "lifecycleStages:", project.lifecycleStages);

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
    let projectRoles: any[] = [];
    let projectCollaborators: any[] = [];
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

        projectCollaborators = membersResult.map(m => m.user);

        // Fetch open roles (small dataset, needed for Dashboard OpenRolesCard)
        const rolesResult = await db.query.projectOpenRoles.findMany({
            where: (roles, { eq }) => eq(roles.projectId, project.id)
        });
        projectRoles = rolesResult;

        // DO NOT FETCH: projectTasks, projectSprints here.
        // They remain empty arrays []

    } catch (e) {
        console.warn("Failed to fetch project members or roles.", e);
        // Fallback to empty arrays so the UI still renders
    }

    return {
        ...project,
        // Explicit lifecycle fields to ensure they're always present
        current_stage_index: project.currentStageIndex ?? 0,
        lifecycle_stages: project.lifecycleStages ?? [],
        slug: project.slug || undefined,
        status: project.status || "draft",
        description: project.description || null,
        shortDescription: project.shortDescription || null,
        coverImage: project.coverImage || null,
        category: project.category || null,
        visibility: project.visibility || "private", // Fix visibility null -> string
        tags: project.tags || [], // Fix null -> string[]
        skills: project.skills || [], // Fix null -> string[]
        view_count: project.viewCount ?? 0,
        followers_count: followersCount,
        is_followed: isFollowed,
        is_saved: isSaved,
        project_sprints: projectSprints,
        project_tasks: projectTasks,
        project_open_roles: projectRoles,
        project_collaborators: projectCollaborators,
        initialFileNodes,
        problem_statement: (project as any).problemStatement || null,
        solution_statement: (project as any).solutionStatement || null,
        owner: owner ? { // Pass as 'owner' for client consistency
            id: owner.id,
            username: owner.username,
            full_name: owner.fullName,
            avatar_url: owner.avatarUrl
        } : undefined,
        profiles: owner ? {
            id: owner.id,
            username: owner.username,
            full_name: owner.fullName,
            avatar_url: owner.avatarUrl
        } : undefined
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
