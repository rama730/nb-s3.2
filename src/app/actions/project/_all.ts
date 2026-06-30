'use server';

import { db } from '@/lib/db';
import { projects, projectFollows, projectOpenRoles, roleApplications, conversations, conversationParticipants, messages, projectNodes, projectNodeEvents, projectMembers, profiles, tasks, projectSprints, taskNodeLinks, taskSubtasks, taskComments, tags, projectTags, skills, projectSkills, fileVersions, messageWorkflowItems, messageWorkLinks, projectMarkdowns, projectMarkdownVersions } from '@/lib/db/schema';
import { eq, and, or, sql, inArray, isNotNull, isNull, desc, ilike } from 'drizzle-orm';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { redis } from '@/lib/redis';
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { CreateProjectInput, validateAndSanitizeLifecycleStages } from '@/lib/validations/project';
import { z } from 'zod';
import { createHash, randomUUID } from 'crypto';
import { generateSlug } from '@/lib/utils/slug';
import { generateProjectKey } from '@/lib/project-key';
import { computeProjectReadAccess, computeProjectWriteAccess, getProjectAccessById, type ProjectAccess } from '@/lib/data/project-access';
import { normalizeGithubBranch, normalizeGithubRepoUrl } from '@/lib/github/repo-validation';
import { clearSealedGithubTokenFromImportSource, sanitizeGitErrorMessage, sealGithubImportToken } from '@/lib/github/repo-security';
import { fetchRepoMeta, parseGithubRepo } from '@/lib/github/repo-preview';
import { buildGithubImportEventId, resolveGithubRepoAccess } from '@/lib/github/auth-resolver';
import { runGithubProjectImport } from '@/lib/github/project-import-runner';
import { buildProjectImportEventId } from '@/lib/import/idempotency';
import { isProjectVisibility, normalizeProjectVisibility, type ProjectVisibility } from '@/lib/projects/project-visibility';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { runInFlightDeduped } from '@/lib/async/inflight-dedupe';
import { createUploadIntent, finalizeUploadIntent } from '@/lib/upload/upload-intents';
import { normalizeAndValidateFileSize, normalizeAndValidateMimeType } from '@/lib/upload/security';
// Queue Imports
import { inngest } from '@/inngest/client';
import { getLifecycleStagesForProjectType } from '@/lib/projects/lifecycle-templates';
import type { Project } from '@/types/hub';
import { logger } from '@/lib/logger';
import { markProjectCollaboratorsSummaryStale, upsertProfileProjectContributionFromMembership } from '@/lib/profile/collaboration';
import { buildProjectOwnerPresentation } from '@/lib/privacy/presentation';
import { resolvePrivacyRelationship } from '@/lib/privacy/resolver';
import { enqueueProjectNotificationEvent } from '@/lib/notifications/project-events';
import { buildDefaultProjectNotificationPolicy, normalizeProjectMemberNotificationOverrides, normalizeProjectNotificationPolicy, summarizeProjectNotificationPolicy, type ProjectMemberNotificationOverrides, type ProjectNotificationPolicy, type ProjectNotificationPreset } from '@/lib/notifications/project-policy';
import { canProjectRoleManageTarget, changeProjectMemberRoleInternal, isProjectMemberEligibleFor, readProjectMemberRemovalImpact, removeProjectMemberInternal, requireProjectCapability } from '@/lib/projects/collaborator-lifecycle';
import { queueCounterRefreshBestEffort } from '@/lib/workspace/counter-buffer';
import { createSprintSchema, deleteSprintSchema, parseSprintDateInput, updateSprintSchema, type CreateSprintInput, type DeleteSprintResult, type UpdateSprintInput } from '@/lib/projects/sprints';
import { buildSprintFilterCounts, buildSprintHealthSummary, buildSprintPermissionSet, type SprintDetailPayload, type SprintDrawerPreview, type SprintFileTimelineEntity, type SprintListItem, type SprintTaskTimelineEntity } from '@/lib/projects/sprint-detail';
import { buildSprintCompareSummary, buildSprintDrawerPreviews, findPreviousSprintBaseline } from '@/lib/projects/sprint-presentation';
import { buildSprintTimeline, type SprintTimelineTaskInput } from '@/lib/projects/sprint-timeline';
import { recordSprintMetric } from '@/lib/projects/sprint-observability';
import { buildTaskActivityItems } from '@/lib/projects/task-activity';
import { normalizeTaskSurfaceRecord } from '@/lib/projects/task-presentation';
import { taskPriorityEnum, taskStatusEnum } from '@/lib/validations/task';
import { invalidatePublicProjectsFeedCache } from '@/lib/projects/public-feed-service';
import { buildProjectAccessTransitionPolicy, canProjectMemberUploadFiles, isProjectTabVisibleToViewer, normalizeProjectPublicTabVisibility, type ProjectPublicTabVisibility } from '@/lib/projects/settings-policies';
import { buildProjectAnalyticsFiles, buildProjectAnalyticsMemberDetail, buildProjectAnalyticsMemberSummaries, buildProjectAnalyticsOverview, buildProjectAnalyticsReport, buildProjectAnalyticsRisks, buildProjectAnalyticsSprints, buildProjectAnalyticsSnapshot, buildProjectAnalyticsTimeline, buildProjectAnalyticsWorkflow, filterProjectAnalyticsDatasetByContext, normalizeProjectAnalyticsContext, PROJECT_ANALYTICS_DATASET_LIMITS, resolveProjectAnalyticsAccess, type BuildProjectAnalyticsInput, type ProjectAnalyticsContextFilters, type ProjectAnalyticsRiskLifecycleStatus, type ProjectAnalyticsTimelineFilters } from '@/lib/projects/analytics';

const isMissingColumn = (error: unknown, column: string) => {
    const msg = error instanceof Error ? error.message : String(error);
    const lowered = msg.toLowerCase();
    return lowered.includes(column.toLowerCase()) && (lowered.includes('column') || lowered.includes('failed query') || lowered.includes('does not exist'));
};

const isMissingCounterColumn = (error: unknown, column: string) => isMissingColumn(error, column);

const PROJECT_COVER_UPLOAD_BUCKET = 'project-files';
const LEGACY_PROJECT_COVER_UPLOAD_BUCKET = 'avatars';
const PROJECT_COVER_UPLOAD_MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_PROJECT_COVER_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const PROJECT_IMAGE_STORAGE_FOLDERS = ['project-images', 'project-covers'] as const;
const PROJECT_IMAGE_PROXY_ROUTE_PREFIX = '/api/v1/projects';
const PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG = 'public-project-detail-shell';
const PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG = 'public-project-detail-metadata';

type AccessTransitionPreview = {
    followers: Array<{
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
    }>;
    openRoles: Array<{ id: string; title: string | null; role: string | null }>;
    pendingApplications: Array<{
        id: string;
        applicantId: string;
        applicantName: string | null;
        roleTitle: string | null;
        roleName: string | null;
    }>;
};

function resolveProjectVisibilityForCreate(value: unknown): ProjectVisibility {
    if (value === undefined || value === null || value === '') return 'public';
    if (isProjectVisibility(value)) return value;
    throw new Error('Invalid project visibility.');
}

function projectCoverExtensionFromMimeType(mimeType: string): string {
    switch (mimeType) {
        case 'image/jpeg':
            return 'jpg';
        case 'image/png':
            return 'png';
        case 'image/webp':
            return 'webp';
        case 'image/gif':
            return 'gif';
        default:
            return 'bin';
    }
}

async function assertProjectOwnerForSettings(projectId: string, userId: string) {
    const [project] = await db
        .select({
            id: projects.id,
            slug: projects.slug,
            ownerId: projects.ownerId,
            coverImage: projects.coverImage,
            coverImageBucket: projects.coverImageBucket,
            coverImageKey: projects.coverImageKey,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    if (!project) throw new Error('Project not found');
    if (project.ownerId !== userId) throw new Error('Unauthorized');
    return project;
}

function buildProjectImageRoute(projectId: string) {
    return `${PROJECT_IMAGE_PROXY_ROUTE_PREFIX}/${projectId}/image`;
}

function projectCoverStorageKeyFromPublicUrl(value: string | null | undefined, userId: string, projectId: string, bucket = PROJECT_COVER_UPLOAD_BUCKET) {
    if (!value) return null;

    let pathname = '';
    try {
        pathname = decodeURIComponent(new URL(value).pathname);
    } catch {
        return null;
    }

    const markers = [`/object/public/${bucket}/`, `/render/image/public/${bucket}/`];
    const marker = markers.find((candidate) => pathname.includes(candidate));
    if (!marker) return null;

    const storageKey = pathname.slice(pathname.indexOf(marker) + marker.length).replace(/^\/+/, '');
    const expectedPrefixes = PROJECT_IMAGE_STORAGE_FOLDERS.map((folder) => `${userId}/${folder}/${projectId}/`);
    expectedPrefixes.push(`projects/${projectId}/project-images/`);
    return expectedPrefixes.some((prefix) => storageKey.startsWith(prefix)) ? storageKey : null;
}

async function cleanupProjectCoverImages(params: { userId: string; projectId: string; keepStorageKey?: string | null; keepBucket?: string | null; previousBucket?: string | null; previousStorageKey?: string | null; previousCoverImage?: string | null }) {
    try {
        const admin = await createAdminClient();
        const keepBucket = params.keepBucket ?? PROJECT_COVER_UPLOAD_BUCKET;
        const staleKeysByBucket = new Map<string, Set<string>>();
        const addStale = (bucket: string, key: string | null | undefined) => {
            if (!key || (bucket === keepBucket && key === params.keepStorageKey)) return;
            const existing = staleKeysByBucket.get(bucket) ?? new Set<string>();
            existing.add(key);
            staleKeysByBucket.set(bucket, existing);
        };

        addStale(params.previousBucket ?? PROJECT_COVER_UPLOAD_BUCKET, params.previousStorageKey);
        addStale(PROJECT_COVER_UPLOAD_BUCKET, projectCoverStorageKeyFromPublicUrl(params.previousCoverImage, params.userId, params.projectId, PROJECT_COVER_UPLOAD_BUCKET));
        addStale(LEGACY_PROJECT_COVER_UPLOAD_BUCKET, projectCoverStorageKeyFromPublicUrl(params.previousCoverImage, params.userId, params.projectId, LEGACY_PROJECT_COVER_UPLOAD_BUCKET));

        const foldersByBucket = new Map<string, string[]>([
            [PROJECT_COVER_UPLOAD_BUCKET, [`projects/${params.projectId}/project-images/${params.userId}`]],
            [LEGACY_PROJECT_COVER_UPLOAD_BUCKET, PROJECT_IMAGE_STORAGE_FOLDERS.map((folder) => `${params.userId}/${folder}/${params.projectId}`)],
        ]);

        const pageSize = 100;
        for (const [bucket, folders] of foldersByBucket) {
            for (const folder of folders) {
                let offset = 0;
                while (true) {
                    const { data: existingObjects, error: listError } = await admin.storage.from(bucket).list(folder, { limit: pageSize, offset });

                    if (listError) {
                        logger.warn('project.cover_cleanup_list_failed', {
                            module: 'projects',
                            projectId: params.projectId,
                            userId: params.userId,
                            bucket,
                            folder,
                            error: listError.message,
                        });
                        break;
                    }

                    if (!existingObjects || existingObjects.length === 0) {
                        break;
                    }

                    for (const object of existingObjects) {
                        if (!object.name) continue;
                        addStale(bucket, `${folder}/${object.name}`);
                    }

                    if (existingObjects.length < pageSize) {
                        break;
                    }
                    offset += pageSize;
                }
            }
        }

        let staleCount = 0;
        for (const keys of staleKeysByBucket.values()) staleCount += keys.size;
        if (staleCount === 0) {
            return { removed: 0 };
        }

        let removedCount = 0;
        for (const [bucket, keys] of staleKeysByBucket) {
            if (keys.size === 0) continue;
            const { data: removed, error: removeError } = await admin.storage.from(bucket).remove(Array.from(keys));

            if (removeError) {
                logger.error('project.cover_cleanup_failed', {
                    module: 'projects',
                    projectId: params.projectId,
                    userId: params.userId,
                    bucket,
                    count: keys.size,
                    error: removeError.message,
                });
                continue;
            }
            removedCount += removed?.length ?? keys.size;
        }

        return { removed: removedCount };
    } catch (error) {
        logger.error('project.cover_cleanup_unexpected_failed', {
            module: 'projects',
            projectId: params.projectId,
            userId: params.userId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { removed: 0, error: 'Cleanup failed' };
    }
}

async function migrateLegacyProjectImageToManagedStorage(params: { projectId: string; userId: string; coverImage: string | null; coverImageBucket?: string | null; coverImageKey?: string | null }) {
    if (params.coverImageBucket && params.coverImageKey) {
        return {
            bucket: params.coverImageBucket,
            key: params.coverImageKey,
            url: buildProjectImageRoute(params.projectId),
            migrated: false,
        };
    }

    const legacyKey = projectCoverStorageKeyFromPublicUrl(params.coverImage, params.userId, params.projectId, LEGACY_PROJECT_COVER_UPLOAD_BUCKET) ?? projectCoverStorageKeyFromPublicUrl(params.coverImage, params.userId, params.projectId, PROJECT_COVER_UPLOAD_BUCKET);
    const legacyBucket = projectCoverStorageKeyFromPublicUrl(params.coverImage, params.userId, params.projectId, LEGACY_PROJECT_COVER_UPLOAD_BUCKET) ? LEGACY_PROJECT_COVER_UPLOAD_BUCKET : legacyKey ? PROJECT_COVER_UPLOAD_BUCKET : null;
    if (!legacyKey || !legacyBucket) return null;

    const extension = legacyKey.split('.').pop()?.toLowerCase() || 'bin';
    const nextKey = `projects/${params.projectId}/project-images/${params.userId}/${Date.now()}-${randomUUID()}.${extension}`;
    const admin = await createAdminClient();
    const { data: file, error: downloadError } = await admin.storage.from(legacyBucket).download(legacyKey);
    if (downloadError || !file) {
        logger.warn('project.cover_migration_download_failed', {
            module: 'projects',
            projectId: params.projectId,
            userId: params.userId,
            bucket: legacyBucket,
            error: downloadError?.message || 'Missing file',
        });
        return null;
    }

    const { error: uploadError } = await admin.storage.from(PROJECT_COVER_UPLOAD_BUCKET).upload(nextKey, file, {
        upsert: false,
        contentType: file.type || undefined,
    });
    if (uploadError) {
        logger.warn('project.cover_migration_upload_failed', {
            module: 'projects',
            projectId: params.projectId,
            userId: params.userId,
            error: uploadError.message,
        });
        return null;
    }

    return {
        bucket: PROJECT_COVER_UPLOAD_BUCKET,
        key: nextKey,
        url: buildProjectImageRoute(params.projectId),
        migrated: true,
        previousBucket: legacyBucket,
        previousKey: legacyKey,
    };
}

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
    try {
        await invalidatePublicProjectsFeedCache(projectId);
    } catch (err) {
        console.error('Failed to invalidate public feed cache:', err);
    }
    revalidatePath(`/projects/${projectId}`);
    revalidatePath('/hub');
    // Next.js 16's cache API requires an explicit cache-life profile for tag revalidation.
    revalidateTag(PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG, 'max');
    revalidateTag(PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG, 'max');
    try {
        const [project] = await db.select({ slug: projects.slug }).from(projects).where(eq(projects.id, projectId)).limit(1);
        if (project?.slug) {
            revalidatePath(`/projects/${project.slug}`);
        }
    } catch {
        // Ignore slug revalidation errors on legacy schemas.
    }
};

export async function invalidateProjectPublicCaches(projectId: string) {
    const feed = await invalidatePublicProjectsFeedCache(projectId);
    revalidatePath('/hub');
    revalidateTag(PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG, 'max');
    revalidateTag(PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG, 'max');
    return feed;
}

function buildAccessConfirmationToken(input: { projectId: string; previousVisibility: ProjectVisibility; nextVisibility: ProjectVisibility; membersCount: number; followersCount: number; openRolesCount: number; pendingApplicationsCount: number; activeTasksCount: number; hasManagedProjectImage: boolean }) {
    return createHash('sha256')
        .update([input.projectId, input.previousVisibility, input.nextVisibility, input.membersCount, input.followersCount, input.openRolesCount, input.pendingApplicationsCount, input.activeTasksCount, input.hasManagedProjectImage ? 'image:managed' : 'image:none-or-legacy'].join(':'))
        .digest('hex');
}

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

type GithubImportDispatchSource = 'create' | 'retry';

function shouldRunGithubImportInlineFallback(error: unknown): boolean {
    const override = process.env.GITHUB_IMPORT_INLINE_FALLBACK?.trim().toLowerCase();
    // Allow explicitly opting into inline fallback via env var
    if (override === 'always' || override === 'true') return true;

    // In development, we always want a simple and synchronous logic flow
    // without depending on the complex external Inngest background queue.
    if (process.env.NODE_ENV !== 'production') return true;

    // In production, rely on the Inngest worker.
    return false;
}

async function persistGithubImportQueueFailure(input: { projectId: string; importSource: ImportSourcePayload; message: string }) {
    const clearedImportSource = clearSealedGithubTokenFromImportSource(input.importSource) as Record<string, any>;
    const nextImportSource = {
        ...clearedImportSource,
        metadata: {
            ...((clearedImportSource as any)?.metadata || {}),
            lastError: input.message,
            syncPhase: 'failed',
        },
    };

    await db
        .update(projects)
        .set({
            syncStatus: 'failed',
            importSource: nextImportSource as any,
            updatedAt: new Date(),
        })
        .where(eq(projects.id, input.projectId));
}

async function enqueueGithubImportOrRunInline(input: {
    projectId: string;
    userId: string;
    importSource: ImportSourcePayload;
    eventId: string;
    source: GithubImportDispatchSource;
    resolutions?: Record<string, "keep_local" | "overwrite_github"> | null;
}): Promise<{ success: true; mode: 'queued' | 'inline' } | { success: false; error: string }> {
    const queueImportSource = clearSealedGithubTokenFromImportSource(input.importSource) as ImportSourcePayload;
    const githubImportSource = {
        type: 'github' as const,
        repoUrl: queueImportSource.repoUrl!,
        branch: queueImportSource.branch,
        metadata: queueImportSource.metadata,
    };

    // In development mode, completely bypass the external queue and run inline immediately
    if (process.env.NODE_ENV !== 'production' || process.env.GITHUB_IMPORT_INLINE_FALLBACK?.trim().toLowerCase() === 'always') {
        try {
            await runGithubProjectImport({
                projectId: input.projectId,
                importSource: githubImportSource,
                userId: input.userId,
                importEventId: input.eventId,
                queueAgeMs: 0,
                resolutions: input.resolutions,
            });
            logger.metric('github.import.enqueue', {
                projectId: input.projectId,
                userId: input.userId,
                result: 'inline_dev',
                eventId: input.eventId,
                source: input.source,
            });
            return { success: true, mode: 'inline' };
        } catch (inlineError) {
            const inlineMsg = sanitizeGitErrorMessage(inlineError instanceof Error ? inlineError.message : 'GitHub import failed');
            logger.metric('github.import.enqueue', {
                projectId: input.projectId,
                userId: input.userId,
                result: 'inline_error',
                eventId: input.eventId,
                source: input.source,
            });
            return { success: false, error: inlineMsg };
        }
    }

    try {
        await inngest.send({
            name: 'project/import',
            id: input.eventId,
            data: {
                projectId: input.projectId,
                importSource: githubImportSource,
                userId: input.userId,
                resolutions: input.resolutions,
            },
        });
        logger.metric('github.import.enqueue', {
            projectId: input.projectId,
            userId: input.userId,
            result: 'success',
            eventId: input.eventId,
            source: input.source,
        });
        return { success: true, mode: 'queued' };
    } catch (queueError) {
        const msg = sanitizeGitErrorMessage(queueError instanceof Error ? queueError.message : 'Failed to enqueue GitHub import');
        console.error('[Action] Failed to add GitHub import to queue', msg);

        if (shouldRunGithubImportInlineFallback(queueError)) {
            logger.metric('github.import.enqueue', {
                projectId: input.projectId,
                userId: input.userId,
                result: 'inline_fallback',
                eventId: input.eventId,
                source: input.source,
            });

            try {
                await runGithubProjectImport({
                    projectId: input.projectId,
                    importSource: githubImportSource,
                    userId: input.userId,
                    importEventId: input.eventId,
                    queueAgeMs: 0,
                    resolutions: input.resolutions,
                });
                return { success: true, mode: 'inline' };
            } catch (inlineError) {
                const inlineMsg = sanitizeGitErrorMessage(inlineError instanceof Error ? inlineError.message : 'GitHub import failed');
                logger.metric('github.import.enqueue', {
                    projectId: input.projectId,
                    userId: input.userId,
                    result: 'inline_error',
                    eventId: input.eventId,
                    source: input.source,
                    error: inlineMsg,
                });
                return { success: false, error: inlineMsg };
            }
        }

        await persistGithubImportQueueFailure({
            projectId: input.projectId,
            importSource: queueImportSource,
            message: msg,
        });
        logger.metric('github.import.enqueue', {
            projectId: input.projectId,
            userId: input.userId,
            result: 'error',
            eventId: input.eventId,
            source: input.source,
        });
        return { success: false, error: msg };
    }
}

function normalizeImportSourceForPersist(importSource: CreateProjectInput['import_source'] | undefined, gitHubToken?: string | null): { ok: true; value: ImportSourcePayload | null } | { ok: false; error: string } {
    if (!importSource) return { ok: true, value: null };
    if (importSource.type !== 'github') {
        return { ok: true, value: importSource as ImportSourcePayload };
    }

    const repoUrl = normalizeGithubRepoUrl(importSource.repoUrl || '');
    if (!repoUrl) {
        return {
            ok: false,
            error: 'Invalid GitHub repository URL. Use https://github.com/owner/repo',
        };
    }

    const branch = normalizeGithubBranch(importSource.branch);
    if (importSource.branch && !branch) {
        return { ok: false, error: 'Invalid GitHub branch name.' };
    }

    const metadata = {
        ...(((clearSealedGithubTokenFromImportSource(importSource) as any)?.metadata || {}) as Record<string, any>),
    };
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

function withLeadFocusMetadata(importSource: ImportSourcePayload | null, creatorRole: CreateProjectInput['creator_role']): ImportSourcePayload | null {
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
    } = {},
): Promise<
    | {
          ok: true;
          installationId: number | null;
          authSource: 'app' | 'oauth' | 'sealed' | 'none';
          defaultBranch: string | null;
          isPrivate: boolean | null;
          repoId: number | null;
      }
    | { ok: false; error: string }
> {
    const parsed = parseGithubRepo(repoUrl);
    if (!parsed) {
        return {
            ok: false,
            error: 'Invalid GitHub repository URL. Use https://github.com/owner/repo',
        };
    }

    try {
        const access = await resolveGithubRepoAccess({
            repoUrl,
            oauthToken: options.oauthToken || null,
            preferredInstallationId: options.preferredInstallationId ?? null,
            sealedImportToken: options.sealedImportToken,
        });

        const meta = await fetchRepoMeta({
            ...parsed,
            token: access.token || undefined,
        });
        const isPrivate = meta.isPrivate === true;
        if (isPrivate && !access.token) {
            return {
                ok: false,
                error: 'GitHub access expired. Reconnect GitHub and retry import.',
            };
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
            return {
                ok: false,
                error: 'Repository not found or private. Connect GitHub and verify repository access.',
            };
        }
        return {
            ok: false,
            error: sanitizeGitErrorMessage(msg || 'Unable to validate repository access'),
        };
    }
}

async function assertProjectReadAccess(projectId: string, userId: string | null) {
    const access = await getProjectAccessById(projectId, userId);
    if (!access.project) throw new Error('Project not found');
    if (!access.canRead) throw new Error('Forbidden');
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
    publicTabVisibility: z.object({
        dashboard: z.boolean(),
        readme: z.boolean(),
        updates: z.boolean(),
        files: z.boolean(),
        sprints: z.boolean(),
        tasks: z.boolean(),
        analytics: z.boolean(),
    }),
    lookingForCollaborators: z.boolean(),
    memberUpdatesEnabled: z.boolean(),
    maxCollaborators: z.string().nullable(),
    status: z.enum(['draft', 'active', 'completed', 'archived']),
    lifecycleStages: z.array(z.string()),
    currentStageIndex: z.number().int().nonnegative(),
    importSource: z.unknown().nullable(),
    githubRepoUrl: z.string().nullable().optional(),
    githubDefaultBranch: z.string().nullable().optional(),
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
    hasPublishedReadme: z.boolean(),
    readmeExcerpt: z.string().nullable(),
    readmeUpdatedAt: z.string().nullable(),
    readmeVersionNumber: z.number().int().positive().nullable(),
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
    readmeExcerpt: string | null;
    coverImage: string | null;
};

const projectDetailUuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isProjectDetailMemberRole(value: unknown): value is 'owner' | 'admin' | 'member' | 'viewer' {
    return value === 'owner' || value === 'admin' || value === 'member' || value === 'viewer';
}

const PROJECT_DETAIL_TRANSIENT_DB_ERROR_CODES = new Set([
    'EAI_AGAIN',
    'ECONNRESET',
    'ECONNREFUSED',
    'ENETUNREACH',
    'ENOTFOUND',
    'ETIMEDOUT',
]);
const PROJECT_DETAIL_READ_RETRY_DELAYS_MS = [150, 450] as const;

function readErrorCode(error: unknown): string | null {
    if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as { code?: unknown }).code;
        return typeof code === 'string' ? code : null;
    }
    return null;
}

function isTransientProjectDetailReadError(error: unknown, depth = 0): boolean {
    if (!error || depth > 4) return false;

    const code = readErrorCode(error);
    if (code && PROJECT_DETAIL_TRANSIENT_DB_ERROR_CODES.has(code)) return true;

    const message = error instanceof Error ? error.message : String(error);
    const normalizedMessage = message.toLowerCase();
    if (
        normalizedMessage.includes('getaddrinfo')
        || normalizedMessage.includes('connection terminated')
        || normalizedMessage.includes('connection timeout')
        || normalizedMessage.includes('connect timeout')
    ) {
        return true;
    }

    if (error && typeof error === 'object' && 'cause' in error) {
        return isTransientProjectDetailReadError((error as { cause?: unknown }).cause, depth + 1);
    }

    return false;
}

async function retryProjectDetailRead<T>(operation: string, read: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= PROJECT_DETAIL_READ_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
            return await read();
        } catch (error) {
            lastError = error;
            const retryDelayMs = PROJECT_DETAIL_READ_RETRY_DELAYS_MS[attempt];
            if (retryDelayMs === undefined || !isTransientProjectDetailReadError(error)) {
                throw error;
            }

            logger.warn('project_detail.read_retry', {
                operation,
                attempt: attempt + 1,
                retryDelayMs,
                errorCode: readErrorCode(error) ?? readErrorCode((error as { cause?: unknown } | null)?.cause) ?? null,
                error: error instanceof Error ? error.message : String(error),
            });
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
    }

    throw lastError;
}

async function resolveProjectDetailTarget(slugOrId: string, actorUserId: string | null = null) {
    const trimmed = slugOrId.trim();
    const isUuid = projectDetailUuidRegex.test(trimmed);
    const where = isUuid ? and(isNull(projects.deletedAt), or(eq(projects.slug, trimmed), eq(projects.id, trimmed))) : and(isNull(projects.deletedAt), eq(projects.slug, trimmed));

    const [project] = await retryProjectDetailRead('resolve_project_detail_target', async () => {
        const q = db
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
                publicTabVisibility: projects.publicTabVisibility,
                lookingForCollaborators: projects.lookingForCollaborators,
                memberUpdatesEnabled: projects.memberUpdatesEnabled,
                maxCollaborators: projects.maxCollaborators,
                status: projects.status,
                lifecycleStages: projects.lifecycleStages,
                currentStageIndex: projects.currentStageIndex,
                stageCompletionDates: projects.stageCompletionDates,
                importSource: projects.importSource,
                githubRepoUrl: projects.githubRepoUrl,
                githubDefaultBranch: projects.githubDefaultBranch,
                syncStatus: projects.syncStatus,
                updatedAt: projects.updatedAt,
                viewCount: projects.viewCount,
                followersCount: projects.followersCount,
                key: projects.key,
                memberRole: actorUserId ? projectMembers.role : sql<string | null>`NULL`,
                isFollowed: actorUserId ? sql<boolean>`${projectFollows.id} IS NOT NULL` : sql<boolean>`false`,
            })
            .from(projects);

        if (actorUserId) {
            q.leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actorUserId))).leftJoin(projectFollows, and(eq(projectFollows.projectId, projects.id), eq(projectFollows.userId, actorUserId)));
        }

        return q.where(where).limit(1);
    });

    return project ?? null;
}

async function resolveProjectDetailMetadataTarget(slugOrId: string, actorUserId: string | null = null) {
    const trimmed = slugOrId.trim();
    const isUuid = projectDetailUuidRegex.test(trimmed);
    const where = isUuid ? and(isNull(projects.deletedAt), or(eq(projects.slug, trimmed), eq(projects.id, trimmed))) : and(isNull(projects.deletedAt), eq(projects.slug, trimmed));

    const [project] = await retryProjectDetailRead('resolve_project_detail_metadata_target', async () => {
        const q = db
            .select({
                projectId: projects.id,
                ownerId: projects.ownerId,
                slug: projects.slug,
                title: projects.title,
                shortDescription: projects.shortDescription,
                description: projects.description,
                coverImage: projects.coverImage,
                publicTabVisibility: projects.publicTabVisibility,
                visibility: projects.visibility,
                status: projects.status,
                memberRole: actorUserId ? projectMembers.role : sql<string | null>`NULL`,
            })
            .from(projects);

        if (actorUserId) {
            q.leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actorUserId)));
        }

        return q.where(where).limit(1);
    });

    return project ?? null;
}

function resolveProjectDetailViewerState(input: { projectId: string; ownerId: string; visibility: string | null; status: string | null; actorUserId: string | null; memberRoleRaw: string | null; isFollowed: boolean }) {
    const { ownerId, visibility, status, actorUserId, memberRoleRaw, isFollowed } = input;
    const isOwner = !!actorUserId && actorUserId === ownerId;
    const memberRole = isProjectDetailMemberRole(memberRoleRaw) ? memberRoleRaw : null;
    const isMember = !isOwner && !!memberRole;
    const canRead = computeProjectReadAccess(visibility, status, isOwner, isMember);
    const canWrite = computeProjectWriteAccess(isOwner, memberRole);

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
    const [ownerRows, followersResult, membersResult, rolesResult, readmeRows] = await Promise.all([
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
                membershipId: projectMembers.id,
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
        db
            .select({
                publishedVersionId: projectMarkdowns.publishedVersionId,
                versionNumber: projectMarkdownVersions.versionNumber,
                excerpt: projectMarkdownVersions.excerpt,
                createdAt: projectMarkdownVersions.createdAt,
            })
            .from(projectMarkdowns)
            .leftJoin(projectMarkdownVersions, eq(projectMarkdowns.publishedVersionId, projectMarkdownVersions.id))
            .where(and(eq(projectMarkdowns.projectId, projectId), eq(projectMarkdowns.slug, 'readme')))
            .limit(1),
    ]);

    const followersCount = includeFollowersCount ? Number((followersResult[0] as { count?: number } | undefined)?.count || 0) : undefined;

    const hasMoreMembers = membersResult.length > PROJECT_DETAIL_MEMBER_PAGE_SIZE;
    const limitedMembers = membersResult.slice(0, PROJECT_DETAIL_MEMBER_PAGE_SIZE);
    const lastMember = limitedMembers[limitedMembers.length - 1];
    const membersNextCursor = hasMoreMembers && lastMember ? Buffer.from(`${lastMember.joinedAt.toISOString()}:::${lastMember.membershipId}`).toString('base64') : null;

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
    const acceptedRoleRows =
        collaboratorIds.length > 0
            ? await db
                  .select({
                      applicantId: roleApplications.applicantId,
                      roleTitle: projectOpenRoles.title,
                      roleName: projectOpenRoles.role,
                      updatedAt: roleApplications.updatedAt,
                  })
                  .from(roleApplications)
                  .leftJoin(projectOpenRoles, eq(projectOpenRoles.id, roleApplications.roleId))
                  .where(and(eq(roleApplications.projectId, projectId), eq(roleApplications.status, 'accepted'), inArray(roleApplications.applicantId, collaboratorIds)))
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
        hasPublishedReadme: Boolean(readmeRows[0]?.publishedVersionId),
        readmeExcerpt: readmeRows[0]?.excerpt ?? null,
        readmeUpdatedAt: readmeRows[0]?.createdAt?.toISOString?.() ?? null,
        readmeVersionNumber: readmeRows[0]?.versionNumber ?? null,
    };
}

const getPublicProjectDetailShellData = unstable_cache(
    async (projectId: string, ownerId: string, includeFollowersCount: boolean) => retryProjectDetailRead('public_project_detail_shell_data', () => fetchProjectDetailShellData(projectId, ownerId, includeFollowersCount, null)),
    [PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG],
    { revalidate: 60, tags: [PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG] },
);

const getPublicProjectDetailMetadata = unstable_cache(
    async (slugOrId: string): Promise<ProjectDetailMetadataRead | null> => {
        const project = await resolveProjectDetailMetadataTarget(slugOrId);
        if (!project) return null;

        const canRead = computeProjectReadAccess(project.visibility, project.status, false, false);
        if (!canRead) return null;
        const readmeVisible = normalizeProjectPublicTabVisibility(project.publicTabVisibility).readme;
        const readme = readmeVisible ? await retryProjectDetailRead('public_project_detail_metadata_readme', () => db.select({ excerpt: projectMarkdownVersions.excerpt }).from(projectMarkdowns).leftJoin(projectMarkdownVersions, eq(projectMarkdowns.publishedVersionId, projectMarkdownVersions.id)).where(and(eq(projectMarkdowns.projectId, project.projectId), eq(projectMarkdowns.slug, 'readme'))).limit(1)) : [];

        return {
            projectId: project.projectId,
            ownerId: project.ownerId,
            slug: project.slug || null,
            title: project.title,
            shortDescription: project.shortDescription || null,
            description: project.description || null,
            readmeExcerpt: readme[0]?.excerpt ?? null,
            coverImage: project.coverImage || null,
        };
    },
    [PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG],
    { revalidate: 60, tags: [PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG] },
);

export async function readProjectDetailMetadata(input: { slugOrId: string; actorUserId?: string | null }): Promise<
    | { success: true; data: ProjectDetailMetadataRead }
    | {
          success: false;
          errorCode: 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL_ERROR';
          message: string;
      }
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

        const project = await resolveProjectDetailMetadataTarget(trimmed, actorUserId);
        if (!project) {
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'Project not found.',
            };
        }

        const viewerState = resolveProjectDetailViewerState({
            projectId: project.projectId,
            ownerId: project.ownerId,
            visibility: project.visibility,
            status: project.status,
            actorUserId,
            memberRoleRaw: project.memberRole,
            isFollowed: false,
        });

        if (!viewerState.canRead) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'Forbidden',
            };
        }
        const readmeVisible = viewerState.isOwner || viewerState.isMember || normalizeProjectPublicTabVisibility(project.publicTabVisibility).readme;
        const readme = readmeVisible ? await retryProjectDetailRead('project_detail_metadata_readme', () => db.select({ excerpt: projectMarkdownVersions.excerpt }).from(projectMarkdowns).leftJoin(projectMarkdownVersions, eq(projectMarkdowns.publishedVersionId, projectMarkdownVersions.id)).where(and(eq(projectMarkdowns.projectId, project.projectId), eq(projectMarkdowns.slug, 'readme'))).limit(1)) : [];

        return {
            success: true,
            data: {
                projectId: project.projectId,
                ownerId: project.ownerId,
                slug: project.slug || null,
                title: project.title,
                shortDescription: project.shortDescription || null,
                description: project.description || null,
                readmeExcerpt: readme[0]?.excerpt ?? null,
                coverImage: project.coverImage || null,
            },
        };
    } catch (error) {
        console.error('[readProjectDetailMetadata] failed', error);
        const message = error instanceof Error ? error.message : String(error);
        const normalizedMessage = message.trim().toLowerCase();
        const isAuthorizationError = normalizedMessage === 'forbidden' || normalizedMessage.includes('not authorized') || normalizedMessage.includes('not authorised') || normalizedMessage.includes('unauthorized') || normalizedMessage.includes('unauthorised') || normalizedMessage.includes('permission');

        return {
            success: false,
            errorCode: isAuthorizationError ? 'FORBIDDEN' : 'INTERNAL_ERROR',
            message: isAuthorizationError ? 'Forbidden' : 'Internal error',
        };
    }
}

export async function readProjectDetailShell(input: { slugOrId: string; actorUserId?: string | null }): Promise<ProjectDetailShellResult> {
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

        const project = await resolveProjectDetailTarget(slugOrId, actorUserId);
        if (!project) {
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'Project not found.',
            };
        }

        return await runInFlightDeduped(`project:detail-shell:${project.id}:${actorUserId ?? 'anon'}`, async () => {
            const viewerState = resolveProjectDetailViewerState({
                projectId: project.id,
                ownerId: project.ownerId,
                visibility: project.visibility,
                status: project.status,
                actorUserId,
                memberRoleRaw: project.memberRole,
                isFollowed: project.isFollowed,
            });

            const { canRead, canWrite, isOwner, isMember, memberRole, isFollowed } = viewerState;
            if (!canRead) {
                return {
                    success: false,
                    errorCode: 'FORBIDDEN' as const,
                    message: 'Forbidden',
                };
            }

            const shouldUseCachedShell = !actorUserId && computeProjectReadAccess(project.visibility, project.status, false, false);
            const includeFollowersCount = project.followersCount == null;
            const shell = shouldUseCachedShell
                ? await getPublicProjectDetailShellData(project.id, project.ownerId, includeFollowersCount)
                : await retryProjectDetailRead('project_detail_shell_data', () => fetchProjectDetailShellData(project.id, project.ownerId, includeFollowersCount, actorUserId));

            const normalizedStatus: Project['status'] = project.status === 'draft' || project.status === 'active' || project.status === 'completed' || project.status === 'archived' ? project.status : 'draft';

            const normalizedSyncStatus: NonNullable<Project['syncStatus']> = project.syncStatus === 'pending' || project.syncStatus === 'cloning' || project.syncStatus === 'indexing' || project.syncStatus === 'ready' || project.syncStatus === 'failed' ? project.syncStatus : 'ready';

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
                publicTabVisibility: normalizeProjectPublicTabVisibility(project.publicTabVisibility),
                lookingForCollaborators: !!project.lookingForCollaborators,
                memberUpdatesEnabled: !!project.memberUpdatesEnabled,
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
                hasPublishedReadme: Boolean(shell.hasPublishedReadme),
                readmeExcerpt: shell.readmeExcerpt ?? null,
                readmeUpdatedAt: shell.readmeUpdatedAt ?? null,
                readmeVersionNumber: shell.readmeVersionNumber ?? null,
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
        });
    } catch (error) {
        console.error('[readProjectDetailShell] failed', error);
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to load project detail.',
        };
    }
}

export async function getProjectDetailShellAction(input: { slugOrId: string; actorUserId?: string | null }): Promise<ProjectDetailShellResult> {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
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
export async function ensureProjectGroupExists(projectId: string, ownerId: string): Promise<string | null> {
    try {
        // FAST PATH: Check if project already has a conversationId (99% of cases)
        const [project] = await db.select({ conversationId: projects.conversationId }).from(projects).where(eq(projects.id, projectId)).limit(1);

        if (!project) return null;

        // If already has conversationId, return it immediately
        if (project.conversationId) {
            return project.conversationId;
        }

        // SLOW PATH: Create project group with proper locking (rare - only for old projects)
        // Uses FOR UPDATE to prevent race conditions
        const result = await db.transaction(async (tx) => {
            // CRITICAL: Lock the row with FOR UPDATE to prevent concurrent creation
            const lockedProject = await tx.execute<{
                conversation_id: string | null;
            }>(sql`
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
            const [newConversation] = await tx
                .insert(conversations)
                .values({
                    type: 'project_group',
                })
                .returning({ id: conversations.id });

            if (!newConversation) {
                throw new Error('Failed to create project group');
            }

            // Link to project (atomic, no race possible due to lock)
            await tx.update(projects).set({ conversationId: newConversation.id }).where(eq(projects.id, projectId));

            // Get ALL existing project members
            const members = await tx.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, projectId)).limit(500); // Prevent unbounded fetch on huge projects

            // Collect all participant user IDs (ensure owner is ALWAYS included)
            const participantIds = new Set<string>([ownerId]); // Always include owner
            members.forEach((m) => participantIds.add(m.userId));

            // Add all participants (bulk insert, idempotent)
            await tx
                .insert(conversationParticipants)
                .values(
                    Array.from(participantIds).map((userId) => ({
                        conversationId: newConversation.id,
                        userId,
                    })),
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
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return {
                success: false,
                error: 'You must be logged in to create a project',
            };
        }

        const {
            data: { session },
        } = await supabase.auth.getSession();

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
            const currentMetadata = (normalizedImportSource.metadata || {}) as Record<string, unknown>;
            const normalizedTarget = typeof currentMetadata.folderName === 'string' && currentMetadata.folderName.trim().length > 0 ? currentMetadata.folderName : 'upload';
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
                        ...(typeof currentMetadata.uploadSession === 'object' && currentMetadata.uploadSession ? (currentMetadata.uploadSession as Record<string, unknown>) : {}),
                        status: 'pending',
                    },
                },
            };
        }
        const normalizedImportSourceWithLeadFocus = withLeadFocusMetadata(normalizedImportSource, input.creator_role);
        const visibility = resolveProjectVisibilityForCreate(input.visibility);

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
                    category: input.project_type === 'other' ? (input.custom_project_type || 'Other') : (input.project_type || null),
                    tags: input.tags || [],
                    skills: input.technologies_used || [],
                    visibility,
                    status: mapStatus(input.status),
                    lookingForCollaborators: true,
                    lifecycleStages: validateAndSanitizeLifecycleStages(input.lifecycle_stages && input.lifecycle_stages.length > 0 ? input.lifecycle_stages : getLifecycleStagesForProjectType(input.project_type)),
                    currentStageIndex: input.current_stage_index || 0,
                    importSource: normalizedImportSourceWithLeadFocus,
                    // For GitHub imports, start at `pending` until the worker actually begins cloning.
                    syncStatus: (normalizedImportSourceWithLeadFocus?.type === 'github' ? 'pending' : normalizedImportSourceWithLeadFocus?.type === 'upload' ? 'pending' : 'ready') as 'pending' | 'cloning' | 'indexing' | 'ready' | 'failed',
                    githubRepoUrl: normalizedImportSourceWithLeadFocus?.type === 'github' ? normalizedImportSourceWithLeadFocus.repoUrl || null : null,
                    githubDefaultBranch: normalizedImportSourceWithLeadFocus?.type === 'github' ? normalizedImportSourceWithLeadFocus.branch || 'main' : 'main',
                };

                // Use transaction to ensure project, owner membership, and project group are created together
                // OPTIMIZED: Create conversation FIRST, insert project WITH conversationId (saves 1 UPDATE)
                const result = await db.transaction(async (tx) => {
                    // 1. Create the Project Group Conversation FIRST
                    const [newConversation] = await tx
                        .insert(conversations)
                        .values({
                            type: 'project_group',
                        })
                        .returning({ id: conversations.id });

                    if (!newConversation) {
                        throw new Error('Failed to create project group');
                    }

                    // 2. Create the Project WITH conversationId
                    const [newProject] = await tx
                        .insert(projects)
                        .values({
                            ...projectData,
                            conversationId: newConversation.id,
                        })
                        .returning();

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
                        role: 'owner',
                    });
                    await upsertProfileProjectContributionFromMembership(tx, {
                        profileId: user.id,
                        projectId: newProject.id,
                        verifiedBy: user.id,
                        previousRole: null,
                        nextRole: 'owner',
                        source: 'owner',
                    });

                    // Keep denormalized profile stats in sync.
                    await tx
                        .update(profiles)
                        .set({
                            projectsCount: sql`GREATEST(0, ${profiles.projectsCount} + 1)`,
                        })
                        .where(eq(profiles.id, user.id));

                    // 5. Insert Open Roles (if any)
                    if (input.roles && input.roles.length > 0) {
                        await tx.insert(projectOpenRoles).values(
                            input.roles.map((role) => ({
                                projectId: newProject.id,
                                role: role.role,
                                count: role.count,
                                description: role.description || '',
                                skills: role.skills || [],
                            })),
                        );
                    }

                    // 6. Insert Tags and Skills into Junction Tables
                    const tagsArray = input.tags || [];
                    if (tagsArray.length > 0) {
                        const tagValues = tagsArray
                            .map((t) => {
                                const slug = t
                                    .toLowerCase()
                                    .replace(/[^a-z0-9]+/g, '-')
                                    .replace(/^-+|-+$/g, '');
                                return { name: t, slug };
                            })
                            .filter((t) => t.slug);

                        if (tagValues.length > 0) {
                            await tx.insert(tags).values(tagValues).onConflictDoNothing();
                            const slugs = tagValues.map((v) => v.slug);
                            const foundTags = await tx.select().from(tags).where(inArray(tags.slug, slugs));
                            if (foundTags.length > 0) {
                                await tx
                                    .insert(projectTags)
                                    .values(
                                        foundTags.map((t) => ({
                                            projectId: newProject.id,
                                            tagId: t.id,
                                        })),
                                    )
                                    .onConflictDoNothing();
                            }
                        }
                    }

                    const skillsArray = input.technologies_used || [];
                    if (skillsArray.length > 0) {
                        const skillValues = skillsArray
                            .map((s) => {
                                const slug = s
                                    .toLowerCase()
                                    .replace(/[^a-z0-9]+/g, '-')
                                    .replace(/^-+|-+$/g, '');
                                return { name: s, slug };
                            })
                            .filter((s) => s.slug);

                        if (skillValues.length > 0) {
                            await tx.insert(skills).values(skillValues).onConflictDoNothing();
                            const slugs = skillValues.map((v) => v.slug);
                            const foundSkills = await tx.select().from(skills).where(inArray(skills.slug, slugs));
                            if (foundSkills.length > 0) {
                                await tx
                                    .insert(projectSkills)
                                    .values(
                                        foundSkills.map((s) => ({
                                            projectId: newProject.id,
                                            skillId: s.id,
                                        })),
                                    )
                                    .onConflictDoNothing();
                            }
                        }
                    }

                    return newProject;
                });

                revalidatePath('/hub');

                // Add to Import Queue if applicable
                if (normalizedImportSourceWithLeadFocus?.type === 'github' && normalizedImportSourceWithLeadFocus.repoUrl) {
                    const queueImportSource = clearSealedGithubTokenFromImportSource(normalizedImportSourceWithLeadFocus) as ImportSourcePayload;
                    const queueEventId = buildGithubImportEventId(result.id, queueImportSource.repoUrl!, queueImportSource.branch || null);
                    await enqueueGithubImportOrRunInline({
                        projectId: result.id,
                        userId: user.id,
                        importSource: queueImportSource,
                        eventId: queueEventId,
                        source: 'create',
                    });
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
                // Postgres error code 23505 is unique_violation. Drizzle wraps this in `error.cause`.
                const dbError = error.cause || error;
                if (dbError.code === '23505') {
                    const errorMsg = String(dbError.message || '') + String(dbError.detail || '') + String(dbError.constraint_name || '');
                    if (errorMsg.includes('slug')) {
                        if (input.slug) {
                            throw new Error('This project URL is already taken. Please choose another.');
                        }
                        attempts++;
                        const suffix = Math.random().toString(36).substring(2, 6);
                        finalSlug = `${generateSlug(input.title)}-${suffix}`;
                        continue;
                    }
                    // Project Key Collision (e.g. "NB" already exists)
                    if (errorMsg.includes('key')) {
                        attempts++;
                        const suffix = Math.floor(Math.random() * 9) + 1;
                        finalKey = `${generateProjectKey(input.title)}${suffix}`;
                        continue;
                    }
                }
                throw error; // Re-throw other errors
            }
        }

        throw new Error('Failed to generate a unique project ID. Please try again.');
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
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) throw new Error('Unauthorized');

    // Transaction to ensure atomicity of project update + role changes
    return await db
        .transaction(async (tx) => {
            // Check ownership
            const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).limit(1);

            if (!project) throw new Error('Project not found');
            if (project.ownerId !== user.id) throw new Error('Unauthorized');

            const { roles, deletedRoleIds, ...raw } = data || {};

            // Update Project (canonical camelCase payload; accepts snake_case for backward compatibility)
            const updateValues: any = {
                updatedAt: new Date(),
            };

            if (raw.title !== undefined) updateValues.title = raw.title;
            if (raw.description !== undefined) updateValues.description = raw.description;
            if (raw.visibility !== undefined) {
                throw new Error('Project visibility must be changed from Access settings.');
            }
            if (raw.status !== undefined) updateValues.status = raw.status;
            const nextCoverImage = raw.coverImage !== undefined ? raw.coverImage : raw.cover_image !== undefined ? raw.cover_image : undefined;
            if (nextCoverImage !== undefined) {
                updateValues.coverImage = nextCoverImage;
                if (nextCoverImage === null) {
                    updateValues.coverImageBucket = null;
                    updateValues.coverImageKey = null;
                }
            }

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
            if (raw.lifecycleStages !== undefined) {
                updateValues.lifecycleStages = validateAndSanitizeLifecycleStages(raw.lifecycleStages);
            } else if (raw.lifecycle_stages !== undefined) {
                updateValues.lifecycleStages = validateAndSanitizeLifecycleStages(raw.lifecycle_stages);
            }

            if (raw.currentStageIndex !== undefined) updateValues.currentStageIndex = raw.currentStageIndex;
            else if (raw.current_stage_index !== undefined) updateValues.currentStageIndex = raw.current_stage_index;
            
            if (raw.memberUpdatesEnabled !== undefined) updateValues.memberUpdatesEnabled = raw.memberUpdatesEnabled;
            else if (raw.member_updates_enabled !== undefined) updateValues.memberUpdatesEnabled = raw.member_updates_enabled;

            await tx.update(projects).set(updateValues).where(eq(projects.id, projectId));
            await markProjectCollaboratorsSummaryStale(projectId, tx);

            // Sync Junction Tables for normalized relational search
            if (raw.tags !== undefined) {
                await tx.delete(projectTags).where(eq(projectTags.projectId, projectId));
                if (tagsArray.length > 0) {
                    const tagValues = tagsArray
                        .map((t) => {
                            const slug = t
                                .toLowerCase()
                                .replace(/[^a-z0-9]+/g, '-')
                                .replace(/^-+|-+$/g, '');
                            return { name: t, slug };
                        })
                        .filter((t) => t.slug);

                    if (tagValues.length > 0) {
                        await tx.insert(tags).values(tagValues).onConflictDoNothing();
                        const slugs = tagValues.map((v) => v.slug);
                        const foundTags = await tx.select().from(tags).where(inArray(tags.slug, slugs));
                        if (foundTags.length > 0) {
                            await tx
                                .insert(projectTags)
                                .values(foundTags.map((t) => ({ projectId, tagId: t.id })))
                                .onConflictDoNothing();
                        }
                    }
                }
            }

            if (raw.skills !== undefined || raw.technologies_used !== undefined) {
                await tx.delete(projectSkills).where(eq(projectSkills.projectId, projectId));
                if (skillsArray.length > 0) {
                    const skillValues = skillsArray
                        .map((s) => {
                            const slug = s
                                .toLowerCase()
                                .replace(/[^a-z0-9]+/g, '-')
                                .replace(/^-+|-+$/g, '');
                            return { name: s, slug };
                        })
                        .filter((s) => s.slug);

                    if (skillValues.length > 0) {
                        await tx.insert(skills).values(skillValues).onConflictDoNothing();
                        const slugs = skillValues.map((v) => v.slug);
                        const foundSkills = await tx.select().from(skills).where(inArray(skills.slug, slugs));
                        if (foundSkills.length > 0) {
                            await tx
                                .insert(projectSkills)
                                .values(foundSkills.map((s) => ({ projectId, skillId: s.id })))
                                .onConflictDoNothing();
                        }
                    }
                }
            }

            let openRoles;

            // Update Roles
            if (roles && Array.isArray(roles)) {
                // Intercept lead-role if present
                let updatedImportSource = project.importSource;
                const cleanRoles = [];
                const leadRole = roles.find((r: any) => r.id === 'lead-role');
                if (leadRole) {
                    const metadata = { ...((project.importSource as any)?.metadata || {}) };
                    metadata.leadFocus = (leadRole.role || '').trim();
                    metadata.leadDescription = (leadRole.description || '').trim();
                    
                    updatedImportSource = {
                        ...(project.importSource || { type: 'scratch' }),
                        metadata,
                    };
                    
                    // Save updated importSource
                    updateValues.importSource = updatedImportSource;
                    await tx.update(projects).set({ importSource: updatedImportSource }).where(eq(projects.id, projectId));
                }

                // Filter out lead-role from database projectOpenRoles sync
                for (const r of roles) {
                    if (r.id !== 'lead-role') {
                        cleanRoles.push(r);
                    }
                }

                const cleanDeletedIds = (deletedRoleIds || []).filter((id: string) => id !== 'lead-role');

                if (cleanDeletedIds.length > 0) {
                    await tx.delete(projectOpenRoles).where(and(eq(projectOpenRoles.projectId, projectId), inArray(projectOpenRoles.id, cleanDeletedIds)));
                }

                const inserts = [];
                const updatePromises = [];

                for (const role of cleanRoles) {
                    if (role.id) {
                        updatePromises.push(
                            tx
                                .update(projectOpenRoles)
                                .set({
                                    role: role.role,
                                    count: role.count,
                                    description: role.description || '',
                                    skills: role.skills || [],
                                    updatedAt: new Date(),
                                })
                                .where(and(eq(projectOpenRoles.projectId, projectId), eq(projectOpenRoles.id, role.id))),
                        );
                    } else {
                        inserts.push({
                            projectId: project.id,
                            role: role.role,
                            count: role.count || 1,
                            description: role.description || '',
                            skills: role.skills || [],
                        });
                    }
                }

                if (updatePromises.length > 0) {
                    await Promise.all(updatePromises);
                }
                if (inserts.length > 0) {
                    await tx.insert(projectOpenRoles).values(inserts);
                }

                openRoles = await tx
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
                    .orderBy(desc(projectOpenRoles.updatedAt), desc(projectOpenRoles.createdAt));
            }

            return {
                success: true,
                slug: project.slug,
                id: project.id,
                previousCoverImage: project.coverImage,
                nextCoverImage,
                openRoles,
            };
        })
        .then(async ({ success, slug, id, previousCoverImage, nextCoverImage, openRoles }) => {
            if (nextCoverImage !== undefined && previousCoverImage !== nextCoverImage) {
                await cleanupProjectCoverImages({
                    userId: user.id,
                    projectId: id,
                    keepStorageKey: projectCoverStorageKeyFromPublicUrl(nextCoverImage, user.id, id),
                    previousCoverImage,
                });
            }
            revalidatePath(`/projects/${slug}`);
            revalidatePath(`/projects/${id}`);
            await invalidateProjectPublicCaches(id);
            if (Array.isArray(data?.roles)) {
                const createdCount = data.roles.filter((role: { id?: unknown }) => !role.id).length;
                const updatedCount = data.roles.length - createdCount;
                const deletedCount = Array.isArray(data.deletedRoleIds) ? data.deletedRoleIds.length : 0;
                const eventKey = createdCount > 0 && updatedCount === 0 && deletedCount === 0 ? 'roles.created' : deletedCount > 0 ? 'roles.closed' : 'roles.updated';
                await enqueueProjectNotificationBestEffort(
                    {
                        projectId: id,
                        actorUserId: user.id,
                        ...actorNotificationSnapshot(user),
                        eventKey,
                        title: 'Project roles updated',
                        body: `${createdCount} created · ${updatedCount} updated · ${deletedCount} removed.`,
                        sourceEventId: `${id}:roles:${Date.now()}`,
                        entityRefs: { projectId: id },
                    },
                    {
                        createdCount,
                        updatedCount,
                        deletedCount,
                    },
                );
            }
            return openRoles === undefined ? { success } : { success, openRoles };
        });
}

export async function createProjectCoverImageUploadUrlAction(input: { projectId: string; mimeType: string; sizeBytes: number }): Promise<
    | {
          success: true;
          uploadUrl: string;
          uploadIntentId: string;
          storagePath: string;
          contentType: string;
          bucket: string;
          uploadToken: string;
      }
    | { success: false; error: string }
> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Unauthorized' };
        }

        const { allowed } = await consumeRateLimit(`upload:project-image:user:${user.id}`, 10, 60 * 60);
        if (!allowed) {
            return {
                success: false,
                error: 'Too many project image upload attempts. Please try again later.',
            };
        }

        await assertProjectOwnerForSettings(input.projectId, user.id);
        const normalizedMimeType = normalizeAndValidateMimeType(input.mimeType);
        if (!ALLOWED_PROJECT_COVER_MIME_TYPES.has(normalizedMimeType)) {
            return {
                success: false,
                error: 'Unsupported image type. Use JPG, PNG, WebP, or GIF.',
            };
        }
        const expectedSize = normalizeAndValidateFileSize(input.sizeBytes, PROJECT_COVER_UPLOAD_MAX_FILE_BYTES, 'Project image');
        const extension = projectCoverExtensionFromMimeType(normalizedMimeType);
        const storagePath = `projects/${input.projectId}/project-images/${user.id}/${Date.now()}-${randomUUID()}.${extension}`;
        const intent = await createUploadIntent({
            userId: user.id,
            projectId: input.projectId,
            bucket: PROJECT_COVER_UPLOAD_BUCKET,
            storageKey: storagePath,
            scope: 'profile_image',
            kind: 'banner',
            expectedMimeType: normalizedMimeType,
            expectedSize,
            metadata: {
                kind: 'project_image',
                projectId: input.projectId,
            },
        });

        const admin = await createAdminClient();
        const { data, error } = await admin.storage.from(PROJECT_COVER_UPLOAD_BUCKET).createSignedUploadUrl(storagePath, { upsert: false });
        if (error || !data?.signedUrl || !data?.token) {
            logger.error('project.cover_upload_url_failed', {
                module: 'projects',
                projectId: input.projectId,
                userId: user.id,
                error: error?.message || 'Missing signed URL token',
            });
            return {
                success: false,
                error: 'Failed to prepare project image upload.',
            };
        }

        return {
            success: true,
            uploadUrl: data.signedUrl,
            uploadIntentId: intent.id,
            storagePath,
            contentType: normalizedMimeType,
            bucket: PROJECT_COVER_UPLOAD_BUCKET,
            uploadToken: data.token,
        };
    } catch (error) {
        logger.error('project.cover_upload_url_failed', {
            module: 'projects',
            projectId: input.projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: 'Failed to prepare project image upload.' };
    }
}

export async function finalizeProjectCoverImageUploadAction(input: { projectId: string; uploadIntentId: string }): Promise<
    | {
          success: true;
          publicUrl: string;
          storagePath: string;
          uploadIntentId: string;
          removedPreviousImages: number;
      }
    | { success: false; error: string }
> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Unauthorized' };
        }

        const project = await assertProjectOwnerForSettings(input.projectId, user.id);
        const intent = await finalizeUploadIntent({
            intentId: input.uploadIntentId,
            bucket: PROJECT_COVER_UPLOAD_BUCKET,
            userId: user.id,
            projectId: input.projectId,
            expectedScope: 'profile_image',
            expectedKind: 'banner',
        });
        const imageUrl = buildProjectImageRoute(input.projectId);

        const [updated] = await db
            .update(projects)
            .set({
                coverImage: imageUrl,
                coverImageBucket: PROJECT_COVER_UPLOAD_BUCKET,
                coverImageKey: intent.storageKey,
                updatedAt: new Date(),
            })
            .where(and(eq(projects.id, input.projectId), eq(projects.ownerId, user.id)))
            .returning({ id: projects.id });

        if (!updated) {
            return { success: false, error: 'Failed to publish project image.' };
        }

        const cleanup = await cleanupProjectCoverImages({
            userId: user.id,
            projectId: input.projectId,
            keepStorageKey: intent.storageKey,
            keepBucket: PROJECT_COVER_UPLOAD_BUCKET,
            previousBucket: project.coverImageBucket,
            previousStorageKey: project.coverImageKey,
            previousCoverImage: project.coverImage,
        });

        await revalidateProjectPaths(input.projectId);
        await invalidateProjectPublicCaches(input.projectId);

        return {
            success: true,
            publicUrl: imageUrl,
            storagePath: intent.storageKey,
            uploadIntentId: intent.id,
            removedPreviousImages: cleanup.removed,
        };
    } catch (error) {
        logger.error('project.cover_upload_finalize_failed', {
            module: 'projects',
            projectId: input.projectId,
            uploadIntentId: input.uploadIntentId,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false,
            error: 'Failed to finalize project image upload.',
        };
    }
}

export async function clearProjectCoverImageAction(projectId: string): Promise<{ success: true; removedPreviousImages: number } | { success: false; error: string }> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Unauthorized' };
        }

        const project = await assertProjectOwnerForSettings(projectId, user.id);
        if (!project.coverImage) {
            return { success: true, removedPreviousImages: 0 };
        }

        const [updated] = await db
            .update(projects)
            .set({
                coverImage: null,
                coverImageBucket: null,
                coverImageKey: null,
                updatedAt: new Date(),
            })
            .where(and(eq(projects.id, projectId), eq(projects.ownerId, user.id)))
            .returning({ id: projects.id });

        if (!updated) {
            return { success: false, error: 'Failed to clear project image.' };
        }

        const cleanup = await cleanupProjectCoverImages({
            userId: user.id,
            projectId,
            keepStorageKey: null,
            keepBucket: null,
            previousBucket: project.coverImageBucket,
            previousStorageKey: project.coverImageKey,
            previousCoverImage: project.coverImage,
        });

        await revalidateProjectPaths(projectId);
        await invalidateProjectPublicCaches(projectId);

        return { success: true, removedPreviousImages: cleanup.removed };
    } catch (error) {
        logger.error('project.cover_clear_failed', {
            module: 'projects',
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: 'Failed to clear project image.' };
    }
}

type ProjectSettingsErrorCode = 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_INPUT' | 'INTERNAL_ERROR';

type ProjectSettingsMutationResult = { success: true; message: string } | { success: false; message: string; errorCode: ProjectSettingsErrorCode };

type ProjectDangerZonePreflightResult =
    | {
          success: true;
          data: {
              status: 'draft' | 'active' | 'completed' | 'archived';
              openRolesCount: number;
              pendingApplicationsCount: number;
              activeTasksCount: number;
              canArchive: boolean;
              canDelete: boolean;
          };
      }
    | { success: false; message: string; errorCode: ProjectSettingsErrorCode };

type ProjectAccessImpactResult =
    | {
          success: true;
          data: {
              membersCount: number;
              followersCount: number;
              openRolesCount: number;
              pendingApplicationsCount: number;
              activeTasksCount: number;
          };
      }
    | { success: false; message: string; errorCode: ProjectSettingsErrorCode };

type ProjectAccessTransitionPreflightResult =
    | {
          success: true;
          data: {
              previousVisibility: ProjectVisibility;
              nextVisibility: ProjectVisibility;
              confirmationToken: string;
              policy: ReturnType<typeof buildProjectAccessTransitionPolicy>;
              counts: {
                  membersCount: number;
                  followersCount: number;
                  openRolesCount: number;
                  pendingApplicationsCount: number;
                  activeTasksCount: number;
              };
              previews: AccessTransitionPreview;
          };
      }
    | { success: false; message: string; errorCode: ProjectSettingsErrorCode };

type ProjectPublicTabVisibilityResult =
    | {
          success: true;
          message: string;
          data: ProjectPublicTabVisibility;
      }
    | { success: false; message: string; errorCode: ProjectSettingsErrorCode };

type ProjectFileWorkspaceSettingsResult =
    | {
          success: true;
          data: {
              members: Array<{
                  id: string;
                  username: string | null;
                  fullName: string | null;
                  avatarUrl: string | null;
                  membershipRole: ProjectCollaboratorRole;
                  projectRoleTitle: string | null;
                  joinedAt: string | null;
                  fileUploadEnabled: boolean;
                  uploadPermissionLocked: boolean;
                  uploadPermissionLabel: string;
              }>;
              manualFiles: Array<{
                  id: string;
                  name: string;
                  path: string;
                  uploadedByName: string | null;
                  uploadedAt: string | null;
                  updatedAt: string | null;
                  size: number | null;
                  linkedTasks: number;
                  analyticsVisible: boolean;
                  publicVisible: boolean;
                  privateReason: string | null;
              }>;
              summary: {
                  alwaysAllowedCount: number;
                  enabledMemberCount: number;
                  disabledMemberCount: number;
                  viewerCount: number;
                  manualFileCount: number;
                  privateManualFileCount: number;
                  analyticsVisibleManualFileCount: number;
              };
          };
      }
    | { success: false; message: string; errorCode: ProjectSettingsErrorCode };

type ProjectSettingsAuditResult =
    | {
          success: true;
          data: Array<{
              id: string;
              type: string;
              createdAt: string;
              actorName: string | null;
              metadata: Record<string, unknown>;
          }>;
      }
    | { success: false; message: string; errorCode: ProjectSettingsErrorCode };

type ProjectCollaboratorRole = 'owner' | 'admin' | 'member' | 'viewer';

type ProjectCollaboratorSettingsResult =
    | {
          success: true;
          data: {
              members: Array<{
                  id: string;
                  username: string | null;
                  fullName: string | null;
                  avatarUrl: string | null;
                  membershipRole: ProjectCollaboratorRole;
                  projectRoleTitle: string | null;
                  joinedAt: string | null;
                  fileUploadEnabled: boolean;
                  responsibilityCounts: {
                      activeAssignedTasks: number;
                      activeCreatedTasks: number;
                      fileReviews: number;
                      acceptedApplications: number;
                      projectGroupParticipant: boolean;
                  };
              }>;
              roleCounts: Record<ProjectCollaboratorRole, number>;
              hasMore: boolean;
              nextCursor: string | null;
          };
      }
    | { success: false; message: string; errorCode: ProjectSettingsErrorCode };

type ProjectCollaboratorSettingsOptions = {
    limit?: number;
    cursor?: string | null;
    query?: string | null;
    roleFilter?: ProjectCollaboratorRole | 'all' | null;
};

type ProjectMemberRemovalPreflightResult =
    | {
          success: true;
          data: {
              member: {
                  id: string;
                  username: string | null;
                  fullName: string | null;
                  avatarUrl: string | null;
                  membershipRole: ProjectCollaboratorRole;
                  projectRoleTitle: string | null;
              };
              activeAssignedTasks: number;
              activeCreatedTasks: number;
              fileReviews: number;
              acceptedApplications: number;
              projectGroupParticipant: boolean;
              visibility: ProjectVisibility;
              activeAssignedTaskItems: Array<{
                  id: string;
                  title: string;
                  taskNumber: number | null;
                  status: string | null;
              }>;
              activeCreatedTaskItems: Array<{
                  id: string;
                  title: string;
                  taskNumber: number | null;
                  status: string | null;
              }>;
              fileReviewItems: Array<{
                  id: string;
                  taskId: string;
                  taskTitle: string | null;
                  nodeName: string | null;
                  annotation: string | null;
              }>;
              acceptedApplicationItems: Array<{
                  id: string;
                  roleId: string;
                  roleTitle: string | null;
                  roleName: string | null;
              }>;
              reassignmentCandidates: Array<{
                  id: string;
                  username: string | null;
                  fullName: string | null;
                  avatarUrl: string | null;
                  membershipRole: ProjectCollaboratorRole;
              }>;
          };
      }
    | { success: false; message: string; errorCode: ProjectSettingsErrorCode };

type ProjectMemberMutationResult =
    | { success: true; message: string }
    | {
          success: false;
          message: string;
          errorCode: ProjectSettingsErrorCode | 'INVALID_ROLE' | 'OWNER_TARGET' | 'NOT_A_MEMBER';
      };

type ProjectNotificationSettingsResult =
    | {
          success: true;
          data: {
              policy: ProjectNotificationPolicy;
              summary: ReturnType<typeof summarizeProjectNotificationPolicy>;
          };
      }
    | { success: false; message: string; errorCode: ProjectSettingsErrorCode };

type ProjectMemberNotificationSettingsResult =
    | {
          success: true;
          data: {
              member: {
                  id: string;
                  username: string | null;
                  fullName: string | null;
                  avatarUrl: string | null;
                  membershipRole: ProjectCollaboratorRole;
              };
              canEdit: boolean;
              overrides: ProjectMemberNotificationOverrides;
          };
      }
    | { success: false; message: string; errorCode: ProjectSettingsErrorCode };

const projectSettingsPatchSchema = z.object({
    visibility: z.enum(['public', 'private']).optional(),
    lookingForCollaborators: z.boolean().optional(),
    memberUpdatesEnabled: z.boolean().optional(),
    maxCollaborators: z.string().trim().max(32).nullable().optional(),
});

function actorNotificationSnapshot(user: { user_metadata?: Record<string, unknown> | null }) {
    return {
        actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
        actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    };
}

async function enqueueProjectNotificationBestEffort(input: Parameters<typeof enqueueProjectNotificationEvent>[0], logContext: Record<string, unknown>) {
    try {
        await enqueueProjectNotificationEvent(input);
    } catch (notificationError) {
        logger.warn('project.notification_policy_enqueue_failed', {
            module: 'projects',
            eventKey: input.eventKey,
            projectId: input.projectId,
            ...logContext,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
    }
}

async function loadOwnedProjectForSettings(projectId: string, userId: string) {
    const [project] = await db
        .select({
            id: projects.id,
            ownerId: projects.ownerId,
            title: projects.title,
            slug: projects.slug,
            status: projects.status,
            visibility: projects.visibility,
            coverImage: projects.coverImage,
            coverImageBucket: projects.coverImageBucket,
            coverImageKey: projects.coverImageKey,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

    if (!project) {
        return {
            ok: false as const,
            errorCode: 'NOT_FOUND' as const,
            message: 'Project not found.',
        };
    }
    if (project.ownerId !== userId) {
        return {
            ok: false as const,
            errorCode: 'FORBIDDEN' as const,
            message: 'Only the project owner can change settings.',
        };
    }
    return { ok: true as const, project };
}

export async function updateProjectSettingsAction(
    projectId: string,
    patch: {
        visibility?: 'public' | 'private';
        lookingForCollaborators?: boolean;
        maxCollaborators?: string | null;
    },
): Promise<ProjectSettingsMutationResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        }

        const parsed = projectSettingsPatchSchema.safeParse(patch ?? {});
        if (!parsed.success) {
            return {
                success: false,
                errorCode: 'INVALID_INPUT',
                message: 'Invalid settings payload.',
            };
        }

        const owned = await loadOwnedProjectForSettings(projectId, user.id);
        if (!owned.ok)
            return {
                success: false,
                errorCode: owned.errorCode,
                message: owned.message,
            };

        const data = parsed.data;
        if (data.visibility !== undefined) {
            return {
                success: false,
                errorCode: 'INVALID_INPUT',
                message: 'Project visibility must be changed from Access settings.',
            };
        }

        const updateValues: Partial<typeof projects.$inferInsert> & {
            updatedAt: Date;
        } = {
            updatedAt: new Date(),
        };

        if (data.lookingForCollaborators !== undefined) {
            updateValues.lookingForCollaborators = data.lookingForCollaborators;
        }
        if (data.memberUpdatesEnabled !== undefined) {
            updateValues.memberUpdatesEnabled = data.memberUpdatesEnabled;
        }
        if (data.maxCollaborators !== undefined) {
            const trimmed = data.maxCollaborators?.trim() ?? null;
            updateValues.maxCollaborators = trimmed && trimmed.length > 0 ? trimmed : null;
        }

        if (Object.keys(updateValues).length === 1) {
            return { success: true, message: 'No settings changes to save.' };
        }

        const previousVisibility = normalizeProjectVisibility(owned.project.visibility);

        await db.transaction(async (tx) => {
            await tx.update(projects).set(updateValues).where(eq(projects.id, projectId));
        });
        await revalidateProjectPaths(projectId);

        logger.metric('project.settings.update.result', {
            projectId,
            userId: user.id,
            result: 'success',
            visibilityChanged: false,
            nextVisibility: previousVisibility,
        });

        return { success: true, message: 'Project settings updated.' };
    } catch (error) {
        console.error('Failed to update project settings:', error);
        logger.metric('project.settings.update.result', {
            projectId,
            result: 'error',
            errorCode: 'INTERNAL_ERROR',
        });
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to update project settings.',
        };
    }
}

async function readProjectAccessImpactCounts(projectId: string) {
    const [membersRow, followersRow, openRolesRow, pendingAppsRow, activeTasksRow] = await Promise.all([
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(projectMembers)
            .where(eq(projectMembers.projectId, projectId))
            .limit(1),
        db
            .select({ count: sql<number>`count(*)::int` })
            .from(projectFollows)
            .where(eq(projectFollows.projectId, projectId))
            .limit(1),
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
            .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`))
            .limit(1),
    ]);

    return {
        membersCount: Number(membersRow[0]?.count ?? 0),
        followersCount: Number(followersRow[0]?.count ?? 0),
        openRolesCount: Number(openRolesRow[0]?.count ?? 0),
        pendingApplicationsCount: Number(pendingAppsRow[0]?.count ?? 0),
        activeTasksCount: Number(activeTasksRow[0]?.count ?? 0),
    };
}

async function readProjectAccessTransitionPreviews(projectId: string): Promise<AccessTransitionPreview> {
    const [followers, openRoles, pendingApplications] = await Promise.all([
        db
            .select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
            })
            .from(projectFollows)
            .innerJoin(profiles, eq(profiles.id, projectFollows.userId))
            .where(eq(projectFollows.projectId, projectId))
            .orderBy(desc(projectFollows.createdAt))
            .limit(6),
        db
            .select({
                id: projectOpenRoles.id,
                title: projectOpenRoles.title,
                role: projectOpenRoles.role,
            })
            .from(projectOpenRoles)
            .where(eq(projectOpenRoles.projectId, projectId))
            .orderBy(desc(projectOpenRoles.createdAt))
            .limit(6),
        db
            .select({
                id: roleApplications.id,
                applicantId: roleApplications.applicantId,
                applicantName: sql<string | null>`coalesce(${profiles.fullName}, ${profiles.username})`,
                roleTitle: projectOpenRoles.title,
                roleName: projectOpenRoles.role,
            })
            .from(roleApplications)
            .leftJoin(profiles, eq(profiles.id, roleApplications.applicantId))
            .leftJoin(projectOpenRoles, eq(projectOpenRoles.id, roleApplications.roleId))
            .where(and(eq(roleApplications.projectId, projectId), eq(roleApplications.status, 'pending')))
            .orderBy(desc(roleApplications.updatedAt))
            .limit(6),
    ]);

    return { followers, openRoles, pendingApplications };
}

function buildAccessPreflightPayload(params: { projectId: string; previousVisibility: ProjectVisibility; nextVisibility: ProjectVisibility; hasManagedProjectImage: boolean; counts: Awaited<ReturnType<typeof readProjectAccessImpactCounts>>; previews: AccessTransitionPreview }) {
    const policy = buildProjectAccessTransitionPolicy({
        previousVisibility: params.previousVisibility,
        nextVisibility: params.nextVisibility,
        hasManagedProjectImage: params.hasManagedProjectImage,
        ...params.counts,
    });
    const confirmationToken = buildAccessConfirmationToken({
        projectId: params.projectId,
        previousVisibility: params.previousVisibility,
        nextVisibility: params.nextVisibility,
        hasManagedProjectImage: params.hasManagedProjectImage,
        ...params.counts,
    });

    return {
        previousVisibility: params.previousVisibility,
        nextVisibility: params.nextVisibility,
        confirmationToken,
        policy,
        counts: params.counts,
        previews: params.previews,
    };
}

export async function getProjectAccessTransitionPreflightAction(projectId: string, nextVisibility: ProjectVisibility): Promise<ProjectAccessTransitionPreflightResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        }
        if (!isProjectVisibility(nextVisibility)) {
            return {
                success: false,
                errorCode: 'INVALID_INPUT',
                message: 'Choose Public or Private.',
            };
        }

        const owned = await loadOwnedProjectForSettings(projectId, user.id);
        if (!owned.ok)
            return {
                success: false,
                errorCode: owned.errorCode,
                message: owned.message,
            };

        const [counts, previews] = await Promise.all([readProjectAccessImpactCounts(projectId), readProjectAccessTransitionPreviews(projectId)]);

        return {
            success: true,
            data: buildAccessPreflightPayload({
                projectId,
                previousVisibility: normalizeProjectVisibility(owned.project.visibility),
                nextVisibility,
                hasManagedProjectImage: Boolean(owned.project.coverImageBucket && owned.project.coverImageKey),
                counts,
                previews,
            }),
        };
    } catch (error) {
        logger.error('project.access_preflight_failed', {
            module: 'projects',
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to prepare access transition.',
        };
    }
}

export async function updateProjectVisibilityAction(projectId: string, nextVisibility: ProjectVisibility, confirmationToken: string): Promise<ProjectSettingsMutationResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        }
        if (!isProjectVisibility(nextVisibility)) {
            return {
                success: false,
                errorCode: 'INVALID_INPUT',
                message: 'Choose Public or Private.',
            };
        }

        const owned = await loadOwnedProjectForSettings(projectId, user.id);
        if (!owned.ok)
            return {
                success: false,
                errorCode: owned.errorCode,
                message: owned.message,
            };

        const previousVisibility = normalizeProjectVisibility(owned.project.visibility);
        if (previousVisibility === nextVisibility) {
            return {
                success: true,
                message: `Project is already ${nextVisibility}.`,
            };
        }

        const [counts, previews] = await Promise.all([readProjectAccessImpactCounts(projectId), readProjectAccessTransitionPreviews(projectId)]);
        const preflight = buildAccessPreflightPayload({
            projectId,
            previousVisibility,
            nextVisibility,
            hasManagedProjectImage: Boolean(owned.project.coverImageBucket && owned.project.coverImageKey),
            counts,
            previews,
        });

        if (!confirmationToken || confirmationToken !== preflight.confirmationToken) {
            return {
                success: false,
                errorCode: 'INVALID_INPUT',
                message: 'Access confirmation expired. Review the impact and try again.',
            };
        }

        const imageMigration =
            nextVisibility === 'private'
                ? await migrateLegacyProjectImageToManagedStorage({
                      projectId,
                      userId: user.id,
                      coverImage: owned.project.coverImage,
                      coverImageBucket: owned.project.coverImageBucket,
                      coverImageKey: owned.project.coverImageKey,
                  })
                : null;

        await db.transaction(async (tx) => {
            await tx
                .update(projects)
                .set({
                    visibility: nextVisibility,
                    ...(imageMigration
                        ? {
                              coverImage: imageMigration.url,
                              coverImageBucket: imageMigration.bucket,
                              coverImageKey: imageMigration.key,
                          }
                        : {}),
                    updatedAt: new Date(),
                })
                .where(and(eq(projects.id, projectId), eq(projects.ownerId, user.id)));
            await markProjectCollaboratorsSummaryStale(projectId, tx);

            await tx.insert(projectNodeEvents).values({
                projectId,
                actorId: user.id,
                nodeId: null,
                type: 'project_settings.visibility_changed',
                metadata: {
                    previousVisibility,
                    nextVisibility,
                    source: 'project_settings_access',
                    confirmationSummary: preflight.policy.confirmationSummary,
                    affectedCounts: counts,
                    previewIds: {
                        followers: previews.followers.map((row) => row.id),
                        openRoles: previews.openRoles.map((row) => row.id),
                        pendingApplications: previews.pendingApplications.map((row) => row.id),
                    },
                    imagePrivacyAction: imageMigration?.migrated ? 'migrated_to_private_route' : imageMigration ? 'managed_private_route_confirmed' : 'none',
                },
                createdAt: new Date(),
            });
        });

        if (imageMigration?.migrated) {
            await cleanupProjectCoverImages({
                userId: user.id,
                projectId,
                keepStorageKey: imageMigration.key,
                keepBucket: imageMigration.bucket,
                previousBucket: imageMigration.previousBucket,
                previousStorageKey: imageMigration.previousKey,
                previousCoverImage: owned.project.coverImage,
            });
        }

        await revalidateProjectPaths(projectId);
        await invalidateProjectPublicCaches(projectId);

        try {
            await enqueueProjectNotificationEvent({
                projectId,
                actorUserId: user.id,
                ...actorNotificationSnapshot(user),
                eventKey: 'access.visibility_changed',
                title: `Project visibility changed to ${nextVisibility}`,
                body: `${owned.project.title ?? owned.project.slug ?? 'Project'} is now ${nextVisibility}.`,
                sourceEventId: `${projectId}:visibility:${previousVisibility}:${nextVisibility}`,
                entityRefs: { projectId, projectSlug: owned.project.slug ?? null },
            });
        } catch (notificationError) {
            logger.warn('project.access_visibility_notification_failed', {
                module: 'projects',
                projectId,
                previousVisibility,
                nextVisibility,
                error: notificationError instanceof Error ? notificationError.message : String(notificationError),
            });
        }

        logger.metric('project.access_visibility.update', {
            projectId,
            userId: user.id,
            previousVisibility,
            nextVisibility,
            result: 'success',
        });

        return { success: true, message: `Project is now ${nextVisibility}.` };
    } catch (error) {
        logger.error('project.access_visibility_failed', {
            module: 'projects',
            projectId,
            nextVisibility,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to update project visibility.',
        };
    }
}

export async function getProjectAccessImpactAction(projectId: string): Promise<ProjectAccessImpactResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        }

        const owned = await loadOwnedProjectForSettings(projectId, user.id);
        if (!owned.ok)
            return {
                success: false,
                errorCode: owned.errorCode,
                message: owned.message,
            };

        return {
            success: true,
            data: await readProjectAccessImpactCounts(projectId),
        };
    } catch (error) {
        console.error('Failed to load project access impact:', error);
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to load access impact.',
        };
    }
}

export async function updateProjectPublicTabVisibilityAction(projectId: string, nextVisibility: ProjectPublicTabVisibility): Promise<ProjectPublicTabVisibilityResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        }

        const capability = await requireProjectCapability(projectId, user.id, 'manage_public_tabs');
        const normalized = normalizeProjectPublicTabVisibility(nextVisibility);
        const [current] = await db.select({ publicTabVisibility: projects.publicTabVisibility }).from(projects).where(eq(projects.id, projectId)).limit(1);
        const previous = normalizeProjectPublicTabVisibility(current?.publicTabVisibility);

        await db.transaction(async (tx) => {
            await tx.update(projects).set({ publicTabVisibility: normalized, updatedAt: new Date() }).where(eq(projects.id, projectId));
            await tx.insert(projectNodeEvents).values({
                projectId,
                actorId: user.id,
                nodeId: null,
                type: 'project_settings.public_tabs_changed',
                metadata: {
                    previous,
                    next: normalized,
                    source: 'project_settings_access',
                    actorRole: capability.role,
                },
                createdAt: new Date(),
            });
        });

        await revalidateProjectPaths(projectId);
        await invalidateProjectPublicCaches(projectId);

        try {
            await enqueueProjectNotificationEvent({
                projectId,
                actorUserId: user.id,
                ...actorNotificationSnapshot(user),
                eventKey: 'access.public_tabs_changed',
                title: 'Public project surfaces changed',
                body: 'The visible public tabs for this project were updated.',
                sourceEventId: `${projectId}:public-tabs:${Date.now()}`,
                entityRefs: { projectId },
            });
        } catch (notificationError) {
            logger.warn('project.public_tabs_notification_failed', {
                module: 'projects',
                projectId,
                error: notificationError instanceof Error ? notificationError.message : String(notificationError),
            });
        }

        return {
            success: true,
            message: 'Public tab visibility updated.',
            data: normalized,
        };
    } catch (error) {
        logger.error('project.public_tabs_update_failed', {
            module: 'projects',
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Project not found')) {
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'Project not found.',
            };
        }
        if (message.includes('permission')) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'You do not have permission to change public tab visibility.',
            };
        }
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to update public tab visibility.',
        };
    }
}

export async function getProjectSettingsAuditAction(projectId: string): Promise<ProjectSettingsAuditResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        }

        const owned = await loadOwnedProjectForSettings(projectId, user.id);
        if (!owned.ok)
            return {
                success: false,
                errorCode: owned.errorCode,
                message: owned.message,
            };

        const rows = await db
            .select({
                id: projectNodeEvents.id,
                type: projectNodeEvents.type,
                createdAt: projectNodeEvents.createdAt,
                metadata: projectNodeEvents.metadata,
                username: profiles.username,
                fullName: profiles.fullName,
            })
            .from(projectNodeEvents)
            .leftJoin(profiles, eq(projectNodeEvents.actorId, profiles.id))
            .where(and(eq(projectNodeEvents.projectId, projectId), isNull(projectNodeEvents.nodeId), or(sql`${projectNodeEvents.type} LIKE 'project_settings.%'`, sql`${projectNodeEvents.type} LIKE 'project_member.%'`, sql`${projectNodeEvents.type} LIKE 'project_file_policy.%'`, sql`${projectNodeEvents.type} LIKE 'project_notification_settings.%'`)))
            .orderBy(desc(projectNodeEvents.createdAt))
            .limit(12);

        return {
            success: true,
            data: rows.map((row) => ({
                id: row.id,
                type: row.type,
                createdAt: row.createdAt.toISOString(),
                actorName: row.fullName || row.username || null,
                metadata: (row.metadata as Record<string, unknown> | null) ?? {},
            })),
        };
    } catch (error) {
        console.error('Failed to load project settings audit:', error);
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to load settings audit.',
        };
    }
}

function normalizeCollaboratorRole(value: unknown, fallback: ProjectCollaboratorRole = 'member'): ProjectCollaboratorRole {
    return value === 'owner' || value === 'admin' || value === 'member' || value === 'viewer' ? value : fallback;
}

function collaboratorRoleLabel(role: ProjectCollaboratorRole) {
    if (role === 'admin') return 'Co-leader';
    return role.slice(0, 1).toUpperCase() + role.slice(1);
}

async function readProjectCollaboratorResponsibilityCounts(projectId: string, memberIds: string[], conversationId?: string | null) {
    const initial = new Map<
        string,
        {
            activeAssignedTasks: number;
            activeCreatedTasks: number;
            fileReviews: number;
            acceptedApplications: number;
            projectGroupParticipant: boolean;
        }
    >();
    for (const memberId of memberIds) {
        initial.set(memberId, {
            activeAssignedTasks: 0,
            activeCreatedTasks: 0,
            fileReviews: 0,
            acceptedApplications: 0,
            projectGroupParticipant: false,
        });
    }
    if (memberIds.length === 0) return initial;

    const [assignedRows, createdRows, fileReviewRows, acceptedRows, participantRows] = await Promise.all([
        db
            .select({ userId: tasks.assigneeId, count: sql<number>`count(*)::int` })
            .from(tasks)
            .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`, inArray(tasks.assigneeId, memberIds)))
            .groupBy(tasks.assigneeId),
        db
            .select({ userId: tasks.creatorId, count: sql<number>`count(*)::int` })
            .from(tasks)
            .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), sql`${tasks.status} <> 'done'`, inArray(tasks.creatorId, memberIds)))
            .groupBy(tasks.creatorId),
        db
            .select({
                userId: taskNodeLinks.createdBy,
                count: sql<number>`count(*)::int`,
            })
            .from(taskNodeLinks)
            .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
            .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
            .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), isNull(projectNodes.deletedAt), inArray(taskNodeLinks.createdBy, memberIds), sql`lower(coalesce(${taskNodeLinks.annotation}, '')) like '%review%'`))
            .groupBy(taskNodeLinks.createdBy),
        db
            .select({
                userId: roleApplications.applicantId,
                count: sql<number>`count(*)::int`,
            })
            .from(roleApplications)
            .where(and(eq(roleApplications.projectId, projectId), eq(roleApplications.status, 'accepted'), inArray(roleApplications.applicantId, memberIds)))
            .groupBy(roleApplications.applicantId),
        conversationId
            ? db
                  .select({ userId: conversationParticipants.userId })
                  .from(conversationParticipants)
                  .where(and(eq(conversationParticipants.conversationId, conversationId), inArray(conversationParticipants.userId, memberIds)))
            : Promise.resolve([]),
    ]);

    const patchCount = (userId: string | null, key: 'activeAssignedTasks' | 'activeCreatedTasks' | 'fileReviews' | 'acceptedApplications', count: number) => {
        if (!userId) return;
        const current = initial.get(userId);
        if (current) current[key] = Number(count ?? 0);
    };
    for (const row of assignedRows) patchCount(row.userId, 'activeAssignedTasks', row.count);
    for (const row of createdRows) patchCount(row.userId, 'activeCreatedTasks', row.count);
    for (const row of fileReviewRows) patchCount(row.userId, 'fileReviews', row.count);
    for (const row of acceptedRows) patchCount(row.userId, 'acceptedApplications', row.count);
    for (const row of participantRows) {
        const current = initial.get(row.userId);
        if (current) current.projectGroupParticipant = true;
    }
    return initial;
}

async function readAcceptedRoleTitles(projectId: string, memberIds: string[]) {
    if (memberIds.length === 0) return new Map<string, string>();
    const rows = await db
        .select({
            applicantId: roleApplications.applicantId,
            roleTitle: projectOpenRoles.title,
            roleName: projectOpenRoles.role,
        })
        .from(roleApplications)
        .leftJoin(projectOpenRoles, eq(projectOpenRoles.id, roleApplications.roleId))
        .where(and(eq(roleApplications.projectId, projectId), eq(roleApplications.status, 'accepted'), inArray(roleApplications.applicantId, memberIds)))
        .orderBy(desc(roleApplications.updatedAt));

    const roleByUser = new Map<string, string>();
    for (const row of rows) {
        if (roleByUser.has(row.applicantId)) continue;
        const label = row.roleTitle || row.roleName || '';
        if (label) roleByUser.set(row.applicantId, label);
    }
    return roleByUser;
}

export async function getProjectCollaboratorSettingsAction(projectId: string, optionsOrLimit: ProjectCollaboratorSettingsOptions | number = 40, legacyCursor?: string): Promise<ProjectCollaboratorSettingsResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user)
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };

        const capability = await requireProjectCapability(projectId, user.id, 'manage_collaborators');
        const owned = {
            ok: true as const,
            project: {
                id: capability.project.id,
                ownerId: capability.project.ownerId,
            },
        };

        const options = typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit, cursor: legacyCursor } : optionsOrLimit;
        const roleFilter = options.roleFilter && options.roleFilter !== 'all' ? options.roleFilter : null;
        const query = options.query?.trim() ?? '';
        const safeLimit = Math.min(Math.max(options.limit ?? 40, 1), 80);
        const whereConditions: any[] = [eq(projectMembers.projectId, projectId)];
        if (roleFilter) {
            if (roleFilter === 'owner') {
                whereConditions.push(eq(projectMembers.userId, owned.project.ownerId));
            } else {
                whereConditions.push(eq(projectMembers.role, roleFilter));
                whereConditions.push(sql`${projectMembers.userId} <> ${owned.project.ownerId}`);
            }
        }
        if (query) {
            const likePattern = `%${query.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
            whereConditions.push(or(ilike(profiles.fullName, likePattern), ilike(profiles.username, likePattern)));
        }
        if (options.cursor) {
            try {
                const decoded = Buffer.from(options.cursor, 'base64').toString('utf-8');
                const [joinedAt, memberId] = decoded.split(':::');
                if (joinedAt && memberId) {
                    whereConditions.push(sql`(${projectMembers.joinedAt}, ${projectMembers.id}) < (${new Date(joinedAt)}, ${memberId})`);
                }
            } catch {
                // Ignore invalid cursors and return the first page.
            }
        }

        const [projectRow] = await db
            .select({
                conversationId: projects.conversationId,
                importSource: projects.importSource,
                ownerId: projects.ownerId,
            })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        const rows = await db
            .select({
                memberId: projectMembers.id,
                userId: projectMembers.userId,
                role: projectMembers.role,
                fileUploadEnabled: projectMembers.fileUploadEnabled,
                joinedAt: projectMembers.joinedAt,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
            })
            .from(projectMembers)
            .leftJoin(profiles, eq(profiles.id, projectMembers.userId))
            .where(and(...whereConditions))
            .orderBy(desc(projectMembers.joinedAt), desc(projectMembers.id))
            .limit(safeLimit + 1);
        const hasMore = rows.length > safeLimit;
        let slice = rows.slice(0, safeLimit);
        if (!options.cursor && (!roleFilter || roleFilter === 'owner') && !slice.some((row) => row.userId === owned.project.ownerId)) {
            const [ownerProfile] = await db
                .select({
                    id: profiles.id,
                    username: profiles.username,
                    fullName: profiles.fullName,
                    avatarUrl: profiles.avatarUrl,
                })
                .from(profiles)
                .where(eq(profiles.id, owned.project.ownerId))
                .limit(1);
            const matchesQuery = !query || [ownerProfile?.fullName, ownerProfile?.username].filter(Boolean).some((value) => String(value).toLowerCase().includes(query.toLowerCase()));
            if (ownerProfile?.id && matchesQuery) {
                slice = [
                    {
                        memberId: `owner:${ownerProfile.id}`,
                        userId: ownerProfile.id,
                        role: 'owner' as ProjectCollaboratorRole,
                        fileUploadEnabled: true,
                        joinedAt: new Date(0),
                        username: ownerProfile.username,
                        fullName: ownerProfile.fullName,
                        avatarUrl: ownerProfile.avatarUrl,
                    },
                    ...slice,
                ].slice(0, safeLimit);
            }
        }
        const last = slice[slice.length - 1];
        const nextCursor = hasMore && last ? Buffer.from(`${last.joinedAt.toISOString()}:::${last.memberId}`).toString('base64') : null;

        const memberIds = slice.map((row) => row.userId);
        const [roleTitleByUser, responsibilityByUser, roleCountRows] = await Promise.all([readAcceptedRoleTitles(projectId, memberIds), readProjectCollaboratorResponsibilityCounts(projectId, memberIds, projectRow?.conversationId ?? null), db.select({ userId: projectMembers.userId, role: projectMembers.role }).from(projectMembers).where(eq(projectMembers.projectId, projectId))]);
        const roleCounts: Record<ProjectCollaboratorRole, number> = {
            owner: 0,
            admin: 0,
            member: 0,
            viewer: 0,
        };
        let ownerCounted = false;
        for (const row of roleCountRows) {
            const role = normalizeCollaboratorRole(row.role, row.userId === owned.project.ownerId ? 'owner' : 'member');
            if (row.userId === owned.project.ownerId || role === 'owner') ownerCounted = true;
            roleCounts[role] = (roleCounts[role] ?? 0) + 1;
        }
        if (!ownerCounted) roleCounts.owner = 1;

        const rawLeadFocus = (projectRow?.importSource as any)?.metadata?.leadFocus;
        const leadFocus = typeof rawLeadFocus === "string" ? rawLeadFocus.trim() : "";

        return {
            success: true,
            data: {
                members: slice
                    .filter((row) => row.userId)
                    .map((row) => ({
                        id: row.userId,
                        username: row.username ?? null,
                        fullName: row.fullName ?? null,
                        avatarUrl: row.avatarUrl ?? null,
                        membershipRole: normalizeCollaboratorRole(row.role, row.userId === owned.project.ownerId ? 'owner' : 'member'),
                        projectRoleTitle: row.userId === projectRow?.ownerId 
                            ? (leadFocus || 'Lead') 
                            : (roleTitleByUser.get(row.userId) ?? null),
                        joinedAt: row.joinedAt?.toISOString?.() ?? null,
                        fileUploadEnabled: row.fileUploadEnabled !== false,
                        responsibilityCounts: responsibilityByUser.get(row.userId) ?? {
                            activeAssignedTasks: 0,
                            activeCreatedTasks: 0,
                            fileReviews: 0,
                            acceptedApplications: 0,
                            projectGroupParticipant: false,
                        },
                    })),
                roleCounts,
                hasMore,
                nextCursor,
            },
        };
    } catch (error) {
        console.error('Failed to load project collaborator settings:', error);
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Project not found')) {
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'Project not found.',
            };
        }
        if (message.includes('permission')) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'You do not have permission to manage collaborators.',
            };
        }
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to load collaborators.',
        };
    }
}

function formatFileUploadPermission(role: ProjectCollaboratorRole, enabled: boolean) {
    if (role === 'owner') return { locked: true, label: 'Owner · always on' };
    if (role === 'admin') return { locked: true, label: 'Co-leader · always on' };
    if (role === 'viewer') return { locked: true, label: 'Viewer · upload off' };
    return {
        locked: false,
        label: enabled ? 'Member upload on' : 'Member upload off',
    };
}

type AnalyticsFileSource = 'github' | 'manual' | 'system';

function readRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function normalizeProjectNodeAnalyticsMetadata(input: { metadata: Record<string, unknown> | null | undefined; gitHash?: string | null; importSourceType?: 'github' | 'upload' | 'scratch' | null }): {
    source: AnalyticsFileSource;
    analyticsVisible: boolean;
    publicVisible: boolean;
    privateReason: string | null;
} {
    const metadata = readRecord(input.metadata);
    const analytics = readRecord(metadata.analytics);
    const privacy = readRecord(metadata.privacy);
    const rawSource = analytics.source ?? metadata.source ?? metadata.importSource;
    const source: AnalyticsFileSource = rawSource === 'github' || input.gitHash ? 'github' : rawSource === 'system' ? 'system' : input.importSourceType === 'github' && input.gitHash ? 'github' : 'manual';
    const privateReason = typeof analytics.privateReason === 'string' ? analytics.privateReason : typeof privacy.reason === 'string' ? privacy.reason : typeof metadata.privateReason === 'string' ? metadata.privateReason : null;
    const publicVisible = readBoolean(analytics.publicVisible) ?? readBoolean(privacy.publicVisible) ?? readBoolean(metadata.publicVisible) ?? metadata.visibility !== 'private';
    const analyticsVisible = readBoolean(analytics.analyticsVisible) ?? readBoolean(metadata.analyticsVisible) ?? (metadata.visibility === 'private' || privacy.private === true ? false : true);
    return {
        source,
        analyticsVisible,
        publicVisible,
        privateReason,
    };
}

function mergeProjectNodeAnalyticsMetadata(metadata: Record<string, unknown> | null | undefined, next: Partial<ReturnType<typeof normalizeProjectNodeAnalyticsMetadata>>) {
    const current = readRecord(metadata);
    const analytics = readRecord(current.analytics);
    return {
        ...current,
        analytics: {
            ...analytics,
            ...next,
        },
    };
}

export async function getProjectFileWorkspaceSettingsAction(projectId: string): Promise<ProjectFileWorkspaceSettingsResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user)
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        const capability = await requireProjectCapability(projectId, user.id, 'manage_files');

        const rows = await db
            .select({
                userId: projectMembers.userId,
                role: projectMembers.role,
                fileUploadEnabled: projectMembers.fileUploadEnabled,
                joinedAt: projectMembers.joinedAt,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
            })
            .from(projectMembers)
            .leftJoin(profiles, eq(profiles.id, projectMembers.userId))
            .where(eq(projectMembers.projectId, projectId))
            .orderBy(sql`CASE WHEN ${projectMembers.userId} = ${capability.project.ownerId} THEN 0 WHEN ${projectMembers.role} = 'admin' THEN 1 WHEN ${projectMembers.role} = 'member' THEN 2 ELSE 3 END`, sql`${profiles.fullName} ASC NULLS LAST`, sql`${profiles.username} ASC NULLS LAST`);

        const memberIds = rows.map((row) => row.userId);
        const roleTitleByUser = await readAcceptedRoleTitles(projectId, memberIds);
        const members = rows.map((row) => {
            const role = normalizeCollaboratorRole(row.role, row.userId === capability.project.ownerId ? 'owner' : 'member');
            const uploadEnabled = canProjectMemberUploadFiles({
                role,
                fileUploadEnabled: row.fileUploadEnabled,
            });
            const permission = formatFileUploadPermission(role, uploadEnabled);
            return {
                id: row.userId,
                username: row.username ?? null,
                fullName: row.fullName ?? null,
                avatarUrl: row.avatarUrl ?? null,
                membershipRole: role,
                projectRoleTitle: roleTitleByUser.get(row.userId) ?? null,
                joinedAt: row.joinedAt?.toISOString?.() ?? null,
                fileUploadEnabled: uploadEnabled,
                uploadPermissionLocked: permission.locked,
                uploadPermissionLabel: permission.label,
            };
        });

        const [projectSourceRow] = await db
            .select({
                importSource: projects.importSource,
            })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);
        const importSourceType = (projectSourceRow?.importSource as { type?: 'github' | 'upload' | 'scratch' } | null | undefined)?.type ?? null;

        const fileRows = await db
            .select({
                id: projectNodes.id,
                name: projectNodes.name,
                path: projectNodes.path,
                size: projectNodes.size,
                createdBy: projectNodes.createdBy,
                createdAt: projectNodes.createdAt,
                updatedAt: projectNodes.updatedAt,
                metadata: projectNodes.metadata,
                gitHash: projectNodes.gitHash,
                uploaderName: profiles.fullName,
                uploaderUsername: profiles.username,
            })
            .from(projectNodes)
            .leftJoin(profiles, eq(profiles.id, projectNodes.createdBy))
            .where(and(eq(projectNodes.projectId, projectId), eq(projectNodes.type, 'file'), isNull(projectNodes.deletedAt)))
            .orderBy(desc(projectNodes.updatedAt))
            .limit(100);

        const manualFileRows = fileRows.filter((file) => {
            const contract = normalizeProjectNodeAnalyticsMetadata({
                metadata: file.metadata as Record<string, unknown> | null | undefined,
                gitHash: file.gitHash,
                importSourceType,
            });
            return contract.source === 'manual';
        });
        const manualFileIds = manualFileRows.map((file) => file.id);
        const linkedRows = manualFileIds.length
            ? await db
                  .select({
                      nodeId: taskNodeLinks.nodeId,
                      taskId: taskNodeLinks.taskId,
                  })
                  .from(taskNodeLinks)
                  .where(inArray(taskNodeLinks.nodeId, manualFileIds))
            : [];
        const linkedCounts = linkedRows.reduce((map, row) => {
            map.set(row.nodeId, (map.get(row.nodeId) ?? 0) + 1);
            return map;
        }, new Map<string, number>());
        const manualFileContracts = new Map(
            manualFileRows.map((file) => [
                file.id,
                normalizeProjectNodeAnalyticsMetadata({
                    metadata: file.metadata as Record<string, unknown> | null | undefined,
                    gitHash: file.gitHash,
                    importSourceType,
                }),
            ]),
        );
        const manualFiles = manualFileRows.slice(0, 24).map((file) => {
            const contract = normalizeProjectNodeAnalyticsMetadata({
                metadata: file.metadata as Record<string, unknown> | null | undefined,
                gitHash: file.gitHash,
                importSourceType,
            });
            return {
                id: file.id,
                name: file.name,
                path: file.path,
                uploadedByName: file.uploaderName ?? file.uploaderUsername ?? null,
                uploadedAt: file.createdAt?.toISOString?.() ?? null,
                updatedAt: file.updatedAt?.toISOString?.() ?? null,
                size: file.size ?? null,
                linkedTasks: linkedCounts.get(file.id) ?? 0,
                analyticsVisible: contract.analyticsVisible,
                publicVisible: contract.publicVisible,
                privateReason: contract.privateReason,
            };
        });

        return {
            success: true,
            data: {
                members,
                manualFiles,
                summary: {
                    alwaysAllowedCount: members.filter((member) => member.membershipRole === 'owner' || member.membershipRole === 'admin').length,
                    enabledMemberCount: members.filter((member) => member.membershipRole === 'member' && member.fileUploadEnabled).length,
                    disabledMemberCount: members.filter((member) => member.membershipRole === 'member' && !member.fileUploadEnabled).length,
                    viewerCount: members.filter((member) => member.membershipRole === 'viewer').length,
                    manualFileCount: manualFileRows.length,
                    privateManualFileCount: manualFileRows.filter((file) => !manualFileContracts.get(file.id)?.publicVisible).length,
                    analyticsVisibleManualFileCount: manualFileRows.filter((file) => manualFileContracts.get(file.id)?.analyticsVisible).length,
                },
            },
        };
    } catch (error) {
        logger.error('project.file_workspace_settings_failed', {
            module: 'projects',
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Project not found')) {
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'Project not found.',
            };
        }
        if (message.includes('permission')) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'You do not have permission to manage file workspace settings.',
            };
        }
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to load file workspace settings.',
        };
    }
}

export async function updateProjectMemberFileUploadAction(projectId: string, memberUserId: string, enabled: boolean): Promise<ProjectSettingsMutationResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user)
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        const capability = await requireProjectCapability(projectId, user.id, 'manage_files');

        const [target] = await db
            .select({
                role: projectMembers.role,
                fileUploadEnabled: projectMembers.fileUploadEnabled,
                username: profiles.username,
                fullName: profiles.fullName,
            })
            .from(projectMembers)
            .leftJoin(profiles, eq(profiles.id, projectMembers.userId))
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, memberUserId)))
            .limit(1);
        if (!target)
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'Project member not found.',
            };
        const targetRole = normalizeCollaboratorRole(target.role, memberUserId === capability.project.ownerId ? 'owner' : 'member');
        if (targetRole === 'owner' || targetRole === 'admin') {
            return {
                success: false,
                errorCode: 'INVALID_INPUT',
                message: 'Owner and Co-leader upload access is always on.',
            };
        }
        if (targetRole === 'viewer') {
            return {
                success: false,
                errorCode: 'INVALID_INPUT',
                message: 'Viewers cannot upload files.',
            };
        }

        await db.transaction(async (tx) => {
            await tx
                .update(projectMembers)
                .set({ fileUploadEnabled: enabled })
                .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, memberUserId)));
            await tx.insert(projectNodeEvents).values({
                projectId,
                actorId: user.id,
                nodeId: null,
                type: enabled ? 'project_file_policy.member_upload_enabled' : 'project_file_policy.member_upload_disabled',
                metadata: {
                    targetUserId: memberUserId,
                    targetDisplayName: target.fullName || target.username || 'Project member',
                    previous: target.fileUploadEnabled !== false,
                    next: enabled,
                    actorRole: capability.role,
                },
                createdAt: new Date(),
            });
        });

        await revalidateProjectPaths(projectId);
        try {
            await enqueueProjectNotificationEvent({
                projectId,
                actorUserId: user.id,
                ...actorNotificationSnapshot(user),
                eventKey: 'access.file_upload_permission_changed',
                affectedMemberId: memberUserId,
                title: enabled ? 'File uploads enabled for you' : 'File uploads disabled for you',
                body: enabled ? 'You can upload files to this project workspace.' : 'You can no longer upload files to this project workspace.',
                sourceEventId: `${projectId}:file-upload:${memberUserId}:${enabled}`,
                entityRefs: { projectId, targetUserId: memberUserId },
            });
        } catch (notificationError) {
            logger.warn('project.member_file_upload_notification_failed', {
                module: 'projects',
                projectId,
                targetUserId: memberUserId,
                error: notificationError instanceof Error ? notificationError.message : String(notificationError),
            });
        }
        return {
            success: true,
            message: enabled ? 'Member file uploads enabled.' : 'Member file uploads disabled.',
        };
    } catch (error) {
        logger.error('project.member_file_upload_update_failed', {
            module: 'projects',
            projectId,
            targetUserId: memberUserId,
            error: error instanceof Error ? error.message : String(error),
        });
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('permission')) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'You do not have permission to manage file uploads.',
            };
        }
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to update member upload permission.',
        };
    }
}

export async function updateProjectFileUploadDefaultsAction(projectId: string, enabled: boolean): Promise<ProjectSettingsMutationResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user)
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        const capability = await requireProjectCapability(projectId, user.id, 'manage_files');

        const updated = await db.transaction(async (tx) => {
            const rows = await tx
                .update(projectMembers)
                .set({ fileUploadEnabled: enabled })
                .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'member')))
                .returning({ userId: projectMembers.userId });
            await tx.insert(projectNodeEvents).values({
                projectId,
                actorId: user.id,
                nodeId: null,
                type: 'project_file_policy.member_upload_bulk_changed',
                metadata: {
                    next: enabled,
                    affectedCount: rows.length,
                    actorRole: capability.role,
                },
                createdAt: new Date(),
            });
            return rows.length;
        });

        await revalidateProjectPaths(projectId);
        try {
            const affectedUserIds = await db
                .select({ userId: projectMembers.userId })
                .from(projectMembers)
                .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'member')));
            await enqueueProjectNotificationEvent({
                projectId,
                actorUserId: user.id,
                ...actorNotificationSnapshot(user),
                eventKey: 'access.file_upload_permission_changed',
                directRecipientIds: affectedUserIds.map((row) => row.userId),
                title: enabled ? 'Project file uploads enabled' : 'Project file uploads disabled',
                body: enabled ? 'Members can upload files to this project workspace.' : 'Members can no longer upload files to this project workspace.',
                sourceEventId: `${projectId}:file-upload-defaults:${enabled}`,
                entityRefs: { projectId },
            });
        } catch (notificationError) {
            logger.warn('project.file_upload_defaults_notification_failed', {
                module: 'projects',
                projectId,
                error: notificationError instanceof Error ? notificationError.message : String(notificationError),
            });
        }
        return {
            success: true,
            message: enabled ? `Enabled uploads for ${updated} member${updated === 1 ? '' : 's'}.` : `Disabled uploads for ${updated} member${updated === 1 ? '' : 's'}.`,
        };
    } catch (error) {
        logger.error('project.file_upload_defaults_failed', {
            module: 'projects',
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('permission')) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'You do not have permission to manage file uploads.',
            };
        }
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to update file upload defaults.',
        };
    }
}

export async function readProjectNotificationSettingsAction(projectId: string): Promise<ProjectNotificationSettingsResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user)
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        await requireProjectCapability(projectId, user.id, 'manage_notifications');

        const [project] = await db
            .select({ notificationPreferences: projects.notificationPreferences })
            .from(projects)
            .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
            .limit(1);
        if (!project)
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'Project not found.',
            };

        const policy = normalizeProjectNotificationPolicy(project.notificationPreferences);
        return {
            success: true,
            data: {
                policy,
                summary: summarizeProjectNotificationPolicy(policy),
            },
        };
    } catch (error) {
        logger.error('project.notification_settings_read_failed', {
            module: 'projects',
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('permission')) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'You do not have permission to manage project notifications.',
            };
        }
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to load project notification settings.',
        };
    }
}

export async function updateProjectNotificationSettingsAction(projectId: string, input: unknown): Promise<ProjectNotificationSettingsResult & { message?: string }> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user)
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        const capability = await requireProjectCapability(projectId, user.id, 'manage_notifications');
        const policy = normalizeProjectNotificationPolicy(input);

        await db.transaction(async (tx) => {
            await tx
                .update(projects)
                .set({ notificationPreferences: policy, updatedAt: new Date() })
                .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));
            await tx.insert(projectNodeEvents).values({
                projectId,
                actorId: user.id,
                nodeId: null,
                type: 'project_notification_settings.updated',
                metadata: {
                    preset: policy.preset,
                    summary: summarizeProjectNotificationPolicy(policy),
                    actorRole: capability.role,
                },
                createdAt: new Date(),
            });
        });

        await revalidateProjectPaths(projectId);
        return {
            success: true,
            message: 'Project notification settings updated.',
            data: {
                policy,
                summary: summarizeProjectNotificationPolicy(policy),
            },
        };
    } catch (error) {
        logger.error('project.notification_settings_update_failed', {
            module: 'projects',
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('permission')) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'You do not have permission to manage project notifications.',
            };
        }
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to update project notification settings.',
        };
    }
}

export async function resetProjectNotificationSettingsAction(projectId: string, preset: ProjectNotificationPreset = 'balanced'): Promise<ProjectNotificationSettingsResult & { message?: string }> {
    return updateProjectNotificationSettingsAction(projectId, buildDefaultProjectNotificationPolicy(preset));
}

async function canViewProjectMemberNotificationSettings(projectId: string, actorUserId: string, memberUserId: string) {
    if (actorUserId === memberUserId) return true;
    try {
        await requireProjectCapability(projectId, actorUserId, 'manage_notifications');
        return true;
    } catch {
        return false;
    }
}

export async function readProjectMemberNotificationSettingsAction(projectId: string, memberUserId: string): Promise<ProjectMemberNotificationSettingsResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user)
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        if (!(await canViewProjectMemberNotificationSettings(projectId, user.id, memberUserId))) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'You do not have permission to view these notification settings.',
            };
        }

        const [member] = await db
            .select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                role: projectMembers.role,
                notificationPreferences: projectMembers.notificationPreferences,
                ownerId: projects.ownerId,
            })
            .from(projectMembers)
            .innerJoin(projects, eq(projects.id, projectMembers.projectId))
            .leftJoin(profiles, eq(profiles.id, projectMembers.userId))
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, memberUserId), isNull(projects.deletedAt)))
            .limit(1);
        if (!member?.id) {
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'Project member not found.',
            };
        }

        return {
            success: true,
            data: {
                member: {
                    id: member.id,
                    username: member.username,
                    fullName: member.fullName,
                    avatarUrl: member.avatarUrl,
                    membershipRole: normalizeCollaboratorRole(member.role, memberUserId === member.ownerId ? 'owner' : 'member'),
                },
                canEdit: user.id === memberUserId,
                overrides: normalizeProjectMemberNotificationOverrides(member.notificationPreferences),
            },
        };
    } catch (error) {
        logger.error('project.member_notification_settings_read_failed', {
            module: 'projects',
            projectId,
            targetUserId: memberUserId,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to load member notification settings.',
        };
    }
}

export async function updateProjectMemberNotificationSettingsAction(projectId: string, memberUserId: string, input: unknown): Promise<ProjectMemberNotificationSettingsResult & { message?: string }> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user)
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        if (user.id !== memberUserId) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'Members can only update their own project notification settings.',
            };
        }
        const overrides = normalizeProjectMemberNotificationOverrides(input);

        const [updated] = await db
            .update(projectMembers)
            .set({ notificationPreferences: overrides })
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, memberUserId)))
            .returning({ userId: projectMembers.userId, role: projectMembers.role });
        if (!updated)
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'Project member not found.',
            };

        await db.insert(projectNodeEvents).values({
            projectId,
            actorId: user.id,
            nodeId: null,
            type: 'project_notification_settings.member_updated',
            metadata: {
                targetUserId: memberUserId,
                mode: overrides.mode,
                customRules: Object.keys(overrides.rules).length,
            },
            createdAt: new Date(),
        });
        await revalidateProjectPaths(projectId);
        const read = await readProjectMemberNotificationSettingsAction(projectId, memberUserId);
        if (!read.success) return read;
        return { ...read, message: 'Project notification preferences updated.' };
    } catch (error) {
        logger.error('project.member_notification_settings_update_failed', {
            module: 'projects',
            projectId,
            targetUserId: memberUserId,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to update member notification settings.',
        };
    }
}

export async function resetProjectMemberNotificationSettingsAction(projectId: string, memberUserId: string): Promise<ProjectMemberNotificationSettingsResult & { message?: string }> {
    return updateProjectMemberNotificationSettingsAction(projectId, memberUserId, {
        version: 1,
        mode: 'inherit',
        rules: {},
    });
}

export async function updateProjectMemberRoleAction(projectId: string, memberUserId: string, nextRole: 'admin' | 'member' | 'viewer'): Promise<ProjectMemberMutationResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user)
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        if (!['admin', 'member', 'viewer'].includes(nextRole)) {
            return {
                success: false,
                errorCode: 'INVALID_ROLE',
                message: 'Invalid collaborator role.',
            };
        }

        const result = await db.transaction(async (tx) => {
            try {
                const lifecycle = await changeProjectMemberRoleInternal(tx, {
                    projectId,
                    actorId: user.id,
                    targetUserId: memberUserId,
                    nextRole,
                });
                return { ok: true as const, lifecycle };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message.includes('Project not found')) {
                    return {
                        ok: false as const,
                        errorCode: 'NOT_FOUND' as const,
                        message: 'Project not found.',
                    };
                }
                if (message.includes('permission')) {
                    return {
                        ok: false as const,
                        errorCode: 'FORBIDDEN' as const,
                        message,
                    };
                }
                return {
                    ok: false as const,
                    errorCode: 'INTERNAL_ERROR' as const,
                    message: 'Failed to update collaborator role.',
                };
            }
        });

        if (!result.ok) {
            return {
                success: false,
                errorCode: result.errorCode,
                message: result.message,
            };
        }
        await revalidateProjectPaths(projectId);
        if (result.lifecycle.changed) {
            const actor = actorNotificationSnapshot(user);
            const nextRoleLabel = collaboratorRoleLabel(result.lifecycle.nextRole ?? nextRole);
            await enqueueProjectNotificationBestEffort(
                {
                    projectId,
                    actorUserId: user.id,
                    ...actor,
                    eventKey: 'members.role_changed',
                    affectedMemberId: memberUserId,
                    title: `${actor.actorName || 'Someone'} updated your project role`,
                    body: result.lifecycle.project.title ? `${result.lifecycle.project.title}: ${nextRoleLabel}` : `New role: ${nextRoleLabel}`,
                    href: `/projects/${encodeURIComponent(result.lifecycle.project.slug || projectId)}?tab=settings`,
                    entityRefs: {
                        projectId,
                        projectSlug: result.lifecycle.project.slug ?? null,
                        targetUserId: memberUserId,
                        previousRole: result.lifecycle.previousRole ? collaboratorRoleLabel(result.lifecycle.previousRole) : null,
                        nextRole: nextRoleLabel,
                    },
                    preview: {
                        actorName: actor.actorName,
                        actorAvatarUrl: actor.actorAvatarUrl,
                        contextLabel: result.lifecycle.project.title ?? 'Project',
                        contextKind: 'project',
                        secondaryText: `Role changed to ${nextRoleLabel}`,
                    },
                    sourceEventId: result.lifecycle.eventId ?? `${result.lifecycle.previousRole}:${result.lifecycle.nextRole}`,
                },
                {
                    action: 'member_role_changed',
                    targetUserId: memberUserId,
                },
            );
        }

        return {
            success: true,
            message: result.lifecycle.changed ? `Updated collaborator role to ${collaboratorRoleLabel(result.lifecycle.nextRole ?? nextRole)}.` : 'Collaborator already has that role.',
        };
    } catch (error) {
        console.error('Failed to update project member role:', error);
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to update collaborator role.',
        };
    }
}

export async function getProjectMemberRemovalPreflightAction(projectId: string, memberUserId: string): Promise<ProjectMemberRemovalPreflightResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user)
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        const capability = await requireProjectCapability(projectId, user.id, 'manage_collaborators');
        if (memberUserId === capability.project.ownerId) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'Use transfer ownership before removing the owner.',
            };
        }

        const [memberRow] = await db
            .select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                role: projectMembers.role,
            })
            .from(projectMembers)
            .leftJoin(profiles, eq(profiles.id, projectMembers.userId))
            .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, memberUserId)))
            .limit(1);
        if (!memberRow?.id) {
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'This user is no longer a project member.',
            };
        }
        const actorRole = capability.role;
        const targetRole = normalizeCollaboratorRole(memberRow.role, memberUserId === capability.project.ownerId ? 'owner' : 'member');
        if (!canProjectRoleManageTarget({ actorRole, targetRole })) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'You do not have permission to remove this collaborator.',
            };
        }
        const roleTitleByUser = await readAcceptedRoleTitles(projectId, [memberUserId]);
        const [projectRow] = await db
            .select({
                conversationId: projects.conversationId,
                visibility: projects.visibility,
            })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);
        const counts = (await readProjectCollaboratorResponsibilityCounts(projectId, [memberUserId], projectRow?.conversationId ?? null)).get(memberUserId);
        const impact = await readProjectMemberRemovalImpact(db, projectId, memberUserId);

        return {
            success: true,
            data: {
                member: {
                    id: memberRow.id,
                    username: memberRow.username,
                    fullName: memberRow.fullName,
                    avatarUrl: memberRow.avatarUrl,
                    membershipRole: normalizeCollaboratorRole(memberRow.role),
                    projectRoleTitle: roleTitleByUser.get(memberUserId) ?? null,
                },
                activeAssignedTasks: counts?.activeAssignedTasks ?? 0,
                activeCreatedTasks: counts?.activeCreatedTasks ?? 0,
                fileReviews: counts?.fileReviews ?? 0,
                acceptedApplications: counts?.acceptedApplications ?? 0,
                projectGroupParticipant: counts?.projectGroupParticipant ?? false,
                visibility: normalizeProjectVisibility(projectRow?.visibility),
                activeAssignedTaskItems: impact.assignedTasks,
                activeCreatedTaskItems: impact.createdTasks,
                fileReviewItems: impact.fileReviews,
                acceptedApplicationItems: impact.acceptedApplications.map((application) => ({
                    ...application,
                    roleId: application.roleId || "",
                    roleTitle: application.roleTitle ?? null,
                    roleName: application.roleName ?? null,
                })),
                reassignmentCandidates: impact.reassignmentCandidates.map((candidate) => ({
                    id: candidate.id,
                    username: candidate.username,
                    fullName: candidate.fullName,
                    avatarUrl: candidate.avatarUrl,
                    membershipRole: normalizeCollaboratorRole(candidate.role, candidate.id === capability.project.ownerId ? 'owner' : 'member'),
                })),
            },
        };
    } catch (error) {
        console.error('Failed to load member removal preflight:', error);
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Project not found')) {
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'Project not found.',
            };
        }
        if (message.includes('permission')) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'You do not have permission to remove this collaborator.',
            };
        }
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to load removal preflight.',
        };
    }
}

const removeProjectMemberSchema = z.object({
    mode: z.enum(['preserve_history', 'unassign_active_tasks', 'reassign_active_tasks']).default('preserve_history'),
    reassignToUserId: z.string().uuid().nullable().optional(),
});

export async function removeProjectMemberAction(
    projectId: string,
    memberUserId: string,
    options?: {
        mode?: 'preserve_history' | 'unassign_active_tasks' | 'reassign_active_tasks';
        reassignToUserId?: string | null;
    },
): Promise<ProjectMemberMutationResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user)
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        const parsed = removeProjectMemberSchema.safeParse(options ?? {});
        if (!parsed.success)
            return {
                success: false,
                errorCode: 'INVALID_INPUT',
                message: 'Invalid removal options.',
            };

        const txResult = await db.transaction(async (tx) => {
            try {
                const lifecycle = await removeProjectMemberInternal(tx, {
                    projectId,
                    actorId: user.id,
                    targetUserId: memberUserId,
                    mode: parsed.data.mode,
                    reassignToUserId: parsed.data.reassignToUserId ?? null,
                });
                return { ok: true as const, lifecycle };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message.includes('Project not found')) {
                    return {
                        ok: false as const,
                        errorCode: 'NOT_FOUND' as const,
                        message: 'Project not found.',
                    };
                }
                if (message.includes('permission') || message.includes('owner')) {
                    return {
                        ok: false as const,
                        errorCode: 'FORBIDDEN' as const,
                        message,
                    };
                }
                if (message.includes('Replacement') || message.includes('valid replacement')) {
                    return {
                        ok: false as const,
                        errorCode: 'INVALID_INPUT' as const,
                        message,
                    };
                }
                return {
                    ok: false as const,
                    errorCode: 'INTERNAL_ERROR' as const,
                    message: 'Failed to remove collaborator.',
                };
            }
        });

        if (!txResult.ok) {
            return {
                success: false,
                errorCode: txResult.errorCode,
                message: txResult.message,
            };
        }
        await revalidateProjectPaths(projectId);
        await queueCounterRefreshBestEffort([memberUserId]);
        const actor = actorNotificationSnapshot(user);
        await enqueueProjectNotificationBestEffort(
            {
                projectId,
                actorUserId: user.id,
                ...actor,
                eventKey: 'members.removed',
                affectedMemberId: memberUserId,
                title: `${actor.actorName || 'Someone'} removed you from a project`,
                body: txResult.lifecycle.project.title ?? 'Project access removed',
                href: `/projects/${encodeURIComponent(txResult.lifecycle.project.slug || projectId)}`,
                entityRefs: {
                    projectId,
                    projectSlug: txResult.lifecycle.project.slug ?? null,
                    targetUserId: memberUserId,
                },
                preview: {
                    actorName: actor.actorName,
                    actorAvatarUrl: actor.actorAvatarUrl,
                    contextLabel: txResult.lifecycle.project.title ?? 'Project',
                    contextKind: 'project',
                    secondaryText: 'Removed from project',
                },
                sourceEventId: txResult.lifecycle.eventId ?? `${txResult.lifecycle.previousRole}:removed`,
            },
            {
                action: 'member_removed',
                targetUserId: memberUserId,
            },
        );
        return {
            success: true,
            message: 'Collaborator removed. Historical references were preserved.',
        };
    } catch (error) {
        console.error('Failed to remove project member:', error);
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to remove collaborator.',
        };
    }
}

export async function getProjectDangerZonePreflightAction(projectId: string): Promise<ProjectDangerZonePreflightResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        }

        const owned = await loadOwnedProjectForSettings(projectId, user.id);
        if (!owned.ok)
            return {
                success: false,
                errorCode: owned.errorCode,
                message: owned.message,
            };

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

        const status = owned.project.status === 'draft' || owned.project.status === 'active' || owned.project.status === 'completed' || owned.project.status === 'archived' ? owned.project.status : 'draft';
        const activeTasksCount = Number(activeTasksRow[0]?.count ?? 0);
        const openRolesCount = Number(openRolesRow[0]?.count ?? 0);
        const pendingApplicationsCount = Number(pendingAppsRow[0]?.count ?? 0);

        return {
            success: true,
            data: {
                status,
                openRolesCount,
                pendingApplicationsCount,
                activeTasksCount,
                canArchive: status !== 'archived',
                canDelete: true,
            },
        };
    } catch (error) {
        console.error('Failed to run danger-zone preflight:', error);
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to prepare danger-zone checks.',
        };
    }
}

export async function updateProjectManualFileAnalyticsVisibilityAction(projectId: string, nodeId: string, analyticsVisible: boolean): Promise<ProjectSettingsMutationResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user)
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        const capability = await requireProjectCapability(projectId, user.id, 'manage_files');

        const [file] = await db
            .select({
                id: projectNodes.id,
                name: projectNodes.name,
                metadata: projectNodes.metadata,
                gitHash: projectNodes.gitHash,
                importSource: projects.importSource,
            })
            .from(projectNodes)
            .innerJoin(projects, eq(projects.id, projectNodes.projectId))
            .where(and(eq(projectNodes.projectId, projectId), eq(projectNodes.id, nodeId), eq(projectNodes.type, 'file'), isNull(projectNodes.deletedAt)))
            .limit(1);

        if (!file)
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'File not found.',
            };
        const importSourceType = (file.importSource as { type?: 'github' | 'upload' | 'scratch' } | null | undefined)?.type ?? null;
        const current = normalizeProjectNodeAnalyticsMetadata({
            metadata: file.metadata as Record<string, unknown> | null | undefined,
            gitHash: file.gitHash,
            importSourceType,
        });
        if (current.source !== 'manual') {
            return {
                success: false,
                errorCode: 'INVALID_INPUT',
                message: 'Only manually uploaded files can be managed here.',
            };
        }

        const nextMetadata = mergeProjectNodeAnalyticsMetadata(file.metadata as Record<string, unknown> | null | undefined, {
            source: current.source,
            analyticsVisible,
            publicVisible: current.publicVisible,
            privateReason: analyticsVisible ? null : 'Hidden from analytics in file workspace settings',
        });

        await db.transaction(async (tx) => {
            await tx.update(projectNodes).set({ metadata: nextMetadata, updatedAt: new Date() }).where(eq(projectNodes.id, nodeId));
            await tx.insert(projectNodeEvents).values({
                projectId,
                nodeId,
                actorId: user.id,
                type: 'project_file.analytics_visibility_changed',
                metadata: {
                    fileName: file.name,
                    analyticsVisible,
                    source: 'file_workspace_settings',
                },
            });
        });

        revalidatePath(`/projects/${projectId}`);
        return {
            success: true,
            message: analyticsVisible ? 'File will appear in analytics.' : 'File is hidden from analytics.',
        };
    } catch (error) {
        logger.error('project.manual_file_analytics_visibility_failed', {
            module: 'projects',
            projectId,
            nodeId,
            analyticsVisible,
            error: error instanceof Error ? error.message : String(error),
        });
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('permission')) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'You do not have permission to manage file analytics visibility.',
            };
        }
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to update file analytics visibility.',
        };
    }
}

export async function archiveProjectAction(projectId: string): Promise<ProjectSettingsMutationResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        }

        const owned = await loadOwnedProjectForSettings(projectId, user.id);
        if (!owned.ok)
            return {
                success: false,
                errorCode: owned.errorCode,
                message: owned.message,
            };
        if (owned.project.status === 'archived') {
            return { success: true, message: 'Project is already archived.' };
        }

        await db.update(projects).set({ status: 'archived', updatedAt: new Date() }).where(eq(projects.id, projectId));
        await revalidateProjectPaths(projectId);
        const actor = actorNotificationSnapshot(user);
        await enqueueProjectNotificationBestEffort(
            {
                projectId,
                actorUserId: user.id,
                ...actor,
                eventKey: 'security.project_archived',
                title: `${actor.actorName || 'Someone'} archived ${owned.project.title || 'Project'}`,
                body: 'The project was archived from settings.',
                href: `/projects/${encodeURIComponent(owned.project.slug || projectId)}?tab=settings&settings=security-data`,
                sourceEventId: `archive:${projectId}`,
                entityRefs: {
                    projectId,
                    projectSlug: owned.project.slug ?? null,
                },
            },
            { action: 'archive' },
        );

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
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: 'Failed to archive project.',
        };
    }
}

// --- Delete Action ---
export async function deleteProject(projectId: string): Promise<{ success: true; message: string; data: { redirectTo: string } } | { success: false; message: string; errorCode: ProjectSettingsErrorCode }> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        }

        // Check ownership and get conversationId
        const [project] = await db
            .select({
                ownerId: projects.ownerId,
                conversationId: projects.conversationId,
                slug: projects.slug,
            })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) {
            return {
                success: false,
                errorCode: 'NOT_FOUND',
                message: 'Project not found.',
            };
        }
        if (project.ownerId !== user.id) {
            return {
                success: false,
                errorCode: 'FORBIDDEN',
                message: 'Only the project owner can delete this project.',
            };
        }

        // 1. Get ALL S3 keys for this project before deleting nodes
        const fileNodes = await db
            .select({ s3Key: projectNodes.s3Key })
            .from(projectNodes)
            .where(and(eq(projectNodes.projectId, projectId), isNotNull(projectNodes.s3Key)));

        const s3Keys = fileNodes.map((n) => n.s3Key!).filter(Boolean);

        // 2. Hard-Delete Transaction
        await db.transaction(async (tx) => {
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

            // B. Hard-delete the project (cascades to nodes, tasks, sprints, members, etc.)
            const deletedProjects = await tx.delete(projects).where(eq(projects.id, projectId)).returning({ id: projects.id });

            // C. Keep denormalized profile stats in sync
            if (deletedProjects.length > 0) {
                await tx
                    .update(profiles)
                    .set({
                        projectsCount: sql`GREATEST(0, ${profiles.projectsCount} - 1)`,
                    })
                    .where(eq(profiles.id, user.id));
            }
        });

        // 3. Delete files from S3 Storage (Best Effort, outside transaction)
        if (s3Keys.length > 0) {
            try {
                const adminClient = await createAdminClient();
                await adminClient.storage.from('project-files').remove(s3Keys);
            } catch (storageError) {
                console.error('Failed to cleanup S3 files for project:', projectId, storageError);
                // Don't fail the whole action if storage cleanup fails
            }
        }

        logger.metric('project.settings.delete.result', {
            projectId,
            userId: user.id,
            result: 'success',
        });

        revalidatePath('/hub');
        revalidatePath(`/projects/${project.slug || projectId}`);
        return {
            success: true,
            message: 'Project deleted successfully.',
            data: { redirectTo: '/hub' },
        };
    } catch (error) {
        console.error('Failed to delete project:', error);
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
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');

        const [project] = await db
            .select({
                ownerId: projects.ownerId,
                conversationId: projects.conversationId,
            })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!project) return { success: true }; // Already gone
        if (project.ownerId !== user.id) throw new Error('Unauthorized');

        // 2. Wipe DB (Atomic transition)
        await db.transaction(async (tx) => {
            // Delete project (cascades to members, roles, etc.)
            await tx.delete(projects).where(eq(projects.id, projectId));
            await tx
                .update(profiles)
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
                const { data: files, error } = await adminClient.storage.from('project-files').list(folderPath, {
                    limit: 1000,
                });

                if (error || !files || files.length === 0) return;

                const filesToDelete = files
                    .filter((f) => f.id) // Only files have IDs in some Supabase versions, or check metadata
                    .map((f) => `${folderPath}/${f.name}`);

                const subFolders = files
                    .filter((f) => !f.id || f.metadata === null) // Folders
                    .map((f) => `${folderPath}/${f.name}`);

                // Delete files in this level
                if (filesToDelete.length > 0) {
                    await adminClient.storage.from('project-files').remove(filesToDelete);
                }

                // Recurse into subfolders (Pure optimization: Parallel recursion)
                if (subFolders.length > 0) {
                    await Promise.all(subFolders.map((sf) => purgeFolder(sf)));
                }
            };

            await purgeFolder(projectId);
        } catch (storageError) {
            console.error('S3 recursive draft cleanup failed:', storageError);
        }

        revalidatePath('/hub');
        return { success: true };
    } catch (error: any) {
        console.error('Failed to delete draft:', error);
        return { success: false, error: error.message || 'Failed to delete draft' };
    }
}

// --- Interaction Actions ---

export async function toggleProjectFollowAction(projectId: string, shouldFollow: boolean) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };
    try {
        const followRate = await consumeRateLimit(`project-follow:${user.id}`, 80, 60);
        if (!followRate.allowed) {
            return {
                success: false,
                error: 'Too many follow actions. Please wait and try again.',
            };
        }
        const access = await getProjectAccessById(projectId, user.id);
        if (!access.project || !access.canRead) {
            return { success: false, error: 'Project not found or private.' };
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
                    await tx.insert(projectFollows).values({ userId: user.id, projectId });

                    const [updated] = await tx
                        .update(projects)
                        .set({ followersCount: sql`${projects.followersCount} + 1` })
                        .where(eq(projects.id, projectId))
                        .returning({ followersCount: projects.followersCount });
                    return updated?.followersCount ?? 0;
                }
            } else {
                const deleted = await tx
                    .delete(projectFollows)
                    .where(and(eq(projectFollows.userId, user.id), eq(projectFollows.projectId, projectId)))
                    .returning({ id: projectFollows.id });

                if (deleted.length > 0) {
                    const [updated] = await tx
                        .update(projects)
                        .set({
                            followersCount: sql`GREATEST(${projects.followersCount} - 1, 0)`,
                        })
                        .where(eq(projects.id, projectId))
                        .returning({ followersCount: projects.followersCount });
                    return updated?.followersCount ?? 0;
                }
            }

            const [row] = await tx.select({ followersCount: projects.followersCount }).from(projects).where(eq(projects.id, projectId)).limit(1);
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
                    await db.insert(projectFollows).values({ userId: user.id, projectId });
                }
            } else {
                await db.delete(projectFollows).where(and(eq(projectFollows.userId, user.id), eq(projectFollows.projectId, projectId)));
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
        const access = await getProjectAccessById(projectId, user?.id ?? null);
        if (!access.project || !access.canRead) {
            return { success: false, error: 'Project not found' };
        }

        const writeThroughEnabled = process.env.PROJECT_VIEWS_WRITE_THROUGH === '1' || !redis;

        if (writeThroughEnabled) {
            const [updated] = await db
                .update(projects)
                .set({ viewCount: sql`${projects.viewCount} + 1` })
                .where(eq(projects.id, projectId))
                .returning({ viewCount: projects.viewCount });

            return { success: true, viewCount: Number(updated?.viewCount ?? 1) };
        } else {
            const bufferedVal = await redis!.hincrby('project:views', projectId, 1);
            const [dbRow] = await db.select({ viewCount: projects.viewCount }).from(projects).where(eq(projects.id, projectId)).limit(1);
            const dbVal = dbRow?.viewCount ?? 0;
            return { success: true, viewCount: dbVal + bufferedVal };
        }
    } catch (e) {
        if (isMissingCounterColumn(e, 'view_count')) {
            return {
                success: false,
                error: 'Project views are unavailable until migrations are applied',
            };
        }
        console.error('Failed to increment view', e);
        return { success: false, error: 'Failed to increment view' };
    }
}

export async function getProjectUserStateAction(projectId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        return { isFollowing: false, isOwner: false };
    }
    return await runInFlightDeduped(`project:user-state:${projectId}:${user.id}`, async () => {
        const [follow, project] = await Promise.all([
            db
                .select()
                .from(projectFollows)
                .where(and(eq(projectFollows.projectId, projectId), eq(projectFollows.userId, user.id)))
                .limit(1),
            db
                .select({
                    ownerId: projects.ownerId,
                    conversationId: projects.conversationId,
                })
                .from(projects)
                .where(eq(projects.id, projectId))
                .limit(1),
        ]);

        // LAZY PROJECT GROUP CREATION: If owner visits and project has no group, create it
        // SYNCHRONOUS: Wait for creation to complete so group is immediately visible
        if (project[0] && !project[0].conversationId && project[0].ownerId === user.id) {
            await ensureProjectGroupExists(projectId, project[0].ownerId);
        }

        return {
            isFollowing: !!follow[0],
            isOwner: project[0]?.ownerId === user.id,
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
        const parsed = JSON.parse(cursor) as {
            activityAt?: unknown;
            taskId?: unknown;
        };
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

export async function fetchProjectTasksAction(projectId: string, limit: number = 100, cursor?: string, scope: 'all' | 'backlog' | 'sprint' = 'all') {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        const actorId = user?.id ?? null;
        const safeLimit = Math.min(Math.max(limit, 1), 200);
        const normalizedScope = scope === 'backlog' || scope === 'sprint' ? scope : 'all';
        const parsedCursor = parseTaskPaginationCursor(cursor);
        const cursorCreatedAtKey = parsedCursor?.createdAt.toISOString() ?? 'head';
        const cursorIdKey = parsedCursor?.id || 'none';

        return await runInFlightDeduped(`project:tasks:${projectId}:${actorId ?? 'anon'}:${safeLimit}:${cursorCreatedAtKey}:${cursorIdKey}:${normalizedScope}`, async () => {
            // Enforce read access server-side through the canonical project access policy.
            await assertProjectReadAccess(projectId, actorId);

            const projectTasks = await db.query.tasks.findMany({
                where: (t, { eq, and, or, lt, isNull, isNotNull }) => and(eq(t.projectId, projectId), isNull(t.deletedAt), parsedCursor ? or(lt(t.createdAt, parsedCursor.createdAt), and(eq(t.createdAt, parsedCursor.createdAt), lt(t.id, parsedCursor.id))) : undefined, normalizedScope === 'backlog' ? isNull(t.sprintId) : normalizedScope === 'sprint' ? isNotNull(t.sprintId) : undefined),
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
                      createdAt: new Date(tasks[tasks.length - 1]!.createdAt ?? new Date().toISOString()),
                      id: tasks[tasks.length - 1]!.id,
                  })
                : undefined;

            return { success: true as const, tasks, nextCursor, hasMore };
        });
    } catch (error) {
        console.error('Failed to fetch tasks:', error);
        return { success: false as const, error: 'Failed to fetch tasks' };
    }
}

export async function fetchProjectSprintsAction(projectId: string, limit: number = 120) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        const actorId = user?.id ?? null;
        const safeLimit = Math.min(Math.max(limit, 1), 200);

        return await runInFlightDeduped(`project:sprints:${projectId}:${actorId ?? 'anon'}:${safeLimit}`, async () => {
            await assertProjectReadAccess(projectId, actorId);

            const projectSprintsList = await readProjectSprintsList(projectId, safeLimit);

            return { success: true as const, sprints: projectSprintsList };
        });
    } catch (error) {
        console.error('Failed to fetch sprints:', error);
        return { success: false as const, error: 'Failed to fetch sprints' };
    }
}

type SprintTaskActivityQueryRow = {
    id: string;
    project_id: string;
    sprint_id: string;
    title: string;
    description: string | null;
    status: SprintTaskTimelineEntity['status'];
    priority: SprintTaskTimelineEntity['priority'];
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
    node_type: SprintFileTimelineEntity['nodeType'];
};

type SprintNodeEventQueryRow = {
    nodeId: string | null;
    type: string;
    createdAt: Date | string | null;
    actorName: string | null;
};

type SprintFileVersionQueryRow = {
    id: string;
    node_id: string;
    version_number: number;
    uploaded_by: string | null;
    uploaded_at: Date | string;
    comment: string | null;
    uploaded_by_name: string | null;
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

const acceptedRoleTitleSql = (projectId: string, userId: unknown) => sql<string | null>`(
    SELECT COALESCE(NULLIF(ra.accepted_role_title, ''), NULLIF(por.title, ''), NULLIF(por.role, ''))
    FROM role_applications ra
    LEFT JOIN project_open_roles por ON por.id = ra.role_id
    WHERE ra.project_id = ${projectId}
      AND ra.applicant_id = ${userId}
      AND ra.status = 'accepted'
    ORDER BY ra.updated_at DESC
    LIMIT 1
)`;

function formatSprintMemberRole(role: string | null | undefined, isOwner: boolean = false) {
    if (isOwner) return "Owner";
    if (role === "admin") return "Admin";
    if (role === "member") return "Member";
    if (role === "viewer") return "Viewer";
    return null;
}

function serializeSprintListItem(sprint: {
    id: string;
    projectId: string;
    creatorId?: string | null;
    name: string;
    goal: string | null;
    description: string | null;
    startDate: Date | null;
    endDate: Date | null;
    status: SprintListItem['status'];
    createdAt: Date | null;
    updatedAt: Date | null;
    creatorName?: string | null;
    creatorAvatarUrl?: string | null;
    creatorRole?: string | null;
    creatorRoleTitle?: string | null;
}): SprintListItem {
    const membershipRoleLabel = formatSprintMemberRole(sprint.creatorRole, sprint.creatorRole === 'owner');
    const roleLabel = sprint.creatorRoleTitle || membershipRoleLabel || null;

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
        creator: sprint.creatorId ? {
            id: sprint.creatorId,
            fullName: sprint.creatorName ?? null,
            avatarUrl: sprint.creatorAvatarUrl ?? null,
            roleLabel,
        } : null,
    };
}

async function readProjectSprintsList(projectId: string, limit: number) {
    const readSprints = async (supportsDescription: boolean) => {
        if (supportsDescription) {
            return db
                .select({
                    id: projectSprints.id,
                    projectId: projectSprints.projectId,
                    creatorId: projectSprints.creatorId,
                    name: projectSprints.name,
                    goal: projectSprints.goal,
                    description: projectSprints.description,
                    startDate: projectSprints.startDate,
                    endDate: projectSprints.endDate,
                    status: projectSprints.status,
                    createdAt: projectSprints.createdAt,
                    updatedAt: projectSprints.updatedAt,
                    creatorName: profiles.fullName,
                    creatorAvatarUrl: profiles.avatarUrl,
                    creatorRole: projectMembers.role,
                    creatorRoleTitle: acceptedRoleTitleSql(projectId, projectSprints.creatorId),
                })
                .from(projectSprints)
                .leftJoin(profiles, eq(profiles.id, projectSprints.creatorId))
                .leftJoin(projectMembers, and(eq(projectMembers.userId, projectSprints.creatorId), eq(projectMembers.projectId, projectId)))
                .where(eq(projectSprints.projectId, projectId))
                .orderBy(sql`CASE WHEN ${projectSprints.status} = 'active' THEN 0 WHEN ${projectSprints.status} = 'planning' THEN 1 ELSE 2 END`, desc(projectSprints.createdAt))
                .limit(limit);
        }

        return db
            .select({
                id: projectSprints.id,
                projectId: projectSprints.projectId,
                creatorId: projectSprints.creatorId,
                name: projectSprints.name,
                goal: projectSprints.goal,
                startDate: projectSprints.startDate,
                endDate: projectSprints.endDate,
                status: projectSprints.status,
                createdAt: projectSprints.createdAt,
                updatedAt: projectSprints.updatedAt,
                creatorName: profiles.fullName,
                creatorAvatarUrl: profiles.avatarUrl,
                creatorRole: projectMembers.role,
                creatorRoleTitle: acceptedRoleTitleSql(projectId, projectSprints.creatorId),
            })
            .from(projectSprints)
            .leftJoin(profiles, eq(profiles.id, projectSprints.creatorId))
            .leftJoin(projectMembers, and(eq(projectMembers.userId, projectSprints.creatorId), eq(projectMembers.projectId, projectId)))
            .where(eq(projectSprints.projectId, projectId))
            .orderBy(sql`CASE WHEN ${projectSprints.status} = 'active' THEN 0 WHEN ${projectSprints.status} = 'planning' THEN 1 ELSE 2 END`, desc(projectSprints.createdAt))
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

async function readProjectSprintListItem(projectId: string, sprintId: string) {
    const readSprint = async (supportsDescription: boolean) => {
        if (supportsDescription) {
            return db
                .select({
                    id: projectSprints.id,
                    projectId: projectSprints.projectId,
                    creatorId: projectSprints.creatorId,
                    name: projectSprints.name,
                    goal: projectSprints.goal,
                    description: projectSprints.description,
                    startDate: projectSprints.startDate,
                    endDate: projectSprints.endDate,
                    status: projectSprints.status,
                    createdAt: projectSprints.createdAt,
                    updatedAt: projectSprints.updatedAt,
                    creatorName: profiles.fullName,
                    creatorAvatarUrl: profiles.avatarUrl,
                    creatorRole: projectMembers.role,
                    creatorRoleTitle: acceptedRoleTitleSql(projectId, projectSprints.creatorId),
                })
                .from(projectSprints)
                .leftJoin(profiles, eq(profiles.id, projectSprints.creatorId))
                .leftJoin(projectMembers, and(eq(projectMembers.userId, projectSprints.creatorId), eq(projectMembers.projectId, projectId)))
                .where(and(eq(projectSprints.id, sprintId), eq(projectSprints.projectId, projectId)))
                .limit(1);
        }

        return db
            .select({
                id: projectSprints.id,
                projectId: projectSprints.projectId,
                creatorId: projectSprints.creatorId,
                name: projectSprints.name,
                goal: projectSprints.goal,
                startDate: projectSprints.startDate,
                endDate: projectSprints.endDate,
                status: projectSprints.status,
                createdAt: projectSprints.createdAt,
                updatedAt: projectSprints.updatedAt,
                creatorName: profiles.fullName,
                creatorAvatarUrl: profiles.avatarUrl,
                creatorRole: projectMembers.role,
                creatorRoleTitle: acceptedRoleTitleSql(projectId, projectSprints.creatorId),
            })
            .from(projectSprints)
            .leftJoin(profiles, eq(profiles.id, projectSprints.creatorId))
            .leftJoin(projectMembers, and(eq(projectMembers.userId, projectSprints.creatorId), eq(projectMembers.projectId, projectId)))
            .where(and(eq(projectSprints.id, sprintId), eq(projectSprints.projectId, projectId)))
            .limit(1)
            .then((rows) => rows.map((row) => ({ ...row, description: null })));
    };

    const supportsDescription = await hasProjectSprintDescriptionColumn();

    try {
        const rows = await readSprint(supportsDescription);
        return rows[0] ? serializeSprintListItem(rows[0]) : null;
    } catch (error) {
        if (supportsDescription && isMissingColumn(error, 'description')) {
            sprintDescriptionColumnSupport = false;
            const rows = await readSprint(false);
            return rows[0] ? serializeSprintListItem(rows[0]) : null;
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

async function readSprintTaskActivityPage(input: { projectId: string; sprintId: string; limit: number; cursor: SprintDetailPaginationCursor | null }) {
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
                GREATEST(
                    t.updated_at,
                    COALESCE(MAX(lnk.linked_at), t.created_at),
                    COALESCE(MAX(fv.uploaded_at), t.created_at)
                ) AS activity_at,
                COUNT(DISTINCT lnk.node_id)::int AS linked_file_count
            FROM ${tasks} t
            LEFT JOIN ${taskNodeLinks} lnk ON lnk.task_id = t.id
            LEFT JOIN ${fileVersions} fv
             ON fv.node_id = lnk.node_id
             AND fv.version > 1
             AND fv.uploaded_at >= lnk.linked_at - INTERVAL '5 minutes'
            WHERE t.sprint_id = ${sprintId}
              AND t.deleted_at IS NULL
            GROUP BY t.id
        )
        SELECT *
        FROM task_activity
        ${
            cursor
                ? sql`WHERE (
                activity_at > ${cursor.activityAt}
                OR (activity_at = ${cursor.activityAt} AND id > ${cursor.taskId})
            )`
                : sql``
        }
        ORDER BY activity_at ASC, id ASC
        LIMIT ${limit + 1}
    `);

    const activityRows = Array.from(activityRowsResult);
    const hasMore = activityRows.length > limit;
    const pageRows = hasMore ? activityRows.slice(0, limit) : activityRows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursorActivityAt = toDateValue(lastRow?.activity_at);
    const nextCursor =
        hasMore && nextCursorActivityAt
            ? encodeSprintDetailPaginationCursor({
                  activityAt: nextCursorActivityAt,
                  taskId: lastRow!.id,
              })
            : null;

    const taskIds = pageRows.map((row) => row.id);
    const actorIds = Array.from(new Set(pageRows.flatMap((row) => [row.assignee_id, row.creator_id]).filter((value): value is string => !!value)));

    const [actorRows, fileRows] = await Promise.all([
        actorIds.length > 0
            ? db
                  .select({
                      id: profiles.id,
                      fullName: profiles.fullName,
                      avatarUrl: profiles.avatarUrl,
                  })
                  .from(profiles)
                  .where(inArray(profiles.id, actorIds))
            : Promise.resolve([]),

        taskIds.length > 0
            ? db
                  .execute<SprintTaskFileQueryRow>(
                      sql`
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
                WHERE lnk.task_id IN (${sql.join(
                    taskIds.map((taskId) => sql`${taskId}`),
                    sql`, `,
                )})
                  AND pn.project_id = ${projectId}
                  AND pn.deleted_at IS NULL
                ORDER BY lnk.linked_at ASC, lnk.id ASC
            `,
                  )
                  .then((rows) => Array.from(rows))
            : Promise.resolve([]),
    ]);

    const actorById = new Map(actorRows.map((row) => [row.id, row]));

    const nodeIds = Array.from(new Set(fileRows.map((row) => row.node_id).filter((value): value is string => !!value)));
    const [nodeEventRows, versionRows] =
        nodeIds.length > 0
            ? await Promise.all([
                  db
                      .select({
                          nodeId: projectNodeEvents.nodeId,
                          type: projectNodeEvents.type,
                          createdAt: projectNodeEvents.createdAt,
                          actorName: profiles.fullName,
                      })
                      .from(projectNodeEvents)
                      .leftJoin(profiles, eq(profiles.id, projectNodeEvents.actorId))
                      .where(and(eq(projectNodeEvents.projectId, projectId), inArray(projectNodeEvents.nodeId, nodeIds)))
                      .orderBy(desc(projectNodeEvents.createdAt))
                      .limit(100),
                  db
                      .execute<SprintFileVersionQueryRow>(sql`
                          SELECT
                              ranked.id,
                              ranked.node_id,
                              ranked.version_number,
                              ranked.uploaded_by,
                              ranked.uploaded_at,
                              ranked.comment,
                              ranked.uploaded_by_name
                          FROM (
                              SELECT
                                  fv.id,
                                  fv.node_id,
                                  fv.version AS version_number,
                                  fv.uploaded_by,
                                  fv.uploaded_at,
                                  fv.comment,
                                  COALESCE(p.full_name, p.username) AS uploaded_by_name,
                                  ROW_NUMBER() OVER (
                                      PARTITION BY fv.node_id
                                      ORDER BY fv.version DESC, fv.id DESC
                                  ) AS version_rank
                              FROM ${fileVersions} fv
                              LEFT JOIN ${profiles} p ON p.id = fv.uploaded_by
                              WHERE fv.node_id IN (${sql.join(
                                  nodeIds.map((nodeId) => sql`${nodeId}`),
                                  sql`, `,
                              )})
                                AND fv.version > 1
                          ) ranked
                          WHERE ranked.version_rank <= 3
                          ORDER BY ranked.uploaded_at ASC, ranked.id ASC
                      `)
                      .then((rows) => Array.from(rows)),
              ])
            : [[], []];

    const latestNodeEventByNodeId = new Map<string, SprintNodeEventQueryRow>();
    for (const eventRow of nodeEventRows) {
        if (!eventRow.nodeId || latestNodeEventByNodeId.has(eventRow.nodeId)) continue;
        latestNodeEventByNodeId.set(eventRow.nodeId, eventRow);
    }

    const versionEventsByNodeId = new Map<string, SprintFileVersionQueryRow[]>();
    for (const versionRow of versionRows) {
        const current = versionEventsByNodeId.get(versionRow.node_id) ?? [];
        current.push(versionRow);
        versionEventsByNodeId.set(versionRow.node_id, current);
    }

    const filesByTaskId = new Map<string, SprintFileTimelineEntity[]>();
    for (const fileRow of fileRows) {
        const latestNodeEvent = latestNodeEventByNodeId.get(fileRow.node_id);
        const linkedAt =
            (toDateValue(fileRow.linked_at)?.getTime() ?? Number.NEGATIVE_INFINITY) -
            5 * 60 * 1000;
        const versionEvents = (versionEventsByNodeId.get(fileRow.node_id) ?? [])
            .filter((versionRow) => {
                const uploadedAt = toDateValue(versionRow.uploaded_at)?.getTime();
                return uploadedAt !== undefined && uploadedAt !== null && uploadedAt >= linkedAt;
            })
            .map((versionRow) => ({
                id: versionRow.id,
                nodeId: versionRow.node_id,
                versionNumber: Number(versionRow.version_number),
                createdAt: toIsoString(versionRow.uploaded_at)!,
                createdBy: versionRow.uploaded_by ?? null,
                createdByName: versionRow.uploaded_by_name ?? null,
                comment: versionRow.comment ?? null,
            }));
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
            versionEvents,
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

async function buildSprintDetailPayload(input: { projectId: string; access: ProjectAccess; sprintId?: string | null; cursor?: string; limit?: number }): Promise<SprintDetailPayload | null> {
    const safeLimit = Math.min(Math.max(input.limit ?? 24, 1), 50);
    const parsedCursor = parseSprintDetailPaginationCursor(input.cursor);

    const access = input.access;
    if (!access.project) throw new Error('Project not found');
    if (!access.canRead) throw new Error('Forbidden');
    const permissions = buildSprintPermissionSet({
        canRead: access.canRead,
        canWrite: access.canWrite,
        isOwner: access.isOwner,
        isMember: access.isMember,
        memberRole: access.memberRole,
    });

    const sprints = await readProjectSprintsList(input.projectId, 120);
    const selectedSprint = (input.sprintId ? sprints.find((sprint) => sprint.id === input.sprintId) : null) ?? sprints.find((sprint) => sprint.status === 'active') ?? sprints[0] ?? null;

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

async function buildSprintTimelinePagePayload(input: { projectId: string; access: ProjectAccess; sprintId: string | null; cursor?: string; limit?: number }): Promise<SprintDetailPayload | null> {
    if (!input.sprintId) {
        return buildSprintDetailPayload(input);
    }

    const safeLimit = Math.min(Math.max(input.limit ?? 24, 1), 50);
    const parsedCursor = parseSprintDetailPaginationCursor(input.cursor);
    const access = input.access;
    if (!access.project) throw new Error('Project not found');
    if (!access.canRead) throw new Error('Forbidden');

    const selectedSprint = await readProjectSprintListItem(input.projectId, input.sprintId);
    if (!selectedSprint) return null;

    const permissions = buildSprintPermissionSet({
        canRead: access.canRead,
        canWrite: access.canWrite,
        isOwner: access.isOwner,
        isMember: access.isMember,
        memberRole: access.memberRole,
    });

    const [summary, taskPage] = await Promise.all([
        readSprintSummary(selectedSprint.id),
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
        includeKickoff: false,
        includeCloseout: !taskPage.hasMore,
    });

    return {
        projectId: input.projectId,
        projectSlug: access.project.slug ?? null,
        sprints: [selectedSprint],
        selectedSprintId: selectedSprint.id,
        permissions,
        timelineMode: 'chronological',
        summary,
        compareSummary: null,
        filterCounts: buildSprintFilterCounts({
            totalTasks: summary.totalTasks,
            completedTasks: summary.completedTasks,
            blockedTasks: summary.blockedTasks,
            linkedFileCount: summary.linkedFileCount,
        }),
        rows,
        drawerPreviews: buildSprintDrawerPreviews(rows),
        nextCursor: taskPage.nextCursor,
        hasMore: taskPage.hasMore,
    };
}

export async function fetchProjectSprintDetailAction(input: { projectId: string; sprintId?: string | null; cursor?: string; limit?: number }) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        const actorId = user?.id ?? null;
        const cursorKey = input.cursor ?? 'head';
        const sprintKey = input.sprintId ?? 'default';

        const startedAt = Date.now();
        const data = await runInFlightDeduped(`project:sprint-detail:${input.projectId}:${sprintKey}:${actorId ?? 'anon'}:${cursorKey}:${input.limit ?? 24}`, async () => {
            const access = await getProjectAccessById(input.projectId, actorId);
            if (!access.project) {
                throw new Error('Project not found');
            }

            return buildSprintDetailPayload({
                projectId: input.projectId,
                access,
                sprintId: input.sprintId ?? null,
                cursor: input.cursor,
                limit: input.limit,
            });
        });

        if (!data) {
            return { success: false as const, error: 'Sprint not found' };
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
        console.error('Failed to fetch sprint detail:', error);
        return { success: false as const, error: 'Failed to fetch sprint detail' };
    }
}

export async function fetchProjectSprintTimelinePageAction(input: { projectId: string; sprintId: string | null; cursor?: string; limit?: number }) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        const actorId = user?.id ?? null;
        const cursorKey = input.cursor ?? 'head';
        const sprintKey = input.sprintId ?? 'default';
        const startedAt = Date.now();

        const data = await runInFlightDeduped(`project:sprint-timeline-page:${input.projectId}:${sprintKey}:${actorId ?? 'anon'}:${cursorKey}:${input.limit ?? 24}`, async () => {
            const access = await getProjectAccessById(input.projectId, actorId);
            if (!access.project) {
                throw new Error('Project not found');
            }
            return buildSprintTimelinePagePayload({
                projectId: input.projectId,
                access,
                sprintId: input.sprintId,
                cursor: input.cursor,
                limit: input.limit,
            });
        });

        if (!data) {
            return { success: false as const, error: 'Sprint not found' };
        }

        recordSprintMetric('project.sprint.timeline.page_load_ms', {
            projectId: input.projectId,
            sprintId: data.selectedSprintId,
            durationMs: Date.now() - startedAt,
            rowCount: data.rows.length,
            hasMore: data.hasMore,
        });

        return { success: true as const, data };
    } catch (error) {
        console.error('Failed to fetch sprint timeline page:', error);
        return {
            success: false as const,
            error: 'Failed to fetch sprint timeline page',
        };
    }
}

export async function readProjectSprintDetail(input: { slugOrId: string; sprintId?: string | null; actorUserId?: string | null; cursor?: string; limit?: number }) {
    try {
        const project = await resolveProjectDetailTarget(input.slugOrId, input.actorUserId ?? null);
        if (!project) {
            return {
                success: false as const,
                errorCode: 'NOT_FOUND' as const,
                message: 'Project not found.',
            };
        }

        const viewerState = resolveProjectDetailViewerState({
            projectId: project.id,
            ownerId: project.ownerId,
            visibility: project.visibility,
            status: project.status,
            actorUserId: input.actorUserId ?? null,
            memberRoleRaw: project.memberRole,
            isFollowed: project.isFollowed,
        });

        if (!viewerState.canRead) {
            return {
                success: false as const,
                errorCode: 'FORBIDDEN' as const,
                message: 'Forbidden',
            };
        }
        if (
            !isProjectTabVisibleToViewer({
                tabId: 'sprints',
                isOwnerOrMember: viewerState.isOwner || viewerState.isMember,
                publicTabVisibility: project.publicTabVisibility,
            })
        ) {
            return {
                success: false as const,
                errorCode: 'FORBIDDEN' as const,
                message: 'Sprint details are members-only for this project.',
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

export async function fetchSprintTasksAction(sprintId: string, limit: number = 50, cursor?: string) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        const actorId = user?.id ?? null;
        const safeLimit = Math.min(Math.max(limit, 1), 200);
        const parsedCursor = parseTaskPaginationCursor(cursor);
        const cursorCreatedAtKey = parsedCursor?.createdAt.toISOString() ?? 'head';
        const cursorIdKey = parsedCursor?.id || 'none';

        return await runInFlightDeduped(`project:sprint-tasks:${sprintId}:${actorId ?? 'anon'}:${safeLimit}:${cursorCreatedAtKey}:${cursorIdKey}`, async () => {
            const [sprint] = await db.select({ projectId: projectSprints.projectId }).from(projectSprints).where(eq(projectSprints.id, sprintId)).limit(1);

            if (!sprint) {
                return { success: false as const, error: 'Sprint not found' };
            }

            await assertProjectReadAccess(sprint.projectId, actorId);

            const sprintTasks = await db.query.tasks.findMany({
                where: (t, { eq, and, or, lt }) => and(eq(t.sprintId, sprintId), parsedCursor ? or(lt(t.createdAt, parsedCursor.createdAt), and(eq(t.createdAt, parsedCursor.createdAt), lt(t.id, parsedCursor.id))) : undefined),
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
                      createdAt: new Date(tasks[tasks.length - 1]!.createdAt ?? new Date().toISOString()),
                      id: tasks[tasks.length - 1]!.id,
                  })
                : undefined;

            return { success: true as const, tasks, nextCursor, hasMore };
        });
    } catch (error) {
        console.error('Failed to fetch sprint tasks:', error);
        return { success: false as const, error: 'Failed to fetch sprint tasks' };
    }
}

export async function getProjectTaskDetailAction(projectId: string, taskId: string) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        await assertProjectReadAccess(projectId, user?.id ?? null);

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId);
        let taskWhere;
        if (isUuid) {
            taskWhere = and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt));
        } else {
            const dashIndex = taskId.lastIndexOf("-");
            if (dashIndex !== -1) {
                const taskNum = parseInt(taskId.slice(dashIndex + 1), 10);
                if (!isNaN(taskNum)) {
                    taskWhere = and(eq(tasks.taskNumber, taskNum), eq(tasks.projectId, projectId), isNull(tasks.deletedAt));
                } else {
                    taskWhere = and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt));
                }
            } else {
                taskWhere = and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt));
            }
        }

        const task = await db.query.tasks.findFirst({
            where: taskWhere,
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
                    columns: { key: true, slug: true },
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
            return { success: false as const, error: 'Task not found' };
        }

        return { success: true as const, task: normalizeTaskSurfaceRecord(task) };
    } catch (error) {
        console.error('Failed to fetch task detail:', error);
        return { success: false as const, error: 'Failed to fetch task detail' };
    }
}

export async function getProjectTaskActivityAction(projectId: string, taskId: string, limit: number = 40) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        await assertProjectReadAccess(projectId, user?.id ?? null);

        const safeLimit = Math.min(Math.max(limit, 1), 100);
        const task = await db.query.tasks.findFirst({
            where: and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)),
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
            return { success: false as const, error: 'Task not found' };
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
        console.error('Failed to fetch task activity:', error);
        return { success: false as const, error: 'Failed to fetch task activity' };
    }
}

export async function getProjectMembersAction(projectId: string, limit: number = 20, cursor?: string) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        const actorId = user?.id ?? null;

        const safeLimit = Math.min(Math.max(limit, 1), 100);
        const cursorKey = cursor ?? 'head';

        return await runInFlightDeduped(`project:members:${projectId}:${actorId ?? 'anon'}:${safeLimit}:${cursorKey}`, async () => {
            await assertProjectReadAccess(projectId, actorId);
            const whereConditions: any[] = [eq(projectMembers.projectId, projectId)];

            if (cursor) {
                try {
                    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
                    const [joinedAt, memberId] = decoded.split(':::');
                    if (joinedAt && memberId) {
                        whereConditions.push(sql`(${projectMembers.joinedAt}, ${projectMembers.id}) < (${new Date(joinedAt)}, ${memberId})`);
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
                        },
                    },
                },
                orderBy: (members, { desc }) => [desc(members.joinedAt), desc(members.id)],
                limit: safeLimit + 1,
            });

            const hasMore = membersResult.length > safeLimit;
            const slice = membersResult.slice(0, safeLimit);
            const last = slice[slice.length - 1];
            const nextCursor = hasMore && last ? Buffer.from(`${last.joinedAt.toISOString()}:::${last.id}`).toString('base64') : undefined;

            const members = slice
                .map((m) =>
                    m.user
                        ? {
                              ...m.user,
                              membershipRole: m.role,
                              joinedAt: m.joinedAt?.toISOString?.() || null,
                          }
                        : null,
                )
                .filter(Boolean);

            const memberIds = members.map((m: any) => m.id);
            const acceptedRoleRows =
                memberIds.length > 0
                    ? await db
                          .select({
                              applicantId: roleApplications.applicantId,
                              roleTitle: projectOpenRoles.title,
                              roleName: projectOpenRoles.role,
                          })
                          .from(roleApplications)
                          .leftJoin(projectOpenRoles, eq(projectOpenRoles.id, roleApplications.roleId))
                          .where(and(eq(roleApplications.projectId, projectId), eq(roleApplications.status, 'accepted'), inArray(roleApplications.applicantId, memberIds)))
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

            return {
                success: true as const,
                members: membersWithRoleTitles,
                hasMore,
                nextCursor,
            };
        });
    } catch (error) {
        console.error('Failed to fetch project members:', error);
        return {
            success: false as const,
            error: 'Failed to fetch project members',
        };
    }
}

async function getProjectAnalyticsDataset(projectId: string, actorId: string | null): Promise<BuildProjectAnalyticsInput> {
    await assertProjectReadAccess(projectId, actorId);

    const [projectRow] = await db
        .select({
            id: projects.id,
            slug: projects.slug,
            title: projects.title,
            ownerId: projects.ownerId,
            visibility: projects.visibility,
            publicTabVisibility: projects.publicTabVisibility,
            importSource: projects.importSource,
            syncStatus: projects.syncStatus,
        })
        .from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1);

    if (!projectRow) throw new Error('Project not found');

    const actorMemberRows =
        actorId && actorId !== projectRow.ownerId
            ? await db
                  .select({
                      userId: projectMembers.userId,
                      role: projectMembers.role,
                  })
                  .from(projectMembers)
                  .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorId)))
                  .limit(1)
            : [];

    const membersForAccess = actorMemberRows.map((member) => ({
        userId: member.userId,
        role: member.role,
    }));
    const accessLevel = resolveProjectAnalyticsAccess({
        actorId,
        projectOwnerId: projectRow.ownerId,
        members: membersForAccess,
        projectIsPublic: projectRow.visibility === 'public',
    });

    if (
        accessLevel === 'public' &&
        !isProjectTabVisibleToViewer({
            tabId: 'analytics',
            isOwnerOrMember: false,
            publicTabVisibility: projectRow.publicTabVisibility,
        })
    ) {
        throw new Error('Project analytics are not publicly visible');
    }

    if (accessLevel === 'public') {
        const importSourceType = (projectRow.importSource as { type?: 'github' | 'upload' | 'scratch' } | null | undefined)?.type ?? null;
        return {
            project: {
                id: projectRow.id,
                slug: projectRow.slug,
                title: projectRow.title,
                ownerId: projectRow.ownerId,
                importSourceType,
                syncStatus: projectRow.syncStatus,
            },
            accessLevel,
            actorId,
            hiddenPrivateFiles: 0,
            members: [],
            tasks: [],
            sprints: [],
            files: [],
            fileVersions: [],
            taskFileLinks: [],
            comments: [],
            applications: [],
            roles: [],
            workflows: [],
            events: [],
        };
    }

    const memberRows = await db
        .select({
            id: projectMembers.id,
            userId: projectMembers.userId,
            role: projectMembers.role,
            joinedAt: projectMembers.joinedAt,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
        })
        .from(projectMembers)
        .leftJoin(profiles, eq(profiles.id, projectMembers.userId))
        .where(and(eq(projectMembers.projectId, projectId), isNull(profiles.deletedAt)))
        .orderBy(desc(projectMembers.joinedAt))
        .limit(PROJECT_ANALYTICS_DATASET_LIMITS.members);

    const [taskRows, sprintRows, fileRows, applicationRows, roleRows, workflowRows, linkedWorkRows, eventRows] = await Promise.all([
        db
            .select({
                id: tasks.id,
                title: tasks.title,
                status: tasks.status,
                priority: tasks.priority,
                assigneeId: tasks.assigneeId,
                creatorId: tasks.creatorId,
                sprintId: tasks.sprintId,
                dueDate: tasks.dueDate,
                createdAt: tasks.createdAt,
                updatedAt: tasks.updatedAt,
            })
            .from(tasks)
            .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
            .orderBy(desc(tasks.updatedAt))
            .limit(PROJECT_ANALYTICS_DATASET_LIMITS.tasks),
        db
            .select({
                id: projectSprints.id,
                name: projectSprints.name,
                status: projectSprints.status,
                startDate: projectSprints.startDate,
                endDate: projectSprints.endDate,
                createdAt: projectSprints.createdAt,
                updatedAt: projectSprints.updatedAt,
            })
            .from(projectSprints)
            .where(eq(projectSprints.projectId, projectId))
            .orderBy(desc(projectSprints.updatedAt))
            .limit(PROJECT_ANALYTICS_DATASET_LIMITS.sprints),
        db
            .select({
                id: projectNodes.id,
                name: projectNodes.name,
                path: projectNodes.path,
                type: projectNodes.type,
                createdBy: projectNodes.createdBy,
                createdAt: projectNodes.createdAt,
                updatedAt: projectNodes.updatedAt,
                metadata: projectNodes.metadata,
                gitHash: projectNodes.gitHash,
            })
            .from(projectNodes)
            .where(and(eq(projectNodes.projectId, projectId), eq(projectNodes.type, 'file'), isNull(projectNodes.deletedAt)))
            .orderBy(desc(projectNodes.updatedAt))
            .limit(PROJECT_ANALYTICS_DATASET_LIMITS.files),
        db
            .select({
                id: roleApplications.id,
                applicantId: roleApplications.applicantId,
                status: roleApplications.status,
                createdAt: roleApplications.createdAt,
                updatedAt: roleApplications.updatedAt,
            })
            .from(roleApplications)
            .where(eq(roleApplications.projectId, projectId))
            .orderBy(desc(roleApplications.updatedAt))
            .limit(PROJECT_ANALYTICS_DATASET_LIMITS.applications),
        db
            .select({
                id: projectOpenRoles.id,
                title: projectOpenRoles.title,
                role: projectOpenRoles.role,
                count: projectOpenRoles.count,
                filled: projectOpenRoles.filled,
                updatedAt: projectOpenRoles.updatedAt,
            })
            .from(projectOpenRoles)
            .where(eq(projectOpenRoles.projectId, projectId))
            .orderBy(desc(projectOpenRoles.updatedAt))
            .limit(PROJECT_ANALYTICS_DATASET_LIMITS.roles),
        db
            .select({
                id: messageWorkflowItems.id,
                targetId: messageWorkflowItems.taskId,
                status: messageWorkflowItems.status,
                assigneeUserId: messageWorkflowItems.assigneeUserId,
                createdBy: messageWorkflowItems.creatorId,
                createdAt: messageWorkflowItems.createdAt,
                updatedAt: messageWorkflowItems.updatedAt,
            })
            .from(messageWorkflowItems)
            .where(eq(messageWorkflowItems.projectId, projectId))
            .orderBy(desc(messageWorkflowItems.updatedAt))
            .limit(PROJECT_ANALYTICS_DATASET_LIMITS.workflows / 2),
        db
            .select({
                id: messageWorkLinks.id,
                targetId: messageWorkLinks.targetId,
                status: messageWorkLinks.status,
                assigneeUserId: messageWorkLinks.assigneeUserId,
                createdBy: messageWorkLinks.createdBy,
                createdAt: messageWorkLinks.createdAt,
                updatedAt: messageWorkLinks.updatedAt,
            })
            .from(messageWorkLinks)
            .where(and(eq(messageWorkLinks.targetProjectId, projectId), isNull(messageWorkLinks.deletedAt)))
            .orderBy(desc(messageWorkLinks.updatedAt))
            .limit(PROJECT_ANALYTICS_DATASET_LIMITS.workflows / 2),
        db
            .select({
                id: projectNodeEvents.id,
                type: projectNodeEvents.type,
                actorId: projectNodeEvents.actorId,
                metadata: projectNodeEvents.metadata,
                createdAt: projectNodeEvents.createdAt,
            })
            .from(projectNodeEvents)
            .where(eq(projectNodeEvents.projectId, projectId))
            .orderBy(desc(projectNodeEvents.createdAt))
            .limit(PROJECT_ANALYTICS_DATASET_LIMITS.events),
    ]);

    const importSourceType = (projectRow.importSource as { type?: 'github' | 'upload' | 'scratch' } | null | undefined)?.type ?? null;
    const analyticsFileRows = fileRows.map((file) => {
        const contract = normalizeProjectNodeAnalyticsMetadata({
            metadata: file.metadata as Record<string, unknown> | null | undefined,
            gitHash: file.gitHash,
            importSourceType,
        });
        return { ...file, analyticsContract: contract };
    });
    const visibleFileRows = analyticsFileRows.filter((file) => file.analyticsContract.analyticsVisible);
    const hiddenPrivateFiles = analyticsFileRows.length - visibleFileRows.length;
    const fileNodeIds = visibleFileRows.map((file) => file.id);
    const taskIds = taskRows.map((task) => task.id);

    const [versionRows, taskFileLinkRows, commentRows] = await Promise.all([
        fileNodeIds.length
            ? db
                  .select({
                      id: fileVersions.id,
                      nodeId: fileVersions.nodeId,
                      uploadedBy: fileVersions.uploadedBy,
                      uploadedAt: fileVersions.uploadedAt,
                  })
                  .from(fileVersions)
                  .where(inArray(fileVersions.nodeId, fileNodeIds))
                  .orderBy(desc(fileVersions.uploadedAt))
                  .limit(PROJECT_ANALYTICS_DATASET_LIMITS.fileVersions)
            : Promise.resolve([]),
        taskIds.length
            ? db
                  .select({
                      id: taskNodeLinks.id,
                      taskId: taskNodeLinks.taskId,
                      nodeId: taskNodeLinks.nodeId,
                      annotation: taskNodeLinks.annotation,
                      linkedAt: taskNodeLinks.linkedAt,
                  })
                  .from(taskNodeLinks)
                  .where(inArray(taskNodeLinks.taskId, taskIds))
                  .orderBy(desc(taskNodeLinks.linkedAt))
                  .limit(PROJECT_ANALYTICS_DATASET_LIMITS.taskFileLinks)
            : Promise.resolve([]),
        taskIds.length
            ? db
                  .select({
                      id: taskComments.id,
                      taskId: taskComments.taskId,
                      userId: taskComments.userId,
                      createdAt: taskComments.createdAt,
                  })
                  .from(taskComments)
                  .where(and(inArray(taskComments.taskId, taskIds), isNull(taskComments.deletedAt)))
                  .orderBy(desc(taskComments.createdAt))
                  .limit(PROJECT_ANALYTICS_DATASET_LIMITS.comments)
            : Promise.resolve([]),
    ]);

    return {
        project: {
            id: projectRow.id,
            slug: projectRow.slug,
            title: projectRow.title,
            ownerId: projectRow.ownerId,
            importSourceType,
            syncStatus: projectRow.syncStatus,
        },
        accessLevel,
        actorId,
        hiddenPrivateFiles,
        members: memberRows.map((member) => ({
            id: member.id,
            userId: member.userId,
            role: projectRow.ownerId === member.userId ? 'owner' : member.role,
            joinedAt: member.joinedAt,
            user: {
                id: member.userId,
                username: member.username,
                fullName: member.fullName,
                avatarUrl: member.avatarUrl,
            },
        })),
        tasks: taskRows,
        sprints: sprintRows,
        files: visibleFileRows.map((file) => ({
            id: file.id,
            name: file.name,
            path: file.path,
            type: file.type,
            createdBy: file.createdBy,
            createdAt: file.createdAt,
            updatedAt: file.updatedAt,
            source: file.analyticsContract.source,
            analyticsVisible: file.analyticsContract.analyticsVisible,
            publicVisible: file.analyticsContract.publicVisible,
            privateReason: file.analyticsContract.privateReason,
        })),
        fileVersions: versionRows,
        taskFileLinks: taskFileLinkRows,
        comments: commentRows,
        applications: applicationRows,
        roles: roleRows,
        workflows: [
            ...workflowRows,
            ...linkedWorkRows.map((link) => ({
                id: link.id,
                targetId: link.targetId,
                status: link.status,
                assigneeUserId: link.assigneeUserId,
                createdBy: link.createdBy,
                createdAt: link.createdAt,
                updatedAt: link.updatedAt,
            })),
        ],
        events: eventRows,
    };
}

const readProjectAnalyticsData = async (projectId: string) => {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    return runInFlightDeduped(`project:analytics:v2:${projectId}:${actorId ?? 'anon'}`, () => getProjectAnalyticsDataset(projectId, actorId));
};

const readProjectAnalyticsScopedData = async (projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) => {
    const dataset = await readProjectAnalyticsData(projectId);
    return filterProjectAnalyticsDatasetByContext(dataset, normalizeProjectAnalyticsContext(context));
};

const canReadMemberDetail = (dataset: BuildProjectAnalyticsInput, memberUserId: string) => {
    if (dataset.accessLevel === 'owner' || dataset.accessLevel === 'co_leader') return true;
    if (dataset.accessLevel === 'member' || dataset.accessLevel === 'viewer') return dataset.actorId === memberUserId;
    return false;
};

const canReadOperationalRisk = (dataset: BuildProjectAnalyticsInput) => dataset.accessLevel === 'owner' || dataset.accessLevel === 'co_leader';

export async function readProjectAnalyticsOverviewAction(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    try {
        const rawDataset = await readProjectAnalyticsData(projectId);
        const dataset = filterProjectAnalyticsDatasetByContext(rawDataset, normalizeProjectAnalyticsContext(context));
        return {
            success: true as const,
            overview: buildProjectAnalyticsOverview(dataset, context, rawDataset),
        };
    } catch (error) {
        console.error('Failed to fetch project analytics overview:', error);
        return {
            success: false as const,
            error: 'Failed to fetch project analytics overview',
        };
    }
}

export async function readProjectAnalyticsMembersAction(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    try {
        const dataset = await readProjectAnalyticsScopedData(projectId, context);
        if (dataset.accessLevel === 'public') return { success: true as const, members: [] };
        return {
            success: true as const,
            members: buildProjectAnalyticsMemberSummaries(dataset),
        };
    } catch (error) {
        console.error('Failed to fetch project analytics members:', error);
        return {
            success: false as const,
            error: 'Failed to fetch project analytics members',
        };
    }
}

export async function readProjectMemberAnalyticsAction(projectId: string, memberUserId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    try {
        const dataset = await readProjectAnalyticsScopedData(projectId, {
            ...context,
            memberId: memberUserId,
        });
        if (!canReadMemberDetail(dataset, memberUserId)) {
            return {
                success: false as const,
                error: 'Member analytics are not visible for this access level',
            };
        }
        return {
            success: true as const,
            detail: buildProjectAnalyticsMemberDetail(dataset, memberUserId),
        };
    } catch (error) {
        console.error('Failed to fetch project member analytics:', error);
        return {
            success: false as const,
            error: 'Failed to fetch project member analytics',
        };
    }
}

export async function readProjectAnalyticsWorkflowAction(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    try {
        const dataset = await readProjectAnalyticsScopedData(projectId, context);
        if (dataset.accessLevel === 'public') {
            return {
                success: true as const,
                workflow: {
                    statusCounts: {},
                    friction: [],
                    unassigned: [],
                    blocked: [],
                    stale: [],
                    removedMemberAssignments: [],
                },
            };
        }
        return {
            success: true as const,
            workflow: buildProjectAnalyticsWorkflow(dataset),
        };
    } catch (error) {
        console.error('Failed to fetch project analytics workflow:', error);
        return {
            success: false as const,
            error: 'Failed to fetch project analytics workflow',
        };
    }
}

export async function readProjectAnalyticsSprintsAction(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    try {
        const dataset = await readProjectAnalyticsScopedData(projectId, context);
        if (dataset.accessLevel === 'public') return { success: true as const, sprints: [] };
        return {
            success: true as const,
            sprints: buildProjectAnalyticsSprints(dataset),
        };
    } catch (error) {
        console.error('Failed to fetch project analytics sprints:', error);
        return {
            success: false as const,
            error: 'Failed to fetch project analytics sprints',
        };
    }
}

export async function readProjectAnalyticsFilesAction(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    try {
        const dataset = await readProjectAnalyticsScopedData(projectId, context);
        if (dataset.accessLevel === 'public') {
            return {
                success: true as const,
                files: buildProjectAnalyticsFiles({ ...dataset, taskFileLinks: [] }),
            };
        }
        return {
            success: true as const,
            files: buildProjectAnalyticsFiles(dataset),
        };
    } catch (error) {
        console.error('Failed to fetch project analytics files:', error);
        return {
            success: false as const,
            error: 'Failed to fetch project analytics files',
        };
    }
}

export async function readProjectAnalyticsRisksAction(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    try {
        const dataset = await readProjectAnalyticsScopedData(projectId, context);
        return {
            success: true as const,
            risks: canReadOperationalRisk(dataset) ? buildProjectAnalyticsRisks(dataset) : [],
        };
    } catch (error) {
        console.error('Failed to fetch project analytics risks:', error);
        return {
            success: false as const,
            error: 'Failed to fetch project analytics risks',
        };
    }
}

export async function readProjectAnalyticsTimelineAction(projectId: string, filters: ProjectAnalyticsTimelineFilters = {}) {
    try {
        const dataset = await readProjectAnalyticsData(projectId);
        if (dataset.accessLevel === 'public') {
            return {
                success: true as const,
                timeline: buildProjectAnalyticsTimeline({ ...dataset, events: [], comments: [], workflows: [] }, filters),
            };
        }
        return {
            success: true as const,
            timeline: buildProjectAnalyticsTimeline(dataset, filters),
        };
    } catch (error) {
        console.error('Failed to fetch project analytics timeline:', error);
        return {
            success: false as const,
            error: 'Failed to fetch project analytics timeline',
        };
    }
}

export async function readProjectAnalyticsSnapshotAction(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    try {
        const dataset = await readProjectAnalyticsData(projectId);
        return {
            success: true as const,
            snapshot: buildProjectAnalyticsSnapshot(dataset, context),
        };
    } catch (error) {
        console.error('Failed to fetch project analytics snapshot:', error);
        return {
            success: false as const,
            error: 'Failed to fetch project analytics snapshot',
        };
    }
}

export async function readProjectAnalyticsReportAction(projectId: string, context?: Partial<ProjectAnalyticsContextFilters> | null) {
    try {
        const dataset = await readProjectAnalyticsData(projectId);
        const snapshot = buildProjectAnalyticsSnapshot(dataset, context);
        return {
            success: true as const,
            filename: `project-intelligence-${projectId}-${new Date().toISOString().slice(0, 10)}.md`,
            content: buildProjectAnalyticsReport(snapshot),
        };
    } catch (error) {
        console.error('Failed to build project analytics report:', error);
        return {
            success: false as const,
            error: 'Failed to build project analytics report',
        };
    }
}

export async function updateProjectAnalyticsRiskLifecycleAction(projectId: string, riskId: string, status: ProjectAnalyticsRiskLifecycleStatus) {
    try {
        const normalizedStatus = status === 'active' || status === 'acknowledged' || status === 'resolved' || status === 'dismissed' ? status : null;
        if (!normalizedStatus)
            return {
                success: false as const,
                error: 'Invalid risk lifecycle status',
            };
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) return { success: false as const, error: 'Not authenticated' };
        const dataset = await getProjectAnalyticsDataset(projectId, user.id);
        if (!canReadOperationalRisk(dataset))
            return {
                success: false as const,
                error: 'Not authorized to update risk lifecycle',
            };
        await db.insert(projectNodeEvents).values({
            projectId,
            actorId: user.id,
            nodeId: null,
            type: 'project_analytics.risk_lifecycle_changed',
            metadata: {
                riskId,
                status: normalizedStatus,
                source: 'analytics_risk_panel',
            },
            createdAt: new Date(),
        });
        return { success: true as const, status: normalizedStatus };
    } catch (error) {
        console.error('Failed to update project analytics risk lifecycle:', error);
        return {
            success: false as const,
            error: 'Failed to update project analytics risk lifecycle',
        };
    }
}

export async function getProjectAnalyticsAction(projectId: string) {
    try {
        const dataset = await readProjectAnalyticsData(projectId);
        const overview = buildProjectAnalyticsOverview(dataset);
        return {
            success: true as const,
            analytics: {
                totalTasks: overview.sourceSummary.tasks,
                completedTasks: overview.pulse.completedWork,
                inProgressTasks: overview.pulse.activeWork,
                overdueTasks: overview.pulse.staleWork,
                priorityDistribution: {},
                completionRate: overview.sourceSummary.tasks > 0 ? Math.round((overview.pulse.completedWork / overview.sourceSummary.tasks) * 100) : 0,
                activityByWindow: {
                    7: {
                        tasksCreated: overview.pulse.recentMovement,
                        tasksCompleted: overview.pulse.completedWork,
                    },
                    30: {
                        tasksCreated: overview.sourceSummary.tasks,
                        tasksCompleted: overview.pulse.completedWork,
                    },
                    90: {
                        tasksCreated: overview.sourceSummary.tasks,
                        tasksCompleted: overview.pulse.completedWork,
                    },
                },
                overview,
            },
        };
    } catch (error) {
        console.error('Failed to fetch project analytics:', error);
        return {
            success: false as const,
            error: 'Failed to fetch project analytics',
        };
    }
}

const createTaskSchema = z.object({
    projectId: z.string().uuid(),
    title: z.string().min(1, 'Title is required'),
    description: z.string().optional(),
    status: taskStatusEnum.default('todo'),
    priority: taskPriorityEnum.default('medium'),
    sprintId: z.string().uuid().optional().nullable(),
    assigneeId: z.string().uuid().optional().nullable(),
    storyPoints: z.number().min(0).optional(),
    dueDate: z.string().optional().nullable(), // ISO String
    subtasks: z
        .array(
            z.object({
                title: z.string(),
                completed: z.boolean().default(false),
            }),
        )
        .optional(),
    attachmentNodeIds: z.array(z.string().uuid()).optional(),
});

export async function createTaskAction(data: z.infer<typeof createTaskSchema>) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');

        const validated = createTaskSchema.parse(data);
        await requireProjectCapability(validated.projectId, user.id, 'create_tasks');
        if (validated.sprintId) {
            await requireProjectCapability(validated.projectId, user.id, 'manage_tasks');
        }

        if (validated.assigneeId) {
            await requireProjectCapability(validated.projectId, user.id, 'assign_tasks');
            const assigneeMember = await db.query.projectMembers.findFirst({
                where: and(eq(projectMembers.projectId, validated.projectId), eq(projectMembers.userId, validated.assigneeId)),
                columns: { id: true, role: true },
            });
            if (!assigneeMember) {
                throw new Error('Assignee must be a project member');
            }
            if (!isProjectMemberEligibleFor(assigneeMember.role, 'assign')) {
                throw new Error('Assignee must be an assignable project member');
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
            if (!current) throw new Error('Project not found');

            const nextTaskNumber = Number(current.current_task_number || 0) + 1;
            await tx.update(projects).set({ currentTaskNumber: nextTaskNumber }).where(eq(projects.id, validated.projectId));

            const [newTask] = await tx
                .insert(tasks)
                .values({
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
                })
                .returning({ id: tasks.id });

            if (!newTask) throw new Error('Failed to create task');

            if (validated.attachmentNodeIds && validated.attachmentNodeIds.length > 0) {
                const uniqueAttachmentIds = [...new Set(validated.attachmentNodeIds)];
                const attachmentNodes = await tx.query.projectNodes.findMany({
                    where: and(eq(projectNodes.projectId, validated.projectId), inArray(projectNodes.id, uniqueAttachmentIds), isNull(projectNodes.deletedAt)),
                    columns: { id: true },
                });
                if (attachmentNodes.length !== uniqueAttachmentIds.length) {
                    throw new Error('One or more attachments are invalid for this project');
                }

                await tx
                    .insert(taskNodeLinks)
                    .values(
                        uniqueAttachmentIds.map((nodeId) => ({
                            taskId: newTask.id,
                            nodeId,
                            createdBy: user.id,
                        })),
                    )
                    .onConflictDoNothing({
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
                        })),
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
                    columns: { key: true, slug: true },
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
            throw new Error('Failed to load created task');
        }

        // Note: We don't need to manually revalidate if we are using Realtime
        // But for fallback and initial load consistency:
        revalidatePath(`/projects/${validated.projectId}`);

        if (validated.assigneeId && validated.assigneeId !== user.id) {
            const actor = actorNotificationSnapshot(user);
            await enqueueProjectNotificationBestEffort(
                {
                    projectId: validated.projectId,
                    actorUserId: user.id,
                    ...actor,
                    eventKey: 'tasks.created_assigned',
                    assigneeId: validated.assigneeId,
                    title: `${actor.actorName || 'Someone'} assigned you a task`,
                    body: hydratedTask.title,
                    href: `/projects/${encodeURIComponent(hydratedTask.project?.slug || validated.projectId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(hydratedTask.id)}`,
                    entityRefs: {
                        projectId: validated.projectId,
                        projectSlug: hydratedTask.project?.slug ?? null,
                        taskId: hydratedTask.id,
                    },
                    preview: {
                        actorName: actor.actorName,
                        actorAvatarUrl: actor.actorAvatarUrl,
                        contextLabel: hydratedTask.project?.key && hydratedTask.taskNumber ? `${hydratedTask.project.key}-${hydratedTask.taskNumber}` : 'Task',
                        contextKind: 'task',
                        secondaryText: hydratedTask.title,
                    },
                    sourceEventId: `${hydratedTask.id}:created-assigned`,
                },
                {
                    taskId: hydratedTask.id,
                    targetUserId: validated.assigneeId,
                },
            );
        }

        return { success: true, task: normalizeTaskSurfaceRecord(hydratedTask) };
    } catch (error) {
        console.error('Failed to create task:', error);
        const message = error instanceof Error ? error.message : 'Failed to create task';
        return {
            success: false,
            error: message.includes('Failed query:') ? 'Failed to create task' : message,
        };
    }
}

export async function createSprintAction(data: CreateSprintInput) {
    let actorIdForMetric: string | null = null;
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');
        actorIdForMetric = user.id;

        const validated = createSprintSchema.parse(data);
        const startDate = parseSprintDateInput(validated.startDate);
        const endDate = parseSprintDateInput(validated.endDate);

        const access = await getProjectAccessById(validated.projectId, user.id);
        if (!access.project) throw new Error('Project not found');
        if (!access.isOwner) {
            throw new Error('You do not have permission to create sprints in this project');
        }

        const supportsDescription = await hasProjectSprintDescriptionColumn();
        const sprintValues: typeof projectSprints.$inferInsert = {
            projectId: validated.projectId,
            creatorId: user.id,
            name: validated.name,
            goal: validated.goal ?? null,
            startDate,
            endDate,
            status: 'active',
        };
        if (supportsDescription) {
            sprintValues.description = validated.description ?? null;
        }

        let newSprint: { id: string } | undefined;
        try {
            const rows = await db
                .insert(projectSprints)
                .values(sprintValues)
                .returning({
                    id: projectSprints.id,
                });
            newSprint = rows[0];
        } catch (error) {
            if (supportsDescription && isMissingColumn(error, 'description')) {
                sprintDescriptionColumnSupport = false;
                delete sprintValues.description;
                const rows = await db
                    .insert(projectSprints)
                    .values(sprintValues)
                    .returning({
                        id: projectSprints.id,
                    });
                newSprint = rows[0];
            } else {
                throw error;
            }
        }

        if (!newSprint) {
            throw new Error('Failed to create sprint');
        }

        const sprintListItem = await readProjectSprintListItem(validated.projectId, newSprint.id);
        if (!sprintListItem) {
            throw new Error('Failed to load created sprint');
        }

        await revalidateProjectPaths(validated.projectId);

        await enqueueProjectNotificationBestEffort(
            {
                projectId: validated.projectId,
                actorUserId: user.id,
                ...actorNotificationSnapshot(user),
                eventKey: 'sprints.created',
                title: `Sprint created: ${sprintListItem.name}`,
                body: sprintListItem.goal ?? 'A new sprint was added to the project.',
                sourceEventId: sprintListItem.id,
                entityRefs: { projectId: validated.projectId, sprintId: sprintListItem.id },
            },
            { sprintId: sprintListItem.id },
        );

        recordSprintMetric('project.sprint.create.result', {
            projectId: validated.projectId,
            sprintId: sprintListItem.id,
            actorId: actorIdForMetric,
            success: true,
        });

        return { success: true, sprint: sprintListItem };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false,
                error: error.issues[0]?.message ?? 'Sprint details are invalid',
            };
        }
        console.error('Failed to create sprint:', error);
        recordSprintMetric('project.sprint.create.result', {
            projectId: data.projectId,
            actorId: actorIdForMetric ?? 'unknown',
            success: false,
            message: error instanceof Error ? error.message : 'Failed to create sprint',
        });
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to create sprint',
        };
    }
}

export async function updateSprintAction(data: UpdateSprintInput) {
    let actorIdForMetric: string | null = null;
    const startedAt = Date.now();
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');
        actorIdForMetric = user.id;

        const validated = updateSprintSchema.parse(data);
        const startDate = parseSprintDateInput(validated.startDate);
        const endDate = parseSprintDateInput(validated.endDate);

        const access = await getProjectAccessById(validated.projectId, user.id);
        if (!access.project) throw new Error('Project not found');
        if (!access.isOwner) {
            throw new Error('You do not have permission to edit sprints in this project');
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
            throw new Error('Sprint not found');
        }

        const supportsDescription = await hasProjectSprintDescriptionColumn();
        const sprintPatch: Partial<typeof projectSprints.$inferInsert> & {
            updatedAt: Date;
        } = {
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
                  status: SprintListItem['status'];
                  createdAt: Date | null;
                  updatedAt: Date | null;
              }
            | undefined;
        try {
            [updatedSprint] = await db
                .update(projectSprints)
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
                [updatedSprint] = await db
                    .update(projectSprints)
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
            throw new Error('Failed to update sprint');
        }

        await revalidateProjectPaths(validated.projectId);

        await enqueueProjectNotificationBestEffort(
            {
                projectId: validated.projectId,
                actorUserId: user.id,
                ...actorNotificationSnapshot(user),
                eventKey: 'sprints.updated',
                title: `Sprint updated: ${updatedSprint.name}`,
                body: updatedSprint.goal ?? 'Sprint details were updated.',
                sourceEventId: `${updatedSprint.id}:${updatedSprint.updatedAt?.toISOString?.() ?? Date.now()}`,
                entityRefs: {
                    projectId: validated.projectId,
                    sprintId: updatedSprint.id,
                },
            },
            { sprintId: updatedSprint.id },
        );

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
                error: error.issues[0]?.message ?? 'Sprint details are invalid',
            };
        }

        console.error('Failed to update sprint:', error);
        recordSprintMetric('project.sprint.update.result', {
            projectId: data.projectId,
            sprintId: data.sprintId,
            actorId: actorIdForMetric ?? 'unknown',
            success: false,
            durationMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : 'Failed to update sprint',
        });

        return {
            success: false as const,
            error: error instanceof Error ? error.message : 'Failed to update sprint',
        };
    }
}

export async function deleteSprintAction(data: { projectId: string; sprintId: string }): Promise<DeleteSprintResult> {
    let actorIdForMetric: string | null = null;
    const startedAt = Date.now();
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');
        actorIdForMetric = user.id;

        const validated = deleteSprintSchema.parse(data);
        const access = await getProjectAccessById(validated.projectId, user.id);
        if (!access.project) throw new Error('Project not found');
        if (!access.isOwner) {
            throw new Error('You do not have permission to delete sprints in this project');
        }

        const [sprintWithTaskCount] = await db.execute<{
            id: string;
            status: SprintListItem['status'];
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
            throw new Error('Sprint not found');
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
            await tx
                .update(tasks)
                .set({
                    sprintId: null,
                    updatedAt: new Date(),
                })
                .where(and(eq(tasks.projectId, validated.projectId), eq(tasks.sprintId, validated.sprintId), isNull(tasks.deletedAt)));

            await tx.delete(projectSprints).where(eq(projectSprints.id, validated.sprintId));
        });

        await revalidateProjectPaths(validated.projectId);

        await enqueueProjectNotificationBestEffort(
            {
                projectId: validated.projectId,
                actorUserId: user.id,
                ...actorNotificationSnapshot(user),
                eventKey: 'sprints.deleted',
                title: 'Sprint deleted',
                body: `A sprint was deleted and ${sprintWithTaskCount.affected_task_count} task${sprintWithTaskCount.affected_task_count === 1 ? '' : 's'} moved back to the backlog.`,
                sourceEventId: `${validated.sprintId}:deleted`,
                entityRefs: {
                    projectId: validated.projectId,
                    sprintId: validated.sprintId,
                },
            },
            { sprintId: validated.sprintId },
        );

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
                error: error.issues[0]?.message ?? 'Sprint details are invalid',
            };
        }

        console.error('Failed to delete sprint:', error);
        recordSprintMetric('project.sprint.delete.result', {
            projectId: data.projectId,
            sprintId: data.sprintId,
            actorId: actorIdForMetric ?? 'unknown',
            success: false,
            durationMs: Date.now() - startedAt,
            message: error instanceof Error ? error.message : 'Failed to delete sprint',
        });
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to delete sprint',
        };
    }
}

export async function startSprintAction(sprintId: string, projectId: string) {
    let actorIdForMetric: string | null = null;
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');
        actorIdForMetric = user.id;

        const access = await getProjectAccessById(projectId, user.id);
        if (!access.project) throw new Error('Project not found');
        if (!access.isOwner) {
            throw new Error('You do not have permission to start sprints in this project');
        }

        // 1. Check for active sprints
        const activeSprint = await db.query.projectSprints.findFirst({
            where: and(eq(projectSprints.projectId, projectId), eq(projectSprints.status, 'active')),
        });

        if (activeSprint) {
            throw new Error('There is already an active sprint. Complete it before starting a new one.');
        }

        // 2. Start Sprint
        await db.update(projectSprints).set({ status: 'active', updatedAt: new Date() }).where(eq(projectSprints.id, sprintId));

        await revalidateProjectPaths(projectId);

        await enqueueProjectNotificationBestEffort(
            {
                projectId,
                actorUserId: user.id,
                ...actorNotificationSnapshot(user),
                eventKey: 'sprints.started',
                title: 'Sprint started',
                body: 'A project sprint is now active.',
                sourceEventId: `${sprintId}:started`,
                entityRefs: { projectId, sprintId },
            },
            { sprintId },
        );

        recordSprintMetric('project.sprint.start.result', {
            projectId,
            sprintId,
            actorId: actorIdForMetric,
            success: true,
        });

        return { success: true };
    } catch (error) {
        console.error('Failed to start sprint:', error);
        recordSprintMetric('project.sprint.start.result', {
            projectId,
            sprintId,
            actorId: actorIdForMetric ?? 'unknown',
            success: false,
            message: error instanceof Error ? error.message : 'Failed to start sprint',
        });
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to start sprint',
        };
    }
}

export async function completeSprintAction(sprintId: string, projectId: string) {
    let actorIdForMetric: string | null = null;
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');
        actorIdForMetric = user.id;

        const access = await getProjectAccessById(projectId, user.id);
        if (!access.project) throw new Error('Project not found');
        if (!access.isOwner) {
            throw new Error('You do not have permission to complete sprints in this project');
        }

        await db.update(projectSprints).set({ status: 'completed', updatedAt: new Date() }).where(eq(projectSprints.id, sprintId));

        await revalidateProjectPaths(projectId);

        await enqueueProjectNotificationBestEffort(
            {
                projectId,
                actorUserId: user.id,
                ...actorNotificationSnapshot(user),
                eventKey: 'sprints.completed',
                title: 'Sprint completed',
                body: 'A project sprint was marked complete.',
                sourceEventId: `${sprintId}:completed`,
                entityRefs: { projectId, sprintId },
            },
            { sprintId },
        );

        recordSprintMetric('project.sprint.complete.result', {
            projectId,
            sprintId,
            actorId: actorIdForMetric,
            success: true,
        });

        return { success: true };
    } catch (error) {
        console.error('Failed to complete sprint:', error);
        recordSprintMetric('project.sprint.complete.result', {
            projectId,
            sprintId,
            actorId: actorIdForMetric ?? 'unknown',
            success: false,
            message: error instanceof Error ? error.message : 'Failed to complete sprint',
        });
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to complete sprint',
        };
    }
}

export async function moveTaskToSprintAction(taskId: string, sprintId: string | null, projectId: string) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');

        // Access Check
        const project = await db.query.projects.findFirst({
            where: eq(projects.id, projectId),
            columns: { ownerId: true, slug: true },
        });
        if (!project) throw new Error('Project not found');

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
            throw new Error('Only the project owner can manage sprint tasks');
        }

        const [task] = await db
            .select({
                id: tasks.id,
                title: tasks.title,
                assigneeId: tasks.assigneeId,
                creatorId: tasks.creatorId,
            })
            .from(tasks)
            .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
            .limit(1);

        if (!task) {
            throw new Error('Task not found in this project');
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
                throw new Error('Sprint not found in this project');
            }
        }

        await db
            .update(tasks)
            .set({ sprintId: sprintId, updatedAt: new Date() })
            .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));

        const slugOrId = project.slug || projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${projectId}`);

        await enqueueProjectNotificationBestEffort(
            {
                projectId,
                actorUserId: user.id,
                ...actorNotificationSnapshot(user),
                eventKey: 'sprints.task_moved',
                title: sprintId ? 'Task moved into a sprint' : 'Task moved out of a sprint',
                body: task.title,
                sourceEventId: `${taskId}:${sprintId ?? 'backlog'}`,
                taskParticipantIds: [task.assigneeId, task.creatorId].filter((value): value is string => Boolean(value)),
                entityRefs: { projectId, taskId, sprintId: sprintId ?? null },
            },
            { taskId, sprintId },
        );

        return { success: true };
    } catch (error) {
        console.error('Failed to move task:', error);
        return { success: false, error: 'Failed to move task' };
    }
}

export async function deleteTaskAction(taskId: string, projectId: string) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');

        // Access Check - Only project owner can delete tasks
        const project = await db.query.projects.findFirst({
            where: eq(projects.id, projectId),
            columns: { ownerId: true, slug: true },
        });
        if (!project) throw new Error('Project not found');

        if (project.ownerId !== user.id) {
            throw new Error('Only the project owner can delete tasks');
        }

        const deletedTask = await db.transaction(async (tx) => {
            const existingTask = await tx.query.tasks.findFirst({
                where: and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)),
                columns: {
                    assigneeId: true,
                },
            });

            if (!existingTask) {
                throw new Error('Task not found in this project');
            }

            await tx.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));
            return existingTask;
        });

        await queueCounterRefreshBestEffort([deletedTask?.assigneeId ?? null]);

        const slugOrId = project.slug || projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${projectId}`);

        return { success: true };
    } catch (error) {
        console.error('Failed to delete task:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to delete task',
        };
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
          stageCompletionDates?: Record<string, string>;
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

export async function updateProjectStageAction(projectId: string, currentStageIndex: number, options?: UpdateProjectStageOptions): Promise<UpdateProjectStageResult> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return {
                success: false,
                error: 'Unauthorized',
                errorCode: 'UNAUTHORIZED',
            };
        }

        const normalizedIndex = Number.isInteger(currentStageIndex) && currentStageIndex >= 0 ? currentStageIndex : null;
        if (normalizedIndex === null) {
            return {
                success: false,
                error: 'Invalid stage index',
                errorCode: 'INVALID_INPUT',
            };
        }

        const [projectForStageUpdate] = await db
            .select({
                ownerId: projects.ownerId,
                lifecycleStages: projects.lifecycleStages,
                stageCompletionDates: projects.stageCompletionDates,
            })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!projectForStageUpdate) {
            return {
                success: false,
                error: 'Project not found',
                errorCode: 'NOT_FOUND',
            };
        }
        if (projectForStageUpdate.ownerId !== user.id) {
            return {
                success: false,
                error: 'Only the project owner can advance the stage',
                errorCode: 'FORBIDDEN',
            };
        }

        const lifecycleStages = Array.isArray(projectForStageUpdate.lifecycleStages) ? projectForStageUpdate.lifecycleStages : [];
        if (normalizedIndex >= lifecycleStages.length) {
            return {
                success: false,
                error: 'Stage index out of range',
                errorCode: 'INVALID_INPUT',
            };
        }

        let expectedUpdatedAtDate: Date | null = null;
        const expectedUpdatedAtRaw = options?.expectedUpdatedAt?.trim();
        if (expectedUpdatedAtRaw) {
            expectedUpdatedAtDate = new Date(expectedUpdatedAtRaw);
            if (Number.isNaN(expectedUpdatedAtDate.getTime())) {
                return {
                    success: false,
                    error: 'Invalid lifecycle version',
                    errorCode: 'INVALID_INPUT',
                };
            }
        }

        const whereClause = expectedUpdatedAtDate ? and(eq(projects.id, projectId), eq(projects.ownerId, user.id), eq(projects.updatedAt, expectedUpdatedAtDate)) : and(eq(projects.id, projectId), eq(projects.ownerId, user.id));

        const currentDates = (projectForStageUpdate?.stageCompletionDates || {}) as Record<string, string>;
        const updatedDates: Record<string, string> = {};

        for (const [key, val] of Object.entries(currentDates)) {
            const idx = parseInt(key, 10);
            if (idx < normalizedIndex) {
                updatedDates[key] = val;
            }
        }

        if (normalizedIndex > 0) {
            const prevIndexStr = String(normalizedIndex - 1);
            if (!updatedDates[prevIndexStr]) {
                updatedDates[prevIndexStr] = new Date().toISOString();
            }
        }

        const [updated] = await db
            .update(projects)
            .set({
                currentStageIndex: normalizedIndex,
                stageCompletionDates: updatedDates,
                updatedAt: new Date(),
            })
            .where(whereClause)
            .returning({
                currentStageIndex: projects.currentStageIndex,
                updatedAt: projects.updatedAt,
                slug: projects.slug,
                stageCompletionDates: projects.stageCompletionDates,
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
                return {
                    success: false,
                    error: 'Project not found',
                    errorCode: 'NOT_FOUND',
                };
            }
            if (current.ownerId !== user.id) {
                return {
                    success: false,
                    error: 'Only the project owner can advance the stage',
                    errorCode: 'FORBIDDEN',
                };
            }
            if (expectedUpdatedAtDate) {
                return {
                    success: false,
                    error: 'Project lifecycle changed. Refresh and retry.',
                    errorCode: 'PROJECT_CONFLICT',
                    latest: {
                        currentStageIndex: Math.max(0, current.currentStageIndex ?? 0),
                        updatedAt: current.updatedAt?.toISOString?.() ?? null,
                    },
                };
            }
            return {
                success: false,
                error: 'Failed to update project stage',
                errorCode: 'INTERNAL_ERROR',
            };
        }

        const slugOrId = updated.slug || projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${projectId}`);
        revalidatePath('/hub');

        return {
            success: true,
            currentStageIndex: Math.max(0, updated.currentStageIndex ?? normalizedIndex),
            updatedAt: updated.updatedAt?.toISOString?.() ?? null,
            stageCompletionDates: updated.stageCompletionDates as Record<string, string> | undefined,
        };
    } catch (error) {
        console.error('[updateProjectStageAction] Failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to update project stage',
            errorCode: 'INTERNAL_ERROR',
        };
    }
}

/**
 * Smart Lifecycle Update Action
 * Handles stage renames, reorders, additions, and deletions.
 * Uses "Smart Rebalance" logic to keep currentStageIndex pointing at the correct stage.
 */
export async function updateProjectLifecycleAction(projectId: string, newStages: string[], currentActiveStageName: string) {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error('Unauthorized');

        // Validate and sanitize stages
        const sanitizedStages = validateAndSanitizeLifecycleStages(newStages);

        // Get current index for Smart Rebalance calculation
        const { data: project, error: fetchError } = await supabase.from('projects').select('current_stage_index, slug').eq('id', projectId).eq('owner_id', user.id).single();

        if (fetchError || !project) {
            throw new Error('Project not found or access denied');
        }

        // SMART REBALANCE: Find the new index for the current stage
        let newIndex = sanitizedStages.findIndex((s) => s === currentActiveStageName);
        if (newIndex === -1) {
            // Stage was deleted - fallback to previous index or 0
            newIndex = Math.max(0, (project.current_stage_index || 0) - 1);
            // Clamp to max
            newIndex = Math.min(newIndex, sanitizedStages.length - 1);
        }

        // Use Supabase client directly for RLS-compliant update
        const { error } = await supabase
            .from('projects')
            .update({
                lifecycle_stages: sanitizedStages,
                current_stage_index: newIndex,
                updated_at: new Date().toISOString(),
            })
            .eq('id', projectId)
            .eq('owner_id', user.id);

        if (error) {
            console.error('Supabase update error:', error);
            throw new Error(error.message);
        }

        const slugOrId = project.slug || projectId;
        revalidatePath(`/projects/${slugOrId}`);
        revalidatePath(`/projects/${projectId}`);
        revalidatePath('/hub');

        return { success: true, newStageIndex: newIndex };
    } catch (error) {
        console.error('Failed to update project lifecycle:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to update project lifecycle',
        };
    }
}

export async function finalizeProjectAction(projectId: string): Promise<{ success: true; message: string } | { success: false; message: string; errorCode: ProjectSettingsErrorCode }> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
            return {
                success: false,
                errorCode: 'UNAUTHORIZED',
                message: 'You must be signed in.',
            };
        }

        const MAX_FINALIZE_TX_RETRIES = 3;
        const isSerializationRetryable = (error: unknown) => {
            const code = (error as { code?: string } | null)?.code;
            const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
            return (
                code === '40001' || // serialization_failure
                code === '40P01' || // deadlock_detected
                message.includes('could not serialize access') ||
                message.includes('serialization failure') ||
                message.includes('deadlock detected')
            );
        };

        let result: { success: true; message: string } | { success: false; message: string; errorCode: ProjectSettingsErrorCode } | null = null;

        for (let attempt = 1; attempt <= MAX_FINALIZE_TX_RETRIES; attempt += 1) {
            try {
                result = await db.transaction(async (tx) => {
                    // Ensure blocker checks and status mutation share the same serializable snapshot.
                    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`);

                    // 1. Verify Ownership
                    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for('update').limit(1);
                    if (!project) {
                        return {
                            success: false as const,
                            errorCode: 'NOT_FOUND' as const,
                            message: 'Project not found.',
                        };
                    }
                    if (project.ownerId !== user.id) {
                        return {
                            success: false as const,
                            errorCode: 'FORBIDDEN' as const,
                            message: 'Only the owner can finalize the project.',
                        };
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

                    const status = project.status === 'draft' || project.status === 'active' || project.status === 'completed' || project.status === 'archived' ? project.status : 'draft';
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
                        return {
                            success: false as const,
                            errorCode: 'INVALID_INPUT' as const,
                            message: 'Project is already completed.',
                        };
                    }
                    if (status === 'archived') {
                        return {
                            success: false as const,
                            errorCode: 'INVALID_INPUT' as const,
                            message: 'Archived projects cannot be finalized.',
                        };
                    }
                    if (finalizeBlockers.length > 0) {
                        return {
                            success: false as const,
                            errorCode: 'INVALID_INPUT' as const,
                            message: finalizeBlockers[0] ?? 'Project cannot be finalized yet.',
                        };
                    }

                    // 3. Finalize Project
                    await tx.update(projects).set({ status: 'completed', updatedAt: new Date() }).where(eq(projects.id, projectId));

                    // 4. Close open roles
                    await tx.delete(projectOpenRoles).where(eq(projectOpenRoles.projectId, projectId));

                    // 5. (Future) Distribute Reputation Points
                    // This would be a ledger insert

                    return {
                        success: true as const,
                        message: 'Project finalized successfully.',
                    };
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
        console.error('Failed to finalize project:', error);
        logger.metric('project.settings.finalize.result', {
            projectId,
            result: 'error',
            errorCode: 'INTERNAL_ERROR',
        });
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : 'Failed to finalize project.',
        };
    }
}

export async function getProjectSyncStatus(projectId: string) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    let access: Awaited<ReturnType<typeof assertProjectReadAccess>> | null = null;

    // Read access check (public projects are allowed)
    try {
        access = await assertProjectReadAccess(projectId, actorId);
    } catch (error) {
        return {
            success: false as const,
            error: error instanceof Error ? error.message : 'Unauthorized',
        };
    }

    try {
        return await runInFlightDeduped(`project:sync-status:${projectId}:${actorId ?? 'anon'}`, async () => {
            const [project] = await db
                .select({
                    syncStatus: projects.syncStatus,
                    importSource: projects.importSource,
                })
                .from(projects)
                .where(eq(projects.id, projectId));

            const meta = (project?.importSource as any)?.metadata;
            const rawError = meta?.lastError || null;
            const canSeeDetailedError = !!access?.canWrite;
            const lastError = rawError ? (canSeeDetailedError ? sanitizeGitErrorMessage(rawError) : 'Import failed. Project owner can retry the import.') : null;

            return {
                success: true as const,
                status: project?.syncStatus || 'ready',
                lastError,
            };
        });
    } catch (error) {
        console.error('Failed to get sync status', error);
        return { success: false as const, error: 'Failed' };
    }
}

export async function retryGithubImportAction(
    projectId: string,
    resolutions?: Record<string, "keep_local" | "overwrite_github"> | null,
) {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Unauthorized' };

    const {
        data: { session },
    } = await supabase.auth.getSession();

    try {
        const [project] = await db
            .select({
                ownerId: projects.ownerId,
                importSource: projects.importSource,
            })
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
            .set({
                syncStatus: 'pending',
                importSource: nextImportSource as any,
                updatedAt: new Date(),
            })
            .where(eq(projects.id, projectId));

        const enqueueBranch = normalizedBranch || accessCheck.defaultBranch || undefined;
        const retryEventId = `${buildGithubImportEventId(projectId, normalizedRepoUrl, enqueueBranch || null)}:retry:${Date.parse(retryAt)}`;
        const dispatchResult = await enqueueGithubImportOrRunInline({
            projectId,
            userId: user.id,
            importSource: {
                type: 'github',
                repoUrl: normalizedRepoUrl,
                branch: enqueueBranch,
                metadata: (clearSealedGithubTokenFromImportSource(nextImportSource) as Record<string, any>).metadata,
            },
            eventId: retryEventId,
            source: 'retry',
            resolutions,
        });

        if (!dispatchResult.success) {
            return { success: false, error: dispatchResult.error };
        }

        return { success: true };
    } catch (e: any) {
        const msg = sanitizeGitErrorMessage(typeof e?.message === 'string' ? e.message : 'Retry failed');
        try {
            const [project] = await db.select({ importSource: projects.importSource }).from(projects).where(eq(projects.id, projectId)).limit(1);
            const clearedSource = clearSealedGithubTokenFromImportSource(project?.importSource) as Record<string, any>;
            await db
                .update(projects)
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
            console.error('Failed to persist sync failure metadata after retry failure', updateError);
        }

        logger.metric('github.import.enqueue', {
            projectId,
            result: 'error',
            source: 'retry',
        });

        return { success: false, error: msg };
    }
}

export async function getProjectLiveStatsAction(projectId: string): Promise<{
    success: boolean;
    viewCount?: number;
    followersCount?: number;
    isFollowed?: boolean;
    error?: string;
}> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        const access = await getProjectAccessById(projectId, user?.id ?? null);
        if (!access.project || !access.canRead) {
            return { success: false, error: 'Project not found or access denied' };
        }

        const [row] = await db
            .select({
                viewCount: projects.viewCount,
                followersCount: projects.followersCount,
            })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        if (!row) {
            return { success: false, error: 'Project not found' };
        }

        let liveViewCount = Math.max(0, row.viewCount ?? 0);
        if (redis && process.env.PROJECT_VIEWS_WRITE_THROUGH !== '1') {
            const bufferedVal = await redis.hget('project:views', projectId);
            if (bufferedVal) {
                liveViewCount += parseInt(bufferedVal as any, 10) || 0;
            }
        }
        const followersCount = Math.max(0, row.followersCount ?? 0);

        let isFollowed = false;
        if (user) {
            const [followRow] = await db
                .select({ id: projectFollows.id })
                .from(projectFollows)
                .where(and(eq(projectFollows.userId, user.id), eq(projectFollows.projectId, projectId)))
                .limit(1);
            isFollowed = !!followRow;
        }

        return {
            success: true,
            viewCount: liveViewCount,
            followersCount,
            isFollowed,
        };
    } catch (error) {
        console.error('Failed to get live project stats', error);
        return { success: false, error: 'Failed to get live stats' };
    }
}
