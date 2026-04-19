'use server';

import { db } from '@/lib/db';
import { projects, projectFollows, projectOpenRoles, roleApplications, conversations, conversationParticipants, messages, projectNodes, projectNodeEvents, projectMembers, profiles, tasks, projectSprints, taskNodeLinks, taskSubtasks, taskComments, tags, projectTags, skills, projectSkills } from '@/lib/db/schema';
import { eq, and, or, sql, inArray, isNotNull, isNull, desc } from 'drizzle-orm';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { redis } from '@/lib/redis';
import { revalidatePath, unstable_cache } from 'next/cache';
import { cookies } from 'next/headers';
import { CreateProjectInput } from '@/lib/validations/project';
import { z } from 'zod';
import { createHash } from 'crypto';
import { generateSlug } from '@/lib/utils/slug';
import { generateProjectKey } from '@/lib/project-key';
import { computeProjectReadAccess, computeProjectWriteAccess, getProjectAccessById, type ProjectAccess } from '@/lib/data/project-access';
import { normalizeGithubBranch, normalizeGithubRepoUrl } from '@/lib/github/repo-validation';
import { clearSealedGithubTokenFromImportSource, sanitizeGitErrorMessage, sealGithubImportToken } from '@/lib/github/repo-security';
import { fetchRepoMeta, parseGithubRepo } from '@/lib/github/repo-preview';
import { buildGithubImportEventId, resolveGithubRepoAccess } from '@/lib/github/auth-resolver';
import { buildProjectImportEventId } from '@/lib/import/idempotency';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { runInFlightDeduped } from '@/lib/async/inflight-dedupe';
// Queue Imports
import { inngest } from '@/inngest/client';
import { getLifecycleStagesForProjectType } from '@/lib/projects/lifecycle-templates';
import type { Project } from '@/types/hub';
import { logger } from '@/lib/logger';
import { buildProjectOwnerPresentation } from '@/lib/privacy/presentation';
import { resolvePrivacyRelationship } from '@/lib/privacy/resolver';
import { queueCounterRefreshBestEffort } from '@/lib/workspace/counter-buffer';
import {
    createSprintSchema,
    deleteSprintSchema,
    parseSprintDateInput,
    updateSprintSchema,
    type CreateSprintInput,
    type DeleteSprintResult,
    type UpdateSprintInput,
} from '@/lib/projects/sprints';
import {
    buildSprintFilterCounts,
    buildSprintHealthSummary,
    buildSprintPermissionSet,
    type SprintDetailPayload,
    type SprintDrawerPreview,
    type SprintFileTimelineEntity,
    type SprintListItem,
    type SprintTaskTimelineEntity,
} from '@/lib/projects/sprint-detail';
import {
    buildSprintCompareSummary,
    buildSprintDrawerPreviews,
    findPreviousSprintBaseline,
} from '@/lib/projects/sprint-presentation';
import { buildSprintTimeline, type SprintTimelineTaskInput } from '@/lib/projects/sprint-timeline';
import { recordSprintMetric } from '@/lib/projects/sprint-observability';
import { buildTaskActivityItems } from '@/lib/projects/task-activity';
import { normalizeTaskSurfaceRecord } from '@/lib/projects/task-presentation';
import { taskPriorityEnum, taskStatusEnum } from '@/lib/validations/task';

const isMissingColumn = (error: unknown, column: string) => {
    const msg = error instanceof Error ? error.message : String(error);
    const lowered = msg.toLowerCase();
    return (
        lowered.includes(column.toLowerCase()) &&
        (lowered.includes('column') || lowered.includes('failed query') || lowered.includes('does not exist'))
    );
};

const isMissingCounterColumn = (error: unknown, column: string) => isMissingColumn(error, column);

let sprintDescriptionColumnSupport: boolean | null = null;

async function hasProjectSprintDescriptionColumn() {
    if (sprintDescriptionColumnSupport !== null) {
        return sprintDescriptionColumnSupport;
    }

    try {
        const rows = await db.execute<{ exists: boolean }>(sql`
            select exists (
                select 1
                from information_schema.columns
                where table_schema = 'public'
                  and table_name = 'project_sprints'
                  and column_name = 'description'
            ) as exists
        `);

        sprintDescriptionColumnSupport = Boolean(Array.from(rows)[0]?.exists);
    } catch {
        sprintDescriptionColumnSupport = false;
    }

    return sprintDescriptionColumnSupport;
}

const revalidateProjectPaths = async (projectId: string) => {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath('/hub');
    try {
        const [project] = await db
            .select({ slug: projects.slug })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);
        if (project?.slug) {
            revalidatePath(`/projects/${project.slug}`);
        }
    } catch {
        // Ignore slug revalidation errors on legacy schemas.
    }
};

async function lockProjectUserPair(tx: any, projectId: string, userId: string) {
    await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
            hashtext(CAST(${projectId} AS text)),
            hashtext(CAST(${userId} AS text))
        )
    `);
}

// --- Types ---
interface CreateProjectResult {
    success: boolean;
    project?: {
        id: string;
        title: string;
        slug?: string;
    };
    error?: string;
}

type ImportSourcePayload = {
    type: 'github' | 'upload' | 'scratch';
    repoUrl?: string;
    branch?: string;
    s3Key?: string;
    metadata?: Record<string, any>;
};

function normalizeImportSourceForPersist(
    importSource: CreateProjectInput['import_source'] | undefined,
    gitHubToken?: string | null
): { ok: true; value: ImportSourcePayload | null } | { ok: false; error: string } {
    if (!importSource) return { ok: true, value: null };
    if (importSource.type !== 'github') {
        return { ok: true, value: importSource as ImportSourcePayload };
    }

    const repoUrl = normalizeGithubRepoUrl(importSource.repoUrl || '');
    if (!repoUrl) {
        return { ok: false, error: 'Invalid GitHub repository URL. Use https://github.com/owner/repo' };
    }

    const branch = normalizeGithubBranch(importSource.branch);
    if (importSource.branch && !branch) {
        return { ok: false, error: 'Invalid GitHub branch name.' };
    }

    const metadata = { ...(((clearSealedGithubTokenFromImportSource(importSource) as any)?.metadata || {}) as Record<string, any>) };
    if (gitHubToken) {
        const sealed = sealGithubImportToken(gitHubToken);
        if (sealed) metadata.importAuth = sealed;
    }

    const normalized: ImportSourcePayload = {
        ...importSource,
        type: 'github',
        repoUrl,
        branch,
        metadata,
    };
    return { ok: true, value: normalized };
}

function withLeadFocusMetadata(
    importSource: ImportSourcePayload | null,
    creatorRole: CreateProjectInput['creator_role']
): ImportSourcePayload | null {
    const leadFocus = (creatorRole?.title || '').trim();
    if (!importSource && !leadFocus) {
        return null;
    }

    const base: ImportSourcePayload = importSource || { type: 'scratch' };
    const metadata: Record<string, unknown> = { ...(base.metadata || {}) };

    if (leadFocus) {
        metadata.leadFocus = leadFocus;
    } else {
        delete metadata.leadFocus;
    }

    return {
        ...base,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
}

async function ensureGithubImportAccess(
    repoUrl: string,
    options: {
        oauthToken?: string | null;
        preferredInstallationId?: number | string | null;
        sealedImportToken?: unknown;
    } = {}
): Promise<{
    ok: true;
    installationId: number | null;
    authSource: 'app' | 'oauth' | 'sealed' | 'none';
    defaultBranch: string | null;
    isPrivate: boolean | null;
    repoId: number | null;
} | { ok: false; error: string }> {
    const parsed = parseGithubRepo(repoUrl);
    if (!parsed) {
        return { ok: false, error: 'Invalid GitHub repository URL. Use https://github.com/owner/repo' };
    }

    try {
        const access = await resolveGithubRepoAccess({
            repoUrl,
            oauthToken: options.oauthToken || null,
            preferredInstallationId: options.preferredInstallationId ?? null,
            sealedImportToken: options.sealedImportToken,
        });

        const meta = await fetchRepoMeta({ ...parsed, token: access.token || undefined });
        const isPrivate = meta.isPrivate === true;
        if (isPrivate && !access.token) {
            return { ok: false, error: 'GitHub access expired. Reconnect GitHub and retry import.' };
        }
        return {
            ok: true,
            installationId: access.installationId,
            authSource: access.source,
            defaultBranch: meta.defaultBranch,
            isPrivate: meta.isPrivate,
            repoId: meta.repoId,
        };
    } catch (e: any) {
        const msg = typeof e?.message === 'string' ? e.message : '';
        if (!(options.oauthToken || options.sealedImportToken) && msg.includes('404')) {
            return { ok: false, error: 'Repository not found or private. Connect GitHub and verify repository access.' };
        }
        return { ok: false, error: sanitizeGitErrorMessage(msg || 'Unable to validate repository access') };
    }
}

async function assertProjectReadAccess(projectId: string, userId: string | null) {
    const access = await getProjectAccessById(projectId, userId);
    if (!access.project) throw new Error("Project not found");
    if (!access.canRead) throw new Error("Forbidden");
    return access;
}

const PROJECT_DETAIL_MEMBER_PAGE_SIZE = 20;
const PROJECT_DETAIL_OPEN_ROLES_PAGE_SIZE = 50;

const projectDetailInputSchema = z.object({
    slugOrId: z.string().trim().min(1).max(200),
    actorUserId: z.string().uuid().nullable().optional(),
});

const projectDetailMemberRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
const projectDetailProfileSchema = z.object({
    id: z.string().uuid(),
    username: z.string().nullable(),
    fullName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    displayName: z.string().optional(),
    isMasked: z.boolean().optional(),
    canOpenProfile: z.boolean().optional(),
    badgeText: z.string().nullable().optional(),
});

const projectDetailOpenRoleSchema = z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    role: z.string(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    count: z.number().int().nonnegative(),
    filled: z.number().int().nonnegative(),
    skills: z.array(z.string()).nullable().optional(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
});

const projectDetailCollaboratorSchema = z.object({
    userId: z.string().uuid(),
    membershipRole: projectDetailMemberRoleSchema,
    joinedAt: z.string().nullable(),
    user: projectDetailProfileSchema.nullable(),
    projectRoleTitle: z.string().nullable(),
});

const projectDetailProjectSchema = z.object({
    id: z.string().uuid(),
    ownerId: z.string().uuid(),
    conversationId: z.string().uuid().nullable(),
    title: z.string().min(1),
    slug: z.string().min(1).optional(),
    description: z.string().nullable(),
    shortDescription: z.string().nullable(),
    problemStatement: z.string().nullable(),
    solutionStatement: z.string().nullable(),
    coverImage: z.string().nullable(),
    category: z.string().nullable(),
    tags: z.array(z.string()),
    skills: z.array(z.string()),
    visibility: z.string(),
    lookingForCollaborators: z.boolean(),
    maxCollaborators: z.string().nullable(),
    status: z.enum(['draft', 'active', 'completed', 'archived']),
    lifecycleStages: z.array(z.string()),
    currentStageIndex: z.number().int().nonnegative(),
    importSource: z.unknown().nullable(),
    syncStatus: z.enum(['pending', 'cloning', 'indexing', 'ready', 'failed']),
    updatedAt: z.string().nullable(),
    viewCount: z.number().int().nonnegative(),
    followersCount: z.number().int().nonnegative(),
    isFollowed: z.boolean(),
    sprints: z.array(z.unknown()),
    tasks: z.array(z.unknown()),
    openRoles: z.array(projectDetailOpenRoleSchema),
    collaborators: z.array(projectDetailCollaboratorSchema),
    initialFileNodes: z.array(z.unknown()),
    owner: projectDetailProfileSchema.nullable(),
    membersHasMore: z.boolean(),
    membersNextCursor: z.string().nullable(),
    isOwner: z.boolean(),
    isMember: z.boolean(),
    memberRole: projectDetailMemberRoleSchema.nullable(),
});

const projectDetailReadDataSchema = z.object({
    identity: z.object({
        projectId: z.string().uuid(),
        routeSlug: z.string(),
        canonicalSlug: z.string().nullable(),
    }),
    capabilities: z.object({
        canRead: z.boolean(),
        canWrite: z.boolean(),
        isOwner: z.boolean(),
        isMember: z.boolean(),
        memberRole: projectDetailMemberRoleSchema.nullable(),
        isFollowed: z.boolean(),
    }),
    project: projectDetailProjectSchema,
});

type ProjectDetailReadData = z.infer<typeof projectDetailReadDataSchema>;

export type ProjectDetailShellResult =
    | {
        success: true;
        data: ProjectDetailReadData;
    }
    | {
        success: false;
        errorCode: 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL_ERROR';
        message: string;
    };

export type ProjectDetailMetadataRead = {
    projectId: string;
    ownerId: string;
    slug: string | null;
    title: string;
    shortDescription: string | null;
    description: string | null;
    coverImage: string | null;
};

const projectDetailUuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isProjectDetailMemberRole(value: unknown): value is 'owner' | 'admin' | 'member' | 'viewer' {
    return value === 'owner' || value === 'admin' || value === 'member' || value === 'viewer';
}

async function resolveProjectDetailTarget(slugOrId: string) {
    const trimmed = slugOrId.trim();
    const isUuid = projectDetailUuidRegex.test(trimmed);
    const where = isUuid
        ? and(
            isNull(projects.deletedAt),
            or(eq(projects.slug, trimmed), eq(projects.id, trimmed))
        )
        : and(
            isNull(projects.deletedAt),
            eq(projects.slug, trimmed)
        );

    const [project] = await db
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
            lookingForCollaborators: projects.lookingForCollaborators,
            maxCollaborators: projects.maxCollaborators,
            status: projects.status,
            lifecycleStages: projects.lifecycleStages,
            currentStageIndex: projects.currentStageIndex,
            importSource: projects.importSource,
            syncStatus: projects.syncStatus,
            updatedAt: projects.updatedAt,
            viewCount: projects.viewCount,
            followersCount: projects.followersCount,
        })
        .from(projects)
        .where(where)
        .limit(1);

    return project ?? null;
}

async function resolveProjectDetailMetadataTarget(slugOrId: string) {
    const trimmed = slugOrId.trim();
    const isUuid = projectDetailUuidRegex.test(trimmed);
    const where = isUuid
        ? and(
            isNull(projects.deletedAt),
            or(eq(projects.slug, trimmed), eq(projects.id, trimmed))
        )
        : and(
            isNull(projects.deletedAt),
            eq(projects.slug, trimmed)
        );

    const [project] = await db
        .select({
            projectId: projects.id,
            ownerId: projects.ownerId,
            slug: projects.slug,
            title: projects.title,
            shortDescription: projects.shortDescription,
            description: projects.description,
            coverImage: projects.coverImage,
            visibility: projects.visibility,
            status: projects.status,
        })
        .from(projects)
        .where(where)
        .limit(1);

    return project ?? null;
}

async function resolveProjectDetailViewerState(input: {
    projectId: string;
    ownerId: string;
    visibility: string | null;
    status: string | null;
    actorUserId: string | null;
    includeFollowState?: boolean;
}) {
    const { projectId, ownerId, visibility, status, actorUserId, includeFollowState = true } = input;
    const [memberRow, followRow] = actorUserId
        ? await Promise.all([
            db
                .select({ role: projectMembers.role })
                .from(projectMembers)
                .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorUserId)))
                .limit(1),
            includeFollowState
                ? db
                    .select({ id: projectFollows.id })
                    .from(projectFollows)
                    .where(and(eq(projectFollows.projectId, projectId), eq(projectFollows.userId, actorUserId)))
                    .limit(1)
                : Promise.resolve([]),
        ])
        : [[], []] as const;

    const isOwner = !!actorUserId && actorUserId === ownerId;
    const memberRoleRaw = memberRow[0]?.role;
    const memberRole = isProjectDetailMemberRole(memberRoleRaw)
        ? memberRoleRaw
        : null;
    const isMember = !isOwner && !!memberRole;
    const canRead = computeProjectReadAccess(visibility, status, isOwner, isMember);
    const canWrite = computeProjectWriteAccess(isOwner, memberRole);
    const isFollowed = includeFollowState ? !!followRow[0] : false;

    return {
        canRead,
        canWrite,
        isOwner,
        isMember,
        memberRole,
        isFollowed,
    };
}

async function fetchProjectDetailShellData(projectId: string, ownerId: string, includeFollowersCount: boolean, viewerId: string | null) {
    const [ownerRows, followersResult, membersResult, rolesResult] = await Promise.all([
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
                .select({ count: sql<number>`count(*)::int` })
                .from(projectFollows)
                .where(eq(projectFollows.projectId, projectId))
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
            .limit(PROJECT_DETAIL_MEMBER_PAGE_SIZE + 1),
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
            .limit(PROJECT_DETAIL_OPEN_ROLES_PAGE_SIZE),
    ]);

    const followersCount = includeFollowersCount
        ? Number((followersResult[0] as { count?: number } | undefined)?.count || 0)
        : undefined;

    const hasMoreMembers = membersResult.length > PROJECT_DETAIL_MEMBER_PAGE_SIZE;
    const limitedMembers = membersResult.slice(0, PROJECT_DETAIL_MEMBER_PAGE_SIZE);
    const lastMember = limitedMembers[limitedMembers.length - 1];
    const membersNextCursor =
        hasMoreMembers && lastMember
            ? Buffer.from(`${lastMember.joinedAt.toISOString()}:::${lastMember.userId}`).toString('base64')
            : null;

    const collaborators = limitedMembers
        .map((m) => ({
            userId: m.userId,
            membershipRole: isProjectDetailMemberRole(m.membershipRole) ? m.membershipRole : 'member',
            joinedAt: m.joinedAt?.toISOString?.() ?? null,
            user: m.profileId
                ? {
                    id: m.profileId,
                    username: m.username,
                    fullName: m.fullName,
                    avatarUrl: m.avatarUrl,
                }
                : null,
        }))
        .filter((m) => m.user !== null);

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

    const ownerRow = ownerRows[0];
    const ownerRelationship = ownerRow ? await resolvePrivacyRelationship(viewerId, ownerRow.id) : null;
    const owner = buildProjectOwnerPresentation(
        ownerRow
            ? {
                id: ownerRow.id,
                username: ownerRow.username,
                fullName: ownerRow.fullName,
                avatarUrl: ownerRow.avatarUrl,
            }
            : null,
        ownerRelationship,
    );
    if (owner?.isMasked) {
        logger.metric('privacy.project.owner_masked', {
            surface: 'project_detail',
            viewerId: viewerId ?? 'anon',
            ownerId,
            projectId,
        });
    }

    return {
        owner,
        followersCount,
        openRoles: rolesResult,
        collaborators: collaboratorsWithRoleTitle,
        membersHasMore: hasMoreMembers,
        membersNextCursor,
    };
}

const getPublicProjectDetailShellData = unstable_cache(
    async (projectId: string, ownerId: string, includeFollowersCount: boolean) =>
        fetchProjectDetailShellData(projectId, ownerId, includeFollowersCount, null),
    ['public-project-detail-shell'],
    { revalidate: 60 }
);

const getPublicProjectDetailMetadata = unstable_cache(
    async (slugOrId: string): Promise<ProjectDetailMetadataRead | null> => {
        const project = await resolveProjectDetailMetadataTarget(slugOrId);
        if (!project) return null;

        const canRead = computeProjectReadAccess(project.visibility, project.status, false, false);
        if (!canRead) return null;

        return {
            projectId: project.projectId,
            ownerId: project.ownerId,
            slug: project.slug || null,
            title: project.title,
            shortDescription: project.shortDescription || null,
            description: project.description || null,
            coverImage: project.coverImage || null,
        };
    },
    ['public-project-detail-metadata'],
    { revalidate: 60 }
);

export async function readProjectDetailMetadata(input: {
    slugOrId: string;
    actorUserId?: string | null;
}): Promise<
    | { success: true; data: ProjectDetailMetadataRead }
    | { success: false; errorCode: 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL_ERROR'; message: string }
> {
    const parsedInput = projectDetailInputSchema.safeParse(input);
    if (!parsedInput.success) {
        return {
            success: false,
            errorCode: 'INVALID_INPUT',
            message: 'Invalid project detail request.',
        };
    }

    const { slugOrId, actorUserId = null } = parsedInput.data;
    const trimmed = slugOrId.trim();

    try {
        if (!actorUserId) {
            const cached = await getPublicProjectDetailMetadata(trimmed);
            if (cached) {
                return {
                    success: true,
                    data: cached,
                };
            }
        }

        const project = await resolveProjectDetailMetadataTarget(trimmed);
        if (!project) {
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'Project not found.',
            };
        }

        const viewerState = await resolveProjectDetailViewerState({
            projectId: project.projectId,
            ownerId: project.ownerId,
            visibility: project.visibility,
            status: project.status,
            actorUserId,
            includeFollowState: false,
        });

        if (!viewerState.canRead) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'Forbidden',
            };
        }

        return {
            success: true,
            data: {
                projectId: project.projectId,
                ownerId: project.ownerId,
                slug: project.slug || null,
                title: project.title,
                shortDescription: project.shortDescription || null,
                description: project.description || null,
                coverImage: project.coverImage || null,
            },
        };
    } catch (error) {
        console.error('[readProjectDetailMetadata] failed', error);
        const message = error instanceof Error ? error.message : String(error);
        const normalizedMessage = message.trim().toLowerCase();
        const isAuthorizationError =
            normalizedMessage === 'forbidden'
            || normalizedMessage.includes('not authorized')
            || normalizedMessage.includes('not authorised')
            || normalizedMessage.includes('unauthorized')
            || normalizedMessage.includes('unauthorised')
            || normalizedMessage.includes('permission');

        return {
            success: false,
            errorCode: isAuthorizationError ? 'FORBIDDEN' : 'INTERNAL_ERROR',
            message: isAuthorizationError ? 'Forbidden' : 'Internal error',
        };
    }
}

export async function readProjectDetailShell(input: {
    slugOrId: string;
    actorUserId?: string | null;
}): Promise<ProjectDetailShellResult> {
    const parsedInput = projectDetailInputSchema.safeParse(input);
    if (!parsedInput.success) {
        return {
            success: false,
            errorCode: 'INVALID_INPUT',
            message: 'Invalid project detail request.',
        };
    }

    const { slugOrId, actorUserId: requestedActorUserId = null } = parsedInput.data;

    try {
        const actorUserId = requestedActorUserId ?? null;

        const project = await resolveProjectDetailTarget(slugOrId);
        if (!project) {
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'Project not found.',
            };
        }

        return await runInFlightDeduped(
            `project:detail-shell:${project.id}:${actorUserId ?? 'anon'}`,
            async () => {
                const viewerState = await resolveProjectDetailViewerState({
                    projectId: project.id,
                    ownerId: project.ownerId,
                    visibility: project.visibility,
                    status: project.status,
                    actorUserId,
                });

                const { canRead, canWrite, isOwner, isMember, memberRole, isFollowed } = viewerState;
                if (!canRead) {
                    return {
                        success: false,
                        errorCode: 'FORBIDDEN' as const,
                        message: 'Forbidden',
                    };
                }

                const shouldUseCachedShell =
                    !actorUserId &&
                    (project.visibility === 'public' || project.visibility === 'unlisted') &&
                    project.status !== 'draft';
                const includeFollowersCount = project.followersCount == null;
                const shell = shouldUseCachedShell
                    ? await getPublicProjectDetailShellData(project.id, project.ownerId, includeFollowersCount)
                    : await fetchProjectDetailShellData(project.id, project.ownerId, includeFollowersCount, actorUserId);

                const normalizedStatus: Project['status'] =
                    project.status === 'draft' ||
                        project.status === 'active' ||
                        project.status === 'completed' ||
                        project.status === 'archived'
                        ? project.status
                        : 'draft';

                const normalizedSyncStatus: NonNullable<Project['syncStatus']> =
                    project.syncStatus === 'pending' ||
                        project.syncStatus === 'cloning' ||
                        project.syncStatus === 'indexing' ||
                        project.syncStatus === 'ready' ||
                        project.syncStatus === 'failed'
                        ? project.syncStatus
                        : 'ready';

                const safeImportSource = clearSealedGithubTokenFromImportSource(project.importSource);
                const openRoles = shell.openRoles.map((role) => ({
                    id: role.id,
                    projectId: role.projectId,
                    role: role.role,
                    title: role.title ?? null,
                    description: role.description ?? null,
                    count: Math.max(0, role.count ?? 0),
                    filled: Math.max(0, role.filled ?? 0),
                    skills: Array.isArray(role.skills) ? role.skills : [],
                    createdAt: role.createdAt?.toISOString?.() ?? null,
                    updatedAt: role.updatedAt?.toISOString?.() ?? null,
                }));

                const readModel = {
                    id: project.id,
                    ownerId: project.ownerId,
                    conversationId: project.conversationId ?? null,
                    title: project.title,
                    slug: project.slug || undefined,
                    description: project.description || null,
                    shortDescription: project.shortDescription || null,
                    problemStatement: project.problemStatement || null,
                    solutionStatement: project.solutionStatement || null,
                    coverImage: project.coverImage || null,
                    category: project.category || null,
                    tags: Array.isArray(project.tags) ? project.tags : [],
                    skills: Array.isArray(project.skills) ? project.skills : [],
                    visibility: project.visibility || 'private',
                    lookingForCollaborators: !!project.lookingForCollaborators,
                    maxCollaborators: project.maxCollaborators || null,
                    status: normalizedStatus,
                    lifecycleStages: Array.isArray(project.lifecycleStages) ? project.lifecycleStages : [],
                    currentStageIndex: Math.max(0, project.currentStageIndex ?? 0),
                    importSource: safeImportSource || null,
                    syncStatus: normalizedSyncStatus,
                    updatedAt: project.updatedAt?.toISOString?.() ?? null,
                    viewCount: Math.max(0, project.viewCount ?? 0),
                    followersCount: Math.max(0, project.followersCount ?? shell.followersCount ?? 0),
                    isFollowed,
                    sprints: [],
                    tasks: [],
                    openRoles,
                    collaborators: shell.collaborators,
                    initialFileNodes: [],
                    owner: shell.owner || null,
                    membersHasMore: shell.membersHasMore || false,
                    membersNextCursor: shell.membersNextCursor || null,
                    isOwner,
                    isMember,
                    memberRole: isOwner ? 'owner' : memberRole,
                };

                const output = {
                    identity: {
                        projectId: project.id,
                        routeSlug: slugOrId,
                        canonicalSlug: project.slug || null,
                    },
                    capabilities: {
                        canRead,
                        canWrite,
                        isOwner,
                        isMember,
                        memberRole: isOwner ? 'owner' : memberRole,
                        isFollowed,
                    },
                    project: readModel,
                };

                const parsedOutput = projectDetailReadDataSchema.safeParse(output);
                if (!parsedOutput.success) {
                    console.error('[getProjectDetailShellAction] Invalid DTO output', parsedOutput.error.flatten());
                    return {
                        success: false,
                        errorCode: 'INTERNAL_ERROR' as const,
                        message: 'Project detail payload validation failed.',
                    };
                }

                return {
                    success: true as const,
                    data: parsedOutput.data,
                };
            }
        );
    } catch (error) {
        console.error('[readProjectDetailShell] failed', error);
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to load project detail.',
        };
    }
}

export async function getProjectDetailShellAction(input: {
    slugOrId: string;
    actorUserId?: string | null;
}): Promise<ProjectDetailShellResult> {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const actorUserId = user?.id ?? null;

    if (input.actorUserId && input.actorUserId !== actorUserId) {
        console.warn('[getProjectDetailShellAction] Ignoring mismatched client actorUserId.');
    }

    return readProjectDetailShell({
        slugOrId: input.slugOrId,
        actorUserId,
    });
}

// ============================================================================
// LAZY PROJECT GROUP CREATION (for existing projects without groups)
// ============================================================================
/**
 * Ensures a project has an associated project group conversation.
 * This is idempotent - safe to call multiple times (uses onConflictDoNothing).
 * 
 * @param projectId - The project ID to ensure has a group
 * @param ownerId - The owner's user ID (will be added as participant)
 * @returns The conversationId (existing or newly created)
 */
export async function ensureProjectGroupExists(
    projectId: string,
    ownerId: string
): Promise<string | null> {
    try {
        // FAST PATH: Check if project already has a conversationId (99% of cases)
        const [project] = await db
            .select({ conversationId: projects.conversationId })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) return null;

        // If already has conversationId, return it immediately
        if (project.conversationId) {
            return project.conversationId;
        }

        // SLOW PATH: Create project group with proper locking (rare - only for old projects)
        // Uses FOR UPDATE to prevent race conditions
        const result = await db.transaction(async (tx) => {
            // CRITICAL: Lock the row with FOR UPDATE to prevent concurrent creation
            const lockedProject = await tx.execute<{ conversation_id: string | null }>(sql`
                SELECT conversation_id 
                FROM ${projects} 
                WHERE id = ${projectId}
                FOR UPDATE
            `);

            const lockedRow = Array.from(lockedProject)[0];

            // If another transaction already created the group, return it
            if (lockedRow?.conversation_id) {
                return lockedRow.conversation_id;
            }

            // We have exclusive lock - safe to create
            const [newConversation] = await tx.insert(conversations).values({
                type: 'project_group',
            }).returning({ id: conversations.id });

            if (!newConversation) {
                throw new Error('Failed to create project group');
            }

            // Link to project (atomic, no race possible due to lock)
            await tx.update(projects)
                .set({ conversationId: newConversation.id })
                .where(eq(projects.id, projectId));

            // Get ALL existing project members
            const members = await tx
                .select({ userId: projectMembers.userId })
                .from(projectMembers)
                .where(eq(projectMembers.projectId, projectId));

            // Collect all participant user IDs (ensure owner is ALWAYS included)
            const participantIds = new Set<string>([ownerId]); // Always include owner
            members.forEach(m => participantIds.add(m.userId));

            // Add all participants (bulk insert, idempotent)
            await tx.insert(conversationParticipants)
                .values(
                    Array.from(participantIds).map(userId => ({
                        conversationId: newConversation.id,
                        userId,
                    }))
                )
                .onConflictDoNothing();

            return newConversation.id;
        });

        return result;
    } catch (error) {
        console.error('Error ensuring project group exists:', error);
        return null;
    }
}


// --- Create Action ---
export async function createProjectAction(input: CreateProjectInput & { slug?: string; project_id?: string }): Promise<CreateProjectResult> {
    try {
        const supabase = await createClient();
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;

        if (!user) {
            return { success: false, error: 'You must be logged in to create a project' };
        }

        // Retrieve GitHub Access Token if available (for private repo access)
        const gitHubToken = session?.provider_token;

        const importSourceResult = normalizeImportSourceForPersist(input.import_source, gitHubToken || null);
        if (!importSourceResult.ok) {
            return { success: false, error: importSourceResult.error };
        }
        let normalizedImportSource = importSourceResult.value;
        if (normalizedImportSource?.type === 'github' && normalizedImportSource.repoUrl) {
            const preferredInstallationId = (normalizedImportSource.metadata as Record<string, unknown> | undefined)?.githubInstallationId;
            const sealedImportToken = (normalizedImportSource.metadata as Record<string, unknown> | undefined)?.importAuth;
            const accessCheck = await ensureGithubImportAccess(normalizedImportSource.repoUrl, {
                oauthToken: gitHubToken || null,
                preferredInstallationId: preferredInstallationId as number | string | null | undefined,
                sealedImportToken,
            });
            if (!accessCheck.ok) {
                return { success: false, error: accessCheck.error };
            }

            const mergedMetadata = {
                ...((normalizedImportSource.metadata || {}) as Record<string, unknown>),
                githubInstallationId: accessCheck.installationId,
                githubAuthSource: accessCheck.authSource,
                githubRepoId: accessCheck.repoId ?? ((normalizedImportSource.metadata || {}) as Record<string, unknown>)?.githubRepoId ?? null,
                syncPhase: 'pending',
                importEventId: buildProjectImportEventId({
                    projectId: input.project_id || input.slug || input.title || 'pending',
                    source: 'github',
                    normalizedTarget: normalizedImportSource.repoUrl,
                    branchOrManifestHash: normalizedImportSource.branch || accessCheck.defaultBranch || 'main',
                }),
            };

            normalizedImportSource = {
                ...normalizedImportSource,
                branch: normalizedImportSource.branch || accessCheck.defaultBranch || 'main',
                metadata: mergedMetadata,
            };
        } else if (normalizedImportSource?.type === 'upload') {
            const currentMetadata = ((normalizedImportSource.metadata || {}) as Record<string, unknown>);
            const normalizedTarget =
                typeof currentMetadata.folderName === 'string' && currentMetadata.folderName.trim().length > 0
                    ? currentMetadata.folderName
                    : 'upload';
            normalizedImportSource = {
                ...normalizedImportSource,
                metadata: {
                    ...currentMetadata,
                    syncPhase: 'pending',
                    importEventId: buildProjectImportEventId({
                        projectId: input.project_id || input.slug || input.title || 'pending',
                        source: 'upload',
                        normalizedTarget,
                        branchOrManifestHash: 'pending',
                    }),
                    uploadSession: {
                        ...(typeof currentMetadata.uploadSession === 'object' && currentMetadata.uploadSession
                            ? (currentMetadata.uploadSession as Record<string, unknown>)
                            : {}),
                        status: 'pending',
                    },
                },
            };
        }
        const normalizedImportSourceWithLeadFocus = withLeadFocusMetadata(normalizedImportSource, input.creator_role);

        let finalSlug = input.slug || generateSlug(input.title);
        // Initial Key Generation
        let finalKey = generateProjectKey(input.title);

        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
            try {
                const projectData = {
                    ownerId: user.id,
                    title: input.title,
                    slug: finalSlug,
                    // Use mutable key variable
                    key: finalKey,
                    currentTaskNumber: 0,
                    description: input.description || null,
                    shortDescription: input.short_description || null,
                    problemStatement: input.problem_statement || null,
                    // Backward-compatible: support older clients sending solution_overview
                    solutionStatement: (input as any).solution_statement || (input as any).solution_overview || null,
                    category: input.project_type || null,
                    tags: input.tags || [],
                    skills: input.technologies_used || [],
                    visibility: (input.visibility as 'public' | 'private' | 'unlisted') || 'public',
                    status: mapStatus(input.status),
                    lookingForCollaborators: true,
                    lifecycleStages: (input.lifecycle_stages && input.lifecycle_stages.length > 0)
                        ? input.lifecycle_stages
                        : getLifecycleStagesForProjectType(input.project_type),
                    currentStageIndex: input.current_stage_index || 0,
                    importSource: normalizedImportSourceWithLeadFocus,
                    // For GitHub imports, start at `pending` until the worker actually begins cloning.
                    syncStatus: (normalizedImportSourceWithLeadFocus?.type === 'github' ? 'pending' :
                        normalizedImportSourceWithLeadFocus?.type === 'upload' ? 'pending' : 'ready') as 'pending' | 'cloning' | 'indexing' | 'ready' | 'failed',
                    githubRepoUrl: normalizedImportSourceWithLeadFocus?.type === 'github'
                        ? normalizedImportSourceWithLeadFocus.repoUrl || null
                        : null,
                    githubDefaultBranch: normalizedImportSourceWithLeadFocus?.type === 'github'
                        ? normalizedImportSourceWithLeadFocus.branch || 'main'
                        : 'main',
                };

                // Use transaction to ensure project, owner membership, and project group are created together
                // OPTIMIZED: Create conversation FIRST, insert project WITH conversationId (saves 1 UPDATE)
                const result = await db.transaction(async (tx) => {
                    // 1. Create the Project Group Conversation FIRST
                    const [newConversation] = await tx.insert(conversations).values({
                        type: 'project_group',
                    }).returning({ id: conversations.id });

                    if (!newConversation) {
                        throw new Error('Failed to create project group');
                    }

                    // 2. Create the Project WITH conversationId
                    const [newProject] = await tx.insert(projects).values({
                        ...projectData,
                        conversationId: newConversation.id,
                    }).returning();

                    if (!newProject) {
                        throw new Error('Failed to create project');
                    }

                    // 3. Add Owner as a Participant of the Project Group
                    await tx.insert(conversationParticipants).values({
                        conversationId: newConversation.id,
                        userId: user.id,
                    });

                    // 4. Add owner as a member with 'owner' role
                    await tx.insert(projectMembers).values({
                        projectId: newProject.id,
                        userId: user.id,
                        role: 'owner'
                    });

                    // Keep denormalized profile stats in sync.
                    await tx.update(profiles)
                        .set({ projectsCount: sql`GREATEST(0, ${profiles.projectsCount} + 1)` })
                        .where(eq(profiles.id, user.id));

                    // 5. Insert Open Roles (if any)
                    if (input.roles && input.roles.length > 0) {
                        await tx.insert(projectOpenRoles).values(
                            input.roles.map(role => ({
                                projectId: newProject.id,
                                role: role.role,
                                count: role.count,
                                description: role.description || "",
                                skills: role.skills || [],
                            }))
                        );
                    }

                    // 6. Insert Tags and Skills into Junction Tables
                    const tagsArray = input.tags || [];
                    for (const tagName of tagsArray) {
                        const slug = tagName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                        if (!slug) continue;
                        let [tag] = await tx.select().from(tags).where(eq(tags.slug, slug)).limit(1);
                        if (!tag) {
                            await tx.insert(tags).values({ name: tagName, slug }).onConflictDoNothing();
                            [tag] = await tx.select().from(tags).where(eq(tags.slug, slug)).limit(1);
                        }
                        if (!tag) throw new Error(`Failed to resolve tag for slug: ${slug}`);
                        await tx.insert(projectTags).values({ projectId: newProject.id, tagId: tag.id }).onConflictDoNothing();
                    }

                    const skillsArray = input.technologies_used || [];
                    for (const skillName of skillsArray) {
                        const slug = skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                        if (!slug) continue;
                        let [skill] = await tx.select().from(skills).where(eq(skills.slug, slug)).limit(1);
                        if (!skill) {
                            await tx.insert(skills).values({ name: skillName, slug }).onConflictDoNothing();
                            [skill] = await tx.select().from(skills).where(eq(skills.slug, slug)).limit(1);
                        }
                        if (!skill) throw new Error(`Failed to resolve skill for slug: ${slug}`);
                        await tx.insert(projectSkills).values({ projectId: newProject.id, skillId: skill.id }).onConflictDoNothing();
                    }

                    return newProject;
                });

                revalidatePath('/hub');

                // Add to Import Queue if applicable
                if (normalizedImportSourceWithLeadFocus?.type === 'github' && normalizedImportSourceWithLeadFocus.repoUrl) {
                    try {
                        const queueImportSource = clearSealedGithubTokenFromImportSource(normalizedImportSourceWithLeadFocus) as ImportSourcePayload;
                        const queueEventId = buildGithubImportEventId(
                            result.id,
                            queueImportSource.repoUrl!,
                            queueImportSource.branch || null
                        );
                        await inngest.send({
                            name: "project/import",
                            id: queueEventId,
                            data: {
                                projectId: result.id,
                                importSource: {
                                    type: 'github',
                                    repoUrl: queueImportSource.repoUrl!,
                                    branch: queueImportSource.branch,
                                    metadata: queueImportSource.metadata
                                },
                                userId: user.id
                            }
                        });
                        logger.metric('github.import.enqueue', {
                            projectId: result.id,
                            userId: user.id,
                            result: 'success',
                            eventId: queueEventId,
                            source: 'create',
                        });
                    } catch (queueError) {
                        // If we can't enqueue, mark the project as failed so the Files tab becomes actionable.
                        const msg = sanitizeGitErrorMessage(
                            queueError instanceof Error ? queueError.message : 'Failed to enqueue GitHub import'
                        );
                        console.error('[Action] Failed to add to queue', msg);

                        const currentImportSource = normalizedImportSourceWithLeadFocus!;
                        const clearedImportSource = clearSealedGithubTokenFromImportSource(currentImportSource) as Record<string, any>;
                        const nextImportSource = {
                            ...clearedImportSource,
                            metadata: {
                                ...((clearedImportSource as any)?.metadata || {}),
                                lastError: msg,
                                syncPhase: 'failed',
                            },
                        };

                        await db
                            .update(projects)
                            .set({ syncStatus: 'failed', importSource: nextImportSource as any, updatedAt: new Date() })
                            .where(eq(projects.id, result.id));
                        logger.metric('github.import.enqueue', {
                            projectId: result.id,
                            userId: user.id,
                            result: 'error',
                            source: 'create',
                        });
                    }
                }

                return {
                    success: true,
                    project: {
                        id: result.id,
                        title: result.title,
                        slug: result.slug || result.id,
                    },
                };

            } catch (error: any) {
                // Check for Unique Constraint Violation on Slug
                // Postgres error code 23505 is unique_violation
                if (error.code === '23505') {
                    if (error.message?.includes('slug')) {
                        if (input.slug) {
                            throw new Error('This project URL is already taken. Please choose another.');
                        }
                        attempts++;
                        const suffix = Math.random().toString(36).substring(2, 6);
                        finalSlug = `${generateSlug(input.title)}-${suffix}`;
                        continue;
                    }
                    // Project Key Collision (e.g. "NB" already exists)
                    if (error.message?.includes('key')) {
                        attempts++;
                        const suffix = Math.floor(Math.random() * 9) + 1;
                        finalKey = `${generateProjectKey(input.title)}${suffix}`;
                        continue;
                    }
                }
                throw error; // Re-throw other errors
            }
        }

        throw new Error("Failed to generate a unique project ID. Please try again.");

    } catch (error) {
        console.error('Error creating project:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'An unexpected error occurred',
        };
    }
}

// --- Update Action ---
export async function updateProject(projectId: string, data: any) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) throw new Error("Unauthorized");

    // Transaction to ensure atomicity of project update + role changes
    return await db.transaction(async (tx) => {
        // Check ownership
        const [project] = await tx.select()
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) throw new Error("Project not found");
        if (project.ownerId !== user.id) throw new Error("Unauthorized");

        const { roles, deletedRoleIds, ...raw } = data || {};

        // Update Project (canonical camelCase payload; accepts snake_case for backward compatibility)
        const updateValues: any = {
            updatedAt: new Date(),
        };

        if (raw.title !== undefined) updateValues.title = raw.title;
        if (raw.description !== undefined) updateValues.description = raw.description;
        if (raw.visibility !== undefined) updateValues.visibility = raw.visibility;
        if (raw.status !== undefined) updateValues.status = raw.status;

        // Tagline
        if (raw.shortDescription !== undefined) updateValues.shortDescription = raw.shortDescription;
        else if (raw.short_description !== undefined) updateValues.shortDescription = raw.short_description;

        // Problem / Solution
        if (raw.problemStatement !== undefined) updateValues.problemStatement = raw.problemStatement;
        else if (raw.problem_statement !== undefined) updateValues.problemStatement = raw.problem_statement;

        if (raw.solutionStatement !== undefined) updateValues.solutionStatement = raw.solutionStatement;
        else if (raw.solution_statement !== undefined) updateValues.solutionStatement = raw.solution_statement;
        else if (raw.solution_overview !== undefined) updateValues.solutionStatement = raw.solution_overview; // legacy

        // Category
        if (raw.category !== undefined) updateValues.category = raw.category;
        else if (raw.project_type !== undefined) updateValues.category = raw.project_type;
        else if (raw.custom_project_type !== undefined) updateValues.category = raw.custom_project_type;

        // Tags / Skills parsing
        let tagsArray: string[] = [];
        let skillsArray: string[] = [];

        if (raw.tags !== undefined) tagsArray = Array.isArray(raw.tags) ? raw.tags : [];
        if (raw.skills !== undefined) skillsArray = Array.isArray(raw.skills) ? raw.skills : [];
        else if (raw.technologies_used !== undefined) skillsArray = Array.isArray(raw.technologies_used) ? raw.technologies_used : [];

        if (raw.tags !== undefined) updateValues.tags = tagsArray; // Keep JSONB arrays in sync for backward compat
        if (raw.skills !== undefined || raw.technologies_used !== undefined) updateValues.skills = skillsArray;

        // Lifecycle
        if (raw.lifecycleStages !== undefined) updateValues.lifecycleStages = raw.lifecycleStages;
        else if (raw.lifecycle_stages !== undefined) updateValues.lifecycleStages = raw.lifecycle_stages;

        if (raw.currentStageIndex !== undefined) updateValues.currentStageIndex = raw.currentStageIndex;
        else if (raw.current_stage_index !== undefined) updateValues.currentStageIndex = raw.current_stage_index;

        await tx.update(projects).set(updateValues).where(eq(projects.id, projectId));

        // Sync Junction Tables for normalized relational search
        if (raw.tags !== undefined) {
            await tx.delete(projectTags).where(eq(projectTags.projectId, projectId));
            for (const tagName of tagsArray) {
                const slug = tagName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                if (!slug) continue;
                let [tag] = await tx.select().from(tags).where(eq(tags.slug, slug)).limit(1);
                if (!tag) {
                    try {
                        [tag] = await tx.insert(tags).values({ name: tagName, slug }).returning();
                    } catch (e) {
                        // Concurrent insert collision safe fallback
                        [tag] = await tx.select().from(tags).where(eq(tags.slug, slug)).limit(1);
                    }
                }
                if (tag) await tx.insert(projectTags).values({ projectId, tagId: tag.id }).onConflictDoNothing();
            }
        }

        if (raw.skills !== undefined || raw.technologies_used !== undefined) {
            await tx.delete(projectSkills).where(eq(projectSkills.projectId, projectId));
            for (const skillName of skillsArray) {
                const slug = skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                if (!slug) continue;
                let [skill] = await tx.select().from(skills).where(eq(skills.slug, slug)).limit(1);
                if (!skill) {
                    try {
                        [skill] = await tx.insert(skills).values({ name: skillName, slug }).returning();
                    } catch (e) {
                        [skill] = await tx.select().from(skills).where(eq(skills.slug, slug)).limit(1);
                    }
                }
                if (skill) await tx.insert(projectSkills).values({ projectId, skillId: skill.id }).onConflictDoNothing();
            }
        }

        // Update Roles
        if (roles && Array.isArray(roles)) {
            if (deletedRoleIds?.length > 0) {
                await tx.delete(projectOpenRoles).where(inArray(projectOpenRoles.id, deletedRoleIds));
            }

            for (const role of roles) {
                if (role.id) {
                    await tx.update(projectOpenRoles)
                        .set({
                            role: role.role,
                            count: role.count,
                            description: role.description || "",
                            skills: role.skills || [],
                            updatedAt: new Date(),
                        })
                        .where(eq(projectOpenRoles.id, role.id));
                } else {
                    await tx.insert(projectOpenRoles)
                        .values({
                            projectId: project.id,
                            role: role.role,
                            count: role.count || 1,
                            description: role.description || "",
                            skills: role.skills || [],
                        });
                }
            }
        }

        return { success: true, slug: project.slug, id: project.id };
    }).then(({ success, slug, id }) => {
        revalidatePath(`/projects/${slug}`);
        revalidatePath(`/projects/${id}`);
        return { success };
    });
}

type ProjectSettingsErrorCode =
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'INVALID_INPUT'
    | 'INTERNAL_ERROR';

type ProjectSettingsMutationResult =
    | { success: true; message: string }
    | { success: false; message: string; errorCode: ProjectSettingsErrorCode };

type ProjectDangerZonePreflightResult =
    | {
        success: true;
        data: {
            status: 'draft' | 'active' | 'completed' | 'archived';
            openRolesCount: number;
            pendingApplicationsCount: number;
            activeTasksCount: number;
            canFinalize: boolean;
            canArchive: boolean;
            canDelete: boolean;
            finalizeBlockers: string[];
        };
    }
    | { success: false; message: string; errorCode: ProjectSettingsErrorCode };

const projectSettingsPatchSchema = z.object({
    visibility: z.enum(['public', 'private', 'unlisted']).optional(),
    lookingForCollaborators: z.boolean().optional(),
    maxCollaborators: z.string().trim().max(32).nullable().optional(),
});

async function loadOwnedProjectForSettings(projectId: string, userId: string) {
    const [project] = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            slug: projects.slug,
            status: projects.status,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    if (!project) {
        return { ok: false as const, errorCode: 'NOT_FOUND' as const, message: 'Project not found.' };
    }
    if (project.ownerId !== userId) {
        return { ok: false as const, errorCode: 'FORBIDDEN' as const, message: 'Only the project owner can change settings.' };
    }
    return { ok: true as const, project };
}

export async function updateProjectSettingsAction(
    projectId: string,
    patch: {
        visibility?: 'public' | 'private' | 'unlisted';
        lookingForCollaborators?: boolean;
        maxCollaborators?: string | null;
    }
): Promise<ProjectSettingsMutationResult> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, errorCode: 'UNAUTHORIZED', message: 'You must be signed in.' };
        }

        const parsed = projectSettingsPatchSchema.safeParse(patch ?? {});
        if (!parsed.success) {
            return { success: false, errorCode: 'INVALID_INPUT', message: 'Invalid settings payload.' };
        }

        const owned = await loadOwnedProjectForSettings(projectId, user.id);
        if (!owned.ok) return { success: false, errorCode: owned.errorCode, message: owned.message };

        const data = parsed.data;
        const updateValues: Partial<typeof projects.$inferInsert> & { updatedAt: Date } = {
            updatedAt: new Date(),
        };

        if (data.visibility !== undefined) updateValues.visibility = data.visibility;
        if (data.lookingForCollaborators !== undefined) {
            updateValues.lookingForCollaborators = data.lookingForCollaborators;
        }
        if (data.maxCollaborators !== undefined) {
            const trimmed = data.maxCollaborators?.trim() ?? null;
            updateValues.maxCollaborators = trimmed && trimmed.length > 0 ? trimmed : null;
        }

        if (Object.keys(updateValues).length === 1) {
            return { success: true, message: 'No settings changes to save.' };
        }

        await db.update(projects).set(updateValues).where(eq(projects.id, projectId));
        await revalidateProjectPaths(projectId);

        logger.metric('project.settings.update.result', {
            projectId,
            userId: user.id,
            result: 'success',
        });

        return { success: true, message: 'Project settings updated.' };
    } catch (error) {
        console.error('Failed to update project settings:', error);
        logger.metric('project.settings.update.result', {
            projectId,
            result: 'error',
            errorCode: 'INTERNAL_ERROR',
        });
        return { success: false, errorCode: 'INTERNAL_ERROR', message: 'Failed to update project settings.' };
    }
}

export async function getProjectDangerZonePreflightAction(
    projectId: string
): Promise<ProjectDangerZonePreflightResult> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, errorCode: 'UNAUTHORIZED', message: 'You must be signed in.' };
        }

        const owned = await loadOwnedProjectForSettings(projectId, user.id);
        if (!owned.ok) return { success: false, errorCode: owned.errorCode, message: owned.message };

        const [openRolesRow, pendingAppsRow, activeTasksRow] = await Promise.all([
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(projectOpenRoles)
                .where(eq(projectOpenRoles.projectId, projectId))
                .limit(1),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(roleApplications)
                .where(and(eq(roleApplications.projectId, projectId), eq(roleApplications.status, 'pending')))
                .limit(1),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(tasks)
                .where(and(eq(tasks.projectId, projectId), sql`${tasks.status} <> 'done'`))
                .limit(1),
        ]);

        const status = (owned.project.status === 'draft' ||
            owned.project.status === 'active' ||
            owned.project.status === 'completed' ||
            owned.project.status === 'archived')
            ? owned.project.status
            : 'draft';
        const activeTasksCount = Number(activeTasksRow[0]?.count ?? 0);
        const openRolesCount = Number(openRolesRow[0]?.count ?? 0);
        const pendingApplicationsCount = Number(pendingAppsRow[0]?.count ?? 0);
        const finalizeBlockers: string[] = [];
        if (activeTasksCount > 0) {
            finalizeBlockers.push(`There are ${activeTasksCount} non-completed tasks.`);
        }
        if (pendingApplicationsCount > 0) {
            finalizeBlockers.push(`There are ${pendingApplicationsCount} pending applications.`);
        }

        return {
            success: true,
            data: {
                status,
                openRolesCount,
                pendingApplicationsCount,
                activeTasksCount,
                canFinalize: status !== 'completed' && status !== 'archived' && finalizeBlockers.length === 0,
                canArchive: status !== 'archived',
                canDelete: true,
                finalizeBlockers,
            },
        };
    } catch (error) {
        console.error('Failed to run danger-zone preflight:', error);
        return { success: false, errorCode: 'INTERNAL_ERROR', message: 'Failed to prepare danger-zone checks.' };
    }
}

export async function archiveProjectAction(projectId: string): Promise<ProjectSettingsMutationResult> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, errorCode: 'UNAUTHORIZED', message: 'You must be signed in.' };
        }

        const owned = await loadOwnedProjectForSettings(projectId, user.id);
        if (!owned.ok) return { success: false, errorCode: owned.errorCode, message: owned.message };
        if (owned.project.status === 'archived') {
            return { success: true, message: 'Project is already archived.' };
        }

        await db
            .update(projects)
            .set({ status: 'archived', updatedAt: new Date() })
            .where(eq(projects.id, projectId));
        await revalidateProjectPaths(projectId);

        logger.metric('project.settings.archive.result', {
            projectId,
            userId: user.id,
            result: 'success',
        });
        return { success: true, message: 'Project archived.' };
    } catch (error) {
        console.error('Failed to archive project:', error);
        logger.metric('project.settings.archive.result', {
            projectId,
            result: 'error',
            errorCode: 'INTERNAL_ERROR',
        });
        return { success: false, errorCode: 'INTERNAL_ERROR', message: 'Failed to archive project.' };
    }
}

// --- Delete Action ---
export async function deleteProject(projectId: string): Promise<
    | { success: true; message: string; data: { redirectTo: string } }
    | { success: false; message: string; errorCode: ProjectSettingsErrorCode }
> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, errorCode: 'UNAUTHORIZED', message: 'You must be signed in.' };
        }

        // Check ownership and get conversationId
        const [project] = await db.select({
            ownerId: projects.ownerId,
            conversationId: projects.conversationId,
            slug: projects.slug
        })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) {
            return { success: false, errorCode: 'NOT_FOUND', message: 'Project not found.' };
        }
        if (project.ownerId !== user.id) {
            return { success: false, errorCode: 'FORBIDDEN', message: 'Only the project owner can delete this project.' };
        }

        // 1. Get ALL S3 keys for this project before deleting nodes
        const fileNodes = await db.select({ s3Key: projectNodes.s3Key })
            .from(projectNodes)
            .where(and(
                eq(projectNodes.projectId, projectId),
                isNotNull(projectNodes.s3Key)
            ));

        const s3Keys = fileNodes.map(n => n.s3Key!).filter(Boolean);

        // 2. Soft-Delete Transaction (avoids cascade locks at 1M+ scale)
        await db.transaction(async (tx) => {
            const deletedAt = new Date();

            // A. Update application messages to show "project_deleted" status
            await tx.execute(sql`
                UPDATE ${messages}
                SET metadata = jsonb_set(
                    COALESCE(metadata, '{}'::jsonb), 
                    '{status}', 
                    '"project_deleted"'
                )
                WHERE metadata->>'projectId' = ${projectId}
            `);

            // B. Soft-delete the project (sets deletedAt instead of hard DELETE)
            const deletedProjects = await tx.update(projects)
                .set({ deletedAt })
                .where(and(
                    eq(projects.id, projectId),
                    isNull(projects.deletedAt)
                ))
                .returning({ id: projects.id });

            // C. Soft-delete all child nodes
            await tx.update(projectNodes)
                .set({ deletedAt })
                .where(and(
                    eq(projectNodes.projectId, projectId),
                    isNull(projectNodes.deletedAt)
                ));

            // Keep denormalized profile stats in sync only on first soft-delete.
            if (deletedProjects.length > 0) {
                await tx.update(profiles)
                    .set({ projectsCount: sql`GREATEST(0, ${profiles.projectsCount} - 1)` })
                    .where(eq(profiles.id, user.id));
            }
        });

        // 3. Delete files from S3 Storage (Best Effort, outside transaction)
        if (s3Keys.length > 0) {
            try {
                const adminClient = await createAdminClient();
                await adminClient.storage.from("project-files").remove(s3Keys);
            } catch (storageError) {
                console.error("Failed to cleanup S3 files for project:", projectId, storageError);
                // Don't fail the whole action if storage cleanup fails
            }
        }

        logger.metric('project.settings.delete.result', {
            projectId,
            userId: user.id,
            result: 'success',
        });

        revalidatePath("/hub");
        revalidatePath(`/projects/${project.slug || projectId}`);
        return {
            success: true,
            message: "Project deleted successfully.",
            data: { redirectTo: "/hub" },
        };
    } catch (error) {
        console.error("Failed to delete project:", error);
        logger.metric('project.settings.delete.result', {
            projectId,
            result: 'error',
            errorCode: 'INTERNAL_ERROR',
        });
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to delete project.',
        };
    }
}

/**
 * Deep deletion of a project draft.
 * Wipes DB records and S3 assets completely.
 */
export async function deleteProjectDraftAction(projectId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        const [project] = await db.select({
            ownerId: projects.ownerId,
            conversationId: projects.conversationId,
        })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) return { success: true }; // Already gone
        if (project.ownerId !== user.id) throw new Error("Unauthorized");

        // 2. Wipe DB (Atomic transition)
        await db.transaction(async (tx) => {
            // Delete project (cascades to members, roles, etc.)
            await tx.delete(projects).where(eq(projects.id, projectId));
            await tx.update(profiles)
                .set({ projectsCount: sql`GREATEST(0, ${profiles.projectsCount} - 1)` })
                .where(eq(profiles.id, user.id));
            if (project.conversationId) {
                await tx.delete(conversations).where(eq(conversations.id, project.conversationId));
            }
        });

        // 3. Wipe S3 (Best Effort - Deep recursive wipe of entire project prefix)
        try {
            const adminClient = await createAdminClient();

            // Recursive list and delete helper
            const purgeFolder = async (folderPath: string) => {
                const { data: files, error } = await adminClient.storage.from("project-files").list(folderPath, {
                    limit: 1000,
                });

                if (error || !files || files.length === 0) return;

                const filesToDelete = files
                    .filter(f => f.id) // Only files have IDs in some Supabase versions, or check metadata
                    .map(f => `${folderPath}/${f.name}`);

                const subFolders = files
                    .filter(f => !f.id || f.metadata === null) // Folders
                    .map(f => `${folderPath}/${f.name}`);

                // Delete files in this level
                if (filesToDelete.length > 0) {
                    await adminClient.storage.from("project-files").remove(filesToDelete);
                }

                // Recurse into subfolders (Pure optimization: Parallel recursion)
                if (subFolders.length > 0) {
                    await Promise.all(subFolders.map(sf => purgeFolder(sf)));
                }
            };

            await purgeFolder(projectId);
        } catch (storageError) {
            console.error("S3 recursive draft cleanup failed:", storageError);
        }

        revalidatePath("/hub");
        return { success: true };
    } catch (error: any) {
        console.error("Failed to delete draft:", error);
        return { success: false, error: error.message || "Failed to delete draft" };
    }
}

// --- Interaction Actions ---


export async function toggleProjectFollowAction(projectId: string, shouldFollow: boolean) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };
    try {
        const followRate = await consumeRateLimit(`project-follow:${user.id}`, 80, 60);
        if (!followRate.allowed) {
            return { success: false, error: 'Too many follow actions. Please wait and try again.' };
        }

        const followersCount = await db.transaction(async (tx) => {
            await lockProjectUserPair(tx, projectId, user.id);

            if (shouldFollow) {
                const [existing] = await tx
                    .select({ id: projectFollows.id })
                    .from(projectFollows)
                    .where(and(eq(projectFollows.userId, user.id), eq(projectFollows.projectId, projectId)))
                    .limit(1);

                if (!existing) {
                    await tx.insert(projectFollows)
                        .values({ userId: user.id, projectId });

                    const [updated] = await tx.update(projects)
                        .set({ followersCount: sql`${projects.followersCount} + 1` })
                        .where(eq(projects.id, projectId))
                        .returning({ followersCount: projects.followersCount });
                    return updated?.followersCount ?? 0;
                }
            } else {
                const deleted = await tx.delete(projectFollows)
                    .where(and(eq(projectFollows.userId, user.id), eq(projectFollows.projectId, projectId)))
                    .returning({ id: projectFollows.id });

                if (deleted.length > 0) {
                    const [updated] = await tx.update(projects)
                        .set({ followersCount: sql`GREATEST(${projects.followersCount} - 1, 0)` })
                        .where(eq(projects.id, projectId))
                        .returning({ followersCount: projects.followersCount });
                    return updated?.followersCount ?? 0;
                }
            }

            const [row] = await tx
                .select({ followersCount: projects.followersCount })
                .from(projects)
                .where(eq(projects.id, projectId))
                .limit(1);
            return row?.followersCount ?? 0;
        });

        await revalidateProjectPaths(projectId);
        return { success: true, followersCount };
    } catch (error) {
        // Always attempt idempotent fallback through link table + recount.
        if (!isMissingCounterColumn(error, 'followers_count')) {
            console.error('Error toggling follow, trying fallback:', error);
        }
        try {
            if (shouldFollow) {
                const [existing] = await db
                    .select({ id: projectFollows.id })
                    .from(projectFollows)
                    .where(and(eq(projectFollows.userId, user.id), eq(projectFollows.projectId, projectId)))
                    .limit(1);
                if (!existing) {
                    await db.insert(projectFollows)
                        .values({ userId: user.id, projectId });
                }
            } else {
                await db.delete(projectFollows)
                    .where(and(eq(projectFollows.userId, user.id), eq(projectFollows.projectId, projectId)));
            }
            const [countRow] = await db
                .select({ count: sql<number>`count(*)` })
                .from(projectFollows)
                .where(eq(projectFollows.projectId, projectId));
            await revalidateProjectPaths(projectId);
            return { success: true, followersCount: Number(countRow?.count || 0) };
        } catch (fallbackError) {
            console.error('Error toggling follow (fallback):', fallbackError);
            return { success: false, error: 'Failed to update follow status' };
        }
    }
}

export async function incrementProjectViewAction(projectId: string): Promise<{ success: boolean; viewCount?: number; error?: string }> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        const cookieStore = await cookies();
        const anonymousViewerSeed = cookieStore.get('edge-csrf-token')?.value?.trim() || 'anonymous';
        const viewerKey = user?.id
            ? `user:${user.id}`
            : `anon:${createHash('sha256').update(anonymousViewerSeed).digest('hex').slice(0, 16)}`;
        const rateLimit = await consumeRateLimit(`project:view:${projectId}:${viewerKey}`, 1, 60 * 30);
        if (!rateLimit.allowed) {
            const [current] = await db
                .select({ viewCount: projects.viewCount })
                .from(projects)
                .where(eq(projects.id, projectId))
                .limit(1);
            if (!current) {
                return { success: false, error: "Project not found" };
            }
            return { success: true, viewCount: Number(current.viewCount ?? 0) };
        }

        const [updated] = await db.update(projects)
            .set({ viewCount: sql`${projects.viewCount} + 1` })
            .where(eq(projects.id, projectId))
            .returning({ viewCount: projects.viewCount });

        if (!updated) {
            return { success: false, error: "Project not found" };
        }

        // Optional telemetry path only; never the source of truth for UI counters.
        if (redis) {
            void redis.hincrby('project:views:telemetry', projectId, 1).catch((telemetryError) => {
                console.warn("Failed to record project view telemetry", {
                    projectId,
                    error: telemetryError instanceof Error ? telemetryError.message : String(telemetryError),
                });
            });
        }

        return { success: true, viewCount: Number(updated.viewCount ?? 0) };
    } catch (e) {
        if (isMissingCounterColumn(e, 'view_count')) {
            return { success: false, error: "Project views are unavailable until migrations are applied" };
        }
        console.error("Failed to increment view", e);
        return { success: false, error: "Failed to increment view" };
    }
}

export async function getProjectUserStateAction(projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { isFollowing: false, isOwner: false };
    }
    return await runInFlightDeduped(`project:user-state:${projectId}:${user.id}`, async () => {
        const [follow, project] = await Promise.all([
            db.select().from(projectFollows).where(and(eq(projectFollows.projectId, projectId), eq(projectFollows.userId, user.id))).limit(1),
            db.select({ ownerId: projects.ownerId, conversationId: projects.conversationId }).from(projects).where(eq(projects.id, projectId)).limit(1)
        ]);

        // LAZY PROJECT GROUP CREATION: If owner visits and project has no group, create it
        // SYNCHRONOUS: Wait for creation to complete so group is immediately visible
        if (project[0] && !project[0].conversationId && project[0].ownerId === user.id) {
            await ensureProjectGroupExists(projectId, project[0].ownerId);
        }

        return {
            isFollowing: !!follow[0],
            isOwner: project[0]?.ownerId === user.id
        };
    });
}

// Helper: Map wizard status to database status
function mapStatus(status?: string): 'draft' | 'active' | 'completed' | 'archived' {
    switch (status) {
        case 'open':
        case 'active':
            return 'active';
        case 'completed':
            return 'completed';
        case 'archived':
            return 'archived';
        default:
            return 'draft';
    }
}

type TaskPaginationCursor = {
    createdAt: Date;
    id: string;
};

type SprintDetailPaginationCursor = {
    activityAt: Date;
    taskId: string;
};

function parseTaskPaginationCursor(cursor?: string): TaskPaginationCursor | null {
    if (!cursor) return null;

    try {
        const parsed = JSON.parse(cursor) as { createdAt?: unknown; id?: unknown };
        if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string' && parsed.id.length > 0) {
            const parsedDate = new Date(parsed.createdAt);
            if (!Number.isNaN(parsedDate.getTime())) {
                return { createdAt: parsedDate, id: parsed.id };
            }
        }
    } catch {
        // Backward compatibility: legacy cursor was a plain ISO timestamp string.
    }

    const legacyDate = new Date(cursor);
    if (Number.isNaN(legacyDate.getTime())) return null;
    return { createdAt: legacyDate, id: '' };
}

function encodeTaskPaginationCursor(cursor: TaskPaginationCursor): string {
    return JSON.stringify({
        createdAt: cursor.createdAt.toISOString(),
        id: cursor.id,
    });
}

function parseSprintDetailPaginationCursor(cursor?: string): SprintDetailPaginationCursor | null {
    if (!cursor) return null;

    try {
        const parsed = JSON.parse(cursor) as { activityAt?: unknown; taskId?: unknown };
        if (typeof parsed.activityAt === 'string' && typeof parsed.taskId === 'string' && parsed.taskId.length > 0) {
            const parsedDate = new Date(parsed.activityAt);
            if (!Number.isNaN(parsedDate.getTime())) {
                return { activityAt: parsedDate, taskId: parsed.taskId };
            }
        }
    } catch {
        // ignore invalid cursor payloads
    }

    return null;
}

function encodeSprintDetailPaginationCursor(cursor: SprintDetailPaginationCursor): string {
    return JSON.stringify({
        activityAt: cursor.activityAt.toISOString(),
        taskId: cursor.taskId,
    });
}

// ============================================================================
// TASK & SPRINT ACTIONS (PHASE 8 OPTIMIZATION)
// ============================================================================

// --- Fetch Actions (Optimization) ---

export async function fetchProjectTasksAction(
    projectId: string,
    limit: number = 100,
    cursor?: string,
    scope: 'all' | 'backlog' | 'sprint' = 'all'
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const actorId = user?.id ?? null;
        const safeLimit = Math.min(Math.max(limit, 1), 200);
        const normalizedScope = scope === 'backlog' || scope === 'sprint' ? scope : 'all';
        const parsedCursor = parseTaskPaginationCursor(cursor);
        const cursorCreatedAtKey = parsedCursor?.createdAt.toISOString() ?? 'head';
        const cursorIdKey = parsedCursor?.id || 'none';

        return await runInFlightDeduped(
            `project:tasks:${projectId}:${actorId ?? 'anon'}:${safeLimit}:${cursorCreatedAtKey}:${cursorIdKey}:${normalizedScope}`,
            async () => {
                // Enforce read access server-side (public/unlisted or member/owner).
                await assertProjectReadAccess(projectId, actorId);

                const projectTasks = await db.query.tasks.findMany({
                    where: (t, { eq, and, or, lt, isNull, isNotNull }) => and(
                        eq(t.projectId, projectId),
                        parsedCursor
                            ? or(
                                lt(t.createdAt, parsedCursor.createdAt),
                                and(eq(t.createdAt, parsedCursor.createdAt), lt(t.id, parsedCursor.id)),
                            )
                            : undefined,
                        normalizedScope === 'backlog'
                            ? isNull(t.sprintId)
                            : normalizedScope === 'sprint'
                                ? isNotNull(t.sprintId)
                                : undefined
                    ),
                    orderBy: (t, { desc }) => [desc(t.createdAt), desc(t.id)],
                    limit: safeLimit + 1,
                    columns: {
                        id: true,
                        projectId: true,
                        sprintId: true,
                        assigneeId: true,
                        creatorId: true,
                        title: true,
                        description: true,
                        status: true,
                        priority: true,
                        taskNumber: true,
                        storyPoints: true,
                        dueDate: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                    with: {
                        project: {
                            columns: { key: true },
                        },
                        sprint: {
                            columns: {
                                id: true,
                                name: true,
                                status: true,
                            },
                        },
                        assignee: {
                            columns: {
                                id: true,
                                fullName: true,
                                avatarUrl: true,
                            },
                        },
                        creator: {
                            columns: {
                                id: true,
                                fullName: true,
                                avatarUrl: true,
                            },
                        },
                    },
                });

                const hasMore = projectTasks.length > safeLimit;
                const tasks = projectTasks.slice(0, safeLimit).map((task) => normalizeTaskSurfaceRecord(task));
                const nextCursor = hasMore
                    ? encodeTaskPaginationCursor({
                        createdAt: new Date(tasks[tasks.length - 1].createdAt ?? new Date().toISOString()),
                        id: tasks[tasks.length - 1].id,
                    })
                    : undefined;

                return { success: true as const, tasks, nextCursor, hasMore };
            }
        );
    } catch (error) {
        console.error("Failed to fetch tasks:", error);
        return { success: false as const, error: "Failed to fetch tasks" };
    }
}

export async function fetchProjectSprintsAction(projectId: string, limit: number = 120) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const actorId = user?.id ?? null;
        const safeLimit = Math.min(Math.max(limit, 1), 200);

        return await runInFlightDeduped(`project:sprints:${projectId}:${actorId ?? 'anon'}:${safeLimit}`, async () => {
            await assertProjectReadAccess(projectId, actorId);

            const projectSprintsList = await readProjectSprintsList(projectId, safeLimit);

            return { success: true as const, sprints: projectSprintsList };
        });
    } catch (error) {
        console.error("Failed to fetch sprints:", error);
        return { success: false as const, error: "Failed to fetch sprints" };
    }
}

type SprintTaskActivityQueryRow = {
    id: string;
    project_id: string;
    sprint_id: string;
    title: string;
    description: string | null;
    status: SprintTaskTimelineEntity["status"];
    priority: SprintTaskTimelineEntity["priority"];
    task_number: number | null;
    story_points: number | null;
    due_date: Date | string | null;
    created_at: Date | string | null;
    updated_at: Date | string | null;
    activity_at: Date | string | null;
    linked_file_count: number;
    assignee_id: string | null;
    creator_id: string | null;
};

type SprintTaskFileQueryRow = {
    id: string;
    task_id: string;
    node_id: string;
    annotation: string | null;
    linked_at: Date | string | null;
    node_name: string;
    node_path: string;
    node_type: SprintFileTimelineEntity["nodeType"];
};

type SprintNodeEventQueryRow = {
    nodeId: string | null;
    type: string;
    createdAt: Date | string | null;
    actorName: string | null;
};

function toDateValue(value: Date | string | null | undefined): Date | null {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoString(value: Date | string | null | undefined): string | null {
    return toDateValue(value)?.toISOString() ?? null;
}

type SprintSummaryQueryRow = {
    total_tasks: number;
    completed_tasks: number;
    blocked_tasks: number;
    linked_file_count: number;
    total_story_points: number;
    completed_story_points: number;
};

function serializeSprintListItem(sprint: {
    id: string;
    projectId: string;
    name: string;
    goal: string | null;
    description: string | null;
    startDate: Date | null;
    endDate: Date | null;
    status: SprintListItem["status"];
    createdAt: Date | null;
    updatedAt: Date | null;
}): SprintListItem {
    return {
        id: sprint.id,
        projectId: sprint.projectId,
        name: sprint.name,
        goal: sprint.goal ?? null,
        description: sprint.description ?? null,
        startDate: sprint.startDate?.toISOString() ?? null,
        endDate: sprint.endDate?.toISOString() ?? null,
        status: sprint.status,
        createdAt: sprint.createdAt?.toISOString() ?? null,
        updatedAt: sprint.updatedAt?.toISOString() ?? null,
    };
}

async function readProjectSprintsList(projectId: string, limit: number) {
    const readSprints = async (supportsDescription: boolean) => {
        if (supportsDescription) {
            return db
                .select({
                    id: projectSprints.id,
                    projectId: projectSprints.projectId,
                    name: projectSprints.name,
                    goal: projectSprints.goal,
                    description: projectSprints.description,
                    startDate: projectSprints.startDate,
                    endDate: projectSprints.endDate,
                    status: projectSprints.status,
                    createdAt: projectSprints.createdAt,
                    updatedAt: projectSprints.updatedAt,
                })
                .from(projectSprints)
                .where(eq(projectSprints.projectId, projectId))
                .orderBy(
                    sql`CASE WHEN ${projectSprints.status} = 'active' THEN 0 WHEN ${projectSprints.status} = 'planning' THEN 1 ELSE 2 END`,
                    desc(projectSprints.createdAt),
                )
                .limit(limit);
        }

        return db
            .select({
                id: projectSprints.id,
                projectId: projectSprints.projectId,
                name: projectSprints.name,
                goal: projectSprints.goal,
                startDate: projectSprints.startDate,
                endDate: projectSprints.endDate,
                status: projectSprints.status,
                createdAt: projectSprints.createdAt,
                updatedAt: projectSprints.updatedAt,
            })
            .from(projectSprints)
            .where(eq(projectSprints.projectId, projectId))
            .orderBy(
                sql`CASE WHEN ${projectSprints.status} = 'active' THEN 0 WHEN ${projectSprints.status} = 'planning' THEN 1 ELSE 2 END`,
                desc(projectSprints.createdAt),
            )
            .limit(limit)
            .then((rows) => rows.map((row) => ({ ...row, description: null })));
    };

    const supportsDescription = await hasProjectSprintDescriptionColumn();

    try {
        const rows = await readSprints(supportsDescription);
        return rows.map(serializeSprintListItem);
    } catch (error) {
        if (supportsDescription && isMissingColumn(error, 'description')) {
            sprintDescriptionColumnSupport = false;
            const rows = await readSprints(false);
            return rows.map(serializeSprintListItem);
        }
        throw error;
    }
}

async function readSprintSummary(sprintId: string) {
    const rows = await db.execute<SprintSummaryQueryRow>(sql`
        SELECT
            (SELECT COUNT(*)::int FROM ${tasks} t WHERE t.sprint_id = ${sprintId} AND t.deleted_at IS NULL) AS total_tasks,
            (SELECT COUNT(*)::int FROM ${tasks} t WHERE t.sprint_id = ${sprintId} AND t.deleted_at IS NULL AND t.status = 'done') AS completed_tasks,
            (SELECT COUNT(*)::int FROM ${tasks} t WHERE t.sprint_id = ${sprintId} AND t.deleted_at IS NULL AND t.status = 'blocked') AS blocked_tasks,
            (
                SELECT COUNT(*)::int
                FROM ${taskNodeLinks} lnk
                INNER JOIN ${tasks} t ON t.id = lnk.task_id
                WHERE t.sprint_id = ${sprintId} AND t.deleted_at IS NULL
            ) AS linked_file_count,
            (
                SELECT COALESCE(SUM(COALESCE(t.story_points, 0)), 0)::int
                FROM ${tasks} t
                WHERE t.sprint_id = ${sprintId} AND t.deleted_at IS NULL
            ) AS total_story_points,
            (
                SELECT COALESCE(SUM(COALESCE(t.story_points, 0)), 0)::int
                FROM ${tasks} t
                WHERE t.sprint_id = ${sprintId} AND t.deleted_at IS NULL AND t.status = 'done'
            ) AS completed_story_points
    `);

    const row = Array.from(rows)[0] ?? {
        total_tasks: 0,
        completed_tasks: 0,
        blocked_tasks: 0,
        linked_file_count: 0,
        total_story_points: 0,
        completed_story_points: 0,
    };

    return buildSprintHealthSummary({
        totalTasks: Number(row.total_tasks || 0),
        completedTasks: Number(row.completed_tasks || 0),
        blockedTasks: Number(row.blocked_tasks || 0),
        linkedFileCount: Number(row.linked_file_count || 0),
        totalStoryPoints: Number(row.total_story_points || 0),
        completedStoryPoints: Number(row.completed_story_points || 0),
    });
}

async function readSprintTaskActivityPage(input: {
    projectId: string;
    sprintId: string;
    limit: number;
    cursor: SprintDetailPaginationCursor | null;
}) {
    const { projectId, sprintId, limit, cursor } = input;

    const activityRowsResult = await db.execute<SprintTaskActivityQueryRow>(sql`
        WITH task_activity AS (
            SELECT
                t.id,
                t.project_id,
                t.sprint_id,
                t.title,
                t.description,
                t.status,
                t.priority,
                t.task_number,
                t.story_points,
                t.due_date,
                t.created_at,
                t.updated_at,
                t.assignee_id,
                t.creator_id,
                GREATEST(t.updated_at, COALESCE(MAX(lnk.linked_at), t.created_at)) AS activity_at,
                COUNT(lnk.node_id)::int AS linked_file_count
            FROM ${tasks} t
            LEFT JOIN ${taskNodeLinks} lnk ON lnk.task_id = t.id
            WHERE t.sprint_id = ${sprintId}
              AND t.deleted_at IS NULL
            GROUP BY t.id
        )
        SELECT *
        FROM task_activity
        ${cursor
            ? sql`WHERE (
                activity_at > ${cursor.activityAt}
                OR (activity_at = ${cursor.activityAt} AND id > ${cursor.taskId})
            )`
            : sql``}
        ORDER BY activity_at ASC, id ASC
        LIMIT ${limit + 1}
    `);

    const activityRows = Array.from(activityRowsResult);
    const hasMore = activityRows.length > limit;
    const pageRows = hasMore ? activityRows.slice(0, limit) : activityRows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursorActivityAt = toDateValue(lastRow?.activity_at);
    const nextCursor = hasMore && nextCursorActivityAt
        ? encodeSprintDetailPaginationCursor({
            activityAt: nextCursorActivityAt,
            taskId: lastRow.id,
        })
        : null;

    const taskIds = pageRows.map((row) => row.id);
    const actorIds = Array.from(
        new Set(
            pageRows.flatMap((row) => [row.assignee_id, row.creator_id]).filter((value): value is string => !!value),
        ),
    );

    const actorRows = actorIds.length > 0
        ? await db
            .select({
                id: profiles.id,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
            })
            .from(profiles)
            .where(inArray(profiles.id, actorIds))
        : [];

    const actorById = new Map(actorRows.map((row) => [row.id, row]));

    const fileRows = taskIds.length > 0
        ? Array.from(
            await db.execute<SprintTaskFileQueryRow>(sql`
                SELECT
                    lnk.id,
                    lnk.task_id,
                    lnk.node_id,
                    lnk.annotation,
                    lnk.linked_at,
                    pn.name AS node_name,
                    pn.path AS node_path,
                    pn.type AS node_type
                FROM ${taskNodeLinks} lnk
                INNER JOIN ${projectNodes} pn ON pn.id = lnk.node_id
                WHERE lnk.task_id IN (${sql.join(taskIds.map((taskId) => sql`${taskId}`), sql`, `)})
                  AND pn.project_id = ${projectId}
                  AND pn.deleted_at IS NULL
                ORDER BY lnk.linked_at ASC, lnk.id ASC
            `),
        )
        : [];

    const nodeIds = Array.from(new Set(fileRows.map((row) => row.node_id).filter((value): value is string => !!value)));
    const nodeEventRows = nodeIds.length > 0
        ? await db
            .select({
                nodeId: projectNodeEvents.nodeId,
                type: projectNodeEvents.type,
                createdAt: projectNodeEvents.createdAt,
                actorName: profiles.fullName,
            })
            .from(projectNodeEvents)
            .leftJoin(profiles, eq(profiles.id, projectNodeEvents.actorId))
            .where(
                and(
                    eq(projectNodeEvents.projectId, projectId),
                    inArray(projectNodeEvents.nodeId, nodeIds),
                ),
            )
            .orderBy(desc(projectNodeEvents.createdAt))
        : [];

    const latestNodeEventByNodeId = new Map<string, SprintNodeEventQueryRow>();
    for (const eventRow of nodeEventRows) {
        if (!eventRow.nodeId || latestNodeEventByNodeId.has(eventRow.nodeId)) continue;
        latestNodeEventByNodeId.set(eventRow.nodeId, eventRow);
    }

    const filesByTaskId = new Map<string, SprintFileTimelineEntity[]>();
    for (const fileRow of fileRows) {
        const latestNodeEvent = latestNodeEventByNodeId.get(fileRow.node_id);
        const current = filesByTaskId.get(fileRow.task_id) ?? [];
        current.push({
            id: fileRow.id,
            taskId: fileRow.task_id,
            nodeId: fileRow.node_id,
            nodeName: fileRow.node_name,
            nodePath: fileRow.node_path,
            nodeType: fileRow.node_type,
            annotation: fileRow.annotation ?? null,
            linkedAt: toIsoString(fileRow.linked_at),
            lastEventType: latestNodeEvent?.type ?? null,
            lastEventAt: toIsoString(latestNodeEvent?.createdAt),
            lastEventBy: latestNodeEvent?.actorName ?? null,
        });
        filesByTaskId.set(fileRow.task_id, current);
    }

    const tasksPage: SprintTimelineTaskInput[] = pageRows.map((row) => ({
        id: row.id,
        projectId: row.project_id,
        sprintId: row.sprint_id,
        taskNumber: row.task_number ?? null,
        title: row.title,
        description: row.description ?? null,
        status: row.status,
        priority: row.priority,
        storyPoints: row.story_points ?? null,
        dueDate: toIsoString(row.due_date),
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at),
        activityAt: toIsoString(row.activity_at) ?? toIsoString(row.updated_at) ?? toIsoString(row.created_at) ?? null,
        linkedFileCount: Number(row.linked_file_count || 0),
        assignee: row.assignee_id
            ? actorById.get(row.assignee_id)
                ? {
                    id: row.assignee_id,
                    fullName: actorById.get(row.assignee_id)?.fullName ?? null,
                    avatarUrl: actorById.get(row.assignee_id)?.avatarUrl ?? null,
                }
                : null
            : null,
        creator: row.creator_id
            ? actorById.get(row.creator_id)
                ? {
                    id: row.creator_id,
                    fullName: actorById.get(row.creator_id)?.fullName ?? null,
                    avatarUrl: actorById.get(row.creator_id)?.avatarUrl ?? null,
                }
                : null
            : null,
        files: filesByTaskId.get(row.id) ?? [],
    }));

    return {
        tasks: tasksPage,
        hasMore,
        nextCursor,
    };
}

async function buildSprintDetailPayload(input: {
    projectId: string;
    access: ProjectAccess;
    sprintId?: string | null;
    cursor?: string;
    limit?: number;
}): Promise<SprintDetailPayload | null> {
    const safeLimit = Math.min(Math.max(input.limit ?? 24, 1), 50);
    const parsedCursor = parseSprintDetailPaginationCursor(input.cursor);

    const access = input.access;
    if (!access.project) throw new Error("Project not found");
    if (!access.canRead) throw new Error("Forbidden");
    const permissions = buildSprintPermissionSet({
        canRead: access.canRead,
        canWrite: access.canWrite,
        isOwner: access.isOwner,
        isMember: access.isMember,
        memberRole: access.memberRole,
    });

    const sprints = await readProjectSprintsList(input.projectId, 120);
    const selectedSprint =
        (input.sprintId ? sprints.find((sprint) => sprint.id === input.sprintId) : null)
        ?? sprints.find((sprint) => sprint.status === 'active')
        ?? sprints[0]
        ?? null;

    if (input.sprintId && !selectedSprint) {
        return null;
    }

    if (!selectedSprint) {
        return {
            projectId: input.projectId,
            projectSlug: access.project.slug ?? null,
            sprints,
            selectedSprintId: null,
            permissions,
            timelineMode: 'chronological',
            summary: null,
            compareSummary: null,
            filterCounts: buildSprintFilterCounts({
                totalTasks: 0,
                completedTasks: 0,
                blockedTasks: 0,
                linkedFileCount: 0,
            }),
            rows: [],
            drawerPreviews: [],
            nextCursor: null,
            hasMore: false,
        };
    }

    if (input.sprintId && selectedSprint.id !== input.sprintId) {
        return null;
    }

    const previousSprint = findPreviousSprintBaseline(sprints, selectedSprint.id);

    const [summary, previousSummary, taskPage] = await Promise.all([
        readSprintSummary(selectedSprint.id),
        previousSprint ? readSprintSummary(previousSprint.id) : Promise.resolve(null),
        readSprintTaskActivityPage({
            projectId: input.projectId,
            sprintId: selectedSprint.id,
            limit: safeLimit,
            cursor: parsedCursor,
        }),
    ]);

    const rows = buildSprintTimeline({
        sprint: selectedSprint,
        tasks: taskPage.tasks,
        summary,
        includeKickoff: !parsedCursor,
        includeCloseout: !taskPage.hasMore,
    });

    const filterCounts = buildSprintFilterCounts({
        totalTasks: summary.totalTasks,
        completedTasks: summary.completedTasks,
        blockedTasks: summary.blockedTasks,
        linkedFileCount: summary.linkedFileCount,
    });

    const drawerPreviews = buildSprintDrawerPreviews(rows);
    const compareSummary = buildSprintCompareSummary({
        selectedSprint,
        summary,
        previousSprint,
        previousSummary,
    });

    return {
        projectId: input.projectId,
        projectSlug: access.project.slug ?? null,
        sprints,
        selectedSprintId: selectedSprint.id,
        permissions,
        timelineMode: 'chronological',
        summary,
        compareSummary,
        filterCounts,
        rows,
        drawerPreviews,
        nextCursor: taskPage.nextCursor,
        hasMore: taskPage.hasMore,
    };
}

export async function fetchProjectSprintDetailAction(input: {
    projectId: string;
    sprintId?: string | null;
    cursor?: string;
    limit?: number;
}) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const actorId = user?.id ?? null;
        const cursorKey = input.cursor ?? 'head';
        const sprintKey = input.sprintId ?? 'default';

        const startedAt = Date.now();
        const data = await runInFlightDeduped(
            `project:sprint-detail:${input.projectId}:${sprintKey}:${actorId ?? 'anon'}:${cursorKey}:${input.limit ?? 24}`,
            async () => {
                const access = await getProjectAccessById(input.projectId, actorId);
                if (!access.project) {
                    throw new Error("Project not found");
                }

                return buildSprintDetailPayload({
                    projectId: input.projectId,
                    access,
                    sprintId: input.sprintId ?? null,
                    cursor: input.cursor,
                    limit: input.limit,
                });
            },
        );

        if (!data) {
            return { success: false as const, error: "Sprint not found" };
        }

        recordSprintMetric('project.sprint.detail.load_ms', {
            projectId: input.projectId,
            sprintId: data.selectedSprintId,
            durationMs: Date.now() - startedAt,
            rowCount: data.rows.length,
            hasMore: data.hasMore,
        });

        recordSprintMetric('project.sprint.timeline.rows', {
            projectId: input.projectId,
            sprintId: data.selectedSprintId,
            kickoffRows: data.rows.filter((row) => row.kind === 'kickoff').length,
            taskRows: data.rows.filter((row) => row.kind === 'task').length,
            fileRows: data.rows.filter((row) => row.kind === 'file').length,
            closeoutRows: data.rows.filter((row) => row.kind === 'closeout').length,
        });

        return { success: true as const, data };
    } catch (error) {
        console.error("Failed to fetch sprint detail:", error);
        return { success: false as const, error: "Failed to fetch sprint detail" };
    }
}

export async function readProjectSprintDetail(input: {
    slugOrId: string;
    sprintId?: string | null;
    actorUserId?: string | null;
    cursor?: string;
    limit?: number;
}) {
    try {
        const project = await resolveProjectDetailTarget(input.slugOrId);
        if (!project) {
            return {
                success: false as const,
                errorCode: 'NOT_FOUND' as const,
                message: 'Project not found.',
            };
        }

        const viewerState = await resolveProjectDetailViewerState({
            projectId: project.id,
            ownerId: project.ownerId,
            visibility: project.visibility,
            status: project.status,
            actorUserId: input.actorUserId ?? null,
        });

        if (!viewerState.canRead) {
            return {
                success: false as const,
                errorCode: 'FORBIDDEN' as const,
                message: 'Forbidden',
            };
        }

        const access = await assertProjectReadAccess(project.id, input.actorUserId ?? null);
        const data = await buildSprintDetailPayload({
            projectId: project.id,
            access,
            sprintId: input.sprintId ?? null,
            cursor: input.cursor,
            limit: input.limit,
        });

        if (!data) {
            return {
                success: false as const,
                errorCode: 'NOT_FOUND' as const,
                message: 'Sprint not found.',
            };
        }

        return {
            success: true as const,
            data,
        };
    } catch (error) {
        console.error('[readProjectSprintDetail] failed', error);
        return {
            success: false as const,
            errorCode: 'INTERNAL_ERROR' as const,
            message: 'Failed to load sprint detail.',
        };
    }
}

export async function fetchSprintTasksAction(
    sprintId: string,
    limit: number = 50,
    cursor?: string
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const actorId = user?.id ?? null;
        const safeLimit = Math.min(Math.max(limit, 1), 200);
        const parsedCursor = parseTaskPaginationCursor(cursor);
        const cursorCreatedAtKey = parsedCursor?.createdAt.toISOString() ?? 'head';
        const cursorIdKey = parsedCursor?.id || 'none';

        return await runInFlightDeduped(
            `project:sprint-tasks:${sprintId}:${actorId ?? 'anon'}:${safeLimit}:${cursorCreatedAtKey}:${cursorIdKey}`,
            async () => {
                const [sprint] = await db
                    .select({ projectId: projectSprints.projectId })
                    .from(projectSprints)
                    .where(eq(projectSprints.id, sprintId))
                    .limit(1);

                if (!sprint) {
                    return { success: false as const, error: "Sprint not found" };
                }

                await assertProjectReadAccess(sprint.projectId, actorId);

                const sprintTasks = await db.query.tasks.findMany({
                    where: (t, { eq, and, or, lt }) => and(
                        eq(t.sprintId, sprintId),
                        parsedCursor
                            ? or(
                                lt(t.createdAt, parsedCursor.createdAt),
                                and(eq(t.createdAt, parsedCursor.createdAt), lt(t.id, parsedCursor.id)),
                            )
                            : undefined
                    ),
                    orderBy: (t, { desc }) => [desc(t.createdAt), desc(t.id)],
                    columns: {
                        id: true,
                        projectId: true,
                        sprintId: true,
                        assigneeId: true,
                        creatorId: true,
                        title: true,
                        description: true,
                        status: true,
                        priority: true,
                        taskNumber: true,
                        storyPoints: true,
                        dueDate: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                    with: {
                        project: {
                            columns: { key: true },
                        },
                        sprint: {
                            columns: {
                                id: true,
                                name: true,
                                status: true,
                            },
                        },
                        assignee: {
                            columns: {
                                id: true,
                                fullName: true,
                                avatarUrl: true,
                            },
                        },
                        creator: {
                            columns: {
                                id: true,
                                fullName: true,
                                avatarUrl: true,
                            },
                        },
                        attachments: {
                            columns: {
                                id: true,
                            },
                        },
                    },
                    limit: safeLimit + 1,
                });

                const hasMore = sprintTasks.length > safeLimit;
                const tasks = sprintTasks.slice(0, safeLimit).map((task) => normalizeTaskSurfaceRecord(task));
                const nextCursor = hasMore
                    ? encodeTaskPaginationCursor({
                        createdAt: new Date(tasks[tasks.length - 1].createdAt ?? new Date().toISOString()),
                        id: tasks[tasks.length - 1].id,
                    })
                    : undefined;

                return { success: true as const, tasks, nextCursor, hasMore };
            }
        );
    } catch (error) {
        console.error("Failed to fetch sprint tasks:", error);
        return { success: false as const, error: "Failed to fetch sprint tasks" };
    }
}

export async function getProjectTaskDetailAction(projectId: string, taskId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        await assertProjectReadAccess(projectId, user?.id ?? null);

        const task = await db.query.tasks.findFirst({
            where: and(
                eq(tasks.id, taskId),
                eq(tasks.projectId, projectId),
                isNull(tasks.deletedAt),
            ),
            columns: {
                id: true,
                projectId: true,
                sprintId: true,
                assigneeId: true,
                creatorId: true,
                title: true,
                description: true,
                status: true,
                priority: true,
                taskNumber: true,
                storyPoints: true,
                dueDate: true,
                createdAt: true,
                updatedAt: true,
            },
            with: {
                project: {
                    columns: { key: true },
                },
                sprint: {
                    columns: {
                        id: true,
                        name: true,
                        status: true,
                    },
                },
                assignee: {
                    columns: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                    },
                },
                creator: {
                    columns: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                    },
                },
            },
        });

        if (!task) {
            return { success: false as const, error: "Task not found" };
        }

        return { success: true as const, task: normalizeTaskSurfaceRecord(task) };
    } catch (error) {
        console.error("Failed to fetch task detail:", error);
        return { success: false as const, error: "Failed to fetch task detail" };
    }
}

export async function getProjectTaskActivityAction(projectId: string, taskId: string, limit: number = 40) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        await assertProjectReadAccess(projectId, user?.id ?? null);

        const safeLimit = Math.min(Math.max(limit, 1), 100);
        const task = await db.query.tasks.findFirst({
            where: and(
                eq(tasks.id, taskId),
                eq(tasks.projectId, projectId),
                isNull(tasks.deletedAt),
            ),
            columns: {
                id: true,
                title: true,
                createdAt: true,
                updatedAt: true,
            },
            with: {
                creator: {
                    columns: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                    },
                },
            },
        });

        if (!task) {
            return { success: false as const, error: "Task not found" };
        }

        const [comments, subtasks, links] = await Promise.all([
            db.query.taskComments.findMany({
                where: eq(taskComments.taskId, taskId),
                columns: {
                    id: true,
                    content: true,
                    createdAt: true,
                },
                with: {
                    user: {
                        columns: {
                            id: true,
                            fullName: true,
                            avatarUrl: true,
                        },
                    },
                },
                orderBy: (table, { desc }) => [desc(table.createdAt)],
                limit: safeLimit,
            }),
            db.query.taskSubtasks.findMany({
                where: eq(taskSubtasks.taskId, taskId),
                columns: {
                    id: true,
                    title: true,
                    completed: true,
                    createdAt: true,
                    updatedAt: true,
                },
                orderBy: (table, { desc }) => [desc(table.updatedAt)],
                limit: safeLimit,
            }),
            db.query.taskNodeLinks.findMany({
                where: eq(taskNodeLinks.taskId, taskId),
                columns: {
                    id: true,
                    linkedAt: true,
                },
                with: {
                    creator: {
                        columns: {
                            id: true,
                            fullName: true,
                            avatarUrl: true,
                        },
                    },
                    node: {
                        columns: {
                            id: true,
                            name: true,
                        },
                    },
                },
                orderBy: (table, { desc }) => [desc(table.linkedAt)],
                limit: safeLimit,
            }),
        ]);

        const items = buildTaskActivityItems({
            task,
            comments,
            subtasks,
            links,
            limit: safeLimit,
        });

        return { success: true as const, items };
    } catch (error) {
        console.error("Failed to fetch task activity:", error);
        return { success: false as const, error: "Failed to fetch task activity" };
    }
}

export async function getProjectMembersAction(
    projectId: string,
    limit: number = 20,
    cursor?: string
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const actorId = user?.id ?? null;

        const safeLimit = Math.min(Math.max(limit, 1), 100);
        const cursorKey = cursor ?? 'head';

        return await runInFlightDeduped(
            `project:members:${projectId}:${actorId ?? 'anon'}:${safeLimit}:${cursorKey}`,
            async () => {
                await assertProjectReadAccess(projectId, actorId);
                const whereConditions: any[] = [eq(projectMembers.projectId, projectId)];

                if (cursor) {
                    try {
                        const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
                        const [joinedAt, memberId] = decoded.split(':::');
                        if (joinedAt && memberId) {
                            whereConditions.push(
                                sql`(${projectMembers.joinedAt}, ${projectMembers.id}) < (${new Date(joinedAt)}, ${memberId})`
                            );
                        }
                    } catch {
                        // Ignore invalid cursor
                    }
                }

                const membersResult = await db.query.projectMembers.findMany({
                    where: and(...whereConditions),
                    with: {
                        user: {
                            columns: {
                                id: true,
                                username: true,
                                fullName: true,
                                avatarUrl: true,
                            }
                        }
                    },
                    orderBy: (members, { desc }) => [desc(members.joinedAt), desc(members.id)],
                    limit: safeLimit + 1,
                });

                const hasMore = membersResult.length > safeLimit;
                const slice = membersResult.slice(0, safeLimit);
                const last = slice[slice.length - 1];
                const nextCursor = hasMore && last
                    ? Buffer.from(`${last.joinedAt.toISOString()}:::${last.id}`).toString('base64')
                    : undefined;

                const members = slice
                    .map(m => m.user ? ({
                        ...m.user,
                        membershipRole: m.role,
                        joinedAt: m.joinedAt?.toISOString?.() || null,
                    }) : null)
                    .filter(Boolean);

                const memberIds = members.map((m: any) => m.id);
                const acceptedRoleRows = memberIds.length > 0
                    ? await db
                        .select({
                            applicantId: roleApplications.applicantId,
                            roleTitle: projectOpenRoles.title,
                            roleName: projectOpenRoles.role,
                        })
                        .from(roleApplications)
                        .leftJoin(projectOpenRoles, eq(projectOpenRoles.id, roleApplications.roleId))
                        .where(
                            and(
                                eq(roleApplications.projectId, projectId),
                                eq(roleApplications.status, 'accepted'),
                                inArray(roleApplications.applicantId, memberIds)
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

                const membersWithRoleTitles = members.map((member: any) => ({
                    ...member,
                    projectRoleTitle: acceptedRoleByUser.get(member.id) || null,
                }));

                return { success: true as const, members: membersWithRoleTitles, hasMore, nextCursor };
            }
        );
    } catch (error) {
        console.error("Failed to fetch project members:", error);
        return { success: false as const, error: "Failed to fetch project members" };
    }
}

export async function getProjectAnalyticsAction(projectId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const actorId = user?.id ?? null;

        return await runInFlightDeduped(`project:analytics:${projectId}:${actorId ?? 'anon'}`, async () => {
            await assertProjectReadAccess(projectId, actorId);

            const [row] = await db
                .select({
                    totalTasks: sql<number>`count(*)`,
                    completedTasks: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'done')`,
                    inProgressTasks: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'in_progress')`,
                    overdueTasks: sql<number>`count(*) FILTER (WHERE ${tasks.status} != 'done' AND ${tasks.dueDate} IS NOT NULL AND ${tasks.dueDate} < NOW())`,
                    urgentCount: sql<number>`count(*) FILTER (WHERE ${tasks.priority} = 'urgent')`,
                    highCount: sql<number>`count(*) FILTER (WHERE ${tasks.priority} = 'high')`,
                    mediumCount: sql<number>`count(*) FILTER (WHERE ${tasks.priority} = 'medium')`,
                    lowCount: sql<number>`count(*) FILTER (WHERE ${tasks.priority} = 'low')`,
                    tasksCreated7d: sql<number>`count(*) FILTER (WHERE ${tasks.createdAt} >= NOW() - INTERVAL '7 days')`,
                    tasksCreated30d: sql<number>`count(*) FILTER (WHERE ${tasks.createdAt} >= NOW() - INTERVAL '30 days')`,
                    tasksCreated90d: sql<number>`count(*) FILTER (WHERE ${tasks.createdAt} >= NOW() - INTERVAL '90 days')`,
                    tasksCompleted7d: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'done' AND ${tasks.updatedAt} >= NOW() - INTERVAL '7 days')`,
                    tasksCompleted30d: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'done' AND ${tasks.updatedAt} >= NOW() - INTERVAL '30 days')`,
                    tasksCompleted90d: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'done' AND ${tasks.updatedAt} >= NOW() - INTERVAL '90 days')`,
                })
                .from(tasks)
                .where(eq(tasks.projectId, projectId));

            const totalTasks = Number(row?.totalTasks || 0);
            const completedTasks = Number(row?.completedTasks || 0);
            const inProgressTasks = Number(row?.inProgressTasks || 0);
            const overdueTasks = Number(row?.overdueTasks || 0);

            const priorityDistribution = {
                urgent: Number(row?.urgentCount || 0),
                high: Number(row?.highCount || 0),
                medium: Number(row?.mediumCount || 0),
                low: Number(row?.lowCount || 0),
            } as Record<string, number>;
            const activityByWindow = {
                7: {
                    tasksCreated: Number(row?.tasksCreated7d || 0),
                    tasksCompleted: Number(row?.tasksCompleted7d || 0),
                },
                30: {
                    tasksCreated: Number(row?.tasksCreated30d || 0),
                    tasksCompleted: Number(row?.tasksCompleted30d || 0),
                },
                90: {
                    tasksCreated: Number(row?.tasksCreated90d || 0),
                    tasksCompleted: Number(row?.tasksCompleted90d || 0),
                },
            } as const;

            const completionRate = totalTasks > 0
                ? Math.round((completedTasks / totalTasks) * 100)
                : 0;

            return {
                success: true as const,
                analytics: {
                    totalTasks,
                    completedTasks,
                    inProgressTasks,
                    overdueTasks,
                    priorityDistribution,
                    completionRate,
                    activityByWindow,
                }
            };
        });
    } catch (error) {
        console.error("Failed to fetch project analytics:", error);
        return { success: false as const, error: "Failed to fetch project analytics" };
    }
}


const createTaskSchema = z.object({
    projectId: z.string().uuid(),
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    status: taskStatusEnum.default("todo"),
    priority: taskPriorityEnum.default("medium"),
    sprintId: z.string().uuid().optional().nullable(),
    assigneeId: z.string().uuid().optional().nullable(),
    storyPoints: z.number().min(0).optional(),
    dueDate: z.string().optional().nullable(), // ISO String
    subtasks: z.array(z.object({
        title: z.string(),
        completed: z.boolean().default(false)
    })).optional(),
    attachmentNodeIds: z.array(z.string().uuid()).optional()
});

export async function createTaskAction(data: z.infer<typeof createTaskSchema>) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");


        const validated = createTaskSchema.parse(data);
        const access = await getProjectAccessById(validated.projectId, user.id);
        if (!access.project) throw new Error("Project not found");
        if (!access.canWrite) {
            throw new Error("You do not have permission to create tasks in this project");
        }
        if (validated.sprintId && !access.isOwner) {
            throw new Error("Only the project owner can assign new tasks to a sprint");
        }

        if (validated.assigneeId) {
            const assigneeMember = await db.query.projectMembers.findFirst({
                where: and(
                    eq(projectMembers.projectId, validated.projectId),
                    eq(projectMembers.userId, validated.assigneeId)
                ),
                columns: { id: true, role: true },
            });
            if (!assigneeMember) {
                throw new Error("Assignee must be a project member");
            }
            if (assigneeMember.role === 'viewer') {
                throw new Error("Viewer members cannot be assigned tasks");
            }
        }

        const createdTask = await db.transaction(async (tx) => {
            // Lock row to ensure strictly monotonic task number under concurrent creates.
            const counterRows = await tx.execute<{ current_task_number: number }>(sql`
                SELECT current_task_number
                FROM ${projects}
                WHERE id = ${validated.projectId}
                FOR UPDATE
            `);
            const current = Array.from(counterRows)[0];
            if (!current) throw new Error("Project not found");

            const nextTaskNumber = Number(current.current_task_number || 0) + 1;
            await tx.update(projects)
                .set({ currentTaskNumber: nextTaskNumber })
                .where(eq(projects.id, validated.projectId));

            const [newTask] = await tx.insert(tasks).values({
                projectId: validated.projectId,
                title: validated.title.trim(),
                description: validated.description?.trim() || null,
                status: validated.status,
                priority: validated.priority,
                sprintId: validated.sprintId || null,
                assigneeId: validated.assigneeId || null,
                creatorId: user.id,
                storyPoints: validated.storyPoints,
                dueDate: validated.dueDate ? new Date(validated.dueDate) : null,
                taskNumber: nextTaskNumber,
            }).returning({ id: tasks.id });

            if (!newTask) throw new Error("Failed to create task");

            if (validated.attachmentNodeIds && validated.attachmentNodeIds.length > 0) {
                const uniqueAttachmentIds = [...new Set(validated.attachmentNodeIds)];
                const attachmentNodes = await tx.query.projectNodes.findMany({
                    where: and(
                        eq(projectNodes.projectId, validated.projectId),
                        inArray(projectNodes.id, uniqueAttachmentIds),
                        isNull(projectNodes.deletedAt)
                    ),
                    columns: { id: true },
                });
                if (attachmentNodes.length !== uniqueAttachmentIds.length) {
                    throw new Error("One or more attachments are invalid for this project");
                }

                await tx.insert(taskNodeLinks).values(
                    uniqueAttachmentIds.map((nodeId) => ({
                        taskId: newTask.id,
                        nodeId,
                        createdBy: user.id,
                    }))
                ).onConflictDoNothing({
                    target: [taskNodeLinks.taskId, taskNodeLinks.nodeId],
                });
            }

            if (validated.subtasks && validated.subtasks.length > 0) {
                await tx.insert(taskSubtasks).values(
                    validated.subtasks
                        .filter((st) => st.title.trim().length > 0)
                        .map((st, index) => ({
                            taskId: newTask.id,
                            title: st.title.trim(),
                            completed: st.completed,
                            position: index,
                        }))
                );
            }

            return newTask;
        });

        await queueCounterRefreshBestEffort([validated.assigneeId ?? null]);

        const hydratedTask = await db.query.tasks.findFirst({
            where: eq(tasks.id, createdTask.id),
            columns: {
                id: true,
                projectId: true,
                sprintId: true,
                assigneeId: true,
                creatorId: true,
                title: true,
                description: true,
                status: true,
                priority: true,
                taskNumber: true,
                storyPoints: true,
                dueDate: true,
                createdAt: true,
                updatedAt: true,
            },
            with: {
                project: {
                    columns: { key: true },
                },
                sprint: {
                    columns: {
                        id: true,
                        name: true,
                        status: true,
                    },
                },
                assignee: {
                    columns: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                    },
                },
                creator: {
                    columns: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                    },
                },
            },
        });
        if (!hydratedTask) {
            throw new Error("Failed to load created task");
        }

        // Note: We don't need to manually revalidate if we are using Realtime
        // But for fallback and initial load consistency:
        revalidatePath(`/projects/${validated.projectId}`);

        return { success: true, task: normalizeTaskSurfaceRecord(hydratedTask) };
    } catch (error) {
        console.error("Failed to create task:", error);
        const message = error instanceof Error ? error.message : "Failed to create task";
        return { success: false, error: message.includes("Failed query:") ? "Failed to create task" : message };
    }
}

export async function createSprintAction(data: CreateSprintInput) {
    let actorIdForMetric: string | null = null;
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");
        actorIdForMetric = user.id;

        const validated = createSprintSchema.parse(data);
        const startDate = parseSprintDateInput(validated.startDate);
        const endDate = parseSprintDateInput(validated.endDate);

        const access = await getProjectAccessById(validated.projectId, user.id);
        if (!access.project) throw new Error("Project not found");
        if (!access.isOwner) {
            throw new Error("You do not have permission to create sprints in this project");
        }

        const supportsDescription = await hasProjectSprintDescriptionColumn();
        const sprintValues: typeof projectSprints.$inferInsert = {
            projectId: validated.projectId,
            name: validated.name,
            goal: validated.goal ?? null,
            startDate,
            endDate,
            status: 'planning',
        };
        if (supportsDescription) {
            sprintValues.description = validated.description ?? null;
        }

        let newSprint:
            | {
                id: string;
                projectId: string;
                name: string;
                goal: string | null;
                description: string | null;
                startDate: Date | null;
                endDate: Date | null;
                status: SprintListItem["status"];
                createdAt: Date | null;
                updatedAt: Date | null;
            }
            | undefined;
        try {
            [newSprint] = await db.insert(projectSprints).values(sprintValues).returning({
                id: projectSprints.id,
                projectId: projectSprints.projectId,
                name: projectSprints.name,
                goal: projectSprints.goal,
                description: supportsDescription ? projectSprints.description : sql<string | null>`null`,
                startDate: projectSprints.startDate,
                endDate: projectSprints.endDate,
                status: projectSprints.status,
                createdAt: projectSprints.createdAt,
                updatedAt: projectSprints.updatedAt,
            });
        } catch (error) {
            if (supportsDescription && isMissingColumn(error, 'description')) {
                sprintDescriptionColumnSupport = false;
                delete sprintValues.description;
                [newSprint] = await db.insert(projectSprints).values(sprintValues).returning({
                    id: projectSprints.id,
                    projectId: projectSprints.projectId,
                    name: projectSprints.name,
                    goal: projectSprints.goal,
                    description: sql<string | null>`null`,
                    startDate: projectSprints.startDate,
                    endDate: projectSprints.endDate,
                    status: projectSprints.status,
                    createdAt: projectSprints.createdAt,
                    updatedAt: projectSprints.updatedAt,
                });
            } else {
                throw error;
            }
        }

        if (!newSprint) {
            throw new Error("Failed to create sprint");
        }

        await revalidateProjectPaths(validated.projectId);

        recordSprintMetric('project.sprint.create.result', {
            projectId: validated.projectId,
            sprintId: newSprint.id,
            actorId: actorIdForMetric,
            success: true,
        });

        return { success: true, sprint: newSprint };

    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false,
                error: error.issues[0]?.message ?? "Sprint details are invalid",
            };
        }
        console.error("Failed to create sprint:", error);
        recordSprintMetric('project.sprint.create.result', {
            projectId: data.projectId,
            actorId: actorIdForMetric ?? 'unknown',
            success: false,
            message: error instanceof Error ? error.message : 'Failed to create sprint',
        });
        return { success: false, error: error instanceof Error ? error.message : "Failed to create sprint" };
    }
}

export async function updateSprintAction(data: UpdateSprintInput) {
    let actorIdForMetric: string | null = null;
    const startedAt = Date.now();
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");
        actorIdForMetric = user.id;

        const validated = updateSprintSchema.parse(data);
        const startDate = parseSprintDateInput(validated.startDate);
        const endDate = parseSprintDateInput(validated.endDate);

        const access = await getProjectAccessById(validated.projectId, user.id);
        if (!access.project) throw new Error("Project not found");
        if (!access.isOwner) {
            throw new Error("You do not have permission to edit sprints in this project");
        }

        const [existingSprint] = await db
            .select({
                id: projectSprints.id,
                projectId: projectSprints.projectId,
            })
            .from(projectSprints)
            .where(and(eq(projectSprints.id, validated.sprintId), eq(projectSprints.projectId, validated.projectId)))
            .limit(1);

        if (!existingSprint) {
            throw new Error("Sprint not found");
        }

        const supportsDescription = await hasProjectSprintDescriptionColumn();
        const sprintPatch: Partial<typeof projectSprints.$inferInsert> & { updatedAt: Date } = {
            name: validated.name,
            goal: validated.goal ?? null,
            startDate,
            endDate,
            updatedAt: new Date(),
        };
        if (supportsDescription) {
            sprintPatch.description = validated.description ?? null;
        }

        let updatedSprint:
            | {
                id: string;
                projectId: string;
                name: string;
                goal: string | null;
                description: string | null;
                startDate: Date | null;
                endDate: Date | null;
                status: SprintListItem["status"];
                createdAt: Date | null;
                updatedAt: Date | null;
            }
            | undefined;
        try {
            [updatedSprint] = await db.update(projectSprints)
                .set(sprintPatch)
                .where(eq(projectSprints.id, validated.sprintId))
                .returning({
                    id: projectSprints.id,
                    projectId: projectSprints.projectId,
                    name: projectSprints.name,
                    goal: projectSprints.goal,
                    description: supportsDescription ? projectSprints.description : sql<string | null>`null`,
                    startDate: projectSprints.startDate,
                    endDate: projectSprints.endDate,
                    status: projectSprints.status,
                    createdAt: projectSprints.createdAt,
                    updatedAt: projectSprints.updatedAt,
                });
        } catch (error) {
            if (supportsDescription && isMissingColumn(error, 'description')) {
                sprintDescriptionColumnSupport = false;
                delete sprintPatch.description;
                [updatedSprint] = await db.update(projectSprints)
                    .set(sprintPatch)
                    .where(eq(projectSprints.id, validated.sprintId))
                    .returning({
                        id: projectSprints.id,
                        projectId: projectSprints.projectId,
                        name: projectSprints.name,
                        goal: projectSprints.goal,
                        description: sql<string | null>`null`,
                        startDate: projectSprints.startDate,
                        endDate: projectSprints.endDate,
                        status: projectSprints.status,
                        createdAt: projectSprints.createdAt,
                        updatedAt: projectSprints.updatedAt,
                    });
            } else {
                throw error;
            }
        }

        if (!updatedSprint) {
            throw new Error("Failed to update sprint");
        }

        await revalidateProjectPaths(validated.projectId);

        recordSprintMetric('project.sprint.update.result', {
            projectId: validated.projectId,
            sprintId: validated.sprintId,
            actorId: actorIdForMetric,
            success: true,
            durationMs: Date.now() - startedAt,
        });

        return { success: true as const, sprint: updatedSprint };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false as const,
                error: error.issues[0]?.message ?? "Sprint details are invalid",
            };
        }

        console.error("Failed to update sprint:", error);
        recordSprintMetric('project.sprint.update.result', {
            projectId: data.projectId,
            sprintId: data.sprintId,
            actorId: actorIdForMetric ?? 'unknown',
            success: false,
            durationMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : 'Failed to update sprint',
        });

        return { success: false as const, error: error instanceof Error ? error.message : "Failed to update sprint" };
    }
}

export async function deleteSprintAction(data: {
    projectId: string;
    sprintId: string;
}): Promise<DeleteSprintResult> {
    let actorIdForMetric: string | null = null;
    const startedAt = Date.now();
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");
        actorIdForMetric = user.id;

        const validated = deleteSprintSchema.parse(data);
        const access = await getProjectAccessById(validated.projectId, user.id);
        if (!access.project) throw new Error("Project not found");
        if (!access.isOwner) {
            throw new Error("You do not have permission to delete sprints in this project");
        }

        const [sprintWithTaskCount] = await db.execute<{
            id: string;
            status: SprintListItem["status"];
            affected_task_count: number;
        }>(sql`
            SELECT
                s.id,
                s.status,
                (
                    SELECT COUNT(*)::int
                    FROM ${tasks} t
                    WHERE t.sprint_id = s.id AND t.deleted_at IS NULL
                ) AS affected_task_count
            FROM ${projectSprints} s
            WHERE s.id = ${validated.sprintId}
              AND s.project_id = ${validated.projectId}
            LIMIT 1
        `);

        if (!sprintWithTaskCount) {
            throw new Error("Sprint not found");
        }

        if (sprintWithTaskCount.status === 'active') {
            recordSprintMetric('project.sprint.delete.blocked', {
                projectId: validated.projectId,
                sprintId: validated.sprintId,
                actorId: actorIdForMetric,
                reason: 'active_sprint',
                affectedTaskCount: sprintWithTaskCount.affected_task_count,
            });
            return {
                success: false,
                error: 'Active sprints must be completed before they can be deleted.',
            };
        }

        await db.transaction(async (tx) => {
            await tx.update(tasks)
                .set({
                    sprintId: null,
                    updatedAt: new Date(),
                })
                .where(and(eq(tasks.projectId, validated.projectId), eq(tasks.sprintId, validated.sprintId), isNull(tasks.deletedAt)));

            await tx.delete(projectSprints).where(eq(projectSprints.id, validated.sprintId));
        });

        await revalidateProjectPaths(validated.projectId);

        recordSprintMetric('project.sprint.delete.result', {
            projectId: validated.projectId,
            sprintId: validated.sprintId,
            actorId: actorIdForMetric,
            success: true,
            durationMs: Date.now() - startedAt,
            previousStatus: sprintWithTaskCount.status,
            affectedTaskCount: sprintWithTaskCount.affected_task_count,
        });

        return {
            success: true,
            deletedSprintId: validated.sprintId,
            affectedTaskCount: sprintWithTaskCount.affected_task_count,
            previousStatus: sprintWithTaskCount.status,
        };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false,
                error: error.issues[0]?.message ?? "Sprint details are invalid",
            };
        }

        console.error("Failed to delete sprint:", error);
        recordSprintMetric('project.sprint.delete.result', {
            projectId: data.projectId,
            sprintId: data.sprintId,
            actorId: actorIdForMetric ?? 'unknown',
            success: false,
            durationMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : 'Failed to delete sprint',
        });
        return { success: false, error: error instanceof Error ? error.message : "Failed to delete sprint" };
    }
}

export async function startSprintAction(sprintId: string, projectId: string) {
    let actorIdForMetric: string | null = null;
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");
        actorIdForMetric = user.id;

        const access = await getProjectAccessById(projectId, user.id);
        if (!access.project) throw new Error("Project not found");
        if (!access.isOwner) {
            throw new Error("You do not have permission to start sprints in this project");
        }

        // 1. Check for active sprints
        const activeSprint = await db.query.projectSprints.findFirst({
            where: and(
                eq(projectSprints.projectId, projectId),
                eq(projectSprints.status, 'active')
            )
        });

        if (activeSprint) {
            throw new Error("There is already an active sprint. Complete it before starting a new one.");
        }

        // 2. Start Sprint
        await db.update(projectSprints)
            .set({ status: 'active', updatedAt: new Date() })
            .where(eq(projectSprints.id, sprintId));

        await revalidateProjectPaths(projectId);

        recordSprintMetric('project.sprint.start.result', {
            projectId,
            sprintId,
            actorId: actorIdForMetric,
            success: true,
        });

        return { success: true };
    } catch (error) {
        console.error("Failed to start sprint:", error);
        recordSprintMetric('project.sprint.start.result', {
            projectId,
            sprintId,
            actorId: actorIdForMetric ?? 'unknown',
            success: false,
            message: error instanceof Error ? error.message : 'Failed to start sprint',
        });
        return { success: false, error: error instanceof Error ? error.message : "Failed to start sprint" };
    }
}

export async function completeSprintAction(sprintId: string, projectId: string) {
    let actorIdForMetric: string | null = null;
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");
        actorIdForMetric = user.id;

        const access = await getProjectAccessById(projectId, user.id);
        if (!access.project) throw new Error("Project not found");
        if (!access.isOwner) {
            throw new Error("You do not have permission to complete sprints in this project");
        }

        await db.update(projectSprints)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(projectSprints.id, sprintId));

        await revalidateProjectPaths(projectId);

        recordSprintMetric('project.sprint.complete.result', {
            projectId,
            sprintId,
            actorId: actorIdForMetric,
            success: true,
        });

        return { success: true };
    } catch (error) {
        console.error("Failed to complete sprint:", error);
        recordSprintMetric('project.sprint.complete.result', {
            projectId,
            sprintId,
            actorId: actorIdForMetric ?? 'unknown',
            success: false,
            message: error instanceof Error ? error.message : 'Failed to complete sprint',
        });
        return { success: false, error: error instanceof Error ? error.message : "Failed to complete sprint" };
    }
}

export async function moveTaskToSprintAction(taskId: string, sprintId: string | null, projectId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        // Access Check
        const project = await db.query.projects.findFirst({
            where: eq(projects.id, projectId),
            columns: { ownerId: true, slug: true }
        });
        if (!project) throw new Error("Project not found");

        if (project.ownerId !== user.id) {
            // For MOVING tasks to sprint, strictly speaking only the Sprint Leader (Owner) should define what goes in?
            // Or can members pick tasks?
            // User said: "In that sprint, we can create tasks... creating a new task, allowing us to select that sprint."
            // So CREATING a task into a sprint is allowed for members (via createTaskAction).
            // But MOVING an *existing* task into a sprint?
            // If we follow "Simplicity", let's restrict Sprint Management to Owner.
            // But "selecting a sprint" during creation implies assignment.
            // Let's assume OWNER manages the sprint scope. Members just execute.
            // BUT, if I assign a task to a sprint, that changes scope.
            // Recommendation was "Owner Only".
            throw new Error("Only the project owner can manage sprint tasks");
        }

        const [task] = await db
            .select({
                id: tasks.id,
            })
            .from(tasks)
            .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
            .limit(1);

        if (!task) {
            throw new Error("Task not found in this project");
        }

        if (sprintId) {
            const [sprint] = await db
                .select({
                    id: projectSprints.id,
                })
                .from(projectSprints)
                .where(and(eq(projectSprints.id, sprintId), eq(projectSprints.projectId, projectId)))
                .limit(1);

            if (!sprint) {
                throw new Error("Sprint not found in this project");
            }
        }

        await db.update(tasks)
            .set({ sprintId: sprintId, updatedAt: new Date() })
            .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));

        const slugOrId = project.slug || projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${projectId}`);

        return { success: true };
    } catch (error) {
        console.error("Failed to move task:", error);
        return { success: false, error: "Failed to move task" };
    }
}

export async function deleteTaskAction(taskId: string, projectId: string) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        // Access Check - Only project owner can delete tasks
        const project = await db.query.projects.findFirst({
            where: eq(projects.id, projectId),
            columns: { ownerId: true, slug: true }
        });
        if (!project) throw new Error("Project not found");

        if (project.ownerId !== user.id) {
            throw new Error("Only the project owner can delete tasks");
        }

        const deletedTask = await db.transaction(async (tx) => {
            const existingTask = await tx.query.tasks.findFirst({
                where: and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)),
                columns: {
                    assigneeId: true,
                },
            });

            if (!existingTask) {
                throw new Error("Task not found in this project");
            }

            await tx.delete(tasks)
                .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));
            return existingTask;
        });

        await queueCounterRefreshBestEffort([deletedTask?.assigneeId ?? null]);

        const slugOrId = project.slug || projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${projectId}`);

        return { success: true };
    } catch (error) {
        console.error("Failed to delete task:", error);
        return { success: false, error: error instanceof Error ? error.message : "Failed to delete task" };
    }
}

type UpdateProjectStageOptions = {
    expectedUpdatedAt?: string | null;
};

type UpdateProjectStageResult =
    | {
        success: true;
        currentStageIndex: number;
        updatedAt: string | null;
    }
    | {
        success: false;
        error: string;
        errorCode: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'PROJECT_CONFLICT' | 'INVALID_INPUT' | 'INTERNAL_ERROR';
        latest?: {
            currentStageIndex: number;
            updatedAt: string | null;
        };
    };

export async function updateProjectStageAction(
    projectId: string,
    currentStageIndex: number,
    options?: UpdateProjectStageOptions
): Promise<UpdateProjectStageResult> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: "Unauthorized", errorCode: "UNAUTHORIZED" };
        }

        const normalizedIndex = Number.isInteger(currentStageIndex) && currentStageIndex >= 0
            ? currentStageIndex
            : null;
        if (normalizedIndex === null) {
            return { success: false, error: "Invalid stage index", errorCode: "INVALID_INPUT" };
        }

        const [projectForStageUpdate] = await db
            .select({
                ownerId: projects.ownerId,
                lifecycleStages: projects.lifecycleStages,
            })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!projectForStageUpdate) {
            return { success: false, error: "Project not found", errorCode: "NOT_FOUND" };
        }
        if (projectForStageUpdate.ownerId !== user.id) {
            return {
                success: false,
                error: "Only the project owner can advance the stage",
                errorCode: "FORBIDDEN",
            };
        }

        const lifecycleStages = Array.isArray(projectForStageUpdate.lifecycleStages)
            ? projectForStageUpdate.lifecycleStages
            : [];
        if (normalizedIndex >= lifecycleStages.length) {
            return { success: false, error: "Stage index out of range", errorCode: "INVALID_INPUT" };
        }

        let expectedUpdatedAtDate: Date | null = null;
        const expectedUpdatedAtRaw = options?.expectedUpdatedAt?.trim();
        if (expectedUpdatedAtRaw) {
            expectedUpdatedAtDate = new Date(expectedUpdatedAtRaw);
            if (Number.isNaN(expectedUpdatedAtDate.getTime())) {
                return { success: false, error: "Invalid lifecycle version", errorCode: "INVALID_INPUT" };
            }
        }

        const whereClause = expectedUpdatedAtDate
            ? and(
                eq(projects.id, projectId),
                eq(projects.ownerId, user.id),
                eq(projects.updatedAt, expectedUpdatedAtDate)
            )
            : and(eq(projects.id, projectId), eq(projects.ownerId, user.id));

        const [updated] = await db
            .update(projects)
            .set({
                currentStageIndex: normalizedIndex,
                updatedAt: new Date(),
            })
            .where(whereClause)
            .returning({
                currentStageIndex: projects.currentStageIndex,
                updatedAt: projects.updatedAt,
                slug: projects.slug,
            });

        if (!updated) {
            const [current] = await db
                .select({
                    ownerId: projects.ownerId,
                    currentStageIndex: projects.currentStageIndex,
                    updatedAt: projects.updatedAt,
                })
                .from(projects)
                .where(eq(projects.id, projectId))
                .limit(1);

            if (!current) {
                return { success: false, error: "Project not found", errorCode: "NOT_FOUND" };
            }
            if (current.ownerId !== user.id) {
                return {
                    success: false,
                    error: "Only the project owner can advance the stage",
                    errorCode: "FORBIDDEN",
                };
            }
            if (expectedUpdatedAtDate) {
                return {
                    success: false,
                    error: "Project lifecycle changed. Refresh and retry.",
                    errorCode: "PROJECT_CONFLICT",
                    latest: {
                        currentStageIndex: Math.max(0, current.currentStageIndex ?? 0),
                        updatedAt: current.updatedAt?.toISOString?.() ?? null,
                    },
                };
            }
            return { success: false, error: "Failed to update project stage", errorCode: "INTERNAL_ERROR" };
        }

        const slugOrId = updated.slug || projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${projectId}`);
        revalidatePath('/hub');

        return {
            success: true,
            currentStageIndex: Math.max(0, updated.currentStageIndex ?? normalizedIndex),
            updatedAt: updated.updatedAt?.toISOString?.() ?? null,
        };
    } catch (error) {
        console.error("[updateProjectStageAction] Failed:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to update project stage",
            errorCode: "INTERNAL_ERROR",
        };
    }
}

/**
 * Smart Lifecycle Update Action
 * Handles stage renames, reorders, additions, and deletions.
 * Uses "Smart Rebalance" logic to keep currentStageIndex pointing at the correct stage.
 */
export async function updateProjectLifecycleAction(
    projectId: string,
    newStages: string[],
    currentActiveStageName: string
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Unauthorized");

        // Validate
        if (!newStages || newStages.length === 0) {
            throw new Error("At least one lifecycle stage is required");
        }

        // Get current index for Smart Rebalance calculation
        const { data: project, error: fetchError } = await supabase
            .from('projects')
            .select('current_stage_index, slug')
            .eq('id', projectId)
            .eq('owner_id', user.id)
            .single();

        if (fetchError || !project) {
            throw new Error("Project not found or access denied");
        }

        // SMART REBALANCE: Find the new index for the current stage
        let newIndex = newStages.findIndex(s => s === currentActiveStageName);
        if (newIndex === -1) {
            // Stage was deleted - fallback to previous index or 0
            newIndex = Math.max(0, (project.current_stage_index || 0) - 1);
            // Clamp to max
            newIndex = Math.min(newIndex, newStages.length - 1);
        }

        // Use Supabase client directly for RLS-compliant update
        const { error } = await supabase
            .from('projects')
            .update({
                lifecycle_stages: newStages,
                current_stage_index: newIndex,
                updated_at: new Date().toISOString()
            })
            .eq('id', projectId)
            .eq('owner_id', user.id);

        if (error) {
            console.error("Supabase update error:", error);
            throw new Error(error.message);
        }

        const slugOrId = project.slug || projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${projectId}`);
        revalidatePath('/hub');

        return { success: true, newStageIndex: newIndex };
    } catch (error) {
        console.error("Failed to update project lifecycle:", error);
        return { success: false, error: error instanceof Error ? error.message : "Failed to update project lifecycle" };
    }
}



export async function finalizeProjectAction(projectId: string): Promise<
    | { success: true; message: string }
    | { success: false; message: string; errorCode: ProjectSettingsErrorCode }
> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, errorCode: 'UNAUTHORIZED', message: 'You must be signed in.' };
        }

        const MAX_FINALIZE_TX_RETRIES = 3;
        const isSerializationRetryable = (error: unknown) => {
            const code = (error as { code?: string } | null)?.code;
            const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
            return (
                code === '40001' // serialization_failure
                || code === '40P01' // deadlock_detected
                || message.includes('could not serialize access')
                || message.includes('serialization failure')
                || message.includes('deadlock detected')
            );
        };

        let result:
            | { success: true; message: string }
            | { success: false; message: string; errorCode: ProjectSettingsErrorCode }
            | null = null;

        for (let attempt = 1; attempt <= MAX_FINALIZE_TX_RETRIES; attempt += 1) {
            try {
                result = await db.transaction(async (tx) => {
                    // Ensure blocker checks and status mutation share the same serializable snapshot.
                    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);

                    // 1. Verify Ownership
                    const [project] = await tx
                        .select()
                        .from(projects)
                        .where(eq(projects.id, projectId))
                        .for('update')
                        .limit(1);
                    if (!project) {
                        return { success: false as const, errorCode: 'NOT_FOUND' as const, message: 'Project not found.' };
                    }
                    if (project.ownerId !== user.id) {
                        return { success: false as const, errorCode: 'FORBIDDEN' as const, message: 'Only the owner can finalize the project.' };
                    }

                    // 2. Re-check danger-zone blockers at mutation time (do not trust stale UI preflight)
                    const [openRolesRow, pendingAppsRow, activeTasksRow] = await Promise.all([
                        tx
                            .select({ count: sql<number>`count(*)::int` })
                            .from(projectOpenRoles)
                            .where(eq(projectOpenRoles.projectId, projectId))
                            .limit(1),
                        tx
                            .select({ count: sql<number>`count(*)::int` })
                            .from(roleApplications)
                            .where(and(eq(roleApplications.projectId, projectId), eq(roleApplications.status, 'pending')))
                            .limit(1),
                        tx
                            .select({ count: sql<number>`count(*)::int` })
                            .from(tasks)
                            .where(and(eq(tasks.projectId, projectId), sql`${tasks.status} <> 'done'`))
                            .limit(1),
                    ]);

                    const status = (project.status === 'draft' ||
                        project.status === 'active' ||
                        project.status === 'completed' ||
                        project.status === 'archived')
                        ? project.status
                        : 'draft';
                    Number(openRolesRow[0]?.count ?? 0); // queried to keep parity with danger-zone preflight
                    const pendingApplicationsCount = Number(pendingAppsRow[0]?.count ?? 0);
                    const activeTasksCount = Number(activeTasksRow[0]?.count ?? 0);
                    const finalizeBlockers: string[] = [];
                    if (activeTasksCount > 0) {
                        finalizeBlockers.push(`There are ${activeTasksCount} non-completed tasks.`);
                    }
                    if (pendingApplicationsCount > 0) {
                        finalizeBlockers.push(`There are ${pendingApplicationsCount} pending applications.`);
                    }
                    if (status === 'completed') {
                        return { success: false as const, errorCode: 'INVALID_INPUT' as const, message: 'Project is already completed.' };
                    }
                    if (status === 'archived') {
                        return { success: false as const, errorCode: 'INVALID_INPUT' as const, message: 'Archived projects cannot be finalized.' };
                    }
                    if (finalizeBlockers.length > 0) {
                        return {
                            success: false as const,
                            errorCode: 'INVALID_INPUT' as const,
                            message: finalizeBlockers[0] ?? 'Project cannot be finalized yet.',
                        };
                    }

                    // 3. Finalize Project
                    await tx.update(projects)
                        .set({ status: 'completed', updatedAt: new Date() })
                        .where(eq(projects.id, projectId));

                    // 4. Close open roles
                    await tx.delete(projectOpenRoles).where(eq(projectOpenRoles.projectId, projectId));

                    // 5. (Future) Distribute Reputation Points
                    // This would be a ledger insert

                    return { success: true as const, message: 'Project finalized successfully.' };
                });
                break;
            } catch (error) {
                if (isSerializationRetryable(error) && attempt < MAX_FINALIZE_TX_RETRIES) {
                    continue;
                }
                throw error;
            }
        }

        if (!result) {
            throw new Error('Failed to finalize project due to transaction retries.');
        }
        logger.metric('project.settings.finalize.result', {
            projectId,
            userId: user.id,
            result: result.success ? 'success' : 'error',
            errorCode: result.success ? null : result.errorCode,
        });
        await revalidateProjectPaths(projectId);
        return result;
    } catch (error) {
        console.error("Failed to finalize project:", error);
        logger.metric('project.settings.finalize.result', {
            projectId,
            result: 'error',
            errorCode: 'INTERNAL_ERROR',
        });
        return { success: false, errorCode: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : "Failed to finalize project." };
    }
}

export async function getProjectSyncStatus(projectId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    let access: Awaited<ReturnType<typeof assertProjectReadAccess>> | null = null;

    // Read access check (public projects are allowed)
    try {
        access = await assertProjectReadAccess(projectId, actorId);
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : 'Unauthorized' };
    }

    try {
        return await runInFlightDeduped(`project:sync-status:${projectId}:${actorId ?? 'anon'}`, async () => {
            const [project] = await db
                .select({
                    syncStatus: projects.syncStatus,
                    importSource: projects.importSource
                })
                .from(projects)
                .where(eq(projects.id, projectId));

            const meta = (project?.importSource as any)?.metadata;
            const rawError = meta?.lastError || null;
            const canSeeDetailedError = !!access?.canWrite;
            const lastError = rawError
                ? (canSeeDetailedError ? sanitizeGitErrorMessage(rawError) : 'Import failed. Project owner can retry the import.')
                : null;

            return {
                success: true as const,
                status: project?.syncStatus || 'ready',
                lastError
            };
        });
    } catch (error) {
        console.error('Failed to get sync status', error);
        return { success: false as const, error: 'Failed' };
    }
}

export async function retryGithubImportAction(projectId: string) {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return { success: false, error: 'Unauthorized' };

    try {
        const [project] = await db
            .select({ ownerId: projects.ownerId, importSource: projects.importSource })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) return { success: false, error: 'Project not found' };
        if (project.ownerId !== user.id) return { success: false, error: 'Unauthorized' };

        const src = project.importSource as any;
        if (!src || src.type !== 'github' || !src.repoUrl) {
            return { success: false, error: 'Not a GitHub import project' };
        }

        // Inngest handles concurrency/idempotency automatically via function settings.
        // We just re-emit the event.

        const gitHubToken = session?.provider_token;
        const normalizedRepoUrl = normalizeGithubRepoUrl(src.repoUrl || '');
        if (!normalizedRepoUrl) return { success: false, error: 'Invalid GitHub repository URL' };

        const normalizedBranch = normalizeGithubBranch(src.branch);
        if (src.branch && !normalizedBranch) return { success: false, error: 'Invalid GitHub branch name' };

        const accessCheck = await ensureGithubImportAccess(normalizedRepoUrl, {
            oauthToken: gitHubToken || null,
            preferredInstallationId: src?.metadata?.githubInstallationId ?? null,
            sealedImportToken: src?.metadata?.importAuth,
        });
        if (!accessCheck.ok) return { success: false, error: accessCheck.error };

        const sealed = gitHubToken ? sealGithubImportToken(gitHubToken) : null;
        const clearedSource = clearSealedGithubTokenFromImportSource(src) as Record<string, any>;
        const retryAt = new Date().toISOString();
        const nextImportSource = {
            ...clearedSource,
            repoUrl: normalizedRepoUrl,
            branch: normalizedBranch || accessCheck.defaultBranch || 'main',
            metadata: {
                ...((clearedSource.metadata || {}) as Record<string, any>),
                lastError: null,
                lastRetryAt: retryAt,
                syncPhase: 'pending',
                githubInstallationId: accessCheck.installationId,
                githubAuthSource: accessCheck.authSource,
                githubRepoId: accessCheck.repoId ?? ((clearedSource.metadata || {}) as Record<string, unknown>)?.githubRepoId ?? null,
                ...(sealed ? { importAuth: sealed } : {}),
            },
        };

        await db
            .update(projects)
            .set({ syncStatus: 'pending', importSource: nextImportSource as any, updatedAt: new Date() })
            .where(eq(projects.id, projectId));

        const enqueueBranch = normalizedBranch || accessCheck.defaultBranch || undefined;
        const retryEventId = `${buildGithubImportEventId(
            projectId,
            normalizedRepoUrl,
            enqueueBranch || null
        )}:retry:${Date.parse(retryAt)}`;
        await inngest.send({
            name: "project/import",
            id: retryEventId,
            data: {
                projectId,
                importSource: {
                    type: 'github',
                    repoUrl: normalizedRepoUrl,
                    branch: enqueueBranch,
                    metadata: (clearSealedGithubTokenFromImportSource(nextImportSource) as Record<string, any>).metadata,
                },
                userId: user.id,
            }
        });

        logger.metric('github.import.enqueue', {
            projectId,
            userId: user.id,
            result: 'success',
            eventId: retryEventId,
            source: 'retry',
        });

        return { success: true };
    } catch (e: any) {
        const msg = sanitizeGitErrorMessage(typeof e?.message === 'string' ? e.message : 'Retry failed');
        try {
            const [project] = await db
                .select({ importSource: projects.importSource })
                .from(projects)
                .where(eq(projects.id, projectId))
                .limit(1);
            const clearedSource = clearSealedGithubTokenFromImportSource(project?.importSource) as Record<string, any>;
            await db.update(projects)
                .set({
                    syncStatus: 'failed',
                    updatedAt: new Date(),
                    importSource: {
                        ...clearedSource,
                        metadata: {
                            ...((clearedSource?.metadata || {}) as Record<string, any>),
                            lastError: msg,
                            syncPhase: 'failed',
                        },
                    } as any,
                })
                .where(eq(projects.id, projectId));
        } catch (updateError) {
            console.error("Failed to persist sync failure metadata after retry failure", updateError);
        }

        logger.metric('github.import.enqueue', {
            projectId,
            result: 'error',
            source: 'retry',
        });

        return { success: false, error: msg };
    }
}
