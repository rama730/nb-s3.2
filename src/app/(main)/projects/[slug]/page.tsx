import { notFound } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { db } from '@/lib/db';
import { projects, profiles, projectFollows, projectMembers, projectOpenRoles, roleApplications, savedProjects } from '@/lib/db/schema';
import { eq, inArray, sql, and, desc, type SQL } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import ProjectDashboardClient from '@/components/projects/dashboard/ProjectDashboardClient';
import type { Project as HubProject } from '@/types/hub';
import { computeProjectReadAccess } from '@/lib/data/project-access';
import { clearSealedGithubTokenFromImportSource } from '@/lib/github/repo-security';

const MEMBER_PAGE_SIZE = 20;
const OPEN_ROLES_PAGE_SIZE = 50;

const isMissingColumnError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    const lowered = msg.toLowerCase();
    return (
        (lowered.includes('column') && lowered.includes('does not exist')) ||
        (lowered.includes('failed query') && lowered.includes('from "projects"'))
    );
};

const isUuid = (value: string) =>
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);

const selectProject = async (where: SQL<unknown>) => {
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
                followersCount: projects.followersCount,
                savesCount: projects.savesCount,
            })
            .from(projects)
            .where(where)
            .limit(1);
    } catch (e) {
        if (!isMissingColumnError(e)) throw e;
        try {
            // Legacy-schema fallback: select only stable columns and fill the rest as null/defaults.
            return await db
                .select({
                    id: projects.id,
                    ownerId: projects.ownerId,
                    conversationId: sql<string | null>`null`,
                    title: projects.title,
                    slug: sql<string | null>`null`,
                    description: projects.description,
                    shortDescription: sql<string | null>`null`,
                    problemStatement: sql<string | null>`null`,
                    solutionStatement: sql<string | null>`null`,
                    coverImage: sql<string | null>`null`,
                    category: sql<string | null>`null`,
                    tags: sql<string[] | null>`null`,
                    skills: sql<string[] | null>`null`,
                    visibility: projects.visibility,
                    status: projects.status,
                    lifecycleStages: sql<string[] | null>`null`,
                    currentStageIndex: sql<number | null>`null`,
                    importSource: sql<unknown>`null`,
                    syncStatus: sql<string | null>`null`,
                    viewCount: sql<number | null>`null`,
                    followersCount: sql<number | null>`null`,
                    savesCount: sql<number | null>`null`,
                })
                .from(projects)
                .where(where)
                .limit(1);
        } catch (fallbackError) {
            if (!isMissingColumnError(fallbackError)) throw fallbackError;
            throw e;
        }
    }
};

async function selectProjectBySlugOrId(slug: string) {
    let project: Awaited<ReturnType<typeof selectProject>>[number] | null = null;

    // Try by slug first (if the DB is missing `slug`, fall through to id)
    try {
        const [bySlug] = await selectProject(eq(projects.slug, slug));
        project = bySlug ?? null;
    } catch (e) {
        if (!isMissingColumnError(e)) throw e;
    }

    // Fallback: try by id if slug didn't match (or slug column doesn't exist)
    if (!project && isUuid(slug)) {
        try {
            const [byId] = await selectProject(eq(projects.id, slug));
            project = byId ?? null;
        } catch (e) {
            if (!isMissingColumnError(e)) throw e;
            project = null;
        }
    }

    return project;
}

async function fetchProjectShellData(projectId: string, ownerId: string, includeFollowersCount: boolean, includeSavesCount: boolean) {
    const [owner, followersResult, savesResult, membersResult, rolesResult] = await Promise.all([
        db
            .select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(eq(profiles.id, ownerId))
            .limit(1),
        includeFollowersCount
            ? db
                .select({ count: sql<number>`count(*)` })
                .from(projectFollows)
                .where(eq(projectFollows.projectId, projectId))
            : Promise.resolve([]),
        includeSavesCount
            ? db
                .select({ count: sql<number>`count(*)` })
                .from(savedProjects)
                .where(eq(savedProjects.projectId, projectId))
            : Promise.resolve([]),
        db
            .select({
                userId: projectMembers.userId,
                membershipRole: projectMembers.role,
                joinedAt: projectMembers.joinedAt,
                profileId: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
            })
            .from(projectMembers)
            .leftJoin(profiles, eq(projectMembers.userId, profiles.id))
            .where(eq(projectMembers.projectId, projectId))
            .orderBy(desc(projectMembers.joinedAt), desc(projectMembers.id))
            .limit(MEMBER_PAGE_SIZE + 1),
        db
            .select({
                id: projectOpenRoles.id,
                projectId: projectOpenRoles.projectId,
                role: projectOpenRoles.role,
                title: projectOpenRoles.title,
                description: projectOpenRoles.description,
                count: projectOpenRoles.count,
                filled: projectOpenRoles.filled,
                skills: projectOpenRoles.skills,
                createdAt: projectOpenRoles.createdAt,
                updatedAt: projectOpenRoles.updatedAt,
            })
            .from(projectOpenRoles)
            .where(eq(projectOpenRoles.projectId, projectId))
            .orderBy(desc(projectOpenRoles.updatedAt), desc(projectOpenRoles.createdAt))
            .limit(OPEN_ROLES_PAGE_SIZE),
    ]);

    const followersCount = includeFollowersCount
        ? Number((followersResult[0] as { count?: number } | undefined)?.count || 0)
        : undefined;
    const savesCount = includeSavesCount
        ? Number((savesResult[0] as { count?: number } | undefined)?.count || 0)
        : undefined;

    const hasMoreMembers = membersResult.length > MEMBER_PAGE_SIZE;
    const limitedMembers = membersResult.slice(0, MEMBER_PAGE_SIZE);
    const lastMember = limitedMembers[limitedMembers.length - 1];
    const membersNextCursor = hasMoreMembers && lastMember
        ? Buffer.from(`${lastMember.joinedAt.toISOString()}:::${lastMember.userId}`).toString('base64')
        : undefined;

    const collaborators = limitedMembers
        .map((m) => ({
            userId: m.userId,
            membershipRole: m.membershipRole,
            user: m.profileId
                ? {
                    id: m.profileId,
                    username: m.username,
                    fullName: m.fullName,
                    avatarUrl: m.avatarUrl,
                }
                : null,
        }))
        .filter((m) => !!m.user);

    const collaboratorIds = collaborators.map((c) => c.userId);
    const acceptedRoleRows = collaboratorIds.length > 0
        ? await db
            .select({
                applicantId: roleApplications.applicantId,
                roleTitle: projectOpenRoles.title,
                roleName: projectOpenRoles.role,
                updatedAt: roleApplications.updatedAt,
            })
            .from(roleApplications)
            .leftJoin(projectOpenRoles, eq(projectOpenRoles.id, roleApplications.roleId))
            .where(
                and(
                    eq(roleApplications.projectId, projectId),
                    eq(roleApplications.status, 'accepted'),
                    inArray(roleApplications.applicantId, collaboratorIds)
                )
            )
            .orderBy(desc(roleApplications.updatedAt))
        : [];

    const acceptedRoleByUser = new Map<string, string>();
    for (const row of acceptedRoleRows) {
        if (acceptedRoleByUser.has(row.applicantId)) continue;
        const label = row.roleTitle || row.roleName || '';
        if (label) acceptedRoleByUser.set(row.applicantId, label);
    }

    const collaboratorsWithRoleTitle = collaborators.map((c) => ({
        ...c,
        projectRoleTitle: acceptedRoleByUser.get(c.userId) || null,
    }));

    const ownerDto = owner[0]
        ? {
            id: owner[0].id,
            username: owner[0].username,
            fullName: owner[0].fullName,
            avatarUrl: owner[0].avatarUrl,
        }
        : null;

    return {
        owner: ownerDto,
        followersCount,
        savesCount,
        openRoles: rolesResult,
        collaborators: collaboratorsWithRoleTitle,
        membersHasMore: hasMoreMembers,
        membersNextCursor,
    };
}

const getPublicProjectShellData = unstable_cache(
    async (projectId: string, ownerId: string, includeFollowersCount: boolean, includeSavesCount: boolean) =>
        fetchProjectShellData(projectId, ownerId, includeFollowersCount, includeSavesCount),
    ["public-project-shell"],
    { revalidate: 60 }
);

async function getProject(slug: string, currentUserId?: string | null) {
    const project = await selectProjectBySlugOrId(slug);

    if (!project) return null;

    const isOwner = !!currentUserId && currentUserId === project.ownerId;

    let isMember = false;
    let memberRole: string | null = null;
    let isFollowed = false;
    let isSaved = false;

    if (currentUserId) {
        const [memberRow, followRow, saveRow] = await Promise.all([
            db
                .select({ role: projectMembers.role })
                .from(projectMembers)
                .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, currentUserId)))
                .limit(1),
            db
                .select({ id: projectFollows.id })
                .from(projectFollows)
                .where(and(eq(projectFollows.projectId, project.id), eq(projectFollows.userId, currentUserId)))
                .limit(1),
            db
                .select({ id: savedProjects.id })
                .from(savedProjects)
                .where(and(eq(savedProjects.projectId, project.id), eq(savedProjects.userId, currentUserId)))
                .limit(1),
        ]);

        if (memberRow[0]) {
            isMember = true;
            memberRole = memberRow[0].role;
        }

        isFollowed = !!followRow[0];
        isSaved = !!saveRow[0];
    }

    const canRead = computeProjectReadAccess(project.visibility, project.status, isOwner, isMember);
    if (!canRead) return null;

    const shouldUseCachedShell =
        (project.visibility === 'public' || project.visibility === 'unlisted') && project.status !== 'draft';
    const includeFollowersCount = project.followersCount == null;
    const includeSavesCount = project.savesCount == null;
    const shell = shouldUseCachedShell
        ? await getPublicProjectShellData(project.id, project.ownerId, includeFollowersCount, includeSavesCount)
        : await fetchProjectShellData(project.id, project.ownerId, includeFollowersCount, includeSavesCount);

    // OPTIMIZATION: High-Scale Architecture (Shell + Lazy Hydration)
    // We intentionally DO NOT fetch potentially large lists (tasks, sprints, files) on the server.
    // These are fetched client-side by the respective tabs using React Query.
    // This ensures TTFB is O(1) and largely independent of project size.
    const projectSprints: unknown[] = [];
    const projectTasks: unknown[] = [];
    const initialFileNodes: unknown[] = [];

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
    const safeImportSource = clearSealedGithubTokenFromImportSource(project.importSource);

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
        visibility: project.visibility || 'private',
        status: normalizedStatus,

        // Lifecycle
        lifecycleStages: project.lifecycleStages || [],
        currentStageIndex: project.currentStageIndex ?? 0,

        // Import/files sync
        importSource: safeImportSource || null,
        syncStatus: normalizedSyncStatus,

        // Stats + user interaction
        viewCount: project.viewCount ?? 0,
        followersCount: project.followersCount ?? shell.followersCount ?? 0,
        savesCount: project.savesCount ?? shell.savesCount ?? 0,
        isFollowed,
        isSaved,

        // Lightweight relations for shell UI
        sprints: projectSprints,
        tasks: projectTasks,
        openRoles: shell.openRoles || [],
        collaborators: shell.collaborators || [],
        initialFileNodes,

        owner: shell.owner || null,

        // Member paging metadata
        membersHasMore: shell.membersHasMore || false,
        membersNextCursor: shell.membersNextCursor || null,

        // Access context
        isOwner,
        isMember,
        memberRole,
    };
}

function getProjectTitleFromSlug(slug: string) {
    const decoded = decodeURIComponent(slug || "").trim();
    if (!decoded || isUuid(decoded)) return "Project";
    const normalized = decoded
        .replace(/[-_]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return normalized ? normalized.slice(0, 80) : "Project";
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const title = getProjectTitleFromSlug(slug);

    return {
        title: `${title} | Edge`,
    };
}

export default async function ProjectDetailPage({
    params,
    searchParams: _searchParams,
}: {
    params: Promise<{ slug: string }>,
    searchParams: Promise<{ tab?: string }>
}) {
    const { slug } = await params;
    await _searchParams;

    // Server-side Auth Check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const project = await getProject(slug, user?.id);

    if (!project) {
        notFound();
    }

    const isOwner = !!project.isOwner;
    const isMember = !!project.isMember;

    return (
        <ProjectDashboardClient
            project={project}
            currentUserId={user?.id || null}
            isOwner={isOwner}
            isMember={isMember}
        />
    );
}
