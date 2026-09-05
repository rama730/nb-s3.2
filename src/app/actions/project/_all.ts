"use server";

import { db } from "@/lib/db";
import {
  projects,
  projectFollows,
  projectOpenRoles,
  roleApplications,
  conversations,
  conversationParticipants,
  messages,
  projectNodes,
  projectNodeEvents,
  projectMembers,
  profiles,
  tasks,
  projectSprints,
  projectSprintEvents,
  sprintTaskMemberships,
  projectWorkflowColumns,
  taskNodeLinks,
  taskSubtasks,
  taskComments,
  taskActivityEvents,
  tags,
  projectTags,
  fileVersions,
  messageWorkflowItems,
  messageWorkLinks,
  projectMarkdowns,
  projectMarkdownVersions,
  projectGuidanceAppointments,
  taskReadReceipts,
} from "@/lib/db/schema";
import {
  eq,
  and,
  or,
  sql,
  inArray,
  isNotNull,
  isNull,
  desc,
  ilike,
  gt,
  lte,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redis, getCachedData, cacheData } from "@/lib/redis";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { getViewerIdentityContext } from "@/lib/server/viewer-context";
import {
  CreateProjectInput,
  validateAndSanitizeLifecycleStages,
} from "@/lib/validations/project";
import { z } from "zod";
import { createHash, randomUUID } from "crypto";
import { generateSlug } from "@/lib/utils/slug";
import { generateProjectKey } from "@/lib/project-key";
import {
  computeProjectReadAccess,
  computeProjectWriteAccess,
  getProjectAccessById,
  getProjectAccessByIdentifier,
  type ProjectAccess,
} from "@/lib/data/project-access";
import {
  normalizeGithubBranch,
  normalizeGithubRepoUrl,
} from "@/lib/github/repo-validation";
import {
  clearSealedGithubTokenFromImportSource,
  sanitizeGitErrorMessage,
  sealGithubImportToken,
} from "@/lib/github/repo-security";
import { fetchRepoMeta, parseGithubRepo } from "@/lib/github/repo-preview";
import {
  buildGithubImportEventId,
  resolveGithubRepoAccess,
} from "@/lib/github/auth-resolver";
import {
  GITHUB_ACCOUNT_UNAVAILABLE_MESSAGE,
  GITHUB_CONNECTION_REQUIRED_MESSAGE,
  resolveGithubExternalAccountHealth,
} from "@/lib/github/account-health";
import { buildGithubAccountConnectionState } from "@/lib/github/connection-state";
import { runGithubProjectImport } from "@/lib/github/project-import-runner";
import { buildProjectImportEventId } from "@/lib/import/idempotency";
import {
  isProjectVisibility,
  normalizeProjectVisibility,
  type ProjectVisibility,
} from "@/lib/projects/project-visibility";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { runInFlightDeduped } from "@/lib/utils/inflight-dedupe";
import { toDateValue, toIsoString } from "@/lib/utils/date";
import { isLooseUuid } from "@/lib/validations/uuid";
import {
  createUploadIntent,
  finalizeUploadIntent,
} from "@/lib/upload/upload-intents";
import {
  normalizeAndValidateFileSize,
  normalizeAndValidateMimeType,
} from "@/lib/upload/security";
// Queue Imports
import { inngest } from "@/inngest/client";
import { getLifecycleStagesForProjectType } from "@/lib/projects/lifecycle-templates";
import {
  buildJourneyCompletionDates,
  normalizeJourneyCompletionDates,
} from "@/lib/projects/journey-completion";
import type { Project } from "@/types/hub";
import { logger } from "@/lib/logger";
import {
  markProjectCollaboratorsSummaryStale,
  upsertProfileProjectContributionFromMembership,
} from "@/lib/profile/collaboration";
import { buildProjectOwnerPresentation } from "@/lib/privacy/presentation";
import { resolvePrivacyRelationship } from "@/lib/privacy/resolver";
import { enqueueProjectNotificationEvent } from "@/lib/notifications/project-events";
import {
  buildDefaultProjectNotificationPolicy,
  normalizeProjectMemberNotificationOverrides,
  normalizeProjectNotificationPolicy,
  summarizeProjectNotificationPolicy,
  type ProjectMemberNotificationOverrides,
  type ProjectNotificationPolicy,
  type ProjectNotificationPreset,
} from "@/lib/notifications/project-policy";
import {
  canProjectRoleManageTarget,
  changeProjectMemberRoleInternal,
  isProjectMemberEligibleFor,
  readProjectMemberRemovalImpact,
  removeProjectMemberInternal,
  requireProjectCapability,
} from "@/lib/projects/collaborator-lifecycle";
import { queueCounterRefreshBestEffort } from "@/lib/workspace/counter-buffer";
import {
  createSprintSchema,
  deleteSprintSchema,
  parseSprintDateInput,
  updateSprintSchema,
  type CreateSprintInput,
  type DeleteSprintResult,
  type UpdateSprintInput,
} from "@/lib/projects/sprints";
import {
  buildSprintHealthSummary,
  buildSprintPermissionSet,
  type SprintDetailPayload,
  type SprintListItem,
  type SprintTaskTimelineEntity,
} from "@/lib/projects/sprint-detail";
import {
  buildSprintTimeline,
  type SprintTimelineTaskInput,
} from "@/lib/projects/sprint-timeline";
import {
  inferTaskFileRole,
  replaceTaskFileRoleTag,
} from "@/lib/projects/task-file-intelligence";
import { recordSprintMetric } from "@/lib/projects/sprint-observability";
import { normalizeTaskSurfaceRecord } from "@/lib/projects/task-presentation";
import {
  createTaskSchema as baseCreateTaskSchema,
  taskSubtaskTitleSchema,
} from "@/lib/validations/task";
import { invalidatePublicProjectsFeedCache } from "@/lib/projects/public-feed-service";
import {
  buildProjectAccessTransitionPolicy,
  canProjectMemberUploadFiles,
  isProjectTabVisibleToViewer,
  normalizeProjectPublicTabVisibility,
  type ProjectPublicTabVisibility,
} from "@/lib/projects/settings-policies";
import {
  buildProjectAnalyticsMemberDetail,
  buildProjectAnalyticsMemberSummaries,
  buildProjectAnalyticsOverview,
  buildProjectAnalyticsTimeline,
  filterProjectAnalyticsDatasetByContext,
  normalizeProjectAnalyticsContext,
  PROJECT_ANALYTICS_DATASET_LIMITS,
  resolveProjectAnalyticsAccess,
  type BuildProjectAnalyticsInput,
  type ProjectAnalyticsContextFilters,
  type ProjectAnalyticsTimelineFilters,
} from "@/lib/projects/analytics";
import { syncProjectSkills, syncRoleSkills } from "@/lib/skills/service";
import {
  containsLikePattern,
  escapeLikePattern,
  normalizeSearchQuery,
  tokenizeSearchQuery,
} from "@/lib/search/query";
import { recordGlobalSearchMetric } from "@/lib/search/observability";
import {
  areProjectSocialLinksEqual,
  filterProjectLinksForAudience,
  normalizeProjectSocialLinks,
  PROJECT_LINK_PURPOSE_LABELS,
  resolveProjectSocialLinks,
  splitProjectSocialLinks,
  validateProjectSocialLinks,
} from "@/lib/projects/social-links";
import { isMissingRelationError } from "@/lib/db/errors";

const isMissingColumn = (error: unknown, column: string) => {
  const msg = error instanceof Error ? error.message : String(error);
  const lowered = msg.toLowerCase();
  return (
    lowered.includes(column.toLowerCase()) &&
    (lowered.includes("column") ||
      lowered.includes("failed query") ||
      lowered.includes("does not exist"))
  );
};

const isMissingCounterColumn = (error: unknown, column: string) =>
  isMissingColumn(error, column);
const isMissingTable = isMissingRelationError;

const PROJECT_COVER_UPLOAD_BUCKET = "project-files";
const LEGACY_PROJECT_COVER_UPLOAD_BUCKET = "avatars";
const PROJECT_COVER_UPLOAD_MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_PROJECT_COVER_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const PROJECT_IMAGE_STORAGE_FOLDERS = [
  "project-images",
  "project-covers",
] as const;
const PROJECT_IMAGE_PROXY_ROUTE_PREFIX = "/api/v1/projects";
const PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG = "public-project-detail-shell";
const PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG =
  "public-project-detail-metadata";

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
  if (value === undefined || value === null || value === "") return "public";
  if (isProjectVisibility(value)) return value;
  throw new Error("Invalid project visibility.");
}

function projectCoverExtensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

async function assertProjectOwnerForSettings(
  projectId: string,
  userId: string,
) {
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

  if (!project) throw new Error("Project not found");
  if (project.ownerId !== userId) throw new Error("Unauthorized");
  return project;
}

function buildProjectImageRoute(projectId: string, storageKey: string) {
  const version = createHash("sha256").update(storageKey).digest("base64url").slice(0, 16);
  return `${PROJECT_IMAGE_PROXY_ROUTE_PREFIX}/${projectId}/image?v=${version}`;
}

function projectCoverStorageKeyFromPublicUrl(
  value: string | null | undefined,
  userId: string,
  projectId: string,
  bucket = PROJECT_COVER_UPLOAD_BUCKET,
) {
  if (!value) return null;

  let pathname = "";
  try {
    pathname = decodeURIComponent(new URL(value).pathname);
  } catch {
    return null;
  }

  const markers = [
    `/object/public/${bucket}/`,
    `/render/image/public/${bucket}/`,
  ];
  const marker = markers.find((candidate) => pathname.includes(candidate));
  if (!marker) return null;

  const storageKey = pathname
    .slice(pathname.indexOf(marker) + marker.length)
    .replace(/^\/+/, "");
  const expectedPrefixes = PROJECT_IMAGE_STORAGE_FOLDERS.map(
    (folder) => `${userId}/${folder}/${projectId}/`,
  );
  expectedPrefixes.push(`projects/${projectId}/project-images/`);
  return expectedPrefixes.some((prefix) => storageKey.startsWith(prefix))
    ? storageKey
    : null;
}

async function cleanupProjectCoverImages(params: {
  userId: string;
  projectId: string;
  keepStorageKey?: string | null;
  keepBucket?: string | null;
  previousBucket?: string | null;
  previousStorageKey?: string | null;
  previousCoverImage?: string | null;
}) {
  try {
    const admin = await createAdminClient();
    const keepBucket = params.keepBucket ?? PROJECT_COVER_UPLOAD_BUCKET;
    const staleKeysByBucket = new Map<string, Set<string>>();
    const addStale = (bucket: string, key: string | null | undefined) => {
      if (!key || (bucket === keepBucket && key === params.keepStorageKey))
        return;
      const existing = staleKeysByBucket.get(bucket) ?? new Set<string>();
      existing.add(key);
      staleKeysByBucket.set(bucket, existing);
    };

    addStale(
      params.previousBucket ?? PROJECT_COVER_UPLOAD_BUCKET,
      params.previousStorageKey,
    );
    addStale(
      PROJECT_COVER_UPLOAD_BUCKET,
      projectCoverStorageKeyFromPublicUrl(
        params.previousCoverImage,
        params.userId,
        params.projectId,
        PROJECT_COVER_UPLOAD_BUCKET,
      ),
    );
    addStale(
      LEGACY_PROJECT_COVER_UPLOAD_BUCKET,
      projectCoverStorageKeyFromPublicUrl(
        params.previousCoverImage,
        params.userId,
        params.projectId,
        LEGACY_PROJECT_COVER_UPLOAD_BUCKET,
      ),
    );

    const foldersByBucket = new Map<string, string[]>([
      [
        PROJECT_COVER_UPLOAD_BUCKET,
        [`projects/${params.projectId}/project-images/${params.userId}`],
      ],
      [
        LEGACY_PROJECT_COVER_UPLOAD_BUCKET,
        PROJECT_IMAGE_STORAGE_FOLDERS.map(
          (folder) => `${params.userId}/${folder}/${params.projectId}`,
        ),
      ],
    ]);

    const pageSize = 100;
    for (const [bucket, folders] of foldersByBucket) {
      for (const folder of folders) {
        let offset = 0;
        while (true) {
          const { data: existingObjects, error: listError } =
            await admin.storage
              .from(bucket)
              .list(folder, { limit: pageSize, offset });

          if (listError) {
            logger.warn("project.cover_cleanup_list_failed", {
              module: "projects",
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
      const { data: removed, error: removeError } = await admin.storage
        .from(bucket)
        .remove(Array.from(keys));

      if (removeError) {
        logger.error("project.cover_cleanup_failed", {
          module: "projects",
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
    logger.error("project.cover_cleanup_unexpected_failed", {
      module: "projects",
      projectId: params.projectId,
      userId: params.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { removed: 0, error: "Cleanup failed" };
  }
}

async function migrateLegacyProjectImageToManagedStorage(params: {
  projectId: string;
  userId: string;
  coverImage: string | null;
  coverImageBucket?: string | null;
  coverImageKey?: string | null;
}) {
  if (params.coverImageBucket && params.coverImageKey) {
    return {
      bucket: params.coverImageBucket,
      key: params.coverImageKey,
      url: buildProjectImageRoute(params.projectId, params.coverImageKey),
      migrated: false,
    };
  }

  const legacyKey =
    projectCoverStorageKeyFromPublicUrl(
      params.coverImage,
      params.userId,
      params.projectId,
      LEGACY_PROJECT_COVER_UPLOAD_BUCKET,
    ) ??
    projectCoverStorageKeyFromPublicUrl(
      params.coverImage,
      params.userId,
      params.projectId,
      PROJECT_COVER_UPLOAD_BUCKET,
    );
  const legacyBucket = projectCoverStorageKeyFromPublicUrl(
    params.coverImage,
    params.userId,
    params.projectId,
    LEGACY_PROJECT_COVER_UPLOAD_BUCKET,
  )
    ? LEGACY_PROJECT_COVER_UPLOAD_BUCKET
    : legacyKey
      ? PROJECT_COVER_UPLOAD_BUCKET
      : null;
  if (!legacyKey || !legacyBucket) return null;

  const extension = legacyKey.split(".").pop()?.toLowerCase() || "bin";
  const nextKey = `projects/${params.projectId}/project-images/${params.userId}/${Date.now()}-${randomUUID()}.${extension}`;
  const admin = await createAdminClient();
  const { data: file, error: downloadError } = await admin.storage
    .from(legacyBucket)
    .download(legacyKey);
  if (downloadError || !file) {
    logger.warn("project.cover_migration_download_failed", {
      module: "projects",
      projectId: params.projectId,
      userId: params.userId,
      bucket: legacyBucket,
      error: downloadError?.message || "Missing file",
    });
    return null;
  }

  const { error: uploadError } = await admin.storage
    .from(PROJECT_COVER_UPLOAD_BUCKET)
    .upload(nextKey, file, {
      upsert: false,
      contentType: file.type || undefined,
      cacheControl: "31536000",
    });
  if (uploadError) {
    logger.warn("project.cover_migration_upload_failed", {
      module: "projects",
      projectId: params.projectId,
      userId: params.userId,
      error: uploadError.message,
    });
    return null;
  }

  return {
    bucket: PROJECT_COVER_UPLOAD_BUCKET,
    key: nextKey,
    url: buildProjectImageRoute(params.projectId, nextKey),
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
    console.error("Failed to invalidate public feed cache:", err);
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/hub");
  // Next.js 16's cache API requires an explicit cache-life profile for tag revalidation.
  revalidateTag(PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG, "max");
  revalidateTag(PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG, "max");
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

export async function invalidateProjectPublicCaches(projectId: string) {
  const feed = await invalidatePublicProjectsFeedCache(projectId);
  revalidatePath("/hub");
  revalidateTag(PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG, "max");
  revalidateTag(PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG, "max");
  return feed;
}

function buildAccessConfirmationToken(input: {
  projectId: string;
  previousVisibility: ProjectVisibility;
  nextVisibility: ProjectVisibility;
  membersCount: number;
  followersCount: number;
  openRolesCount: number;
  pendingApplicationsCount: number;
  activeTasksCount: number;
  hasManagedProjectImage: boolean;
}) {
  return createHash("sha256")
    .update(
      [
        input.projectId,
        input.previousVisibility,
        input.nextVisibility,
        input.membersCount,
        input.followersCount,
        input.openRolesCount,
        input.pendingApplicationsCount,
        input.activeTasksCount,
        input.hasManagedProjectImage ? "image:managed" : "image:none-or-legacy",
      ].join(":"),
    )
    .digest("hex");
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
  type: "github" | "upload" | "scratch";
  repoUrl?: string;
  branch?: string;
  s3Key?: string;
  metadata?: Record<string, any>;
};

type GithubImportDispatchSource = "create" | "retry";

function shouldRunGithubImportInlineFallback(_error: unknown): boolean {
  const override =
    process.env.GITHUB_IMPORT_INLINE_FALLBACK?.trim().toLowerCase();
  // Allow explicitly opting into inline fallback via env var
  if (override === "always" || override === "true") return true;

  // In development, we always want a simple and synchronous logic flow
  // without depending on the complex external Inngest background queue.
  if (process.env.NODE_ENV !== "production") return true;

  // In production, rely on the Inngest worker.
  return false;
}

async function persistGithubImportQueueFailure(input: {
  projectId: string;
  importSource: ImportSourcePayload;
  message: string;
}) {
  const clearedImportSource = clearSealedGithubTokenFromImportSource(
    input.importSource,
  ) as Record<string, any>;
  const nextImportSource = {
    ...clearedImportSource,
    metadata: {
      ...((clearedImportSource as any)?.metadata || {}),
      lastError: input.message,
      syncPhase: "failed",
    },
  };

  await db
    .update(projects)
    .set({
      syncStatus: "failed",
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
}): Promise<
  | { success: true; mode: "queued" | "inline" }
  | { success: false; error: string }
> {
  const queueImportSource = clearSealedGithubTokenFromImportSource(
    input.importSource,
  ) as ImportSourcePayload;
  const githubImportSource = {
    type: "github" as const,
    repoUrl: queueImportSource.repoUrl!,
    branch: queueImportSource.branch,
    metadata: queueImportSource.metadata,
  };

  // In development mode, completely bypass the external queue and run inline immediately
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.GITHUB_IMPORT_INLINE_FALLBACK?.trim().toLowerCase() === "always"
  ) {
    try {
      await runGithubProjectImport({
        projectId: input.projectId,
        importSource: githubImportSource,
        userId: input.userId,
        importEventId: input.eventId,
        queueAgeMs: 0,
        resolutions: input.resolutions,
      });
      logger.metric("github.import.enqueue", {
        projectId: input.projectId,
        userId: input.userId,
        result: "inline_dev",
        eventId: input.eventId,
        source: input.source,
      });
      return { success: true, mode: "inline" };
    } catch (inlineError) {
      const inlineMsg = sanitizeGitErrorMessage(
        inlineError instanceof Error
          ? inlineError.message
          : "GitHub import failed",
      );
      logger.metric("github.import.enqueue", {
        projectId: input.projectId,
        userId: input.userId,
        result: "inline_error",
        eventId: input.eventId,
        source: input.source,
      });
      return { success: false, error: inlineMsg };
    }
  }

  try {
    await inngest.send({
      name: "project/import",
      id: input.eventId,
      data: {
        projectId: input.projectId,
        importSource: githubImportSource,
        userId: input.userId,
        resolutions: input.resolutions,
      },
    });
    logger.metric("github.import.enqueue", {
      projectId: input.projectId,
      userId: input.userId,
      result: "success",
      eventId: input.eventId,
      source: input.source,
    });
    return { success: true, mode: "queued" };
  } catch (queueError) {
    const msg = sanitizeGitErrorMessage(
      queueError instanceof Error
        ? queueError.message
        : "Failed to enqueue GitHub import",
    );
    console.error("[Action] Failed to add GitHub import to queue", msg);

    if (shouldRunGithubImportInlineFallback(queueError)) {
      logger.metric("github.import.enqueue", {
        projectId: input.projectId,
        userId: input.userId,
        result: "inline_fallback",
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
        return { success: true, mode: "inline" };
      } catch (inlineError) {
        const inlineMsg = sanitizeGitErrorMessage(
          inlineError instanceof Error
            ? inlineError.message
            : "GitHub import failed",
        );
        logger.metric("github.import.enqueue", {
          projectId: input.projectId,
          userId: input.userId,
          result: "inline_error",
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
    logger.metric("github.import.enqueue", {
      projectId: input.projectId,
      userId: input.userId,
      result: "error",
      eventId: input.eventId,
      source: input.source,
    });
    return { success: false, error: msg };
  }
}

function normalizeImportSourceForPersist(
  importSource: CreateProjectInput["import_source"] | undefined,
  gitHubToken?: string | null,
):
  | { ok: true; value: ImportSourcePayload | null }
  | { ok: false; error: string } {
  if (!importSource) return { ok: true, value: null };
  if (importSource.type !== "github") {
    return { ok: true, value: importSource as ImportSourcePayload };
  }

  const repoUrl = normalizeGithubRepoUrl(importSource.repoUrl || "");
  if (!repoUrl) {
    return {
      ok: false,
      error: "Invalid GitHub repository URL. Use https://github.com/owner/repo",
    };
  }

  const branch = normalizeGithubBranch(importSource.branch);
  if (importSource.branch && !branch) {
    return { ok: false, error: "Invalid GitHub branch name." };
  }

  const metadata = {
    ...(((clearSealedGithubTokenFromImportSource(importSource) as any)
      ?.metadata || {}) as Record<string, any>),
  };
  if (gitHubToken) {
    const sealed = sealGithubImportToken(gitHubToken);
    if (sealed) metadata.importAuth = sealed;
  }

  const normalized: ImportSourcePayload = {
    ...importSource,
    type: "github",
    repoUrl,
    branch,
    metadata,
  };
  return { ok: true, value: normalized };
}

function withLeadFocusMetadata(
  importSource: ImportSourcePayload | null,
  creatorRole: CreateProjectInput["creator_role"],
): ImportSourcePayload | null {
  const leadFocus = (creatorRole?.title || "").trim();
  if (!importSource && !leadFocus) {
    return null;
  }

  const base: ImportSourcePayload = importSource || { type: "scratch" };
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
    accountLinked?: boolean;
    accountUnavailable?: boolean;
  } = {},
): Promise<
  | {
      ok: true;
      installationId: number | null;
      authSource: "app" | "oauth" | "sealed" | "none";
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
      error: "Invalid GitHub repository URL. Use https://github.com/owner/repo",
    };
  }

  try {
    const access = await resolveGithubRepoAccess({
      repoUrl,
      oauthToken: options.oauthToken || null,
      preferredInstallationId: options.preferredInstallationId ?? null,
      sealedImportToken: options.sealedImportToken,
    });

    const accountCannotAuthorize =
      access.source !== "app" &&
      (options.accountUnavailable || options.accountLinked === false);
    let meta;
    try {
      meta = await fetchRepoMeta({
        ...parsed,
        token: accountCannotAuthorize ? undefined : access.token || undefined,
      });
    } catch (error) {
      if (accountCannotAuthorize) {
        return {
          ok: false,
          error: options.accountUnavailable
            ? GITHUB_ACCOUNT_UNAVAILABLE_MESSAGE
            : GITHUB_CONNECTION_REQUIRED_MESSAGE,
        };
      }
      throw error;
    }
    const isPrivate = meta.isPrivate === true;
    if (isPrivate && !access.token) {
      return {
        ok: false,
        error: "GitHub access expired. Reconnect GitHub and retry import.",
      };
    }
    return {
      ok: true,
      installationId: access.installationId,
      authSource: accountCannotAuthorize ? "none" : access.source,
      defaultBranch: meta.defaultBranch,
      isPrivate: meta.isPrivate,
      repoId: meta.repoId,
    };
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "";
    if (
      !(options.oauthToken || options.sealedImportToken) &&
      msg.includes("404")
    ) {
      return {
        ok: false,
        error:
          "Repository not found or private. Connect GitHub and verify repository access.",
      };
    }
    return {
      ok: false,
      error: sanitizeGitErrorMessage(
        msg || "Unable to validate repository access",
      ),
    };
  }
}

async function assertProjectReadAccess(
  projectId: string,
  userId: string | null,
) {
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

const projectDetailMemberRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "viewer",
]);
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

const projectDetailGuidanceSchema = z.object({
  id: z.string().uuid(),
  guideUserId: z.string().uuid(),
  label: z.string().min(1),
  reviewAt: z.date().nullable(),
  publicAttributionConsent: z.boolean(),
  fullName: z.string().nullable(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
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
  externalLinks: z.union([
    z.record(z.string(), z.string()),
    z.array(
      z.object({
        id: z.string(),
        url: z.string(),
        platform: z.string().optional(),
        label: z.string().optional(),
        destinationLabel: z.string().optional(),
        purpose: z.enum(["live-product", "source-code", "documentation", "design-prototype", "research-publication", "dataset-model", "demo-media", "community", "distribution-store", "roadmap-operations", "support-contact", "commerce-funding", "other"]).optional(),
        audience: z.enum(["public", "members"]).optional(),
        order: z.number().optional(),
      }),
    ),
  ]),
  externalLinkMetadata: z.record(
    z.string(),
    z.object({
      health: z.enum(["unknown", "active", "unavailable"]),
      checkedAt: z.string().optional(),
      nameSource: z.enum(["provider", "open_graph", "html_title", "url", "manual"]).optional(),
      fetchedAt: z.string().optional(),
      resolvedHost: z.string().optional(),
      contentType: z.string().optional(),
    }),
  ),
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
  status: z.enum(["draft", "active", "completed", "archived"]),
  lifecycleStages: z.array(z.string()),
  currentStageIndex: z.number().int().nonnegative(),
  stageCompletionDates: z.record(z.string(), z.string()),
  importSource: z.unknown().nullable(),
  githubRepoUrl: z.string().nullable().optional(),
  githubDefaultBranch: z.string().nullable().optional(),
  syncStatus: z.enum(["pending", "cloning", "indexing", "ready", "failed"]),
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
  guidance: projectDetailGuidanceSchema.nullable(),
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
      errorCode: "INVALID_INPUT" | "NOT_FOUND" | "FORBIDDEN" | "INTERNAL_ERROR";
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

function isProjectDetailMemberRole(
  value: unknown,
): value is "owner" | "admin" | "member" | "viewer" {
  return (
    value === "owner" ||
    value === "admin" ||
    value === "member" ||
    value === "viewer"
  );
}

const PROJECT_DETAIL_TRANSIENT_DB_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);
const PROJECT_DETAIL_READ_RETRY_DELAYS_MS = [150, 450] as const;

function readErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
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
    normalizedMessage.includes("getaddrinfo") ||
    normalizedMessage.includes("connection terminated") ||
    normalizedMessage.includes("connection timeout") ||
    normalizedMessage.includes("connect timeout")
  ) {
    return true;
  }

  if (error && typeof error === "object" && "cause" in error) {
    return isTransientProjectDetailReadError(
      (error as { cause?: unknown }).cause,
      depth + 1,
    );
  }

  return false;
}

async function retryProjectDetailRead<T>(
  operation: string,
  read: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (
    let attempt = 0;
    attempt <= PROJECT_DETAIL_READ_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      const retryDelayMs = PROJECT_DETAIL_READ_RETRY_DELAYS_MS[attempt];
      if (
        retryDelayMs === undefined ||
        !isTransientProjectDetailReadError(error)
      ) {
        throw error;
      }

      logger.warn("project_detail.read_retry", {
        operation,
        attempt: attempt + 1,
        retryDelayMs,
        errorCode:
          readErrorCode(error) ??
          readErrorCode((error as { cause?: unknown } | null)?.cause) ??
          null,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw lastError;
}

async function resolveProjectDetailTarget(
  slugOrId: string,
  actorUserId: string | null = null,
) {
  const trimmed = slugOrId.trim();
  const isUuid = isLooseUuid(trimmed);
  const where = isUuid
    ? and(
        isNull(projects.deletedAt),
        or(eq(projects.slug, trimmed), eq(projects.id, trimmed)),
      )
    : and(isNull(projects.deletedAt), eq(projects.slug, trimmed));

  const project = await retryProjectDetailRead(
    "resolve_project_detail_target",
    async () => {
      const ownerProfiles = alias(profiles, "project_detail_owner_profiles");
      const q = db
        .select({
          id: projects.id,
          ownerId: projects.ownerId,
          ownerUsername: ownerProfiles.username,
          ownerFullName: ownerProfiles.fullName,
          ownerAvatarUrl: ownerProfiles.avatarUrl,
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
          externalLinks: projects.externalLinks,
          externalLinkMetadata: projects.externalLinkMetadata,
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
          memberRole: actorUserId
            ? projectMembers.role
            : sql<string | null>`NULL`,
          isFollowed: actorUserId
            ? sql<boolean>`${projectFollows.id} IS NOT NULL`
            : sql<boolean>`false`,
        })
        .from(projects)
        .leftJoin(ownerProfiles, eq(projects.ownerId, ownerProfiles.id));

      if (actorUserId) {
        q.leftJoin(
          projectMembers,
          and(
            eq(projectMembers.projectId, projects.id),
            eq(projectMembers.userId, actorUserId),
          ),
        ).leftJoin(
          projectFollows,
          and(
            eq(projectFollows.projectId, projects.id),
            eq(projectFollows.userId, actorUserId),
          ),
        );
      }

      const [row] = await q.where(where).limit(1);
      if (!row) return null;
      return {
        ...row,
        owner: row.ownerId
          ? {
              id: row.ownerId,
              username: row.ownerUsername ?? null,
              fullName: row.ownerFullName ?? null,
              avatarUrl: row.ownerAvatarUrl ?? null,
            }
          : null,
      };
    },
  );

  return project ?? null;
}

// resolveProjectDetailMetadataTarget was deleted in favor of resolveProjectDetailTarget to eliminate code duplication under Ponytail standards.

function resolveProjectDetailViewerState(input: {
  projectId: string;
  ownerId: string;
  visibility: string | null;
  status: string | null;
  actorUserId: string | null;
  memberRoleRaw: string | null;
  isFollowed: boolean;
}) {
  const {
    ownerId,
    visibility,
    status,
    actorUserId,
    memberRoleRaw,
    isFollowed,
  } = input;
  const isOwner = !!actorUserId && actorUserId === ownerId;
  const memberRole = isProjectDetailMemberRole(memberRoleRaw)
    ? memberRoleRaw
    : null;
  const isMember = !isOwner && !!memberRole;
  const canRead = computeProjectReadAccess(
    visibility,
    status,
    isOwner,
    isMember,
  );
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

async function fetchProjectDetailShellData(
  projectId: string,
  ownerId: string,
  includeFollowersCount: boolean,
  viewerId: string | null,
  projectVisibility: string,
  canSeePrivateAttribution: boolean,
  prefetchedOwner?: {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
  } | null,
) {
  const startedAt = performance.now();
  const ownerQuery =
    prefetchedOwner !== undefined
      ? Promise.resolve(prefetchedOwner ? [prefetchedOwner] : [])
      : db
          .select({
            id: profiles.id,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
          })
          .from(profiles)
          .where(eq(profiles.id, ownerId))
          .limit(1);

  const [ownerRows, followersResult, membersResult, rolesResult, readmeRows, guidanceRows] =
    await Promise.all([
      ownerQuery,
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
          totalCount: sql<number>`count(*) over ()::int`,
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
          totalCount: sql<number>`count(*) over ()::int`,
        })
        .from(projectOpenRoles)
        .where(eq(projectOpenRoles.projectId, projectId))
        .orderBy(
          desc(projectOpenRoles.updatedAt),
          desc(projectOpenRoles.createdAt),
          desc(projectOpenRoles.id),
        )
        .limit(PROJECT_DETAIL_OPEN_ROLES_PAGE_SIZE + 1),
      db
        .select({
          publishedVersionId: projectMarkdowns.publishedVersionId,
          versionNumber: projectMarkdownVersions.versionNumber,
          excerpt: projectMarkdownVersions.excerpt,
          createdAt: projectMarkdownVersions.createdAt,
        })
        .from(projectMarkdowns)
        .leftJoin(
          projectMarkdownVersions,
          eq(projectMarkdowns.publishedVersionId, projectMarkdownVersions.id),
        )
        .where(
          and(
            eq(projectMarkdowns.projectId, projectId),
            eq(projectMarkdowns.slug, "readme"),
          ),
        )
        .limit(1),
      db
        .select({
          id: projectGuidanceAppointments.id,
          guideUserId: projectGuidanceAppointments.guideUserId,
          label: projectGuidanceAppointments.label,
          reviewAt: projectGuidanceAppointments.reviewAt,
          publicAttributionConsent:
            projectGuidanceAppointments.publicAttributionConsent,
          fullName: profiles.fullName,
          username: profiles.username,
          avatarUrl: profiles.avatarUrl,
        })
        .from(projectGuidanceAppointments)
        .innerJoin(
          profiles,
          eq(profiles.id, projectGuidanceAppointments.guideUserId),
        )
        .where(
          and(
            eq(projectGuidanceAppointments.projectId, projectId),
            eq(projectGuidanceAppointments.status, "active"),
          ),
        )
        .limit(1),
    ]);

  const followersCount = includeFollowersCount
    ? Number((followersResult[0] as { count?: number } | undefined)?.count || 0)
    : undefined;

  const openRolesHasMore = rolesResult.length > PROJECT_DETAIL_OPEN_ROLES_PAGE_SIZE;
  const openRolesCount = Number(rolesResult[0]?.totalCount ?? 0);
  const openRoles = rolesResult.slice(0, PROJECT_DETAIL_OPEN_ROLES_PAGE_SIZE).map(
    ({ totalCount: _totalCount, ...role }) => role,
  );

  const hasMoreMembers = membersResult.length > PROJECT_DETAIL_MEMBER_PAGE_SIZE;
  const membersCount = Number(membersResult[0]?.totalCount ?? 0);
  const limitedMembers = membersResult.slice(
    0,
    PROJECT_DETAIL_MEMBER_PAGE_SIZE,
  );
  const lastMember = limitedMembers[limitedMembers.length - 1];
  const membersNextCursor =
    hasMoreMembers && lastMember
      ? Buffer.from(
          `${lastMember.joinedAt.toISOString()}:::${lastMember.membershipId}`,
        ).toString("base64")
      : null;

  const collaborators = limitedMembers
    .map((m) => ({
      userId: m.userId,
      membershipRole: isProjectDetailMemberRole(m.membershipRole)
        ? m.membershipRole
        : "member",
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
  const ownerRow = ownerRows[0];
  const [acceptedRoleRows, ownerRelationship] = await Promise.all([
    collaboratorIds.length > 0
      ? db
          .select({
            applicantId: roleApplications.applicantId,
            roleTitle: projectOpenRoles.title,
            roleName: projectOpenRoles.role,
            updatedAt: roleApplications.updatedAt,
          })
          .from(roleApplications)
          .leftJoin(
            projectOpenRoles,
            eq(projectOpenRoles.id, roleApplications.roleId),
          )
          .where(
            and(
              eq(roleApplications.projectId, projectId),
              eq(roleApplications.status, "accepted"),
              inArray(roleApplications.applicantId, collaboratorIds),
            ),
          )
          .orderBy(desc(roleApplications.updatedAt))
      : Promise.resolve([]),
    ownerRow ? resolvePrivacyRelationship(viewerId, ownerRow.id) : Promise.resolve(null),
  ]);

  const acceptedRoleByUser = new Map<string, string>();
  for (const row of acceptedRoleRows) {
    if (acceptedRoleByUser.has(row.applicantId)) continue;
    const label = row.roleTitle || row.roleName || "";
    if (label) acceptedRoleByUser.set(row.applicantId, label);
  }

  const collaboratorsWithRoleTitle = collaborators.map((c) => ({
    ...c,
    projectRoleTitle: acceptedRoleByUser.get(c.userId) || null,
  }));

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
  const guidanceCandidate = guidanceRows[0] ?? null;
  const guidance =
    guidanceCandidate &&
    (canSeePrivateAttribution ||
      (guidanceCandidate.publicAttributionConsent &&
        projectVisibility === "public"))
      ? guidanceCandidate
      : null;
  if (owner?.isMasked) {
    logger.metric("privacy.project.owner_masked", {
      surface: "project_detail",
      viewerId: viewerId ?? "anon",
      ownerId,
      projectId,
    });
  }

  logger.metric("project.detail.shell.data", {
    projectId,
    durationMs: Math.round(performance.now() - startedAt),
  });

  return {
    owner,
    followersCount,
    openRoles,
    openRolesCount,
    openRolesHasMore,
    collaborators: collaboratorsWithRoleTitle,
    membersCount,
    membersHasMore: hasMoreMembers,
    membersNextCursor,
    hasPublishedReadme: Boolean(readmeRows[0]?.publishedVersionId),
    readmeExcerpt: readmeRows[0]?.excerpt ?? null,
    readmeUpdatedAt: readmeRows[0]?.createdAt?.toISOString?.() ?? null,
    readmeVersionNumber: readmeRows[0]?.versionNumber ?? null,
    guidance,
  };
}

const getPublicProjectDetailShellData = unstable_cache(
  async (projectId: string, ownerId: string, includeFollowersCount: boolean) =>
    retryProjectDetailRead("public_project_detail_shell_data", () =>
      fetchProjectDetailShellData(
        projectId,
        ownerId,
        includeFollowersCount,
        null,
        "public",
        false,
      ),
    ),
  [PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG],
  { revalidate: 60, tags: [PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG] },
);

const getPublicProjectDetailMetadata = unstable_cache(
  async (slugOrId: string): Promise<ProjectDetailMetadataRead | null> => {
    const project = await resolveProjectDetailTarget(slugOrId);
    if (!project) return null;

    const canRead = computeProjectReadAccess(
      project.visibility,
      project.status,
      false,
      false,
    );
    if (!canRead) return null;
    const readmeVisible = normalizeProjectPublicTabVisibility(
      project.publicTabVisibility,
    ).readme;
    const readme = readmeVisible
      ? await retryProjectDetailRead(
          "public_project_detail_metadata_readme",
          () =>
            db
              .select({ excerpt: projectMarkdownVersions.excerpt })
              .from(projectMarkdowns)
              .leftJoin(
                projectMarkdownVersions,
                eq(
                  projectMarkdowns.publishedVersionId,
                  projectMarkdownVersions.id,
                ),
              )
              .where(
                and(
                  eq(projectMarkdowns.projectId, project.id),
                  eq(projectMarkdowns.slug, "readme"),
                ),
              )
              .limit(1),
        )
      : [];

    return {
      projectId: project.id,
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

export async function readProjectDetailMetadata(input: {
  slugOrId: string;
  actorUserId?: string | null;
}): Promise<
  | { success: true; data: ProjectDetailMetadataRead }
  | {
      success: false;
      errorCode: "INVALID_INPUT" | "NOT_FOUND" | "FORBIDDEN" | "INTERNAL_ERROR";
      message: string;
    }
> {
  const parsedInput = projectDetailInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return {
      success: false,
      errorCode: "INVALID_INPUT",
      message: "Invalid project detail request.",
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

    const project = await resolveProjectDetailTarget(trimmed, actorUserId);
    if (!project) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project not found.",
      };
    }

    const viewerState = resolveProjectDetailViewerState({
      projectId: project.id,
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
        errorCode: "FORBIDDEN",
        message: "Forbidden",
      };
    }
    const readmeVisible =
      viewerState.isOwner ||
      viewerState.isMember ||
      normalizeProjectPublicTabVisibility(project.publicTabVisibility).readme;
    const readme = readmeVisible
      ? await retryProjectDetailRead("project_detail_metadata_readme", () =>
          db
            .select({ excerpt: projectMarkdownVersions.excerpt })
            .from(projectMarkdowns)
            .leftJoin(
              projectMarkdownVersions,
              eq(
                projectMarkdowns.publishedVersionId,
                projectMarkdownVersions.id,
              ),
            )
            .where(
              and(
                eq(projectMarkdowns.projectId, project.id),
                eq(projectMarkdowns.slug, "readme"),
              ),
            )
            .limit(1),
        )
      : [];

    return {
      success: true,
      data: {
        projectId: project.id,
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
    console.error("[readProjectDetailMetadata] failed", error);
    const message = error instanceof Error ? error.message : String(error);
    const normalizedMessage = message.trim().toLowerCase();
    const isAuthorizationError =
      normalizedMessage === "forbidden" ||
      normalizedMessage.includes("not authorized") ||
      normalizedMessage.includes("not authorised") ||
      normalizedMessage.includes("unauthorized") ||
      normalizedMessage.includes("unauthorised") ||
      normalizedMessage.includes("permission");

    return {
      success: false,
      errorCode: isAuthorizationError ? "FORBIDDEN" : "INTERNAL_ERROR",
      message: isAuthorizationError ? "Forbidden" : "Internal error",
    };
  }
}

export async function readProjectDetailShell(input: {
  slugOrId: string;
  actorUserId?: string | null;
}): Promise<ProjectDetailShellResult> {
  const slugOrId = input.slugOrId?.trim();
  if (!slugOrId || slugOrId.length > 200) {
    return {
      success: false,
      errorCode: "INVALID_INPUT",
      message: "Invalid project detail request.",
    };
  }

  const requestedActorUserId = input.actorUserId ?? null;
  const startedAt = performance.now();

  try {
    const actorUserId = requestedActorUserId ?? null;

    const project = await resolveProjectDetailTarget(slugOrId, actorUserId);
    if (!project) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project not found.",
      };
    }

    return await runInFlightDeduped(
      `project:detail-shell:${project.id}:${actorUserId ?? "anon"}`,
      async () => {
        const viewerState = resolveProjectDetailViewerState({
          projectId: project.id,
          ownerId: project.ownerId,
          visibility: project.visibility,
          status: project.status,
          actorUserId,
          memberRoleRaw: project.memberRole,
          isFollowed: project.isFollowed,
        });

        const { canRead, canWrite, isOwner, isMember, memberRole, isFollowed } =
          viewerState;
        if (!canRead) {
          return {
            success: false,
            errorCode: "FORBIDDEN" as const,
            message: "Forbidden",
          };
        }

        const shouldUseCachedShell =
          !actorUserId &&
          computeProjectReadAccess(
            project.visibility,
            project.status,
            false,
            false,
          );
        const includeFollowersCount = project.followersCount == null;
        const shell = shouldUseCachedShell
          ? await getPublicProjectDetailShellData(
              project.id,
              project.ownerId,
              includeFollowersCount,
            )
          : await retryProjectDetailRead("project_detail_shell_data", () =>
              fetchProjectDetailShellData(
                project.id,
                project.ownerId,
                includeFollowersCount,
                actorUserId,
                project.visibility ?? "private",
                isOwner || isMember,
                project.owner,
              ),
            );

        const normalizedStatus: Project["status"] =
          project.status === "draft" ||
          project.status === "active" ||
          project.status === "completed" ||
          project.status === "archived"
            ? project.status
            : "draft";

        const normalizedSyncStatus: NonNullable<Project["syncStatus"]> =
          project.syncStatus === "pending" ||
          project.syncStatus === "cloning" ||
          project.syncStatus === "indexing" ||
          project.syncStatus === "ready" ||
          project.syncStatus === "failed"
            ? project.syncStatus
            : "ready";

        const safeImportSource = clearSealedGithubTokenFromImportSource(
          project.importSource,
        );
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

        const visibleExternalLinks = filterProjectLinksForAudience(
          normalizeProjectSocialLinks(project.externalLinks),
          isOwner || isMember,
        );
        const visibleExternalLinkIds = new Set(visibleExternalLinks.map((link) => link.id));
        const visibleExternalLinkMetadata = Object.fromEntries(
          Object.entries(project.externalLinkMetadata ?? {}).filter(([id]) => id === "github-integration" || visibleExternalLinkIds.has(id)),
        );

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
          externalLinks: visibleExternalLinks,
          externalLinkMetadata: visibleExternalLinkMetadata,
          visibility: project.visibility || "private",
          publicTabVisibility: normalizeProjectPublicTabVisibility(
            project.publicTabVisibility,
          ),
          lookingForCollaborators: !!project.lookingForCollaborators,
          memberUpdatesEnabled: !!project.memberUpdatesEnabled,
          maxCollaborators: project.maxCollaborators || null,
          status: normalizedStatus,
          lifecycleStages: Array.isArray(project.lifecycleStages)
            ? project.lifecycleStages
            : [],
          currentStageIndex: Math.max(0, project.currentStageIndex ?? 0),
          stageCompletionDates: normalizeJourneyCompletionDates(
            project.stageCompletionDates,
            Math.max(0, project.currentStageIndex ?? 0),
          ),
          importSource: safeImportSource || null,
          githubRepoUrl: project.githubRepoUrl || null,
          syncStatus: normalizedSyncStatus,
          updatedAt: project.updatedAt?.toISOString?.() ?? null,
          viewCount: Math.max(0, project.viewCount ?? 0),
          followersCount: Math.max(
            0,
            project.followersCount ?? shell.followersCount ?? 0,
          ),
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
          memberRole: isOwner ? "owner" : memberRole,
          guidance: shell.guidance ?? null,
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
            memberRole: isOwner ? "owner" : memberRole,
            isFollowed,
          },
          project: readModel,
        };

        const parsedOutput = projectDetailReadDataSchema.safeParse(output);
        if (!parsedOutput.success) {
          console.error(
            "[getProjectDetailShellAction] Invalid DTO output",
            parsedOutput.error.flatten(),
          );
          return {
            success: false,
            errorCode: "INTERNAL_ERROR" as const,
            message: "Project detail payload validation failed.",
          };
        }

        logger.metric("project.detail.shell", {
          projectId: project.id,
          durationMs: Math.round(performance.now() - startedAt),
        });

        return {
          success: true as const,
          data: parsedOutput.data,
        };
      },
    );
  } catch (error) {
    console.error("[readProjectDetailShell] failed", error);
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to load project detail.",
    };
  }
}

export async function getProjectDetailShellAction(input: {
  slugOrId: string;
  actorUserId?: string | null;
}): Promise<ProjectDetailShellResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const actorUserId = user?.id ?? null;

  if (input.actorUserId && input.actorUserId !== actorUserId) {
    console.warn(
      "[getProjectDetailShellAction] Ignoring mismatched client actorUserId.",
    );
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
  ownerId: string,
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
          type: "project_group",
        })
        .returning({ id: conversations.id });

      if (!newConversation) {
        throw new Error("Failed to create project group");
      }

      // Link to project (atomic, no race possible due to lock)
      await tx
        .update(projects)
        .set({ conversationId: newConversation.id })
        .where(eq(projects.id, projectId));

      const [participantResult] = Array.from(
        await tx.execute<{
          expected_count: number;
          actual_count: number;
        }>(sql`
                WITH eligible_users AS (
                    SELECT ${ownerId}::uuid AS user_id
                    UNION
                    SELECT ${projectMembers.userId}
                    FROM ${projectMembers}
                    WHERE ${projectMembers.projectId} = ${projectId}
                ),
                inserted AS (
                    INSERT INTO ${conversationParticipants} (
                        conversation_id,
                        user_id
                    )
                    SELECT
                        ${newConversation.id},
                        eligible_users.user_id
                    FROM eligible_users
                    ON CONFLICT (conversation_id, user_id) DO NOTHING
                    RETURNING user_id
                )
                SELECT
                    (SELECT count(*)::int FROM eligible_users) AS expected_count,
                    (
                        SELECT count(*)::int
                        FROM ${conversationParticipants}
                        WHERE conversation_id = ${newConversation.id}
                    ) AS actual_count
            `),
      );
      if (
        !participantResult ||
        participantResult.actual_count !== participantResult.expected_count
      ) {
        throw new Error(
          "Project conversation participant creation was incomplete",
        );
      }

      return newConversation.id;
    });

    return result;
  } catch (error) {
    console.error("Error ensuring project group exists:", error);
    return null;
  }
}

// --- Create Action ---
export async function createProjectAction(
  input: CreateProjectInput & { slug?: string; project_id?: string },
): Promise<CreateProjectResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        success: false,
        error: "You must be logged in to create a project",
      };
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    // Retrieve GitHub Access Token if available (for private repo access)
    const gitHubToken = session?.provider_token;

    const importSourceResult = normalizeImportSourceForPersist(
      input.import_source,
      gitHubToken || null,
    );
    if (!importSourceResult.ok) {
      return { success: false, error: importSourceResult.error };
    }
    let normalizedImportSource = importSourceResult.value;
    if (
      normalizedImportSource?.type === "github" &&
      normalizedImportSource.repoUrl
    ) {
      const preferredInstallationId = (
        normalizedImportSource.metadata as Record<string, unknown> | undefined
      )?.githubInstallationId;
      const sealedImportToken = (
        normalizedImportSource.metadata as Record<string, unknown> | undefined
      )?.importAuth;
      const accessCheck = await ensureGithubImportAccess(
        normalizedImportSource.repoUrl,
        {
          oauthToken: gitHubToken || null,
          preferredInstallationId: preferredInstallationId as
            | number
            | string
            | null
            | undefined,
          sealedImportToken,
        },
      );
      if (!accessCheck.ok) {
        return { success: false, error: accessCheck.error };
      }

      const mergedMetadata = {
        ...((normalizedImportSource.metadata || {}) as Record<string, unknown>),
        githubInstallationId: accessCheck.installationId,
        githubAuthSource: accessCheck.authSource,
        githubRepoId:
          accessCheck.repoId ??
          ((normalizedImportSource.metadata || {}) as Record<string, unknown>)
            ?.githubRepoId ??
          null,
        githubRepoPrivate: accessCheck.isPrivate,
        syncPhase: "pending",
        importEventId: buildProjectImportEventId({
          projectId: input.project_id || input.slug || input.title || "pending",
          source: "github",
          normalizedTarget: normalizedImportSource.repoUrl,
          branchOrManifestHash:
            normalizedImportSource.branch ||
            accessCheck.defaultBranch ||
            "main",
        }),
      };

      normalizedImportSource = {
        ...normalizedImportSource,
        branch:
          normalizedImportSource.branch || accessCheck.defaultBranch || "main",
        metadata: mergedMetadata,
      };
    } else if (normalizedImportSource?.type === "upload") {
      const currentMetadata = (normalizedImportSource.metadata || {}) as Record<
        string,
        unknown
      >;
      const normalizedTarget =
        typeof currentMetadata.folderName === "string" &&
        currentMetadata.folderName.trim().length > 0
          ? currentMetadata.folderName
          : "upload";
      normalizedImportSource = {
        ...normalizedImportSource,
        metadata: {
          ...currentMetadata,
          syncPhase: "pending",
          importEventId: buildProjectImportEventId({
            projectId:
              input.project_id || input.slug || input.title || "pending",
            source: "upload",
            normalizedTarget,
            branchOrManifestHash: "pending",
          }),
          uploadSession: {
            ...(typeof currentMetadata.uploadSession === "object" &&
            currentMetadata.uploadSession
              ? (currentMetadata.uploadSession as Record<string, unknown>)
              : {}),
            status: "pending",
          },
        },
      };
    }
    const normalizedImportSourceWithLeadFocus = withLeadFocusMetadata(
      normalizedImportSource,
      input.creator_role,
    );
    const visibility = resolveProjectVisibilityForCreate(input.visibility);
    const externalLinksSplit = splitProjectSocialLinks(input.external_links);
    if ("error" in externalLinksSplit)
      return { success: false, error: externalLinksSplit.error };

    let finalSlug = input.slug || generateSlug(input.title);
    // Initial Key Generation
    let finalKey = generateProjectKey(input.title);

    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      try {
        const lifecycleStages = validateAndSanitizeLifecycleStages(
          input.lifecycle_stages && input.lifecycle_stages.length > 0
            ? input.lifecycle_stages
            : getLifecycleStagesForProjectType(input.project_type),
        );
        const requestedInitialStageIndex = Number(input.current_stage_index ?? 0);
        const completedInitialStageCount = Number.isInteger(requestedInitialStageIndex)
          ? Math.min(Math.max(requestedInitialStageIndex, 0), lifecycleStages.length)
          : 0;
        const lifecycleConfiguredAt = new Date().toISOString();

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
          solutionStatement:
            (input as any).solution_statement ||
            (input as any).solution_overview ||
            null,
          category:
            input.project_type === "other"
              ? input.custom_project_type || "Other"
              : input.project_type || null,
          tags: input.tags || [],
          skills: input.technologies_used || [],
          externalLinks: externalLinksSplit.links,
          externalLinkMetadata: externalLinksSplit.metadata,
          visibility,
          status: mapStatus(input.status),
          lookingForCollaborators: true,
          lifecycleStages,
          currentStageIndex: completedInitialStageCount,
          stageCompletionDates: Object.fromEntries(
            Array.from({ length: completedInitialStageCount }, (_, index) => [
              String(index),
              lifecycleConfiguredAt,
            ]),
          ),
          importSource: normalizedImportSourceWithLeadFocus,
          // For GitHub imports, start at `pending` until the worker actually begins cloning.
          syncStatus: (normalizedImportSourceWithLeadFocus?.type === "github"
            ? "pending"
            : normalizedImportSourceWithLeadFocus?.type === "upload"
              ? "pending"
              : "ready") as
            | "pending"
            | "cloning"
            | "indexing"
            | "ready"
            | "failed",
          githubRepoUrl:
            normalizedImportSourceWithLeadFocus?.type === "github"
              ? normalizedImportSourceWithLeadFocus.repoUrl || null
              : null,
          githubDefaultBranch:
            normalizedImportSourceWithLeadFocus?.type === "github"
              ? normalizedImportSourceWithLeadFocus.branch || "main"
              : "main",
        };

        // Use transaction to ensure project, owner membership, and project group are created together
        // OPTIMIZED: Create conversation FIRST, insert project WITH conversationId (saves 1 UPDATE)
        const result = await db.transaction(async (tx) => {
          // 1. Create the Project Group Conversation FIRST
          const [newConversation] = await tx
            .insert(conversations)
            .values({
              type: "project_group",
            })
            .returning({ id: conversations.id });

          if (!newConversation) {
            throw new Error("Failed to create project group");
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
            throw new Error("Failed to create project");
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
            role: "owner",
          });
          await upsertProfileProjectContributionFromMembership(tx, {
            profileId: user.id,
            projectId: newProject.id,
            verifiedBy: user.id,
            previousRole: null,
            nextRole: "owner",
            source: "owner",
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
            const insertedRoles = await tx
              .insert(projectOpenRoles)
              .values(
                input.roles.map((role) => ({
                  projectId: newProject.id,
                  role: role.role,
                  count: role.count,
                  description: role.description || "",
                  skills: role.skills || [],
                })),
              )
              .returning({ id: projectOpenRoles.id });
            for (const [index, insertedRole] of insertedRoles.entries()) {
              await syncRoleSkills(
                tx,
                insertedRole.id,
                input.roles[index]?.skills ?? [],
                user.id,
              );
            }
          }

          // 6. Insert Tags and Skills into Junction Tables
          const tagsArray = input.tags || [];
          if (tagsArray.length > 0) {
            const tagValues = tagsArray
              .map((t) => {
                const slug = t
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "");
                return { name: t, slug };
              })
              .filter((t) => t.slug);

            if (tagValues.length > 0) {
              await tx.insert(tags).values(tagValues).onConflictDoNothing();
              const slugs = tagValues.map((v) => v.slug);
              const foundTags = await tx
                .select()
                .from(tags)
                .where(inArray(tags.slug, slugs));
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
          const resolvedProjectSkills = await syncProjectSkills(
            tx,
            newProject.id,
            skillsArray,
            user.id,
          );
          if (resolvedProjectSkills.length > 0) {
            await tx
              .update(projects)
              .set({ skills: resolvedProjectSkills.map((skill) => skill.name) })
              .where(eq(projects.id, newProject.id));
          }

          return newProject;
        });

        revalidatePath("/hub");

        // Add to Import Queue if applicable
        if (
          normalizedImportSourceWithLeadFocus?.type === "github" &&
          normalizedImportSourceWithLeadFocus.repoUrl
        ) {
          const queueImportSource = clearSealedGithubTokenFromImportSource(
            normalizedImportSourceWithLeadFocus,
          ) as ImportSourcePayload;
          const queueEventId = buildGithubImportEventId(
            result.id,
            queueImportSource.repoUrl!,
            queueImportSource.branch || null,
          );
          await enqueueGithubImportOrRunInline({
            projectId: result.id,
            userId: user.id,
            importSource: queueImportSource,
            eventId: queueEventId,
            source: "create",
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
        if (dbError.code === "23505") {
          const errorMsg =
            String(dbError.message || "") +
            String(dbError.detail || "") +
            String(dbError.constraint_name || "");
          if (errorMsg.includes("slug")) {
            if (input.slug) {
              throw new Error(
                "This project URL is already taken. Please choose another.",
              );
            }
            attempts++;
            const suffix = Math.random().toString(36).substring(2, 6);
            finalSlug = `${generateSlug(input.title)}-${suffix}`;
            continue;
          }
          // Project Key Collision (e.g. "NB" already exists)
          if (errorMsg.includes("key")) {
            attempts++;
            const suffix = Math.floor(Math.random() * 9) + 1;
            finalKey = `${generateProjectKey(input.title)}${suffix}`;
            continue;
          }
        }
        throw error; // Re-throw other errors
      }
    }

    throw new Error(
      "Failed to generate a unique project ID. Please try again.",
    );
  } catch (error) {
    console.error("Error creating project:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "An unexpected error occurred",
    };
  }
}

// --- Update Action ---
export async function updateProject(projectId: string, data: any) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Unauthorized");

  // Transaction to ensure atomicity of project update + role changes
  return await db
    .transaction(async (tx) => {
      // Check ownership
      const [project] = await tx
        .select()
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
      if (raw.description !== undefined)
        updateValues.description = raw.description;
      if (raw.visibility !== undefined) {
        throw new Error(
          "Project visibility must be changed from Access settings.",
        );
      }
      if (raw.status !== undefined) updateValues.status = raw.status;
      const nextCoverImage =
        raw.coverImage !== undefined
          ? raw.coverImage
          : raw.cover_image !== undefined
            ? raw.cover_image
            : undefined;
      if (nextCoverImage !== undefined) {
        updateValues.coverImage = nextCoverImage;
        if (nextCoverImage === null) {
          updateValues.coverImageBucket = null;
          updateValues.coverImageKey = null;
        }
      }

      // Tagline
      if (raw.shortDescription !== undefined)
        updateValues.shortDescription = raw.shortDescription;
      else if (raw.short_description !== undefined)
        updateValues.shortDescription = raw.short_description;

      // Problem / Solution
      if (raw.problemStatement !== undefined)
        updateValues.problemStatement = raw.problemStatement;
      else if (raw.problem_statement !== undefined)
        updateValues.problemStatement = raw.problem_statement;

      if (raw.solutionStatement !== undefined)
        updateValues.solutionStatement = raw.solutionStatement;
      else if (raw.solution_statement !== undefined)
        updateValues.solutionStatement = raw.solution_statement;
      else if (raw.solution_overview !== undefined)
        updateValues.solutionStatement = raw.solution_overview; // legacy

      // Category
      if (raw.category !== undefined) updateValues.category = raw.category;
      else if (raw.project_type !== undefined)
        updateValues.category = raw.project_type;
      else if (raw.custom_project_type !== undefined)
        updateValues.category = raw.custom_project_type;

      // Tags / Skills parsing
      let tagsArray: string[] = [];
      let skillsArray: string[] = [];

      if (raw.tags !== undefined)
        tagsArray = Array.isArray(raw.tags) ? raw.tags : [];
      if (raw.skills !== undefined)
        skillsArray = Array.isArray(raw.skills) ? raw.skills : [];
      else if (raw.technologies_used !== undefined)
        skillsArray = Array.isArray(raw.technologies_used)
          ? raw.technologies_used
          : [];

      if (raw.tags !== undefined) updateValues.tags = tagsArray; // Keep JSONB arrays in sync for backward compat
      if (raw.skills !== undefined || raw.technologies_used !== undefined)
        updateValues.skills = skillsArray;
      if (raw.externalLinks !== undefined || raw.external_links !== undefined) {
        const externalLinksSplit = splitProjectSocialLinks(
          raw.externalLinks ?? raw.external_links,
          project.externalLinkMetadata ?? {},
        );
        if ("error" in externalLinksSplit)
          throw new Error(externalLinksSplit.error);
        updateValues.externalLinks = externalLinksSplit.links;
        updateValues.externalLinkMetadata = externalLinksSplit.metadata;
      }

      // Lifecycle
      if (raw.lifecycleStages !== undefined) {
        updateValues.lifecycleStages = validateAndSanitizeLifecycleStages(
          raw.lifecycleStages,
        );
      } else if (raw.lifecycle_stages !== undefined) {
        updateValues.lifecycleStages = validateAndSanitizeLifecycleStages(
          raw.lifecycle_stages,
        );
      }

      const requestedStageIndex =
        raw.currentStageIndex !== undefined
          ? raw.currentStageIndex
          : raw.current_stage_index;
      if (requestedStageIndex !== undefined) {
        const nextStageIndex = Number(requestedStageIndex);
        const nextLifecycleStages = Array.isArray(updateValues.lifecycleStages)
          ? updateValues.lifecycleStages
          : Array.isArray(project.lifecycleStages)
            ? project.lifecycleStages
            : [];

        if (
          !Number.isInteger(nextStageIndex) ||
          nextStageIndex < 0 ||
          nextStageIndex >= nextLifecycleStages.length
        ) {
          throw new Error("Project lifecycle stage is out of range.");
        }

        const currentStageIndex = Math.min(
          Math.max(0, project.currentStageIndex ?? 0),
          Math.max(0, nextLifecycleStages.length - 1),
        );
        updateValues.currentStageIndex = nextStageIndex;
        updateValues.stageCompletionDates = buildJourneyCompletionDates({
          completionDates: project.stageCompletionDates,
          previousStageIndex: currentStageIndex,
          nextStageIndex,
          transitionedAt: new Date().toISOString(),
        });
      }

      if (raw.memberUpdatesEnabled !== undefined)
        updateValues.memberUpdatesEnabled = raw.memberUpdatesEnabled;
      else if (raw.member_updates_enabled !== undefined)
        updateValues.memberUpdatesEnabled = raw.member_updates_enabled;

      await tx
        .update(projects)
        .set(updateValues)
        .where(eq(projects.id, projectId));
      await markProjectCollaboratorsSummaryStale(projectId, tx);

      // Sync Junction Tables for normalized relational search
      if (raw.tags !== undefined) {
        await tx
          .delete(projectTags)
          .where(eq(projectTags.projectId, projectId));
        if (tagsArray.length > 0) {
          const tagValues = tagsArray
            .map((t) => {
              const slug = t
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");
              return { name: t, slug };
            })
            .filter((t) => t.slug);

          if (tagValues.length > 0) {
            await tx.insert(tags).values(tagValues).onConflictDoNothing();
            const slugs = tagValues.map((v) => v.slug);
            const foundTags = await tx
              .select()
              .from(tags)
              .where(inArray(tags.slug, slugs));
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
        const resolvedProjectSkills = await syncProjectSkills(
          tx,
          projectId,
          skillsArray,
          user.id,
        );
        updateValues.skills = resolvedProjectSkills.map((skill) => skill.name);
      }

      let openRoles;

      // Update Roles
      if (roles && Array.isArray(roles)) {
        // Intercept lead-role if present
        let updatedImportSource = project.importSource;
        const cleanRoles = [];
        const leadRole = roles.find((r: any) => r.id === "lead-role");
        if (leadRole) {
          const metadata = {
            ...((project.importSource as any)?.metadata || {}),
          };
          metadata.leadFocus = (leadRole.role || "").trim();
          metadata.leadDescription = (leadRole.description || "").trim();

          updatedImportSource = {
            ...(project.importSource || { type: "scratch" }),
            metadata,
          };

          // Save updated importSource
          updateValues.importSource = updatedImportSource;
          await tx
            .update(projects)
            .set({ importSource: updatedImportSource })
            .where(eq(projects.id, projectId));
        }

        // Filter out lead-role from database projectOpenRoles sync
        for (const r of roles) {
          if (r.id !== "lead-role") {
            cleanRoles.push(r);
          }
        }

        const cleanDeletedIds = (deletedRoleIds || []).filter(
          (id: string) => id !== "lead-role",
        );

        if (cleanDeletedIds.length > 0) {
          await tx
            .delete(projectOpenRoles)
            .where(
              and(
                eq(projectOpenRoles.projectId, projectId),
                inArray(projectOpenRoles.id, cleanDeletedIds),
              ),
            );
        }

        for (const role of cleanRoles) {
          if (role.id) {
            const resolvedRoleSkills = await syncRoleSkills(
              tx,
              role.id,
              role.skills || [],
              user.id,
            );
            await tx
              .update(projectOpenRoles)
              .set({
                role: role.role,
                count: role.count,
                description: role.description || "",
                skills: resolvedRoleSkills.map((skill) => skill.name),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(projectOpenRoles.projectId, projectId),
                  eq(projectOpenRoles.id, role.id),
                ),
              );
          } else {
            const [insertedRole] = await tx
              .insert(projectOpenRoles)
              .values({
                projectId: project.id,
                role: role.role,
                count: role.count || 1,
                description: role.description || "",
                skills: role.skills || [],
              })
              .returning({ id: projectOpenRoles.id });
            if (insertedRole) {
              const resolvedRoleSkills = await syncRoleSkills(
                tx,
                insertedRole.id,
                role.skills || [],
                user.id,
              );
              await tx
                .update(projectOpenRoles)
                .set({ skills: resolvedRoleSkills.map((skill) => skill.name) })
                .where(eq(projectOpenRoles.id, insertedRole.id));
            }
          }
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
          .orderBy(
            desc(projectOpenRoles.updatedAt),
            desc(projectOpenRoles.createdAt),
          );
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
    .then(
      async ({
        success,
        slug,
        id,
        previousCoverImage,
        nextCoverImage,
        openRoles,
      }) => {
        if (
          nextCoverImage !== undefined &&
          previousCoverImage !== nextCoverImage
        ) {
          await cleanupProjectCoverImages({
            userId: user.id,
            projectId: id,
            keepStorageKey: projectCoverStorageKeyFromPublicUrl(
              nextCoverImage,
              user.id,
              id,
            ),
            previousCoverImage,
          });
        }
        revalidatePath(`/projects/${slug}`);
        revalidatePath(`/projects/${id}`);
        await invalidateProjectPublicCaches(id);
        if (Array.isArray(data?.roles)) {
          const createdCount = data.roles.filter(
            (role: { id?: unknown }) => !role.id,
          ).length;
          const updatedCount = data.roles.length - createdCount;
          const deletedCount = Array.isArray(data.deletedRoleIds)
            ? data.deletedRoleIds.length
            : 0;
          const eventKey =
            createdCount > 0 && updatedCount === 0 && deletedCount === 0
              ? "roles.created"
              : deletedCount > 0
                ? "roles.closed"
                : "roles.updated";
          await enqueueProjectNotificationBestEffort(
            {
              projectId: id,
              actorUserId: user.id,
              ...actorNotificationSnapshot(user),
              eventKey,
              title: "Project roles updated",
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
      },
    );
}

export async function createProjectCoverImageUploadUrlAction(input: {
  projectId: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<
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
      return { success: false, error: "Unauthorized" };
    }

    const { allowed } = await consumeRateLimit(
      `upload:project-image:user:${user.id}`,
      10,
      60 * 60,
    );
    if (!allowed) {
      return {
        success: false,
        error:
          "Too many project image upload attempts. Please try again later.",
      };
    }

    await assertProjectOwnerForSettings(input.projectId, user.id);
    const normalizedMimeType = normalizeAndValidateMimeType(input.mimeType);
    if (!ALLOWED_PROJECT_COVER_MIME_TYPES.has(normalizedMimeType)) {
      return {
        success: false,
        error: "Unsupported image type. Use JPG, PNG, WebP, or GIF.",
      };
    }
    const expectedSize = normalizeAndValidateFileSize(
      input.sizeBytes,
      PROJECT_COVER_UPLOAD_MAX_FILE_BYTES,
      "Project image",
    );
    const extension = projectCoverExtensionFromMimeType(normalizedMimeType);
    const storagePath = `projects/${input.projectId}/project-images/${user.id}/${Date.now()}-${randomUUID()}.${extension}`;
    const intent = await createUploadIntent({
      userId: user.id,
      projectId: input.projectId,
      bucket: PROJECT_COVER_UPLOAD_BUCKET,
      storageKey: storagePath,
      scope: "profile_image",
      kind: "banner",
      expectedMimeType: normalizedMimeType,
      expectedSize,
      metadata: {
        kind: "project_image",
        projectId: input.projectId,
      },
    });

    const admin = await createAdminClient();
    const { data, error } = await admin.storage
      .from(PROJECT_COVER_UPLOAD_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });
    if (error || !data?.signedUrl || !data?.token) {
      logger.error("project.cover_upload_url_failed", {
        module: "projects",
        projectId: input.projectId,
        userId: user.id,
        error: error?.message || "Missing signed URL token",
      });
      return {
        success: false,
        error: "Failed to prepare project image upload.",
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
    logger.error("project.cover_upload_url_failed", {
      module: "projects",
      projectId: input.projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: "Failed to prepare project image upload." };
  }
}

export async function finalizeProjectCoverImageUploadAction(input: {
  projectId: string;
  uploadIntentId: string;
}): Promise<
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
      return { success: false, error: "Unauthorized" };
    }

    const project = await assertProjectOwnerForSettings(
      input.projectId,
      user.id,
    );
    const intent = await finalizeUploadIntent({
      intentId: input.uploadIntentId,
      bucket: PROJECT_COVER_UPLOAD_BUCKET,
      userId: user.id,
      projectId: input.projectId,
      expectedScope: "profile_image",
      expectedKind: "banner",
    });
    const imageUrl = buildProjectImageRoute(input.projectId, intent.storageKey);

    const [updated] = await db
      .update(projects)
      .set({
        coverImage: imageUrl,
        coverImageBucket: PROJECT_COVER_UPLOAD_BUCKET,
        coverImageKey: intent.storageKey,
        updatedAt: new Date(),
      })
      .where(
        and(eq(projects.id, input.projectId), eq(projects.ownerId, user.id)),
      )
      .returning({ id: projects.id });

    if (!updated) {
      return { success: false, error: "Failed to publish project image." };
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
    logger.error("project.cover_upload_finalize_failed", {
      module: "projects",
      projectId: input.projectId,
      uploadIntentId: input.uploadIntentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: "Failed to finalize project image upload.",
    };
  }
}

export async function clearProjectCoverImageAction(
  projectId: string,
): Promise<
  | { success: true; removedPreviousImages: number }
  | { success: false; error: string }
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Unauthorized" };
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
      return { success: false, error: "Failed to clear project image." };
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
    logger.error("project.cover_clear_failed", {
      module: "projects",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, error: "Failed to clear project image." };
  }
}

type ProjectSettingsErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "INTERNAL_ERROR";

type ProjectSettingsMutationResult =
  | { success: true; message: string }
  | { success: false; message: string; errorCode: ProjectSettingsErrorCode };

type ProjectDangerZonePreflightResult =
  | {
      success: true;
      data: {
        status: "draft" | "active" | "completed" | "archived";
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
        summary: {
          alwaysAllowedCount: number;
          enabledMemberCount: number;
          disabledMemberCount: number;
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

type ProjectCollaboratorRole = "owner" | "admin" | "member" | "viewer";

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
  roleFilter?: ProjectCollaboratorRole | "all" | null;
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
      errorCode:
        | ProjectSettingsErrorCode
        | "INVALID_ROLE"
        | "OWNER_TARGET"
        | "NOT_A_MEMBER";
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
  visibility: z.enum(["public", "private"]).optional(),
  lookingForCollaborators: z.boolean().optional(),
  memberUpdatesEnabled: z.boolean().optional(),
  maxCollaborators: z.string().trim().max(32).nullable().optional(),
});

function actorNotificationSnapshot(user: {
  user_metadata?: Record<string, unknown> | null;
}) {
  return {
    actorName:
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.username as string | undefined) ??
      null,
    actorAvatarUrl:
      (user.user_metadata?.avatar_url as string | undefined) ?? null,
  };
}

async function enqueueProjectNotificationBestEffort(
  input: Parameters<typeof enqueueProjectNotificationEvent>[0],
  logContext: Record<string, unknown>,
) {
  try {
    await enqueueProjectNotificationEvent(input);
  } catch (notificationError) {
    logger.warn("project.notification_policy_enqueue_failed", {
      module: "projects",
      eventKey: input.eventKey,
      projectId: input.projectId,
      ...logContext,
      error:
        notificationError instanceof Error
          ? notificationError.message
          : String(notificationError),
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
      errorCode: "NOT_FOUND" as const,
      message: "Project not found.",
    };
  }
  if (project.ownerId !== userId) {
    return {
      ok: false as const,
      errorCode: "FORBIDDEN" as const,
      message: "Only the project owner can change settings.",
    };
  }
  return { ok: true as const, project };
}

export async function updateProjectSettingsAction(
  projectId: string,
  patch: {
    visibility?: "public" | "private";
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
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    }

    const parsed = projectSettingsPatchSchema.safeParse(patch ?? {});
    if (!parsed.success) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        message: "Invalid settings payload.",
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
        errorCode: "INVALID_INPUT",
        message: "Project visibility must be changed from Access settings.",
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
      updateValues.maxCollaborators =
        trimmed && trimmed.length > 0 ? trimmed : null;
    }

    if (Object.keys(updateValues).length === 1) {
      return { success: true, message: "No settings changes to save." };
    }

    const previousVisibility = normalizeProjectVisibility(
      owned.project.visibility,
    );

    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set(updateValues)
        .where(eq(projects.id, projectId));
    });
    await revalidateProjectPaths(projectId);

    logger.metric("project.settings.update.result", {
      projectId,
      userId: user.id,
      result: "success",
      visibilityChanged: false,
      nextVisibility: previousVisibility,
    });

    return { success: true, message: "Project settings updated." };
  } catch (error) {
    console.error("Failed to update project settings:", error);
    logger.metric("project.settings.update.result", {
      projectId,
      result: "error",
      errorCode: "INTERNAL_ERROR",
    });
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to update project settings.",
    };
  }
}

/** Lead and Co-leaders manage project-owned accounts; personal profile links are never inherited. */
export async function updateProjectExternalLinksAction(
  projectId: string,
  input: unknown,
  expectedLinks?: unknown,
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return { success: false as const, error: "You must be signed in." };

    const initialSplit = splitProjectSocialLinks(input);
    if ("error" in initialSplit)
      return { success: false as const, error: initialSplit.error };
    const [project] = await db
      .select({ ownerId: projects.ownerId, slug: projects.slug, externalLinks: projects.externalLinks, externalLinkMetadata: projects.externalLinkMetadata })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project)
      return { success: false as const, error: "Project not found." };

    const [membership] =
      project.ownerId === user.id
        ? [null]
        : await db
            .select({ role: projectMembers.role })
            .from(projectMembers)
            .where(
              and(
                eq(projectMembers.projectId, projectId),
                eq(projectMembers.userId, user.id),
              ),
            )
            .limit(1);
    if (project.ownerId !== user.id && membership?.role !== "admin") {
      return {
        success: false as const,
        error: "Only the Lead or a Co-leader can update project links.",
      };
    }

    const savedSplit = splitProjectSocialLinks(input, project.externalLinkMetadata ?? {});
    if ("error" in savedSplit)
      return { success: false as const, error: savedSplit.error };
    const links = savedSplit.links;

    if (expectedLinks !== undefined) {
      const expected = validateProjectSocialLinks(expectedLinks);
      if (!expected.success)
        return { success: false as const, error: expected.error };
      const current = normalizeProjectSocialLinks(project.externalLinks);
      if (!areProjectSocialLinksEqual(current, expected.links)) {
        return {
          success: false as const,
          conflict: true as const,
          error: "Project links changed in another session. The changes were merged; review and save again.",
          currentData: current,
        };
      }
    }

    await db.transaction(async (tx) => {
      const currentLinks = normalizeProjectSocialLinks(project.externalLinks);
      const currentIds = new Set(currentLinks.map((link) => link.id));
      const nextIds = new Set(links.map((link) => link.id));
      const added = links.filter((link) => !currentIds.has(link.id));
      const removed = currentLinks.filter((link) => !nextIds.has(link.id));
      const reordered = currentLinks.filter((link) => nextIds.has(link.id)).map((link) => link.id).join('|')
        !== links.filter((link) => currentIds.has(link.id)).map((link) => link.id).join('|');
      const externalLinkMetadata = {
        ...savedSplit.metadata,
        ...(project.externalLinkMetadata?.['github-integration']
          ? { 'github-integration': project.externalLinkMetadata['github-integration'] }
          : {}),
      };
      await tx
        .update(projects)
        .set({ externalLinks: links, externalLinkMetadata, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
      await tx.insert(projectNodeEvents).values({
        projectId,
        actorId: user.id,
        type: "project_social_links.updated",
        metadata: {
          platforms: links.map((link) => link.platform || "other").sort(),
          purposes: [...new Set(links.map((link) => link.purpose || "other"))].sort(),
          count: links.length,
          added: added.map((link) => ({ id: link.id, platform: link.platform || "other", purpose: link.purpose || "other" })),
          removed: removed.map((link) => ({ id: link.id, platform: link.platform || "other", purpose: link.purpose || "other" })),
          reordered,
        },
      });
    });
    await revalidateProjectPaths(projectId);
    logger.metric("project.social_links.update", {
      projectId,
      userId: user.id,
      platforms: links.map((link) => link.platform || "other").sort(),
      count: links.length,
    });
    return { success: true as const, data: links, metadata: savedSplit.metadata };
  } catch (error) {
    logger.error("project.social_links.update_failed", {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false as const,
      error: "Failed to update project links.",
    };
  }
}

async function readProjectAccessImpactCounts(projectId: string) {
  const [
    membersRow,
    followersRow,
    openRolesRow,
    pendingAppsRow,
    activeTasksRow,
  ] = await Promise.all([
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
      .where(
        and(
          eq(roleApplications.projectId, projectId),
          eq(roleApplications.status, "pending"),
        ),
      )
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          isNull(tasks.deletedAt),
          sql`${tasks.status} <> 'done'`,
        ),
      )
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

async function readProjectAccessTransitionPreviews(
  projectId: string,
): Promise<AccessTransitionPreview> {
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
        applicantName: sql<
          string | null
        >`coalesce(${profiles.fullName}, ${profiles.username})`,
        roleTitle: projectOpenRoles.title,
        roleName: projectOpenRoles.role,
      })
      .from(roleApplications)
      .leftJoin(profiles, eq(profiles.id, roleApplications.applicantId))
      .leftJoin(
        projectOpenRoles,
        eq(projectOpenRoles.id, roleApplications.roleId),
      )
      .where(
        and(
          eq(roleApplications.projectId, projectId),
          eq(roleApplications.status, "pending"),
        ),
      )
      .orderBy(desc(roleApplications.updatedAt))
      .limit(6),
  ]);

  return { followers, openRoles, pendingApplications };
}

function buildAccessPreflightPayload(params: {
  projectId: string;
  previousVisibility: ProjectVisibility;
  nextVisibility: ProjectVisibility;
  hasManagedProjectImage: boolean;
  counts: Awaited<ReturnType<typeof readProjectAccessImpactCounts>>;
  previews: AccessTransitionPreview;
}) {
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

export async function getProjectAccessTransitionPreflightAction(
  projectId: string,
  nextVisibility: ProjectVisibility,
): Promise<ProjectAccessTransitionPreflightResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    }
    if (!isProjectVisibility(nextVisibility)) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        message: "Choose Public or Private.",
      };
    }

    const owned = await loadOwnedProjectForSettings(projectId, user.id);
    if (!owned.ok)
      return {
        success: false,
        errorCode: owned.errorCode,
        message: owned.message,
      };

    const [counts, previews] = await Promise.all([
      readProjectAccessImpactCounts(projectId),
      readProjectAccessTransitionPreviews(projectId),
    ]);

    return {
      success: true,
      data: buildAccessPreflightPayload({
        projectId,
        previousVisibility: normalizeProjectVisibility(
          owned.project.visibility,
        ),
        nextVisibility,
        hasManagedProjectImage: Boolean(
          owned.project.coverImageBucket && owned.project.coverImageKey,
        ),
        counts,
        previews,
      }),
    };
  } catch (error) {
    logger.error("project.access_preflight_failed", {
      module: "projects",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to prepare access transition.",
    };
  }
}

export async function updateProjectVisibilityAction(
  projectId: string,
  nextVisibility: ProjectVisibility,
  confirmationToken: string,
): Promise<ProjectSettingsMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    }
    if (!isProjectVisibility(nextVisibility)) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        message: "Choose Public or Private.",
      };
    }

    const owned = await loadOwnedProjectForSettings(projectId, user.id);
    if (!owned.ok)
      return {
        success: false,
        errorCode: owned.errorCode,
        message: owned.message,
      };

    const previousVisibility = normalizeProjectVisibility(
      owned.project.visibility,
    );
    if (previousVisibility === nextVisibility) {
      return {
        success: true,
        message: `Project is already ${nextVisibility}.`,
      };
    }

    const [counts, previews] = await Promise.all([
      readProjectAccessImpactCounts(projectId),
      readProjectAccessTransitionPreviews(projectId),
    ]);
    const preflight = buildAccessPreflightPayload({
      projectId,
      previousVisibility,
      nextVisibility,
      hasManagedProjectImage: Boolean(
        owned.project.coverImageBucket && owned.project.coverImageKey,
      ),
      counts,
      previews,
    });

    if (
      !confirmationToken ||
      confirmationToken !== preflight.confirmationToken
    ) {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        message:
          "Access confirmation expired. Review the impact and try again.",
      };
    }

    const imageMigration =
      nextVisibility === "private"
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
        type: "project_settings.visibility_changed",
        metadata: {
          previousVisibility,
          nextVisibility,
          source: "project_settings_access",
          confirmationSummary: preflight.policy.confirmationSummary,
          affectedCounts: counts,
          previewIds: {
            followers: previews.followers.map((row) => row.id),
            openRoles: previews.openRoles.map((row) => row.id),
            pendingApplications: previews.pendingApplications.map(
              (row) => row.id,
            ),
          },
          imagePrivacyAction: imageMigration?.migrated
            ? "migrated_to_private_route"
            : imageMigration
              ? "managed_private_route_confirmed"
              : "none",
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
        eventKey: "access.visibility_changed",
        title: `Project visibility changed to ${nextVisibility}`,
        body: `${owned.project.title ?? owned.project.slug ?? "Project"} is now ${nextVisibility}.`,
        sourceEventId: `${projectId}:visibility:${previousVisibility}:${nextVisibility}`,
        entityRefs: { projectId, projectSlug: owned.project.slug ?? null },
      });
    } catch (notificationError) {
      logger.warn("project.access_visibility_notification_failed", {
        module: "projects",
        projectId,
        previousVisibility,
        nextVisibility,
        error:
          notificationError instanceof Error
            ? notificationError.message
            : String(notificationError),
      });
    }

    logger.metric("project.access_visibility.update", {
      projectId,
      userId: user.id,
      previousVisibility,
      nextVisibility,
      result: "success",
    });

    return { success: true, message: `Project is now ${nextVisibility}.` };
  } catch (error) {
    logger.error("project.access_visibility_failed", {
      module: "projects",
      projectId,
      nextVisibility,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to update project visibility.",
    };
  }
}

export async function getProjectAccessImpactAction(
  projectId: string,
): Promise<ProjectAccessImpactResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
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
    console.error("Failed to load project access impact:", error);
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to load access impact.",
    };
  }
}

export async function updateProjectPublicTabVisibilityAction(
  projectId: string,
  nextVisibility: ProjectPublicTabVisibility,
): Promise<ProjectPublicTabVisibilityResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    }

    const capability = await requireProjectCapability(
      projectId,
      user.id,
      "manage_public_tabs",
    );
    const normalized = normalizeProjectPublicTabVisibility(nextVisibility);
    const [current] = await db
      .select({ publicTabVisibility: projects.publicTabVisibility })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const previous = normalizeProjectPublicTabVisibility(
      current?.publicTabVisibility,
    );

    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ publicTabVisibility: normalized, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
      await tx.insert(projectNodeEvents).values({
        projectId,
        actorId: user.id,
        nodeId: null,
        type: "project_settings.public_tabs_changed",
        metadata: {
          previous,
          next: normalized,
          source: "project_settings_access",
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
        eventKey: "access.public_tabs_changed",
        title: "Public project surfaces changed",
        body: "The visible public tabs for this project were updated.",
        sourceEventId: `${projectId}:public-tabs:${Date.now()}`,
        entityRefs: { projectId },
      });
    } catch (notificationError) {
      logger.warn("project.public_tabs_notification_failed", {
        module: "projects",
        projectId,
        error:
          notificationError instanceof Error
            ? notificationError.message
            : String(notificationError),
      });
    }

    return {
      success: true,
      message: "Public tab visibility updated.",
      data: normalized,
    };
  } catch (error) {
    logger.error("project.public_tabs_update_failed", {
      module: "projects",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Project not found")) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project not found.",
      };
    }
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to change public tab visibility.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to update public tab visibility.",
    };
  }
}

export async function getProjectSettingsAuditAction(
  projectId: string,
): Promise<ProjectSettingsAuditResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
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
      .where(
        and(
          eq(projectNodeEvents.projectId, projectId),
          isNull(projectNodeEvents.nodeId),
          or(
            sql`${projectNodeEvents.type} LIKE 'project_settings.%'`,
            sql`${projectNodeEvents.type} LIKE 'project_member.%'`,
            sql`${projectNodeEvents.type} LIKE 'project_file_policy.%'`,
            sql`${projectNodeEvents.type} LIKE 'project_notification_settings.%'`,
            sql`${projectNodeEvents.type} LIKE 'project_social_links.%'`,
          ),
        ),
      )
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
    console.error("Failed to load project settings audit:", error);
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to load settings audit.",
    };
  }
}

function normalizeCollaboratorRole(
  value: unknown,
  fallback: ProjectCollaboratorRole = "member",
): ProjectCollaboratorRole {
  return value === "owner" ||
    value === "admin" ||
    value === "member" ||
    value === "viewer"
    ? value
    : fallback;
}

function collaboratorRoleLabel(role: ProjectCollaboratorRole) {
  if (role === "admin") return "Co-leader";
  return role.slice(0, 1).toUpperCase() + role.slice(1);
}

async function readProjectCollaboratorResponsibilityCounts(
  projectId: string,
  memberIds: string[],
  conversationId?: string | null,
) {
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

  const [
    assignedRows,
    createdRows,
    fileReviewRows,
    acceptedRows,
    participantRows,
  ] = await Promise.all([
    db
      .select({ userId: tasks.assigneeId, count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          isNull(tasks.deletedAt),
          sql`${tasks.status} <> 'done'`,
          inArray(tasks.assigneeId, memberIds),
        ),
      )
      .groupBy(tasks.assigneeId),
    db
      .select({ userId: tasks.creatorId, count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          isNull(tasks.deletedAt),
          sql`${tasks.status} <> 'done'`,
          inArray(tasks.creatorId, memberIds),
        ),
      )
      .groupBy(tasks.creatorId),
    db
      .select({
        userId: taskNodeLinks.createdBy,
        count: sql<number>`count(*)::int`,
      })
      .from(taskNodeLinks)
      .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
      .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
      .where(
        and(
          eq(tasks.projectId, projectId),
          isNull(tasks.deletedAt),
          isNull(projectNodes.deletedAt),
          inArray(taskNodeLinks.createdBy, memberIds),
          sql`lower(coalesce(${taskNodeLinks.annotation}, '')) like '%review%'`,
        ),
      )
      .groupBy(taskNodeLinks.createdBy),
    db
      .select({
        userId: roleApplications.applicantId,
        count: sql<number>`count(*)::int`,
      })
      .from(roleApplications)
      .where(
        and(
          eq(roleApplications.projectId, projectId),
          eq(roleApplications.status, "accepted"),
          inArray(roleApplications.applicantId, memberIds),
        ),
      )
      .groupBy(roleApplications.applicantId),
    conversationId
      ? db
          .select({ userId: conversationParticipants.userId })
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversationId, conversationId),
              inArray(conversationParticipants.userId, memberIds),
            ),
          )
      : Promise.resolve([]),
  ]);

  const patchCount = (
    userId: string | null,
    key:
      | "activeAssignedTasks"
      | "activeCreatedTasks"
      | "fileReviews"
      | "acceptedApplications",
    count: number,
  ) => {
    if (!userId) return;
    const current = initial.get(userId);
    if (current) current[key] = Number(count ?? 0);
  };
  for (const row of assignedRows)
    patchCount(row.userId, "activeAssignedTasks", row.count);
  for (const row of createdRows)
    patchCount(row.userId, "activeCreatedTasks", row.count);
  for (const row of fileReviewRows)
    patchCount(row.userId, "fileReviews", row.count);
  for (const row of acceptedRows)
    patchCount(row.userId, "acceptedApplications", row.count);
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
    .leftJoin(
      projectOpenRoles,
      eq(projectOpenRoles.id, roleApplications.roleId),
    )
    .where(
      and(
        eq(roleApplications.projectId, projectId),
        eq(roleApplications.status, "accepted"),
        inArray(roleApplications.applicantId, memberIds),
      ),
    )
    .orderBy(desc(roleApplications.updatedAt));

  const roleByUser = new Map<string, string>();
  for (const row of rows) {
    if (roleByUser.has(row.applicantId)) continue;
    const label = row.roleTitle || row.roleName || "";
    if (label) roleByUser.set(row.applicantId, label);
  }
  return roleByUser;
}

export async function getProjectCollaboratorSettingsAction(
  projectId: string,
  optionsOrLimit: ProjectCollaboratorSettingsOptions | number = 40,
  legacyCursor?: string,
): Promise<ProjectCollaboratorSettingsResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };

    const capability = await requireProjectCapability(
      projectId,
      user.id,
      "manage_collaborators",
    );
    const owned = {
      ok: true as const,
      project: {
        id: capability.project.id,
        ownerId: capability.project.ownerId,
      },
    };

    const options =
      typeof optionsOrLimit === "number"
        ? { limit: optionsOrLimit, cursor: legacyCursor }
        : optionsOrLimit;
    const roleFilter =
      options.roleFilter && options.roleFilter !== "all"
        ? options.roleFilter
        : null;
    const query = options.query?.trim() ?? "";
    const safeLimit = Math.min(Math.max(options.limit ?? 40, 1), 80);
    const whereConditions: any[] = [eq(projectMembers.projectId, projectId)];
    if (roleFilter) {
      if (roleFilter === "owner") {
        whereConditions.push(eq(projectMembers.userId, owned.project.ownerId));
      } else {
        whereConditions.push(eq(projectMembers.role, roleFilter));
        whereConditions.push(
          sql`${projectMembers.userId} <> ${owned.project.ownerId}`,
        );
      }
    }
    if (query) {
      const likePattern = `%${query.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
      whereConditions.push(
        or(
          ilike(profiles.fullName, likePattern),
          ilike(profiles.username, likePattern),
        ),
      );
    }
    if (options.cursor) {
      try {
        const decoded = Buffer.from(options.cursor, "base64").toString("utf-8");
        const [joinedAt, memberId] = decoded.split(":::");
        if (joinedAt && memberId) {
          whereConditions.push(
            sql`(${projectMembers.joinedAt}, ${projectMembers.id}) < (${new Date(joinedAt)}, ${memberId})`,
          );
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
    if (
      !options.cursor &&
      (!roleFilter || roleFilter === "owner") &&
      !slice.some((row) => row.userId === owned.project.ownerId)
    ) {
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
      const matchesQuery =
        !query ||
        [ownerProfile?.fullName, ownerProfile?.username]
          .filter(Boolean)
          .some((value) =>
            String(value).toLowerCase().includes(query.toLowerCase()),
          );
      if (ownerProfile?.id && matchesQuery) {
        slice = [
          {
            memberId: `owner:${ownerProfile.id}`,
            userId: ownerProfile.id,
            role: "owner" as ProjectCollaboratorRole,
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
    const nextCursor =
      hasMore && last
        ? Buffer.from(
            `${last.joinedAt.toISOString()}:::${last.memberId}`,
          ).toString("base64")
        : null;

    const memberIds = slice.map((row) => row.userId);
    const [roleTitleByUser, responsibilityByUser, roleCountRows] =
      await Promise.all([
        readAcceptedRoleTitles(projectId, memberIds),
        readProjectCollaboratorResponsibilityCounts(
          projectId,
          memberIds,
          projectRow?.conversationId ?? null,
        ),
        db
          .select({ userId: projectMembers.userId, role: projectMembers.role })
          .from(projectMembers)
          .where(eq(projectMembers.projectId, projectId)),
      ]);
    const roleCounts: Record<ProjectCollaboratorRole, number> = {
      owner: 0,
      admin: 0,
      member: 0,
      viewer: 0,
    };
    let ownerCounted = false;
    for (const row of roleCountRows) {
      const role = normalizeCollaboratorRole(
        row.role,
        row.userId === owned.project.ownerId ? "owner" : "member",
      );
      if (row.userId === owned.project.ownerId || role === "owner")
        ownerCounted = true;
      roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    }
    if (!ownerCounted) roleCounts.owner = 1;

    const rawLeadFocus = (projectRow?.importSource as any)?.metadata?.leadFocus;
    const leadFocus =
      typeof rawLeadFocus === "string" ? rawLeadFocus.trim() : "";

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
            membershipRole: normalizeCollaboratorRole(
              row.role,
              row.userId === owned.project.ownerId ? "owner" : "member",
            ),
            projectRoleTitle:
              row.userId === projectRow?.ownerId
                ? leadFocus || "Lead"
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
    console.error("Failed to load project collaborator settings:", error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Project not found")) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project not found.",
      };
    }
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to manage collaborators.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to load collaborators.",
    };
  }
}

function formatFileUploadPermission(
  role: ProjectCollaboratorRole,
  enabled: boolean,
) {
  if (role === "owner") return { locked: true, label: "Owner · always on" };
  if (role === "admin") return { locked: true, label: "Co-leader · always on" };
  if (role === "viewer") return { locked: true, label: "Viewer · upload off" };
  return {
    locked: false,
    label: enabled ? "Member upload on" : "Member upload off",
  };
}

type AnalyticsFileSource = "github" | "manual" | "system";

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeProjectNodeAnalyticsMetadata(input: {
  metadata: Record<string, unknown> | null | undefined;
  gitHash?: string | null;
  importSourceType?: "github" | "upload" | "scratch" | null;
}): {
  source: AnalyticsFileSource;
  analyticsVisible: boolean;
  publicVisible: boolean;
  privateReason: string | null;
} {
  const metadata = readRecord(input.metadata);
  const analytics = readRecord(metadata.analytics);
  const privacy = readRecord(metadata.privacy);
  const rawSource =
    analytics.source ?? metadata.source ?? metadata.importSource;
  const source: AnalyticsFileSource =
    rawSource === "github" || input.gitHash
      ? "github"
      : rawSource === "system"
        ? "system"
        : input.importSourceType === "github" && input.gitHash
          ? "github"
          : "manual";
  const privateReason =
    typeof analytics.privateReason === "string"
      ? analytics.privateReason
      : typeof privacy.reason === "string"
        ? privacy.reason
        : typeof metadata.privateReason === "string"
          ? metadata.privateReason
          : null;
  const publicVisible =
    readBoolean(analytics.publicVisible) ??
    readBoolean(privacy.publicVisible) ??
    readBoolean(metadata.publicVisible) ??
    metadata.visibility !== "private";
  const analyticsVisible =
    readBoolean(analytics.analyticsVisible) ??
    readBoolean(metadata.analyticsVisible) ??
    (metadata.visibility === "private" || privacy.private === true
      ? false
      : true);
  return {
    source,
    analyticsVisible,
    publicVisible,
    privateReason,
  };
}

export async function getProjectFileWorkspaceSettingsAction(
  projectId: string,
): Promise<ProjectFileWorkspaceSettingsResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    const capability = await requireProjectCapability(
      projectId,
      user.id,
      "manage_files",
    );

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
      .orderBy(
        sql`CASE WHEN ${projectMembers.userId} = ${capability.project.ownerId} THEN 0 WHEN ${projectMembers.role} = 'admin' THEN 1 WHEN ${projectMembers.role} = 'member' THEN 2 ELSE 3 END`,
        sql`${profiles.fullName} ASC NULLS LAST`,
        sql`${profiles.username} ASC NULLS LAST`,
      );

    const memberIds = rows.map((row) => row.userId);
    const roleTitleByUser = await readAcceptedRoleTitles(projectId, memberIds);
    const members = rows.map((row) => {
      const role = normalizeCollaboratorRole(
        row.role,
        row.userId === capability.project.ownerId ? "owner" : "member",
      );
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

    return {
      success: true,
      data: {
        members,
        summary: {
          alwaysAllowedCount: members.filter(
            (member) =>
              member.membershipRole === "owner" ||
              member.membershipRole === "admin",
          ).length,
          enabledMemberCount: members.filter(
            (member) =>
              member.membershipRole === "member" && member.fileUploadEnabled,
          ).length,
          disabledMemberCount: members.filter(
            (member) =>
              member.membershipRole === "member" && !member.fileUploadEnabled,
          ).length,
        },
      },
    };
  } catch (error) {
    logger.error("project.file_workspace_settings_failed", {
      module: "projects",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Project not found")) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project not found.",
      };
    }
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message:
          "You do not have permission to manage file workspace settings.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to load file workspace settings.",
    };
  }
}

export async function updateProjectMemberFileUploadAction(
  projectId: string,
  memberUserId: string,
  enabled: boolean,
): Promise<ProjectSettingsMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    const capability = await requireProjectCapability(
      projectId,
      user.id,
      "manage_files",
    );

    const [target] = await db
      .select({
        role: projectMembers.role,
        fileUploadEnabled: projectMembers.fileUploadEnabled,
        username: profiles.username,
        fullName: profiles.fullName,
      })
      .from(projectMembers)
      .leftJoin(profiles, eq(profiles.id, projectMembers.userId))
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, memberUserId),
        ),
      )
      .limit(1);
    if (!target)
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project member not found.",
      };
    const targetRole = normalizeCollaboratorRole(
      target.role,
      memberUserId === capability.project.ownerId ? "owner" : "member",
    );
    if (targetRole === "owner" || targetRole === "admin") {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        message: "Owner and Co-leader upload access is always on.",
      };
    }
    if (targetRole === "viewer") {
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        message: "Viewers cannot upload files.",
      };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(projectMembers)
        .set({ fileUploadEnabled: enabled })
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, memberUserId),
          ),
        );
      await tx.insert(projectNodeEvents).values({
        projectId,
        actorId: user.id,
        nodeId: null,
        type: enabled
          ? "project_file_policy.member_upload_enabled"
          : "project_file_policy.member_upload_disabled",
        metadata: {
          targetUserId: memberUserId,
          targetDisplayName:
            target.fullName || target.username || "Project member",
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
        eventKey: "access.file_upload_permission_changed",
        affectedMemberId: memberUserId,
        title: enabled
          ? "File uploads enabled for you"
          : "File uploads disabled for you",
        body: enabled
          ? "You can upload files to this project workspace."
          : "You can no longer upload files to this project workspace.",
        sourceEventId: `${projectId}:file-upload:${memberUserId}:${enabled}`,
        entityRefs: { projectId, targetUserId: memberUserId },
      });
    } catch (notificationError) {
      logger.warn("project.member_file_upload_notification_failed", {
        module: "projects",
        projectId,
        targetUserId: memberUserId,
        error:
          notificationError instanceof Error
            ? notificationError.message
            : String(notificationError),
      });
    }
    return {
      success: true,
      message: enabled
        ? "Member file uploads enabled."
        : "Member file uploads disabled.",
    };
  } catch (error) {
    logger.error("project.member_file_upload_update_failed", {
      module: "projects",
      projectId,
      targetUserId: memberUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to manage file uploads.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to update member upload permission.",
    };
  }
}

export async function updateProjectFileUploadDefaultsAction(
  projectId: string,
  enabled: boolean,
): Promise<ProjectSettingsMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    const capability = await requireProjectCapability(
      projectId,
      user.id,
      "manage_files",
    );

    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .update(projectMembers)
        .set({ fileUploadEnabled: enabled })
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.role, "member"),
          ),
        )
        .returning({ userId: projectMembers.userId });
      await tx.insert(projectNodeEvents).values({
        projectId,
        actorId: user.id,
        nodeId: null,
        type: "project_file_policy.member_upload_bulk_changed",
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
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.role, "member"),
          ),
        );
      await enqueueProjectNotificationEvent({
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "access.file_upload_permission_changed",
        directRecipientIds: affectedUserIds.map((row) => row.userId),
        title: enabled
          ? "Project file uploads enabled"
          : "Project file uploads disabled",
        body: enabled
          ? "Members can upload files to this project workspace."
          : "Members can no longer upload files to this project workspace.",
        sourceEventId: `${projectId}:file-upload-defaults:${enabled}`,
        entityRefs: { projectId },
      });
    } catch (notificationError) {
      logger.warn("project.file_upload_defaults_notification_failed", {
        module: "projects",
        projectId,
        error:
          notificationError instanceof Error
            ? notificationError.message
            : String(notificationError),
      });
    }
    return {
      success: true,
      message: enabled
        ? `Enabled uploads for ${updated} member${updated === 1 ? "" : "s"}.`
        : `Disabled uploads for ${updated} member${updated === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    logger.error("project.file_upload_defaults_failed", {
      module: "projects",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to manage file uploads.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to update file upload defaults.",
    };
  }
}

export async function readProjectNotificationSettingsAction(
  projectId: string,
): Promise<ProjectNotificationSettingsResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    await requireProjectCapability(projectId, user.id, "manage_notifications");

    const [project] = await db
      .select({ notificationPreferences: projects.notificationPreferences })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project)
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project not found.",
      };

    const policy = normalizeProjectNotificationPolicy(
      project.notificationPreferences,
    );
    return {
      success: true,
      data: {
        policy,
        summary: summarizeProjectNotificationPolicy(policy),
      },
    };
  } catch (error) {
    logger.error("project.notification_settings_read_failed", {
      module: "projects",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to manage project notifications.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to load project notification settings.",
    };
  }
}

export async function updateProjectNotificationSettingsAction(
  projectId: string,
  input: unknown,
): Promise<ProjectNotificationSettingsResult & { message?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    const capability = await requireProjectCapability(
      projectId,
      user.id,
      "manage_notifications",
    );
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
        type: "project_notification_settings.updated",
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
      message: "Project notification settings updated.",
      data: {
        policy,
        summary: summarizeProjectNotificationPolicy(policy),
      },
    };
  } catch (error) {
    logger.error("project.notification_settings_update_failed", {
      module: "projects",
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to manage project notifications.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to update project notification settings.",
    };
  }
}

export async function resetProjectNotificationSettingsAction(
  projectId: string,
  preset: ProjectNotificationPreset = "balanced",
): Promise<ProjectNotificationSettingsResult & { message?: string }> {
  return updateProjectNotificationSettingsAction(
    projectId,
    buildDefaultProjectNotificationPolicy(preset),
  );
}

async function canViewProjectMemberNotificationSettings(
  projectId: string,
  actorUserId: string,
  memberUserId: string,
) {
  if (actorUserId === memberUserId) return true;
  try {
    await requireProjectCapability(
      projectId,
      actorUserId,
      "manage_notifications",
    );
    return true;
  } catch {
    return false;
  }
}

export async function readProjectMemberNotificationSettingsAction(
  projectId: string,
  memberUserId: string,
): Promise<ProjectMemberNotificationSettingsResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    if (
      !(await canViewProjectMemberNotificationSettings(
        projectId,
        user.id,
        memberUserId,
      ))
    ) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message:
          "You do not have permission to view these notification settings.",
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
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, memberUserId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    if (!member?.id) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project member not found.",
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
          membershipRole: normalizeCollaboratorRole(
            member.role,
            memberUserId === member.ownerId ? "owner" : "member",
          ),
        },
        canEdit: user.id === memberUserId,
        overrides: normalizeProjectMemberNotificationOverrides(
          member.notificationPreferences,
        ),
      },
    };
  } catch (error) {
    logger.error("project.member_notification_settings_read_failed", {
      module: "projects",
      projectId,
      targetUserId: memberUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to load member notification settings.",
    };
  }
}

export async function updateProjectMemberNotificationSettingsAction(
  projectId: string,
  memberUserId: string,
  input: unknown,
): Promise<ProjectMemberNotificationSettingsResult & { message?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    if (user.id !== memberUserId) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message:
          "Members can only update their own project notification settings.",
      };
    }
    const overrides = normalizeProjectMemberNotificationOverrides(input);

    const [updated] = await db
      .update(projectMembers)
      .set({ notificationPreferences: overrides })
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, memberUserId),
        ),
      )
      .returning({ userId: projectMembers.userId, role: projectMembers.role });
    if (!updated)
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project member not found.",
      };

    await db.insert(projectNodeEvents).values({
      projectId,
      actorId: user.id,
      nodeId: null,
      type: "project_notification_settings.member_updated",
      metadata: {
        targetUserId: memberUserId,
        mode: overrides.mode,
        customRules: Object.keys(overrides.rules).length,
      },
      createdAt: new Date(),
    });
    await revalidateProjectPaths(projectId);
    const read = await readProjectMemberNotificationSettingsAction(
      projectId,
      memberUserId,
    );
    if (!read.success) return read;
    return { ...read, message: "Project notification preferences updated." };
  } catch (error) {
    logger.error("project.member_notification_settings_update_failed", {
      module: "projects",
      projectId,
      targetUserId: memberUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to update member notification settings.",
    };
  }
}

export async function resetProjectMemberNotificationSettingsAction(
  projectId: string,
  memberUserId: string,
): Promise<ProjectMemberNotificationSettingsResult & { message?: string }> {
  return updateProjectMemberNotificationSettingsAction(
    projectId,
    memberUserId,
    {
      version: 1,
      mode: "inherit",
      rules: {},
    },
  );
}

export async function updateProjectMemberRoleAction(
  projectId: string,
  memberUserId: string,
  nextRole: "admin" | "member" | "viewer",
): Promise<ProjectMemberMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    if (!["admin", "member", "viewer"].includes(nextRole)) {
      return {
        success: false,
        errorCode: "INVALID_ROLE",
        message: "Invalid collaborator role.",
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
        if (message.includes("Project not found")) {
          return {
            ok: false as const,
            errorCode: "NOT_FOUND" as const,
            message: "Project not found.",
          };
        }
        if (message.includes("permission")) {
          return {
            ok: false as const,
            errorCode: "FORBIDDEN" as const,
            message,
          };
        }
        return {
          ok: false as const,
          errorCode: "INTERNAL_ERROR" as const,
          message: "Failed to update collaborator role.",
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
      const nextRoleLabel = collaboratorRoleLabel(
        result.lifecycle.nextRole ?? nextRole,
      );
      await enqueueProjectNotificationBestEffort(
        {
          projectId,
          actorUserId: user.id,
          ...actor,
          eventKey: "members.role_changed",
          affectedMemberId: memberUserId,
          title: `${actor.actorName || "Someone"} updated your project role`,
          body: result.lifecycle.project.title
            ? `${result.lifecycle.project.title}: ${nextRoleLabel}`
            : `New role: ${nextRoleLabel}`,
          href: `/projects/${encodeURIComponent(result.lifecycle.project.slug || projectId)}?tab=settings`,
          entityRefs: {
            projectId,
            projectSlug: result.lifecycle.project.slug ?? null,
            targetUserId: memberUserId,
            previousRole: result.lifecycle.previousRole
              ? collaboratorRoleLabel(result.lifecycle.previousRole)
              : null,
            nextRole: nextRoleLabel,
          },
          preview: {
            actorName: actor.actorName,
            actorAvatarUrl: actor.actorAvatarUrl,
            contextLabel: result.lifecycle.project.title ?? "Project",
            contextKind: "project",
            secondaryText: `Role changed to ${nextRoleLabel}`,
          },
          sourceEventId:
            result.lifecycle.eventId ??
            `${result.lifecycle.previousRole}:${result.lifecycle.nextRole}`,
        },
        {
          action: "member_role_changed",
          targetUserId: memberUserId,
        },
      );
    }

    return {
      success: true,
      message: result.lifecycle.changed
        ? `Updated collaborator role to ${collaboratorRoleLabel(result.lifecycle.nextRole ?? nextRole)}.`
        : "Collaborator already has that role.",
    };
  } catch (error) {
    console.error("Failed to update project member role:", error);
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to update collaborator role.",
    };
  }
}

export async function getProjectMemberRemovalPreflightAction(
  projectId: string,
  memberUserId: string,
): Promise<ProjectMemberRemovalPreflightResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    const capability = await requireProjectCapability(
      projectId,
      user.id,
      "manage_collaborators",
    );
    if (memberUserId === capability.project.ownerId) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "Use transfer ownership before removing the owner.",
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
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, memberUserId),
        ),
      )
      .limit(1);
    if (!memberRow?.id) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "This user is no longer a project member.",
      };
    }
    const actorRole = capability.role;
    const targetRole = normalizeCollaboratorRole(
      memberRow.role,
      memberUserId === capability.project.ownerId ? "owner" : "member",
    );
    if (!canProjectRoleManageTarget({ actorRole, targetRole })) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to remove this collaborator.",
      };
    }
    const roleTitleByUser = await readAcceptedRoleTitles(projectId, [
      memberUserId,
    ]);
    const [projectRow] = await db
      .select({
        conversationId: projects.conversationId,
        visibility: projects.visibility,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const counts = (
      await readProjectCollaboratorResponsibilityCounts(
        projectId,
        [memberUserId],
        projectRow?.conversationId ?? null,
      )
    ).get(memberUserId);
    const impact = await readProjectMemberRemovalImpact(
      db,
      projectId,
      memberUserId,
    );

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
        acceptedApplicationItems: impact.acceptedApplications.map(
          (application) => ({
            ...application,
            roleId: application.roleId || "",
            roleTitle: application.roleTitle ?? null,
            roleName: application.roleName ?? null,
          }),
        ),
        reassignmentCandidates: impact.reassignmentCandidates.map(
          (candidate) => ({
            id: candidate.id,
            username: candidate.username,
            fullName: candidate.fullName,
            avatarUrl: candidate.avatarUrl,
            membershipRole: normalizeCollaboratorRole(
              candidate.role,
              candidate.id === capability.project.ownerId ? "owner" : "member",
            ),
          }),
        ),
      },
    };
  } catch (error) {
    console.error("Failed to load member removal preflight:", error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Project not found")) {
      return {
        success: false,
        errorCode: "NOT_FOUND",
        message: "Project not found.",
      };
    }
    if (message.includes("permission")) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "You do not have permission to remove this collaborator.",
      };
    }
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to load removal preflight.",
    };
  }
}

const removeProjectMemberSchema = z.object({
  mode: z
    .enum([
      "preserve_history",
      "unassign_active_tasks",
      "reassign_active_tasks",
    ])
    .default("preserve_history"),
  reassignToUserId: z.string().uuid().nullable().optional(),
});

export async function removeProjectMemberAction(
  projectId: string,
  memberUserId: string,
  options?: {
    mode?:
      | "preserve_history"
      | "unassign_active_tasks"
      | "reassign_active_tasks";
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
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    const parsed = removeProjectMemberSchema.safeParse(options ?? {});
    if (!parsed.success)
      return {
        success: false,
        errorCode: "INVALID_INPUT",
        message: "Invalid removal options.",
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
        if (message.includes("Project not found")) {
          return {
            ok: false as const,
            errorCode: "NOT_FOUND" as const,
            message: "Project not found.",
          };
        }
        if (message.includes("permission") || message.includes("owner")) {
          return {
            ok: false as const,
            errorCode: "FORBIDDEN" as const,
            message,
          };
        }
        if (
          message.includes("Replacement") ||
          message.includes("valid replacement")
        ) {
          return {
            ok: false as const,
            errorCode: "INVALID_INPUT" as const,
            message,
          };
        }
        return {
          ok: false as const,
          errorCode: "INTERNAL_ERROR" as const,
          message: "Failed to remove collaborator.",
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
        eventKey: "members.removed",
        affectedMemberId: memberUserId,
        title: `${actor.actorName || "Someone"} removed you from a project`,
        body: txResult.lifecycle.project.title ?? "Project access removed",
        href: `/projects/${encodeURIComponent(txResult.lifecycle.project.slug || projectId)}`,
        entityRefs: {
          projectId,
          projectSlug: txResult.lifecycle.project.slug ?? null,
          targetUserId: memberUserId,
        },
        preview: {
          actorName: actor.actorName,
          actorAvatarUrl: actor.actorAvatarUrl,
          contextLabel: txResult.lifecycle.project.title ?? "Project",
          contextKind: "project",
          secondaryText: "Removed from project",
        },
        sourceEventId:
          txResult.lifecycle.eventId ??
          `${txResult.lifecycle.previousRole}:removed`,
      },
      {
        action: "member_removed",
        targetUserId: memberUserId,
      },
    );
    return {
      success: true,
      message: "Collaborator removed. Historical references were preserved.",
    };
  } catch (error) {
    console.error("Failed to remove project member:", error);
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to remove collaborator.",
    };
  }
}

export async function getProjectDangerZonePreflightAction(
  projectId: string,
): Promise<ProjectDangerZonePreflightResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
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
        .where(
          and(
            eq(roleApplications.projectId, projectId),
            eq(roleApplications.status, "pending"),
          ),
        )
        .limit(1),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
            sql`${tasks.status} <> 'done'`,
          ),
        )
        .limit(1),
    ]);

    const status =
      owned.project.status === "draft" ||
      owned.project.status === "active" ||
      owned.project.status === "completed" ||
      owned.project.status === "archived"
        ? owned.project.status
        : "draft";
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
        canArchive: status !== "archived",
        canDelete: true,
      },
    };
  } catch (error) {
    console.error("Failed to run danger-zone preflight:", error);
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to prepare danger-zone checks.",
    };
  }
}

export async function archiveProjectAction(
  projectId: string,
): Promise<ProjectSettingsMutationResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    }

    const owned = await loadOwnedProjectForSettings(projectId, user.id);
    if (!owned.ok)
      return {
        success: false,
        errorCode: owned.errorCode,
        message: owned.message,
      };
    if (owned.project.status === "archived") {
      return { success: true, message: "Project is already archived." };
    }

    const archivedAt = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({ status: "archived", updatedAt: archivedAt })
        .where(eq(projects.id, projectId));
      const ended = await tx
        .update(projectGuidanceAppointments)
        .set({
          status: "ended",
          endedAt: archivedAt,
          endedBy: user.id,
          endReason: "Project archived",
          updatedAt: archivedAt,
        })
        .where(
          and(
            eq(projectGuidanceAppointments.projectId, projectId),
            eq(projectGuidanceAppointments.status, "active"),
          ),
        )
        .returning({ id: projectGuidanceAppointments.id });
      if (ended.length > 0) {
        await tx.insert(projectNodeEvents).values({
          projectId,
          actorId: user.id,
          nodeId: null,
          type: "project_guidance.ended",
          metadata: {
            reason: "project_archived",
            appointmentId: ended[0]?.id ?? null,
          },
          createdAt: archivedAt,
        });
      }
    });
    await revalidateProjectPaths(projectId);
    const actor = actorNotificationSnapshot(user);
    await enqueueProjectNotificationBestEffort(
      {
        projectId,
        actorUserId: user.id,
        ...actor,
        eventKey: "security.project_archived",
        title: `${actor.actorName || "Someone"} archived ${owned.project.title || "Project"}`,
        body: "The project was archived from settings.",
        href: `/projects/${encodeURIComponent(owned.project.slug || projectId)}?tab=settings&settings=security-data`,
        sourceEventId: `archive:${projectId}`,
        entityRefs: {
          projectId,
          projectSlug: owned.project.slug ?? null,
        },
      },
      { action: "archive" },
    );

    logger.metric("project.settings.archive.result", {
      projectId,
      userId: user.id,
      result: "success",
    });
    return { success: true, message: "Project archived." };
  } catch (error) {
    console.error("Failed to archive project:", error);
    logger.metric("project.settings.archive.result", {
      projectId,
      result: "error",
      errorCode: "INTERNAL_ERROR",
    });
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to archive project.",
    };
  }
}

// --- Delete Action ---
export async function deleteProject(
  projectId: string,
): Promise<
  | { success: true; message: string; data: { redirectTo: string } }
  | { success: false; message: string; errorCode: ProjectSettingsErrorCode }
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
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
        errorCode: "NOT_FOUND",
        message: "Project not found.",
      };
    }
    if (project.ownerId !== user.id) {
      return {
        success: false,
        errorCode: "FORBIDDEN",
        message: "Only the project owner can delete this project.",
      };
    }

    // 1. Get ALL S3 keys for this project before deleting nodes
    const fileNodes = await db
      .select({ s3Key: projectNodes.s3Key })
      .from(projectNodes)
      .where(
        and(
          eq(projectNodes.projectId, projectId),
          isNotNull(projectNodes.s3Key),
        ),
      );

    const s3Keys = fileNodes.map((n) => n.s3Key!).filter(Boolean);

    // 2. Hard-Delete Transaction
    await db.transaction(async (tx) => {
      // A. Update application messages to show "project_deleted" status
      await tx.execute(sql`
                UPDATE ${messages}
                SET metadata = jsonb_set(
                    (
                        COALESCE(metadata, '{}'::jsonb)
                        - 'projectId'
                    ) #- '{structured,entityRefs,projectId}',
                    '{status}',
                    '"project_deleted"',
                    true
                )
                WHERE metadata->>'projectId' = ${projectId}
                   OR metadata #>> '{structured,entityRefs,projectId}' = ${projectId}
            `);

      // B. Hard-delete the project (cascades to nodes, tasks, sprints, members, etc.)
      const deletedProjects = await tx
        .delete(projects)
        .where(eq(projects.id, projectId))
        .returning({ id: projects.id });
      if (project.conversationId) {
        await tx
          .delete(conversations)
          .where(eq(conversations.id, project.conversationId));
      }

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
        await adminClient.storage.from("project-files").remove(s3Keys);
      } catch (storageError) {
        console.error(
          "Failed to cleanup S3 files for project:",
          projectId,
          storageError,
        );
        // Don't fail the whole action if storage cleanup fails
      }
    }

    logger.metric("project.settings.delete.result", {
      projectId,
      userId: user.id,
      result: "success",
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
    logger.metric("project.settings.delete.result", {
      projectId,
      result: "error",
      errorCode: "INTERNAL_ERROR",
    });
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message: "Failed to delete project.",
    };
  }
}

/**
 * Deep deletion of a project draft.
 * Wipes DB records and S3 assets completely.
 */
export async function deleteProjectDraftAction(
  projectId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const [project] = await db
      .select({
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
      await tx
        .update(profiles)
        .set({ projectsCount: sql`GREATEST(0, ${profiles.projectsCount} - 1)` })
        .where(eq(profiles.id, user.id));
      if (project.conversationId) {
        await tx
          .delete(conversations)
          .where(eq(conversations.id, project.conversationId));
      }
    });

    // 3. Wipe S3 (Best Effort - Deep recursive wipe of entire project prefix)
    try {
      const adminClient = await createAdminClient();

      // Recursive list and delete helper
      const purgeFolder = async (folderPath: string) => {
        const { data: files, error } = await adminClient.storage
          .from("project-files")
          .list(folderPath, {
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
          await adminClient.storage.from("project-files").remove(filesToDelete);
        }

        // Recurse into subfolders (Pure optimization: Parallel recursion)
        if (subFolders.length > 0) {
          await Promise.all(subFolders.map((sf) => purgeFolder(sf)));
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

export async function toggleProjectFollowAction(
  projectId: string,
  shouldFollow: boolean,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };
  try {
    const followRate = await consumeRateLimit(
      `project-follow:${user.id}`,
      80,
      60,
    );
    if (!followRate.allowed) {
      return {
        success: false,
        error: "Too many follow actions. Please wait and try again.",
      };
    }
    const access = await getProjectAccessById(projectId, user.id);
    if (!access.project || !access.canRead) {
      return { success: false, error: "Project not found or private." };
    }

    const followersCount = await db.transaction(async (tx) => {
      await lockProjectUserPair(tx, projectId, user.id);

      if (shouldFollow) {
        const inserted = await tx
          .insert(projectFollows)
          .values({ userId: user.id, projectId })
          .onConflictDoNothing({
            target: [projectFollows.projectId, projectFollows.userId],
          })
          .returning({ id: projectFollows.id });

        if (inserted.length > 0) {
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
          .where(
            and(
              eq(projectFollows.userId, user.id),
              eq(projectFollows.projectId, projectId),
            ),
          )
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
    if (!isMissingCounterColumn(error, "followers_count")) {
      console.error("Error toggling follow:", error);
      return { success: false, error: "Failed to update follow status" };
    }
    // ponytail: only the exact pre-counter schema needs the compatibility path.
    try {
      if (shouldFollow) {
        const [existing] = await db
          .select({ id: projectFollows.id })
          .from(projectFollows)
          .where(
            and(
              eq(projectFollows.userId, user.id),
              eq(projectFollows.projectId, projectId),
            ),
          )
          .limit(1);
        if (!existing) {
          await db
            .insert(projectFollows)
            .values({ userId: user.id, projectId });
        }
      } else {
        await db
          .delete(projectFollows)
          .where(
            and(
              eq(projectFollows.userId, user.id),
              eq(projectFollows.projectId, projectId),
            ),
          );
      }
      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(projectFollows)
        .where(eq(projectFollows.projectId, projectId));
      await revalidateProjectPaths(projectId);
      return { success: true, followersCount: Number(countRow?.count || 0) };
    } catch (fallbackError) {
      console.error("Error toggling follow (fallback):", fallbackError);
      return { success: false, error: "Failed to update follow status" };
    }
  }
}

export async function incrementProjectViewAction(
  projectId: string,
): Promise<{ success: boolean; viewCount?: number; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const access = await getProjectAccessById(projectId, user?.id ?? null);
    if (!access.project || !access.canRead) {
      return { success: false, error: "Project not found" };
    }

    const writeThroughEnabled =
      process.env.PROJECT_VIEWS_WRITE_THROUGH === "1" || !redis;

    if (writeThroughEnabled) {
      const [updated] = await db
        .update(projects)
        .set({ viewCount: sql`${projects.viewCount} + 1` })
        .where(eq(projects.id, projectId))
        .returning({ viewCount: projects.viewCount });

      return { success: true, viewCount: Number(updated?.viewCount ?? 1) };
    } else {
      const bufferedVal = await redis!.hincrby("project:views", projectId, 1);
      const cacheKey = `project:views:base:${projectId}`;
      let dbVal: number;
      const cached = await redis!.get(cacheKey);
      if (cached !== null) {
        dbVal = parseInt(cached as string, 10) || 0;
      } else {
        const [dbRow] = await db
          .select({ viewCount: projects.viewCount })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);
        dbVal = dbRow?.viewCount ?? 0;
        await redis!.set(cacheKey, dbVal, { ex: 60 });
      }
      return { success: true, viewCount: dbVal + bufferedVal };
    }
  } catch (e) {
    if (isMissingCounterColumn(e, "view_count")) {
      return {
        success: false,
        error: "Project views are unavailable until migrations are applied",
      };
    }
    console.error("Failed to increment view", e);
    return { success: false, error: "Failed to increment view" };
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
  return await runInFlightDeduped(
    `project:user-state:${projectId}:${user.id}`,
    async () => {
      const [follow, project] = await Promise.all([
        db
          .select()
          .from(projectFollows)
          .where(
            and(
              eq(projectFollows.projectId, projectId),
              eq(projectFollows.userId, user.id),
            ),
          )
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
      if (
        project[0] &&
        !project[0].conversationId &&
        project[0].ownerId === user.id
      ) {
        await ensureProjectGroupExists(projectId, project[0].ownerId);
      }

      return {
        isFollowing: !!follow[0],
        isOwner: project[0]?.ownerId === user.id,
      };
    },
  );
}

// Helper: Map wizard status to database status
function mapStatus(
  status?: string,
): "draft" | "active" | "completed" | "archived" {
  switch (status) {
    case "open":
    case "active":
      return "active";
    case "completed":
      return "completed";
    case "archived":
      return "archived";
    default:
      return "draft";
  }
}

type TaskPaginationCursor = {
  createdAt: Date;
  id: string;
  rank?: number;
  position?: number;
};

type SprintDetailPaginationCursor = {
  activityAt: Date;
  taskId: string;
};

function parseTaskPaginationCursor(
  cursor?: string,
): TaskPaginationCursor | null {
  if (!cursor) return null;

  try {
    const parsed = JSON.parse(cursor) as {
      createdAt?: unknown;
      id?: unknown;
      rank?: unknown;
      position?: unknown;
    };
    if (
      typeof parsed.createdAt === "string" &&
      typeof parsed.id === "string" &&
      parsed.id.length > 0
    ) {
      const parsedDate = new Date(parsed.createdAt);
      if (!Number.isNaN(parsedDate.getTime())) {
        return {
          createdAt: parsedDate,
          id: parsed.id,
          rank: typeof parsed.rank === "number" ? parsed.rank : undefined,
          position:
            typeof parsed.position === "number" &&
            Number.isFinite(parsed.position)
              ? parsed.position
              : undefined,
        };
      }
    }
  } catch {
    // Backward compatibility: legacy cursor was a plain ISO timestamp string.
  }

  const legacyDate = new Date(cursor);
  if (Number.isNaN(legacyDate.getTime())) return null;
  return { createdAt: legacyDate, id: "" };
}

function encodeTaskPaginationCursor(cursor: TaskPaginationCursor): string {
  return JSON.stringify({
    createdAt: cursor.createdAt.toISOString(),
    id: cursor.id,
    rank: cursor.rank,
    position: cursor.position,
  });
}

function parseSprintDetailPaginationCursor(
  cursor?: string,
): SprintDetailPaginationCursor | null {
  if (!cursor) return null;

  try {
    const parsed = JSON.parse(cursor) as {
      activityAt?: unknown;
      taskId?: unknown;
    };
    if (
      typeof parsed.activityAt === "string" &&
      typeof parsed.taskId === "string" &&
      parsed.taskId.length > 0
    ) {
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

function encodeSprintDetailPaginationCursor(
  cursor: SprintDetailPaginationCursor,
): string {
  return JSON.stringify({
    activityAt: cursor.activityAt.toISOString(),
    taskId: cursor.taskId,
  });
}

// ============================================================================
// TASK & SPRINT ACTIONS (PHASE 8 OPTIMIZATION)
// ============================================================================

// --- Fetch Actions (Optimization) ---

async function fetchProjectTasksForActor(
  projectId: string,
  actorId: string | null,
  limit: number = 100,
  cursor?: string,
  scope: "all" | "backlog" | "sprint" = "all",
  search: string = "",
  authorizedAccess?: ProjectAccess,
  surface: "full" | "preview" = "full",
) {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const normalizedScope =
    scope === "backlog" || scope === "sprint" ? scope : "all";
  const normalizedSearch = normalizeSearchQuery(search);
  const searchPattern = normalizedSearch
    ? containsLikePattern(normalizedSearch)
    : null;
  const taskNumberMatch = normalizedSearch.match(/^(?:#|[a-z0-9]+-)?(\d+)$/i);
  const taskNumberSearch = taskNumberMatch ? Number(taskNumberMatch[1]) : null;
  const escapedSearch = escapeLikePattern(normalizedSearch);
  const titlePrefixPattern = `${escapedSearch}%`;
  const searchRankExpr = searchPattern
    ? sql<number>`CASE
            WHEN ${taskNumberSearch !== null ? sql`${tasks.taskNumber} = ${taskNumberSearch}` : sql`FALSE`} THEN 500
            WHEN lower(${tasks.title}) = ${normalizedSearch.toLowerCase()} THEN 400
            WHEN ${tasks.title} ILIKE ${titlePrefixPattern} THEN 300
            WHEN ${tasks.title} ILIKE ${searchPattern} THEN 200
            WHEN ${tasks.description} ILIKE ${searchPattern} THEN 100
            ELSE 0
        END`
    : null;
  const parsedCursor = parseTaskPaginationCursor(cursor);
  const cursorCreatedAtKey = parsedCursor?.createdAt.toISOString() ?? "head";
  const cursorIdKey = parsedCursor?.id || "none";

  if (normalizedSearch) {
    const searchRate = await consumeRateLimit(
      `project-task-search:${actorId ?? `anon:${projectId}`}`,
      90,
      60,
    );
    if (!searchRate.allowed) {
      return {
        success: false as const,
        code: "RATE_LIMITED" as const,
        retryAfterMs: 1_000,
        error: "Too many task searches. Please wait and try again.",
      };
    }
  }

  return await runInFlightDeduped(
    `project:tasks:${projectId}:${actorId ?? "anon"}:${safeLimit}:${cursorCreatedAtKey}:${cursorIdKey}:${normalizedScope}:${normalizedSearch}:${surface}`,
    async () => {
      // Enforce read access server-side through the canonical project access policy.
      const access =
        authorizedAccess?.project?.id === projectId
          ? authorizedAccess
          : await getProjectAccessById(projectId, actorId);
      if (!access.project) throw new Error("Project not found");
      if (!access.canRead) throw new Error("Forbidden");

      const projectTasks = await db.query.tasks.findMany({
        where: (t, { eq, and, or, lt, isNull, isNotNull, ilike }) => {
          const positionExpr = sql<number>`COALESCE(${t.position}, 0)`;
          let pageCursor;
          if (parsedCursor) {
            const createdAtCursor = or(
              lt(t.createdAt, parsedCursor.createdAt),
              and(
                eq(t.createdAt, parsedCursor.createdAt),
                lt(t.id, parsedCursor.id),
              ),
            );
            const positionCursor =
              parsedCursor.position === undefined
                ? createdAtCursor
                : or(
                    sql`${positionExpr} < ${parsedCursor.position}`,
                    and(
                      sql`${positionExpr} = ${parsedCursor.position}`,
                      createdAtCursor,
                    ),
                  );
            pageCursor =
              searchRankExpr && parsedCursor.rank !== undefined
                ? or(
                    sql`${searchRankExpr} < ${parsedCursor.rank}`,
                    and(
                      sql`${searchRankExpr} = ${parsedCursor.rank}`,
                      positionCursor,
                    ),
                  )
                : positionCursor;
          }
          return and(
            eq(t.projectId, projectId),
            isNull(t.deletedAt),
            searchPattern
              ? or(
                  ilike(t.title, searchPattern),
                  taskNumberSearch !== null
                    ? eq(t.taskNumber, taskNumberSearch)
                    : undefined,
                )
              : undefined,
            pageCursor,
            normalizedScope === "backlog"
              ? isNull(t.sprintId)
              : normalizedScope === "sprint"
                ? isNotNull(t.sprintId)
                : undefined,
          );
        },
        orderBy: (t, { desc }) =>
          searchRankExpr
            ? [
                desc(searchRankExpr),
                sql`COALESCE(${t.position}, 0) DESC`,
                desc(t.createdAt),
                desc(t.id),
              ]
            : [
                sql`COALESCE(${t.position}, 0) DESC`,
                desc(t.createdAt),
                desc(t.id),
              ],
        limit: safeLimit + 1,
        extras: {
          ...(searchRankExpr
            ? { searchRank: searchRankExpr.as("search_rank") }
            : {}),
        },
        columns: {
          id: true,
          projectId: true,
          sprintId: true,
          assigneeId: true,
          creatorId: true,
          workflowColumnId: true,
          title: true,
          description: surface === "full",
          status: true,
          reviewStatus: true,
          position: true,
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
          ...(surface === "preview"
            ? {}
            : {
                creator: {
                  columns: {
                    id: true,
                    fullName: true,
                    avatarUrl: true,
                  },
                },
              }),
        },
      });

      const hasMore = projectTasks.length > safeLimit;
      const limitedTasks = projectTasks.slice(0, safeLimit);
      const taskIds = limitedTasks.map((task) => task.id);
      const countRows = taskIds.length === 0 || surface === "preview"
        ? []
        : Array.from(await db.execute<{
            task_id: string;
            subtask_count: number;
            completed_subtask_count: number;
            new_subtask_count: number;
            file_count: number;
            new_file_count: number;
            comment_count: number;
            new_comment_count: number;
          }>(sql`
            WITH selected_tasks AS (
              SELECT task.id, task.created_at, ${actorId ? sql`receipt.last_read_at` : sql`NULL::timestamptz`} AS last_read_at
              FROM tasks task
              ${actorId ? sql`LEFT JOIN task_read_receipts receipt ON receipt.task_id = task.id AND receipt.user_id = ${actorId}::uuid` : sql``}
              WHERE task.id IN (${sql.join(taskIds.map((id) => sql`${id}::uuid`), sql`, `)})
            ), subtask_counts AS (
              SELECT subtask.task_id,
                     count(*)::int AS total,
                     count(*) FILTER (WHERE subtask.completed)::int AS completed,
                     count(*) FILTER (
                       WHERE ${actorId}::uuid IS NOT NULL
                         AND subtask.created_at > COALESCE(selected.last_read_at, selected.created_at)
                     )::int AS new_count
              FROM task_subtasks subtask
              JOIN selected_tasks selected ON selected.id = subtask.task_id
              GROUP BY subtask.task_id
            ), file_counts AS (
              SELECT link.task_id,
                     count(*)::int AS total,
                     count(*) FILTER (
                       WHERE ${actorId}::uuid IS NOT NULL
                         AND link.linked_at > COALESCE(selected.last_read_at, selected.created_at)
                     )::int AS new_count
              FROM task_node_links link
              JOIN selected_tasks selected ON selected.id = link.task_id
              JOIN project_nodes node ON node.id = link.node_id AND node.deleted_at IS NULL
              GROUP BY link.task_id
            ), comment_counts AS (
              SELECT comment.task_id,
                     count(*)::int AS total,
                     count(*) FILTER (
                       WHERE ${actorId}::uuid IS NOT NULL
                         AND comment.created_at > COALESCE(selected.last_read_at, selected.created_at)
                     )::int AS new_count
              FROM task_comments comment
              JOIN selected_tasks selected ON selected.id = comment.task_id
              WHERE comment.deleted_at IS NULL
              GROUP BY comment.task_id
            )
            SELECT selected.id AS task_id,
                   COALESCE(subtask.total, 0)::int AS subtask_count,
                   COALESCE(subtask.completed, 0)::int AS completed_subtask_count,
                   COALESCE(subtask.new_count, 0)::int AS new_subtask_count,
                   COALESCE(file.total, 0)::int AS file_count,
                   COALESCE(file.new_count, 0)::int AS new_file_count,
                   COALESCE(comment.total, 0)::int AS comment_count,
                   COALESCE(comment.new_count, 0)::int AS new_comment_count
            FROM selected_tasks selected
            LEFT JOIN subtask_counts subtask ON subtask.task_id = selected.id
            LEFT JOIN file_counts file ON file.task_id = selected.id
            LEFT JOIN comment_counts comment ON comment.task_id = selected.id
          `));
      const countsByTaskId = new Map(countRows.map((row) => [row.task_id, row]));
      const normalizedTasks = limitedTasks.map((task) => {
        const counts = countsByTaskId.get(task.id);
        return normalizeTaskSurfaceRecord({
          ...task,
          subtaskCount: Number(counts?.subtask_count ?? 0),
          completedSubtaskCount: Number(counts?.completed_subtask_count ?? 0),
          newSubtaskCount: Number(counts?.new_subtask_count ?? 0),
          fileCount: Number(counts?.file_count ?? 0),
          newFileCount: Number(counts?.new_file_count ?? 0),
          commentCount: Number(counts?.comment_count ?? 0),
          newCommentCount: Number(counts?.new_comment_count ?? 0),
        });
      });
      const nextCursor = hasMore
        ? encodeTaskPaginationCursor({
            createdAt: new Date(
              normalizedTasks[normalizedTasks.length - 1]!.createdAt ??
                new Date().toISOString(),
            ),
            id: normalizedTasks[normalizedTasks.length - 1]!.id,
            rank: searchRankExpr
              ? Number(
                  (
                    projectTasks[safeLimit - 1] as
                      | { searchRank?: number }
                      | undefined
                  )?.searchRank ?? 0,
                )
              : undefined,
            position: Number(
              normalizedTasks[normalizedTasks.length - 1]!.position ?? 0,
            ),
          })
        : undefined;

      return {
        success: true as const,
        tasks: normalizedTasks,
        nextCursor,
        hasMore,
      };
    },
  );
}

export async function markTaskAsReadAction(taskId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Unauthorized" };

    await db
      .insert(taskReadReceipts)
      .values({ taskId, userId: user.id })
      .onConflictDoUpdate({
        target: [taskReadReceipts.taskId, taskReadReceipts.userId],
        set: { lastReadAt: sql`NOW()` },
      });

    return { success: true };
  } catch (error) {
    console.error("Failed to mark task as read:", error);
    return { success: false, error: "Failed to mark task as read" };
  }
}

export async function fetchProjectTasksAction(
  projectId: string,
  limit: number = 100,
  cursor?: string,
  scope: "all" | "backlog" | "sprint" = "all",
  search: string = "",
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return await fetchProjectTasksForActor(
      projectId,
      user?.id ?? null,
      limit,
      cursor,
      scope,
      search,
    );
  } catch (error) {
    console.error("Failed to fetch tasks:", error);
    return { success: false as const, error: "Failed to fetch tasks" };
  }
}

const projectTaskPreviewInputSchema = z.object({
  slugOrId: z.string().trim().min(1).max(200),
  search: z.string().trim().min(2).max(100),
  limit: z.number().int().min(1).max(12).default(6),
});

export async function fetchProjectLinkPreviewsAction(input: {
  slugOrId: string;
  search: string;
  limit?: number;
}) {
  try {
    const parsed = projectTaskPreviewInputSchema.parse(input);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    const access = await getProjectAccessByIdentifier(parsed.slugOrId, actorId);
    if (!access.project) return { success: false as const, code: "NOT_FOUND" as const, error: "Project not found" };
    if (!access.canRead) return { success: false as const, code: "FORBIDDEN" as const, error: "Forbidden" };

    const [project] = await db
      .select({ id: projects.id, externalLinks: projects.externalLinks, githubRepoUrl: projects.githubRepoUrl })
      .from(projects)
      .where(and(eq(projects.id, access.project.id), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) return { success: false as const, code: "NOT_FOUND" as const, error: "Project not found" };

    const query = parsed.search.toLocaleLowerCase();
    const canViewMemberLinks = access.isOwner || Boolean(access.memberRole);
    const links = resolveProjectSocialLinks(project.externalLinks, project.githubRepoUrl)
      .filter((link) => link.audience !== "members" || canViewMemberLinks)
      .filter((link) => [
        link.customLabel,
        link.platformLabel,
        link.accountLabel,
        PROJECT_LINK_PURPOSE_LABELS[link.purpose],
        link.serviceKey,
      ].some((value) => value?.toLocaleLowerCase().includes(query)))
      .slice(0, parsed.limit)
      .map((link) => ({
        id: link.id || link.canonicalKey,
        title: link.customLabel || link.platformLabel,
        subtitle: link.accountLabel,
        platform: link.serviceKey || link.platform,
        iconKey: link.iconKey,
        purpose: link.purpose,
        audience: link.audience,
        href: `/go/project/${encodeURIComponent(project.id)}/${encodeURIComponent(link.id || link.canonicalKey)}`,
      }));
    return { success: true as const, links };
  } catch (error) {
    return {
      success: false as const,
      code: error instanceof z.ZodError ? "VALIDATION" as const : "TRANSIENT" as const,
      error: "Failed to fetch project link previews",
    };
  }
}

export async function fetchProjectTaskPreviewsAction(input: {
  slugOrId: string;
  search: string;
  limit?: number;
}) {
  const startedAt = performance.now();
  let metricSearch = "";
  try {
    const parsed = projectTaskPreviewInputSchema.parse(input);
    metricSearch = parsed.search;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    const access = await getProjectAccessByIdentifier(parsed.slugOrId, actorId);
    if (!access.project)
      return {
        success: false as const,
        code: "NOT_FOUND" as const,
        error: "Project not found",
      };
    if (!access.canRead)
      return {
        success: false as const,
        code: "FORBIDDEN" as const,
        error: "Forbidden",
      };
    const cacheKey = `search:preview:tasks:${actorId ?? "anon"}:${parsed.slugOrId}:${parsed.search.toLowerCase()}`;
    const cached = await getCachedData<any>(cacheKey);
    if (cached) {
      recordGlobalSearchMetric({
        domain: "project-tasks",
        scope: "all",
        outcome: cached.tasks.length > 0 ? "success" : "empty",
        durationMs: performance.now() - startedAt,
        resultCount: cached.tasks.length,
        queryLength: parsed.search.length,
        tokenCount: tokenizeSearchQuery(parsed.search).length,
      });
      return cached as Awaited<ReturnType<typeof fetchProjectTasksForActor>>;
    }
    const result = await fetchProjectTasksForActor(
      access.project.id,
      actorId,
      parsed.limit,
      undefined,
      "all",
      parsed.search,
      access,
      "preview",
    );
    recordGlobalSearchMetric({
      domain: "project-tasks",
      scope: "all",
      outcome: result.success
        ? result.tasks.length > 0
          ? "success"
          : "empty"
        : result.code === "RATE_LIMITED"
          ? "rate-limited"
          : "error",
      durationMs: performance.now() - startedAt,
      resultCount: result.success ? result.tasks.length : 0,
      queryLength: parsed.search.length,
      tokenCount: tokenizeSearchQuery(parsed.search).length,
    });
    if (result.success && result.tasks.length > 0) {
      await cacheData(cacheKey, result, 180);
    }
    return result;
  } catch (error) {
    if (metricSearch) {
      recordGlobalSearchMetric({
        domain: "project-tasks",
        scope: "all",
        outcome: "error",
        durationMs: performance.now() - startedAt,
        resultCount: 0,
        queryLength: metricSearch.length,
        tokenCount: tokenizeSearchQuery(metricSearch).length,
      });
    }
    console.error("Failed to fetch task previews:", error);
    const message = error instanceof Error ? error.message : "";
    const code =
      error instanceof z.ZodError
        ? ("VALIDATION" as const)
        : message === "Forbidden"
          ? ("FORBIDDEN" as const)
          : message === "Project not found"
            ? ("NOT_FOUND" as const)
            : ("TRANSIENT" as const);
    return {
      success: false as const,
      code,
      error:
        code === "TRANSIENT"
          ? "Failed to fetch task previews"
          : code === "VALIDATION"
            ? "Invalid task preview request"
            : message,
    };
  }
}

export async function fetchProjectSprintsAction(
  projectId: string,
  limit: number = 120,
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    return await runInFlightDeduped(
      `project:sprints:${projectId}:${actorId ?? "anon"}:${safeLimit}`,
      async () => {
        await assertProjectReadAccess(projectId, actorId);

        const projectSprintsList = await readProjectSprintsList(
          projectId,
          safeLimit,
        );

        return { success: true as const, sprints: projectSprintsList };
      },
    );
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
  membership_removed_at: Date | string | null;
  deleted_at: Date | string | null;
  linked_file_count: number;
  assignee_id: string | null;
  creator_id: string | null;
};

type SprintSummaryQueryRow = {
  total_tasks: number;
  completed_tasks: number;
  blocked_tasks: number;
  linked_file_count: number;
  total_story_points: number;
  completed_story_points: number;
};

const acceptedRoleTitleSql = (projectId: string, userId: unknown) => sql<
  string | null
>`(
    SELECT COALESCE(NULLIF(ra.accepted_role_title, ''), NULLIF(por.title, ''), NULLIF(por.role, ''))
    FROM role_applications ra
    LEFT JOIN project_open_roles por ON por.id = ra.role_id
    WHERE ra.project_id = ${projectId}
      AND ra.applicant_id = ${userId}
      AND ra.status = 'accepted'
    ORDER BY ra.updated_at DESC
    LIMIT 1
)`;

function formatSprintMemberRole(
  role: string | null | undefined,
  isOwner: boolean = false,
) {
  if (isOwner) return "Owner";
  if (role === "admin") return "Admin";
  if (role === "member") return "Member";
  if (role === "viewer") return "Viewer";
  return null;
}

function serializeSprintListItem(sprint: {
  id: string;
  projectId: string;
  sprintNumber: number;
  creatorId?: string | null;
  name: string;
  goal: string | null;
  description: string | null;
  startDate: Date | null;
  endDate: Date | null;
  status: SprintListItem["status"];
  startedAt?: Date | null;
  completedAt?: Date | null;
  archivedAt?: Date | null;
  cancelledAt?: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  creatorName?: string | null;
  creatorAvatarUrl?: string | null;
  creatorRole?: string | null;
  creatorRoleTitle?: string | null;
}): SprintListItem {
  const membershipRoleLabel = formatSprintMemberRole(
    sprint.creatorRole,
    sprint.creatorRole === "owner",
  );
  const roleLabel = sprint.creatorRoleTitle || membershipRoleLabel || null;

  return {
    id: sprint.id,
    projectId: sprint.projectId,
    sprintNumber: sprint.sprintNumber,
    code: `SPR-${sprint.sprintNumber}`,
    name: sprint.name,
    goal: sprint.goal ?? null,
    description: sprint.description ?? null,
    startDate: sprint.startDate?.toISOString() ?? null,
    endDate: sprint.endDate?.toISOString() ?? null,
    status: sprint.status,
    startedAt: sprint.startedAt?.toISOString() ?? null,
    completedAt: sprint.completedAt?.toISOString() ?? null,
    archivedAt: sprint.archivedAt?.toISOString() ?? null,
    cancelledAt: sprint.cancelledAt?.toISOString() ?? null,
    createdAt: sprint.createdAt?.toISOString() ?? null,
    updatedAt: sprint.updatedAt?.toISOString() ?? null,
    creator: sprint.creatorId
      ? {
          id: sprint.creatorId,
          fullName: sprint.creatorName ?? null,
          avatarUrl: sprint.creatorAvatarUrl ?? null,
          roleLabel,
        }
      : null,
  };
}

async function applySprintCreatorSnapshots(
  projectId: string,
  sprints: SprintListItem[],
) {
  if (sprints.length === 0) return sprints;
  const missingSprintIds = sprints
    .filter((s) => !s.creator?.fullName)
    .map((s) => s.id);
  if (missingSprintIds.length === 0) return sprints;

  try {
    const events = await db
      .select({
        sprintId: projectSprintEvents.sprintId,
        actorId: projectSprintEvents.actorId,
        payload: projectSprintEvents.payload,
      })
      .from(projectSprintEvents)
      .where(
        and(
          eq(projectSprintEvents.projectId, projectId),
          eq(projectSprintEvents.eventType, "created"),
          inArray(projectSprintEvents.sprintId, missingSprintIds),
        ),
      )
      .orderBy(desc(projectSprintEvents.createdAt));
    const snapshots = new Map<
      string,
      { actorId: string | null; name: string | null; avatarUrl: string | null }
    >();
    for (const event of events) {
      if (snapshots.has(event.sprintId)) continue;
      const payload = event.payload ?? {};
      snapshots.set(event.sprintId, {
        actorId: event.actorId ?? null,
        name:
          typeof payload.creatorName === "string" && payload.creatorName.trim()
            ? payload.creatorName.trim()
            : null,
        avatarUrl:
          typeof payload.creatorAvatarUrl === "string" &&
          payload.creatorAvatarUrl.trim()
            ? payload.creatorAvatarUrl
            : null,
      });
    }
    return sprints.map((sprint) => {
      if (sprint.creator?.fullName) return sprint;
      const snapshot = snapshots.get(sprint.id);
      if (!snapshot?.name) return sprint;
      return {
        ...sprint,
        creator: {
          id: sprint.creator?.id ?? snapshot.actorId ?? `sprint:${sprint.id}`,
          fullName: snapshot.name,
          avatarUrl: sprint.creator?.avatarUrl ?? snapshot.avatarUrl,
          roleLabel: sprint.creator?.roleLabel ?? null,
        },
      };
    });
  } catch (error) {
    if (isMissingTable(error, "project_sprint_events")) return sprints;
    throw error;
  }
}

async function readProjectSprintsList(projectId: string, limit: number) {
  const readSprints = async (supportsDescription: boolean) => {
    if (supportsDescription) {
      return db
        .select({
          id: projectSprints.id,
          projectId: projectSprints.projectId,
          creatorId: projectSprints.creatorId,
          sprintNumber: projectSprints.sprintNumber,
          name: projectSprints.name,
          goal: projectSprints.goal,
          description: projectSprints.description,
          startDate: projectSprints.startDate,
          endDate: projectSprints.endDate,
          status: projectSprints.status,
          startedAt: projectSprints.startedAt,
          completedAt: projectSprints.completedAt,
          archivedAt: projectSprints.archivedAt,
          cancelledAt: projectSprints.cancelledAt,
          createdAt: projectSprints.createdAt,
          updatedAt: projectSprints.updatedAt,
          creatorName: profiles.fullName,
          creatorAvatarUrl: profiles.avatarUrl,
          creatorRole: projectMembers.role,
          creatorRoleTitle: acceptedRoleTitleSql(
            projectId,
            projectSprints.creatorId,
          ),
        })
        .from(projectSprints)
        .leftJoin(profiles, eq(profiles.id, projectSprints.creatorId))
        .leftJoin(
          projectMembers,
          and(
            eq(projectMembers.userId, projectSprints.creatorId),
            eq(projectMembers.projectId, projectId),
          ),
        )
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
        creatorId: projectSprints.creatorId,
        sprintNumber: projectSprints.sprintNumber,
        name: projectSprints.name,
        goal: projectSprints.goal,
        startDate: projectSprints.startDate,
        endDate: projectSprints.endDate,
        status: projectSprints.status,
        startedAt: projectSprints.startedAt,
        completedAt: projectSprints.completedAt,
        archivedAt: projectSprints.archivedAt,
        cancelledAt: projectSprints.cancelledAt,
        createdAt: projectSprints.createdAt,
        updatedAt: projectSprints.updatedAt,
        creatorName: profiles.fullName,
        creatorAvatarUrl: profiles.avatarUrl,
        creatorRole: projectMembers.role,
        creatorRoleTitle: acceptedRoleTitleSql(
          projectId,
          projectSprints.creatorId,
        ),
      })
      .from(projectSprints)
      .leftJoin(profiles, eq(profiles.id, projectSprints.creatorId))
      .leftJoin(
        projectMembers,
        and(
          eq(projectMembers.userId, projectSprints.creatorId),
          eq(projectMembers.projectId, projectId),
        ),
      )
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
    return applySprintCreatorSnapshots(
      projectId,
      rows.map(serializeSprintListItem),
    );
  } catch (error) {
    if (supportsDescription && isMissingColumn(error, "description")) {
      sprintDescriptionColumnSupport = false;
      const rows = await readSprints(false);
      return applySprintCreatorSnapshots(
        projectId,
        rows.map(serializeSprintListItem),
      );
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
          sprintNumber: projectSprints.sprintNumber,
          name: projectSprints.name,
          goal: projectSprints.goal,
          description: projectSprints.description,
          startDate: projectSprints.startDate,
          endDate: projectSprints.endDate,
          status: projectSprints.status,
          startedAt: projectSprints.startedAt,
          completedAt: projectSprints.completedAt,
          archivedAt: projectSprints.archivedAt,
          cancelledAt: projectSprints.cancelledAt,
          createdAt: projectSprints.createdAt,
          updatedAt: projectSprints.updatedAt,
          creatorName: profiles.fullName,
          creatorAvatarUrl: profiles.avatarUrl,
          creatorRole: projectMembers.role,
          creatorRoleTitle: acceptedRoleTitleSql(
            projectId,
            projectSprints.creatorId,
          ),
        })
        .from(projectSprints)
        .leftJoin(profiles, eq(profiles.id, projectSprints.creatorId))
        .leftJoin(
          projectMembers,
          and(
            eq(projectMembers.userId, projectSprints.creatorId),
            eq(projectMembers.projectId, projectId),
          ),
        )
        .where(
          and(
            eq(projectSprints.id, sprintId),
            eq(projectSprints.projectId, projectId),
          ),
        )
        .limit(1);
    }

    return db
      .select({
        id: projectSprints.id,
        projectId: projectSprints.projectId,
        creatorId: projectSprints.creatorId,
        sprintNumber: projectSprints.sprintNumber,
        name: projectSprints.name,
        goal: projectSprints.goal,
        startDate: projectSprints.startDate,
        endDate: projectSprints.endDate,
        status: projectSprints.status,
        startedAt: projectSprints.startedAt,
        completedAt: projectSprints.completedAt,
        archivedAt: projectSprints.archivedAt,
        cancelledAt: projectSprints.cancelledAt,
        createdAt: projectSprints.createdAt,
        updatedAt: projectSprints.updatedAt,
        creatorName: profiles.fullName,
        creatorAvatarUrl: profiles.avatarUrl,
        creatorRole: projectMembers.role,
        creatorRoleTitle: acceptedRoleTitleSql(
          projectId,
          projectSprints.creatorId,
        ),
      })
      .from(projectSprints)
      .leftJoin(profiles, eq(profiles.id, projectSprints.creatorId))
      .leftJoin(
        projectMembers,
        and(
          eq(projectMembers.userId, projectSprints.creatorId),
          eq(projectMembers.projectId, projectId),
        ),
      )
      .where(
        and(
          eq(projectSprints.id, sprintId),
          eq(projectSprints.projectId, projectId),
        ),
      )
      .limit(1)
      .then((rows) => rows.map((row) => ({ ...row, description: null })));
  };

  const supportsDescription = await hasProjectSprintDescriptionColumn();

  try {
    const rows = await readSprint(supportsDescription);
    const [sprint] = await applySprintCreatorSnapshots(
      projectId,
      rows.map(serializeSprintListItem),
    );
    return sprint ?? null;
  } catch (error) {
    if (supportsDescription && isMissingColumn(error, "description")) {
      sprintDescriptionColumnSupport = false;
      const rows = await readSprint(false);
      const [sprint] = await applySprintCreatorSnapshots(
        projectId,
        rows.map(serializeSprintListItem),
      );
      return sprint ?? null;
    }
    throw error;
  }
}

async function readSprintSummary(sprintId: string) {
  const rows = await db.execute<SprintSummaryQueryRow>(sql`
        WITH sprint_tasks AS (
            SELECT DISTINCT ON (m.task_id)
                t.id,
                t.status,
                t.story_points
            FROM ${sprintTaskMemberships} m
            JOIN ${tasks} t ON t.id = m.task_id AND t.deleted_at IS NULL
            WHERE m.sprint_id = ${sprintId} AND m.removed_at IS NULL
        )
        SELECT
            COUNT(*)::int AS total_tasks,
            COUNT(*) FILTER (WHERE st.status = 'done')::int AS completed_tasks,
            COUNT(*) FILTER (WHERE st.status = 'blocked')::int AS blocked_tasks,
            (
                SELECT COUNT(*)::int
                FROM ${taskNodeLinks} lnk
                JOIN ${projectNodes} node ON node.id = lnk.node_id AND node.deleted_at IS NULL
                WHERE lnk.task_id IN (SELECT id FROM sprint_tasks)
            ) AS linked_file_count,
            COALESCE(SUM(COALESCE(st.story_points, 0)), 0)::int AS total_story_points,
            COALESCE(SUM(COALESCE(st.story_points, 0)) FILTER (WHERE st.status = 'done'), 0)::int AS completed_story_points
        FROM sprint_tasks st
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
  taskReference?: string | null;
}) {
  const { sprintId, limit, cursor } = input;

  const activityRowsResult = await db.execute<SprintTaskActivityQueryRow>(sql`
        WITH memberships AS (
            SELECT task_id,
                   MIN(added_at) AS added_at,
                   CASE WHEN BOOL_OR(removed_at IS NULL) THEN NULL ELSE MAX(removed_at) END AS removed_at
            FROM ${sprintTaskMemberships}
            WHERE sprint_id = ${sprintId}
            GROUP BY task_id
        ), task_activity AS (
            SELECT
                t.id,
                t.project_id,
                ${sprintId}::uuid AS sprint_id,
                t.title,
                t.description,
                t.status,
                t.priority,
                t.task_number,
                t.story_points,
                t.due_date,
                t.created_at,
                t.updated_at,
                t.deleted_at,
                t.assignee_id,
                t.creator_id,
                COALESCE(m.added_at, t.created_at) AS activity_at,
                m.removed_at AS membership_removed_at,
                0::int AS linked_file_count
            FROM ${tasks} t
            INNER JOIN memberships m ON m.task_id = t.id
            WHERE t.project_id = ${input.projectId}
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

  // A canonical project-key task link must work even when the referenced task is
  // outside the first cursor page. Add that one membership-backed row to
  // the initial payload without changing pagination boundaries.
  const requestedTaskNumber = Number.parseInt(
    input.taskReference?.trim().match(/^[A-Za-z][A-Za-z0-9_-]*-(\d+)$/)?.[1] ?? "",
    10,
  );
  const requestedTaskId = z
    .string()
    .uuid()
    .safeParse(input.taskReference ?? "");
  if (
    !cursor &&
    input.taskReference &&
    !pageRows.some(
      (row) =>
        (requestedTaskId.success && row.id === requestedTaskId.data) ||
        (Number.isInteger(requestedTaskNumber) &&
          row.task_number === requestedTaskNumber),
    )
  ) {
    const targetCondition = requestedTaskId.success
      ? sql`t.id = ${requestedTaskId.data}::uuid`
      : Number.isInteger(requestedTaskNumber)
        ? sql`t.task_number = ${requestedTaskNumber}`
        : sql`FALSE`;
    const targetRowsResult = await db.execute<SprintTaskActivityQueryRow>(sql`
            WITH memberships AS (
                SELECT task_id,
                       MIN(added_at) AS added_at,
                       CASE WHEN BOOL_OR(removed_at IS NULL) THEN NULL ELSE MAX(removed_at) END AS removed_at
                FROM ${sprintTaskMemberships}
                WHERE sprint_id = ${sprintId}
                GROUP BY task_id
            )
            SELECT
                t.id,
                t.project_id,
                ${sprintId}::uuid AS sprint_id,
                t.title,
                t.description,
                t.status,
                t.priority,
                t.task_number,
                t.story_points,
                t.due_date,
                t.created_at,
                t.updated_at,
                t.deleted_at,
                t.assignee_id,
                t.creator_id,
                COALESCE(m.added_at, t.created_at) AS activity_at,
                m.removed_at AS membership_removed_at,
                0::int AS linked_file_count
            FROM ${tasks} t
            INNER JOIN memberships m ON m.task_id = t.id
            WHERE t.project_id = ${input.projectId} AND ${targetCondition}
            LIMIT 1
        `);
    const targetRow = Array.from(targetRowsResult)[0];
    if (targetRow) pageRows.push(targetRow);
  }

  const taskIds = pageRows.map((row) => row.id);
  const actorIds = Array.from(
    new Set(
      pageRows
        .flatMap((row) => [row.assignee_id, row.creator_id])
        .filter((value): value is string => !!value),
    ),
  );

  const actorRows =
    actorIds.length > 0
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

  const fileLinks =
    taskIds.length > 0
      ? await db
          .select({
            taskId: taskNodeLinks.taskId,
            nodeId: projectNodes.id,
            nodeName: projectNodes.name,
            nodeType: projectNodes.type,
            nodePath: projectNodes.path,
            canonicalNodeId: projectNodes.canonicalNodeId,
            linkedAt: taskNodeLinks.linkedAt,
            annotation: taskNodeLinks.annotation,
            tags: taskNodeLinks.tags,
          })
          .from(taskNodeLinks)
          .innerJoin(
            projectNodes,
            and(
              eq(projectNodes.id, taskNodeLinks.nodeId),
              eq(projectNodes.projectId, input.projectId),
              isNull(projectNodes.deletedAt),
            ),
          )
          .where(inArray(taskNodeLinks.taskId, taskIds))
          .orderBy(desc(taskNodeLinks.linkedAt))
      : [];
  const nodeIds = Array.from(new Set(fileLinks.map((link) => link.nodeId)));
  const latestVersions =
    nodeIds.length > 0
      ? await db
          .selectDistinctOn([fileVersions.nodeId], {
            nodeId: fileVersions.nodeId,
            version: fileVersions.version,
            uploaderId: profiles.id,
            uploaderName: profiles.fullName,
            uploaderAvatarUrl: profiles.avatarUrl,
          })
          .from(fileVersions)
          .leftJoin(profiles, eq(profiles.id, fileVersions.uploadedBy))
          .where(inArray(fileVersions.nodeId, nodeIds))
          .orderBy(
            fileVersions.nodeId,
            desc(fileVersions.version),
            desc(fileVersions.uploadedAt),
          )
      : [];
  const versionByNodeId = new Map(
    latestVersions.map((version) => [version.nodeId, version]),
  );
  const filesByTaskId = new Map<
    string,
    SprintTaskTimelineEntity["linkedFiles"]
  >();
  for (const link of fileLinks) {
    const files = filesByTaskId.get(link.taskId) ?? [];
    if (files.some((file) => file.nodeId === link.nodeId)) continue;
    const version = versionByNodeId.get(link.nodeId);
    const role = inferTaskFileRole({
      id: link.nodeId,
      name: link.nodeName,
      type: link.nodeType,
      path: link.nodePath,
      annotation: link.annotation,
      tags: link.tags,
      canonicalNodeId: link.canonicalNodeId,
    });

    files.push({
      nodeId: link.nodeId,
      name: link.nodeName,
      latestVersion: version?.version ?? null,
      latestUploader: version?.uploaderId
        ? {
            id: version.uploaderId,
            fullName: version.uploaderName ?? null,
            avatarUrl: version.uploaderAvatarUrl ?? null,
          }
        : null,
      annotation: link.annotation ?? null,
      tags: link.tags ?? [],
      role,
    });
    filesByTaskId.set(link.taskId, files);
  }

  const subtasks =
    taskIds.length > 0
      ? await db
          .select({
            id: taskSubtasks.id,
            taskId: taskSubtasks.taskId,
            title: taskSubtasks.title,
            completed: taskSubtasks.completed,
            position: taskSubtasks.position,
          })
          .from(taskSubtasks)
          .where(inArray(taskSubtasks.taskId, taskIds))
          .orderBy(taskSubtasks.position, taskSubtasks.createdAt)
      : [];

  const subtasksByTaskId = new Map<
    string,
    SprintTaskTimelineEntity["subtasks"]
  >();
  for (const st of subtasks) {
    const list = subtasksByTaskId.get(st.taskId) ?? [];
    list.push({
      id: st.id,
      title: st.title,
      completed: st.completed ?? false,
      position: st.position ?? 0,
    });
    subtasksByTaskId.set(st.taskId, list);
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
    // ponytail: tasks persist status and updated_at, not a completed_at
    // timestamp. Sprint closeout keeps its own durable completedAt field.
    completedAt: null,
    activityAt:
      toIsoString(row.activity_at) ??
      toIsoString(row.updated_at) ??
      toIsoString(row.created_at) ??
      null,
    linkedFileCount: filesByTaskId.get(row.id)?.length ?? 0,
    isDeleted: Boolean(row.deleted_at),
    membershipState: row.membership_removed_at ? "historical" : "committed",
    addedAt: toIsoString(row.activity_at),
    removedAt: toIsoString(row.membership_removed_at),
    linkedFiles: filesByTaskId.get(row.id) ?? [],
    subtasks: subtasksByTaskId.get(row.id) ?? [],
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
  taskReference?: string | null;
  cursor?: string;
  limit?: number;
}): Promise<SprintDetailPayload | null> {
  const safeLimit = Math.min(Math.max(input.limit ?? 30, 1), 50);
  const parsedCursor = parseSprintDetailPaginationCursor(input.cursor);

  const access = input.access;
  if (!access.project) throw new Error("Project not found");
  if (!access.canRead) throw new Error("Forbidden");
  // ponytail: a read must not mutate Sprint lifecycle state. The scheduler
  // remains the sole owner of time-based transitions.
  const permissions = buildSprintPermissionSet({
    canRead: access.canRead,
    canWrite: access.canWrite,
    isOwner: access.isOwner,
    isMember: access.isMember,
    memberRole: access.memberRole,
  });

  const sprints = await readProjectSprintsList(input.projectId, 120);
  const requestedSprint = input.sprintId?.trim() ?? null;
  const legacyNameMatches = requestedSprint
    ? sprints.filter((sprint) => sprint.name === requestedSprint)
    : [];
  const selectedSprint =
    (requestedSprint
      ? (sprints.find(
          (sprint) =>
            sprint.id === requestedSprint ||
            sprint.code.toLowerCase() === requestedSprint.toLowerCase(),
        ) ?? (legacyNameMatches.length === 1 ? legacyNameMatches[0] : null))
      : null) ??
    sprints.find((sprint) => sprint.status === "active") ??
    sprints.find((sprint) => sprint.status === "planning") ??
    sprints[0] ??
    null;

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
      summary: null,
      rows: [],
      nextCursor: null,
      hasMore: false,
    };
  }

  if (
    requestedSprint &&
    selectedSprint.id !== requestedSprint &&
    selectedSprint.code.toLowerCase() !== requestedSprint.toLowerCase() &&
    selectedSprint.name !== requestedSprint
  ) {
    return null;
  }

  const [summary, taskPage] = await Promise.all([
    readSprintSummary(selectedSprint.id),
    readSprintTaskActivityPage({
      projectId: input.projectId,
      sprintId: selectedSprint.id,
      limit: safeLimit,
      cursor: parsedCursor,
      taskReference: input.taskReference,
    }),
  ]);

  const rows = buildSprintTimeline({
    sprint: selectedSprint,
    tasks: taskPage.tasks,
    summary,
    includeKickoff: !parsedCursor,
    includeCloseout: !taskPage.hasMore,
  });

  return {
    projectId: input.projectId,
    projectSlug: access.project.slug ?? null,
    sprints,
    selectedSprintId: selectedSprint.id,
    permissions,
    summary,
    rows,
    nextCursor: taskPage.nextCursor,
    hasMore: taskPage.hasMore,
  };
}

async function buildSprintTimelinePagePayload(input: {
  projectId: string;
  access: ProjectAccess;
  sprintId: string | null;
  cursor?: string;
  limit?: number;
}): Promise<SprintDetailPayload | null> {
  if (!input.sprintId) {
    return buildSprintDetailPayload(input);
  }

  const safeLimit = Math.min(Math.max(input.limit ?? 30, 1), 50);
  const parsedCursor = parseSprintDetailPaginationCursor(input.cursor);
  const access = input.access;
  if (!access.project) throw new Error("Project not found");
  if (!access.canRead) throw new Error("Forbidden");

  const selectedSprint = await readProjectSprintListItem(
    input.projectId,
    input.sprintId,
  );
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
    summary,
    rows,
    nextCursor: taskPage.nextCursor,
    hasMore: taskPage.hasMore,
  };
}

export async function fetchProjectSprintDetailAction(input: {
  projectId: string;
  sprintId?: string | null;
  taskReference?: string | null;
  cursor?: string;
  limit?: number;
}) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    const cursorKey = input.cursor ?? "head";
    const sprintKey = input.sprintId ?? "default";

    const startedAt = Date.now();
    const taskKey = input.taskReference?.trim() || "none";
    const data = await runInFlightDeduped(
      `project:sprint-detail:${input.projectId}:${sprintKey}:${taskKey}:${actorId ?? "anon"}:${cursorKey}:${input.limit ?? 30}`,
      async () => {
        const access = await getProjectAccessById(input.projectId, actorId);
        if (!access.project) {
          throw new Error("Project not found");
        }

        return buildSprintDetailPayload({
          projectId: input.projectId,
          access,
          sprintId: input.sprintId ?? null,
          taskReference: input.taskReference ?? null,
          cursor: input.cursor,
          limit: input.limit,
        });
      },
    );

    if (!data) {
      return { success: false as const, error: "Sprint not found" };
    }

    recordSprintMetric("project.sprint.detail.load_ms", {
      projectId: input.projectId,
      sprintId: data.selectedSprintId,
      durationMs: Date.now() - startedAt,
      rowCount: data.rows.length,
      hasMore: data.hasMore,
    });

    recordSprintMetric("project.sprint.timeline.rows", {
      projectId: input.projectId,
      sprintId: data.selectedSprintId,
      kickoffRows: data.rows.filter((row) => row.kind === "kickoff").length,
      taskRows: data.rows.filter((row) => row.kind === "task").length,
      closeoutRows: data.rows.filter((row) => row.kind === "closeout").length,
    });

    return { success: true as const, data };
  } catch (error) {
    console.error("Failed to fetch sprint detail:", error);
    return { success: false as const, error: "Failed to fetch sprint detail" };
  }
}

export async function fetchProjectSprintTimelinePageAction(input: {
  projectId: string;
  sprintId: string | null;
  cursor?: string;
  limit?: number;
}) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    const cursorKey = input.cursor ?? "head";
    const sprintKey = input.sprintId ?? "default";
    const startedAt = Date.now();

    const data = await runInFlightDeduped(
      `project:sprint-timeline-page:${input.projectId}:${sprintKey}:${actorId ?? "anon"}:${cursorKey}:${input.limit ?? 30}`,
      async () => {
        const access = await getProjectAccessById(input.projectId, actorId);
        if (!access.project) {
          throw new Error("Project not found");
        }
        return buildSprintTimelinePagePayload({
          projectId: input.projectId,
          access,
          sprintId: input.sprintId,
          cursor: input.cursor,
          limit: input.limit,
        });
      },
    );

    if (!data) {
      return { success: false as const, error: "Sprint not found" };
    }

    recordSprintMetric("project.sprint.timeline.page_load_ms", {
      projectId: input.projectId,
      sprintId: data.selectedSprintId,
      durationMs: Date.now() - startedAt,
      rowCount: data.rows.length,
      hasMore: data.hasMore,
    });

    recordSprintMetric("project.sprint.timeline.page_rows", {
      projectId: input.projectId,
      sprintId: data.selectedSprintId,
      taskRows: data.rows.filter((row) => row.kind === "task").length,
    });

    return { success: true as const, data };
  } catch (error) {
    console.error("Failed to fetch sprint timeline page:", error);
    return {
      success: false as const,
      error: "Failed to fetch sprint timeline page",
    };
  }
}

export async function readProjectSprintDetail(input: {
  slugOrId: string;
  sprintId?: string | null;
  taskReference?: string | null;
  actorUserId?: string | null;
  cursor?: string;
  limit?: number;
}) {
  try {
    const project = await resolveProjectDetailTarget(
      input.slugOrId,
      input.actorUserId ?? null,
    );
    if (!project) {
      return {
        success: false as const,
        errorCode: "NOT_FOUND" as const,
        message: "Project not found.",
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
        errorCode: "FORBIDDEN" as const,
        message: "Forbidden",
      };
    }
    if (
      !isProjectTabVisibleToViewer({
        tabId: "sprints",
        isOwnerOrMember: viewerState.isOwner || viewerState.isMember,
        publicTabVisibility: project.publicTabVisibility,
      })
    ) {
      return {
        success: false as const,
        errorCode: "FORBIDDEN" as const,
        message: "Sprint details are members-only for this project.",
      };
    }

    const access = await assertProjectReadAccess(
      project.id,
      input.actorUserId ?? null,
    );
    const data = await buildSprintDetailPayload({
      projectId: project.id,
      access,
      sprintId: input.sprintId ?? null,
      taskReference: input.taskReference ?? null,
      cursor: input.cursor,
      limit: input.limit,
    });

    if (!data) {
      return {
        success: false as const,
        errorCode: "NOT_FOUND" as const,
        message: "Sprint not found.",
      };
    }

    return {
      success: true as const,
      data,
    };
  } catch (error) {
    console.error("[readProjectSprintDetail] failed", error);
    return {
      success: false as const,
      errorCode: "INTERNAL_ERROR" as const,
      message: "Failed to load sprint detail.",
    };
  }
}

export async function getProjectTaskDetailAction(
  projectId: string,
  taskId: string,
) {
  try {
    const viewerIdentity = await getViewerIdentityContext();
    const actorId = viewerIdentity.user?.id ?? null;
    await assertProjectReadAccess(projectId, actorId);

    const isUuid = isLooseUuid(taskId);
    let taskWhere;
    if (isUuid) {
      taskWhere = and(
        eq(tasks.id, taskId),
        eq(tasks.projectId, projectId),
        isNull(tasks.deletedAt),
      );
    } else {
      const dashIndex = taskId.lastIndexOf("-");
      if (dashIndex !== -1) {
        const taskNum = parseInt(taskId.slice(dashIndex + 1), 10);
        if (!isNaN(taskNum)) {
          taskWhere = and(
            eq(tasks.taskNumber, taskNum),
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
          );
        } else {
          taskWhere = and(
            eq(tasks.id, taskId),
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
          );
        }
      } else {
        taskWhere = and(
          eq(tasks.id, taskId),
          eq(tasks.projectId, projectId),
          isNull(tasks.deletedAt),
        );
      }
    }

    const task = await db.query.tasks.findFirst({
      where: taskWhere,
      extras: {
        subtaskCount:
          sql<number>`(SELECT count(*)::int FROM task_subtasks WHERE task_subtasks.task_id = ${tasks.id})`.as(
            "subtask_count",
          ),
        completedSubtaskCount:
          sql<number>`(SELECT count(*)::int FROM task_subtasks WHERE task_subtasks.task_id = ${tasks.id} AND task_subtasks.completed = true)`.as(
            "completed_subtask_count",
          ),
        fileCount:
          sql<number>`(SELECT count(*)::int FROM task_node_links JOIN project_nodes ON project_nodes.id = task_node_links.node_id WHERE task_node_links.task_id = ${tasks.id} AND project_nodes.deleted_at IS NULL)`.as(
            "file_count",
          ),
        commentCount:
          sql<number>`(SELECT count(*)::int FROM task_comments WHERE task_comments.task_id = ${tasks.id} AND task_comments.deleted_at IS NULL)`.as(
            "comment_count",
          ),
      },
      columns: {
        id: true,
        projectId: true,
        sprintId: true,
        assigneeId: true,
        creatorId: true,
        workflowColumnId: true,
        title: true,
        description: true,
        status: true,
        reviewStatus: true,
        position: true,
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
      return { success: false as const, error: "Task not found" };
    }

    return { success: true as const, task: normalizeTaskSurfaceRecord(task) };
  } catch (error) {
    console.error("Failed to fetch task detail:", error);
    return { success: false as const, error: "Failed to fetch task detail" };
  }
}

export async function getProjectMembersAction(
  projectId: string,
  limit: number = 20,
  cursor?: string,
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const cursorKey = cursor ?? "head";

    return await runInFlightDeduped(
      `project:members:${projectId}:${actorId ?? "anon"}:${safeLimit}:${cursorKey}`,
      async () => {
        await assertProjectReadAccess(projectId, actorId);
        const whereConditions: any[] = [
          eq(projectMembers.projectId, projectId),
        ];

        if (cursor) {
          try {
            const decoded = Buffer.from(cursor, "base64").toString("utf-8");
            const [joinedAt, memberId] = decoded.split(":::");
            if (joinedAt && memberId) {
              whereConditions.push(
                sql`(${projectMembers.joinedAt}, ${projectMembers.id}) < (${new Date(joinedAt)}, ${memberId})`,
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
              },
            },
          },
          orderBy: (members, { desc }) => [
            desc(members.joinedAt),
            desc(members.id),
          ],
          limit: safeLimit + 1,
        });

        const hasMore = membersResult.length > safeLimit;
        const slice = membersResult.slice(0, safeLimit);
        const last = slice[slice.length - 1];
        const nextCursor =
          hasMore && last
            ? Buffer.from(
                `${last.joinedAt.toISOString()}:::${last.id}`,
              ).toString("base64")
            : undefined;

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
                .leftJoin(
                  projectOpenRoles,
                  eq(projectOpenRoles.id, roleApplications.roleId),
                )
                .where(
                  and(
                    eq(roleApplications.projectId, projectId),
                    eq(roleApplications.status, "accepted"),
                    inArray(roleApplications.applicantId, memberIds),
                  ),
                )
                .orderBy(desc(roleApplications.updatedAt))
            : [];

        const acceptedRoleByUser = new Map<string, string>();
        for (const row of acceptedRoleRows) {
          if (acceptedRoleByUser.has(row.applicantId)) continue;
          const label = row.roleTitle || row.roleName || "";
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
      },
    );
  } catch (error) {
    console.error("Failed to fetch project members:", error);
    return {
      success: false as const,
      error: "Failed to fetch project members",
    };
  }
}

async function getProjectAnalyticsDataset(
  projectId: string,
  actorId: string | null,
): Promise<BuildProjectAnalyticsInput> {
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

  if (!projectRow) throw new Error("Project not found");

  const actorMemberRows =
    actorId && actorId !== projectRow.ownerId
      ? await db
          .select({
            userId: projectMembers.userId,
            role: projectMembers.role,
          })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.userId, actorId),
            ),
          )
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
    projectIsPublic: projectRow.visibility === "public",
  });

  if (
    accessLevel === "public" &&
    !isProjectTabVisibleToViewer({
      tabId: "analytics",
      isOwnerOrMember: false,
      publicTabVisibility: projectRow.publicTabVisibility,
    })
  ) {
    throw new Error("Project analytics are not publicly visible");
  }

  if (accessLevel === "public") {
    const importSourceType =
      (
        projectRow.importSource as
          | { type?: "github" | "upload" | "scratch" }
          | null
          | undefined
      )?.type ?? null;
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
      taskEvents: [],
      sprintEvents: [],
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
    .where(
      and(eq(projectMembers.projectId, projectId), isNull(profiles.deletedAt)),
    )
    .orderBy(desc(projectMembers.joinedAt))
    .limit(PROJECT_ANALYTICS_DATASET_LIMITS.members);

  const [
    taskRows,
    sprintRows,
    fileRows,
    applicationRows,
    roleRows,
    workflowRows,
    linkedWorkRows,
    eventRows,
    taskEventRows,
  ] = await Promise.all([
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
      .where(
        and(
          eq(projectNodes.projectId, projectId),
          eq(projectNodes.type, "file"),
          isNull(projectNodes.deletedAt),
        ),
      )
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
      .where(
        and(
          eq(messageWorkLinks.targetProjectId, projectId),
          isNull(messageWorkLinks.deletedAt),
        ),
      )
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
    db
      .select({
        id: taskActivityEvents.id,
        taskId: taskActivityEvents.taskId,
        actorId: taskActivityEvents.actorId,
        eventType: taskActivityEvents.eventType,
        payload: taskActivityEvents.payload,
        createdAt: taskActivityEvents.createdAt,
      })
      .from(taskActivityEvents)
      .where(eq(taskActivityEvents.projectId, projectId))
      .orderBy(desc(taskActivityEvents.createdAt))
      .limit(PROJECT_ANALYTICS_DATASET_LIMITS.events),
  ]);

  const sprintEventRows = await db
    .select({
      id: projectSprintEvents.id,
      sprintId: projectSprintEvents.sprintId,
      actorId: projectSprintEvents.actorId,
      eventType: projectSprintEvents.eventType,
      payload: projectSprintEvents.payload,
      createdAt: projectSprintEvents.createdAt,
    })
    .from(projectSprintEvents)
    .where(eq(projectSprintEvents.projectId, projectId))
    .orderBy(desc(projectSprintEvents.createdAt))
    .limit(PROJECT_ANALYTICS_DATASET_LIMITS.events)
    .catch((error) => {
      if (isMissingTable(error, "project_sprint_events")) {
        return [];
      }
      throw error;
    });
  const importSourceType =
    (
      projectRow.importSource as
        | { type?: "github" | "upload" | "scratch" }
        | null
        | undefined
    )?.type ?? null;
  const analyticsFileRows = fileRows.map((file) => {
    const contract = normalizeProjectNodeAnalyticsMetadata({
      metadata: file.metadata as Record<string, unknown> | null | undefined,
      gitHash: file.gitHash,
      importSourceType,
    });
    return { ...file, analyticsContract: contract };
  });
  const visibleFileRows = analyticsFileRows.filter(
    (file) => file.analyticsContract.analyticsVisible,
  );
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
          .where(
            and(
              inArray(taskComments.taskId, taskIds),
              isNull(taskComments.deletedAt),
            ),
          )
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
      role: projectRow.ownerId === member.userId ? "owner" : member.role,
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
    taskEvents: taskEventRows,
    sprintEvents: sprintEventRows,
  };
}

const readProjectAnalyticsData = async (projectId: string) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const actorId = user?.id ?? null;
  return runInFlightDeduped(
    `project:analytics:v2:${projectId}:${actorId ?? "anon"}`,
    () => getProjectAnalyticsDataset(projectId, actorId),
  );
};

const readProjectAnalyticsScopedData = async (
  projectId: string,
  context?: Partial<ProjectAnalyticsContextFilters> | null,
) => {
  const dataset = await readProjectAnalyticsData(projectId);
  return filterProjectAnalyticsDatasetByContext(
    dataset,
    normalizeProjectAnalyticsContext(context),
  );
};

const canReadMemberDetail = (
  dataset: BuildProjectAnalyticsInput,
  memberUserId: string,
) => {
  if (dataset.accessLevel === "owner" || dataset.accessLevel === "co_leader")
    return true;
  if (dataset.accessLevel === "member" || dataset.accessLevel === "viewer")
    return dataset.actorId === memberUserId;
  return false;
};

export async function readProjectAnalyticsOverviewAction(
  projectId: string,
  context?: Partial<ProjectAnalyticsContextFilters> | null,
) {
  try {
    const rawDataset = await readProjectAnalyticsData(projectId);
    const dataset = filterProjectAnalyticsDatasetByContext(
      rawDataset,
      normalizeProjectAnalyticsContext(context),
    );
    return {
      success: true as const,
      overview: buildProjectAnalyticsOverview(dataset, context, rawDataset),
    };
  } catch (error) {
    console.error("Failed to fetch project analytics overview:", error);
    return {
      success: false as const,
      error: "Failed to fetch project analytics overview",
    };
  }
}

export async function readProjectAnalyticsMembersAction(
  projectId: string,
  context?: Partial<ProjectAnalyticsContextFilters> | null,
) {
  try {
    const dataset = await readProjectAnalyticsScopedData(projectId, context);
    if (dataset.accessLevel === "public")
      return { success: true as const, members: [] };
    return {
      success: true as const,
      members: buildProjectAnalyticsMemberSummaries(dataset),
    };
  } catch (error) {
    console.error("Failed to fetch project analytics members:", error);
    return {
      success: false as const,
      error: "Failed to fetch project analytics members",
    };
  }
}

export async function readProjectMemberAnalyticsAction(
  projectId: string,
  memberUserId: string,
  context?: Partial<ProjectAnalyticsContextFilters> | null,
) {
  try {
    const dataset = await readProjectAnalyticsScopedData(projectId, {
      ...context,
      memberId: memberUserId,
    });
    if (!canReadMemberDetail(dataset, memberUserId)) {
      return {
        success: false as const,
        error: "Member analytics are not visible for this access level",
      };
    }
    return {
      success: true as const,
      detail: buildProjectAnalyticsMemberDetail(dataset, memberUserId),
    };
  } catch (error) {
    console.error("Failed to fetch project member analytics:", error);
    return {
      success: false as const,
      error: "Failed to fetch project member analytics",
    };
  }
}

export async function readProjectAnalyticsTimelineAction(
  projectId: string,
  filters: ProjectAnalyticsTimelineFilters = {},
) {
  try {
    const dataset = await readProjectAnalyticsData(projectId);
    if (dataset.accessLevel === "public") {
      return {
        success: true as const,
        timeline: buildProjectAnalyticsTimeline(
          { ...dataset, events: [], comments: [], workflows: [] },
          filters,
        ),
      };
    }
    return {
      success: true as const,
      timeline: buildProjectAnalyticsTimeline(dataset, filters),
    };
  } catch (error) {
    console.error("Failed to fetch project analytics timeline:", error);
    return {
      success: false as const,
      error: "Failed to fetch project analytics timeline",
    };
  }
}

const createTaskSchema = baseCreateTaskSchema.extend({
  subtasks: z
    .array(
      z.object({
        title: taskSubtaskTitleSchema,
        completed: z.boolean().default(false),
      }),
    )
    .max(100)
    .optional(),
  attachmentNodeIds: z.array(z.string().uuid()).max(100).optional(),
});

export async function createTaskAction(data: z.infer<typeof createTaskSchema>) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const validated = createTaskSchema.parse(data);
    await requireProjectCapability(
      validated.projectId,
      user.id,
      "create_tasks",
    );
    if (validated.sprintId) {
      const sprintAccess = await getProjectAccessById(
        validated.projectId,
        user.id,
      );
      if (!sprintAccess.project) throw new Error("Project not found");
      if (!sprintAccess.isOwner) {
        throw new Error("Only the project owner can assign tasks to a Sprint");
      }
    }

    if (validated.assigneeId) {
      await requireProjectCapability(
        validated.projectId,
        user.id,
        "assign_tasks",
      );
      const assigneeMember = await db.query.projectMembers.findFirst({
        where: and(
          eq(projectMembers.projectId, validated.projectId),
          eq(projectMembers.userId, validated.assigneeId),
        ),
        columns: { id: true, role: true },
      });
      if (!assigneeMember) {
        throw new Error("Assignee must be a project member");
      }
      if (!isProjectMemberEligibleFor(assigneeMember.role, "assign")) {
        throw new Error("Assignee must be an assignable project member");
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

      if (validated.sprintId) {
        const sprintRows = await tx.execute<{ id: string; status: string }>(sql`
                    SELECT id, status FROM ${projectSprints}
                    WHERE id = ${validated.sprintId} AND project_id = ${validated.projectId}
                    FOR SHARE
                `);
        const sprint = Array.from(sprintRows)[0];
        if (!sprint) throw new Error("Sprint not found");
        if (sprint.status !== "planning" && sprint.status !== "active") {
          throw new Error(
            "Tasks can only be added to Planning or Active sprints",
          );
        }
      }

      const nextTaskNumber = Number(current.current_task_number || 0) + 1;
      await tx
        .update(projects)
        .set({ currentTaskNumber: nextTaskNumber })
        .where(eq(projects.id, validated.projectId));
      const defaultColumn = await tx.query.projectWorkflowColumns.findFirst({
        where: and(
          eq(projectWorkflowColumns.projectId, validated.projectId),
          eq(projectWorkflowColumns.status, validated.status),
          eq(projectWorkflowColumns.isDefault, true),
        ),
        columns: { id: true },
      });
      if (!defaultColumn)
        throw new Error("Default workflow section is unavailable");

      const [newTask] = await tx
        .insert(tasks)
        .values({
          projectId: validated.projectId,
          title: validated.title.trim(),
          description: validated.description?.trim() || null,
          status: validated.status,
          workflowColumnId: defaultColumn.id,
          priority: validated.priority,
          sprintId: validated.sprintId || null,
          timelineOriginSprintId: validated.sprintId || null,
          timelineOriginAt: validated.sprintId ? new Date() : null,
          assigneeId: validated.assigneeId || null,
          creatorId: user.id,
          storyPoints: validated.storyPoints,
          dueDate: validated.dueDate ? new Date(validated.dueDate) : null,
          taskNumber: nextTaskNumber,
        })
        .returning({ id: tasks.id });

      if (!newTask) throw new Error("Failed to create task");

      if (validated.sprintId) {
        await tx.insert(sprintTaskMemberships).values({
          projectId: validated.projectId,
          sprintId: validated.sprintId,
          taskId: newTask.id,
          addedBy: user.id,
        });
      }

      // These events are the durable source for the sprint activity trail.
      // Keeping creation and assignment separate makes the thread explain the
      // actual work flow instead of inferring it from the task's current state.
      if (validated.sprintId) {
        await tx.insert(taskActivityEvents).values({
          taskId: newTask.id,
          projectId: validated.projectId,
          sprintId: validated.sprintId,
          actorId: user.id,
          eventType: "created",
          payload: {
            version: 1,
            sprintId: validated.sprintId,
            taskTitle: validated.title.trim(),
            taskNumber: nextTaskNumber,
            taskStatus: validated.status,
          },
        });

        if (validated.assigneeId) {
          await tx.insert(taskActivityEvents).values({
            taskId: newTask.id,
            projectId: validated.projectId,
            sprintId: validated.sprintId,
            actorId: user.id,
            eventType: "assigned",
            payload: {
              version: 1,
              sprintId: validated.sprintId,
              assigneeId: validated.assigneeId,
              taskTitle: validated.title.trim(),
              taskNumber: nextTaskNumber,
              taskStatus: validated.status,
            },
          });
        }
      }

      if (
        validated.attachmentNodeIds &&
        validated.attachmentNodeIds.length > 0
      ) {
        const uniqueAttachmentIds = [...new Set(validated.attachmentNodeIds)];
        const attachmentNodes = await tx.query.projectNodes.findMany({
          where: and(
            eq(projectNodes.projectId, validated.projectId),
            inArray(projectNodes.id, uniqueAttachmentIds),
            isNull(projectNodes.deletedAt),
          ),
          columns: { id: true },
        });
        if (attachmentNodes.length !== uniqueAttachmentIds.length) {
          throw new Error(
            "One or more attachments are invalid for this project",
          );
        }

        await tx
          .insert(taskNodeLinks)
          .values(
            uniqueAttachmentIds.map((nodeId) => ({
              taskId: newTask.id,
              nodeId,
              createdBy: user.id,
              annotation: "#initial_reference",
              tags: replaceTaskFileRoleTag([], "reference"),
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
        workflowColumnId: true,
        title: true,
        description: true,
        status: true,
        reviewStatus: true,
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
      throw new Error("Failed to load created task");
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
          eventKey: "tasks.created_assigned",
          assigneeId: validated.assigneeId,
          title: `${actor.actorName || "Someone"} assigned you a task`,
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
            contextLabel:
              hydratedTask.project?.key && hydratedTask.taskNumber
                ? `${hydratedTask.project.key}-${hydratedTask.taskNumber}`
                : "Task",
            contextKind: "task",
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
    console.error("Failed to create task:", error);
    const message =
      error instanceof Error ? error.message : "Failed to create task";
    return {
      success: false,
      error: message.includes("Failed query:")
        ? "Failed to create task"
        : message,
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
    if (!user) throw new Error("Unauthorized");
    actorIdForMetric = user.id;

    const validated = createSprintSchema.parse(data);
    const startDate = parseSprintDateInput(validated.startDate);
    const endDate = parseSprintDateInput(validated.endDate);

    await requireSprintOwner(validated.projectId, user.id);

    const creator = actorNotificationSnapshot(user);
    const newSprint = await db.transaction(async (tx) => {
      // One project lock makes the human Sprint code stable under concurrent creates.
      await tx.execute(
        sql`SELECT id FROM ${projects} WHERE id = ${validated.projectId} FOR UPDATE`,
      );
      const numberRows = await tx.execute<{ next_number: number }>(sql`
                SELECT COALESCE(MAX(sprint_number), 0)::int + 1 AS next_number
                FROM ${projectSprints}
                WHERE project_id = ${validated.projectId}
            `);
      const sprintNumber = Number(Array.from(numberRows)[0]?.next_number ?? 1);
      const [created] = await tx
        .insert(projectSprints)
        .values({
          projectId: validated.projectId,
          creatorId: user.id,
          sprintNumber,
          name: validated.name,
          goal: validated.goal ?? null,
          description: validated.description ?? null,
          startDate,
          endDate,
          status: "planning",
        })
        .returning({ id: projectSprints.id });
      if (created) {
        await tx.insert(projectSprintEvents).values({
          projectId: validated.projectId,
          sprintId: created.id,
          actorId: user.id,
          eventType: "created",
          payload: {
            name: validated.name,
            status: "planning",
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            creatorName: creator.actorName,
            creatorAvatarUrl: creator.actorAvatarUrl,
          },
        });
      }
      return created;
    });

    if (!newSprint) {
      throw new Error("Failed to create sprint");
    }

    const sprintListItem = await readProjectSprintListItem(
      validated.projectId,
      newSprint.id,
    );
    if (!sprintListItem) {
      throw new Error("Failed to load created sprint");
    }

    await revalidateProjectPaths(validated.projectId);

    await enqueueProjectNotificationBestEffort(
      {
        projectId: validated.projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "sprints.created",
        title: `Sprint created: ${sprintListItem.name}`,
        body: sprintListItem.goal ?? "A new sprint was added to the project.",
        sourceEventId: sprintListItem.id,
        entityRefs: {
          projectId: validated.projectId,
          sprintId: sprintListItem.id,
        },
      },
      { sprintId: sprintListItem.id },
    );

    recordSprintMetric("project.sprint.create.result", {
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
        error: error.issues[0]?.message ?? "Sprint details are invalid",
      };
    }
    console.error("Failed to create sprint:", error);
    recordSprintMetric("project.sprint.create.result", {
      projectId: data.projectId,
      actorId: actorIdForMetric ?? "unknown",
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to create sprint",
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to create sprint",
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
    if (!user) throw new Error("Unauthorized");
    actorIdForMetric = user.id;

    const validated = updateSprintSchema.parse(data);
    const startDate = parseSprintDateInput(validated.startDate);
    const endDate = parseSprintDateInput(validated.endDate);

    await requireSprintOwner(validated.projectId, user.id);

    const [existingSprint] = await db
      .select({
        id: projectSprints.id,
        projectId: projectSprints.projectId,
        status: projectSprints.status,
      })
      .from(projectSprints)
      .where(
        and(
          eq(projectSprints.id, validated.sprintId),
          eq(projectSprints.projectId, validated.projectId),
        ),
      )
      .limit(1);

    if (!existingSprint) {
      throw new Error("Sprint not found");
    }
    if (
      existingSprint.status !== "planning"
    ) {
      throw new Error(
        "Active, completed, cancelled, and archived Sprints are read-only",
      );
    }

    const changedAt = new Date();
    const updatedSprintId = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(projectSprints)
        .set({
          name: validated.name,
          goal: validated.goal ?? null,
          description: validated.description ?? null,
          startDate,
          endDate,
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(projectSprints.id, validated.sprintId),
            eq(projectSprints.projectId, validated.projectId),
            eq(projectSprints.status, "planning"),
          ),
        )
        .returning({ id: projectSprints.id });
      if (!updated)
        throw new Error("The Sprint changed before it could be saved");

      await tx.insert(projectSprintEvents).values({
        projectId: validated.projectId,
        sprintId: updated.id,
        actorId: user.id,
        eventType: "updated",
        payload: {
          name: validated.name,
          status: existingSprint.status,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        createdAt: changedAt,
      });
      return updated.id;
    });

    const sprintListItem = await readProjectSprintListItem(
      validated.projectId,
      updatedSprintId,
    );
    if (!sprintListItem) throw new Error("Failed to reload updated sprint");

    await revalidateProjectPaths(validated.projectId);

    await enqueueProjectNotificationBestEffort(
      {
        projectId: validated.projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "sprints.updated",
        title: `Sprint updated: ${sprintListItem.name}`,
        body: sprintListItem.goal ?? "Sprint details were updated.",
        sourceEventId: `${sprintListItem.id}:${sprintListItem.updatedAt ?? changedAt.toISOString()}`,
        entityRefs: {
          projectId: validated.projectId,
          sprintId: sprintListItem.id,
        },
      },
      { sprintId: sprintListItem.id },
    );

    recordSprintMetric("project.sprint.update.result", {
      projectId: validated.projectId,
      sprintId: validated.sprintId,
      actorId: actorIdForMetric,
      success: true,
      durationMs: Date.now() - startedAt,
    });

    return { success: true as const, sprint: sprintListItem };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false as const,
        error: error.issues[0]?.message ?? "Sprint details are invalid",
      };
    }

    console.error("Failed to update sprint:", error);
    recordSprintMetric("project.sprint.update.result", {
      projectId: data.projectId,
      sprintId: data.sprintId,
      actorId: actorIdForMetric ?? "unknown",
      success: false,
      durationMs: Date.now() - startedAt,
      message:
        error instanceof Error ? error.message : "Failed to update sprint",
    });

    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to update sprint",
    };
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    actorIdForMetric = user.id;

    const validated = deleteSprintSchema.parse(data);
    await requireSprintOwner(validated.projectId, user.id);

    const [sprintWithTaskCount] = await db.execute<{
      id: string;
      status: SprintListItem["status"];
      affected_task_count: number;
    }>(sql`
            SELECT
                s.id,
                s.status,
                (
                    SELECT COUNT(DISTINCT task_id)::int
                    FROM ${sprintTaskMemberships} m
                    WHERE m.sprint_id = s.id
                ) AS affected_task_count
            FROM ${projectSprints} s
            WHERE s.id = ${validated.sprintId}
              AND s.project_id = ${validated.projectId}
            LIMIT 1
        `);

    if (!sprintWithTaskCount) {
      throw new Error("Sprint not found");
    }

    if (
      sprintWithTaskCount.status !== "planning" ||
      sprintWithTaskCount.affected_task_count > 0
    ) {
      recordSprintMetric("project.sprint.delete.blocked", {
        projectId: validated.projectId,
        sprintId: validated.sprintId,
        actorId: actorIdForMetric,
        reason:
          sprintWithTaskCount.status !== "planning"
            ? "not_planning"
            : "has_history",
        affectedTaskCount: sprintWithTaskCount.affected_task_count,
      });
      return {
        success: false,
        error:
          sprintWithTaskCount.affected_task_count > 0
            ? "Sprints with work history are archived instead of deleted."
            : "Only an empty Planning sprint can be deleted.",
      };
    }

    await db
      .delete(projectSprints)
      .where(eq(projectSprints.id, validated.sprintId));

    await revalidateProjectPaths(validated.projectId);

    await enqueueProjectNotificationBestEffort(
      {
        projectId: validated.projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "sprints.deleted",
        title: "Sprint deleted",
        body: "An empty Planning sprint was deleted.",
        sourceEventId: `${validated.sprintId}:deleted`,
        entityRefs: {
          projectId: validated.projectId,
          sprintId: validated.sprintId,
        },
      },
      { sprintId: validated.sprintId },
    );

    recordSprintMetric("project.sprint.delete.result", {
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
    recordSprintMetric("project.sprint.delete.result", {
      projectId: data.projectId,
      sprintId: data.sprintId,
      actorId: actorIdForMetric ?? "unknown",
      success: false,
      durationMs: Date.now() - startedAt,
      message:
        error instanceof Error ? error.message : "Failed to delete sprint",
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete sprint",
    };
  }
}

type CompleteSprintOptions = {
  unfinished?: "keep" | "backlog" | "next_sprint";
  nextSprintId?: string | null;
};

async function requireSprintOwner(projectId: string, userId: string) {
  const access = await getProjectAccessById(projectId, userId);
  if (!access.project) throw new Error("Project not found");
  if (!access.isOwner && access.memberRole !== "admin")
    throw new Error("Only a project owner or admin can manage the Sprint lifecycle");
}

async function readLifecycleSprint(projectId: string, sprintId: string) {
  const sprint = await readProjectSprintListItem(projectId, sprintId);
  if (!sprint) throw new Error("Sprint not found");
  return sprint;
}

export async function startSprintAction(sprintId: string, projectId: string) {
  if (process.env.ALLOW_MANUAL_SPRINT_LIFECYCLE !== "true") {
    return {
      success: false as const,
      error: "Sprint start is scheduled automatically.",
    };
  }
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await requireSprintOwner(projectId, user.id);
    const now = new Date();
    await db.transaction(async (tx) => {
      const active = await tx.query.projectSprints.findFirst({
        where: and(
          eq(projectSprints.projectId, projectId),
          eq(projectSprints.status, "active"),
        ),
        columns: { id: true },
      });
      if (active && active.id !== sprintId)
        throw new Error("Complete the current active Sprint first");
      const [started] = await tx
        .update(projectSprints)
        .set({
          status: "active",
          startedAt: now,
          completedAt: null,
          archivedAt: null,
          cancelledAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(projectSprints.id, sprintId),
            eq(projectSprints.projectId, projectId),
            eq(projectSprints.status, "planning"),
          ),
        )
        .returning({ id: projectSprints.id });
      if (!started) throw new Error("Only a Planning sprint can be started");
      await tx.insert(projectSprintEvents).values({
        projectId,
        sprintId,
        actorId: user.id,
        eventType: "started",
        payload: {},
        createdAt: now,
      });
    });
    const sprint = await readLifecycleSprint(projectId, sprintId);
    await revalidateProjectPaths(projectId);
    await enqueueProjectNotificationBestEffort(
      {
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "sprints.started",
        title: `Sprint started: ${sprint.name}`,
        body: sprint.goal ?? "The Sprint is now active.",
        sourceEventId: `${sprintId}:started:${sprint.startedAt ?? now.toISOString()}`,
        entityRefs: { projectId, sprintId },
      },
      { sprintId },
    );
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      actorId: user.id,
      action: "start",
      success: true,
    });
    return { success: true as const, sprint };
  } catch (error) {
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      action: "start",
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to start sprint",
    });
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to start sprint",
    };
  }
}

export async function completeSprintAction(
  sprintId: string,
  projectId: string,
  options: CompleteSprintOptions = {},
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await requireSprintOwner(projectId, user.id);
    const unfinished = options.unfinished ?? "keep";
    const now = new Date();
    await db.transaction(async (tx) => {
      // A close-out can move or detach work, so the UI restriction must be
      // enforced here as well. This also prevents a stale tab from closing a
      // sprint before its scheduled end date.
      const activeSprint = await tx.query.projectSprints.findFirst({
        where: and(
          eq(projectSprints.id, sprintId),
          eq(projectSprints.projectId, projectId),
          eq(projectSprints.status, "active"),
        ),
        columns: { endDate: true },
      });
      if (!activeSprint) throw new Error("Only an Active sprint can be completed");
      if (!activeSprint.endDate || activeSprint.endDate.getTime() > now.getTime()) {
        throw new Error("This sprint can be closed on or after its scheduled end date");
      }
      // Claim the transition first. The status predicate serializes
      // duplicate completion requests before memberships are moved or
      // a second lifecycle event can be written.
      const [completed] = await tx
        .update(projectSprints)
        .set({ status: "completed", completedAt: now, updatedAt: now })
        .where(
          and(
            eq(projectSprints.id, sprintId),
            eq(projectSprints.projectId, projectId),
            eq(projectSprints.status, "active"),
            lte(projectSprints.endDate, now),
          ),
        )
        .returning({ id: projectSprints.id });
      if (!completed) throw new Error("Only an Active sprint can be completed");
      if (unfinished === "next_sprint") {
        if (!options.nextSprintId || options.nextSprintId === sprintId)
          throw new Error("Choose a different Planning sprint");
        const target = await tx.query.projectSprints.findFirst({
          where: and(
            eq(projectSprints.id, options.nextSprintId),
            eq(projectSprints.projectId, projectId),
            eq(projectSprints.status, "planning"),
          ),
          columns: { id: true },
        });
        if (!target)
          throw new Error("The destination must be a Planning sprint");
      }
      if (unfinished !== "keep") {
        const unfinishedTasks = await tx.query.tasks.findMany({
          where: and(
            eq(tasks.projectId, projectId),
            eq(tasks.sprintId, sprintId),
            isNull(tasks.deletedAt),
            sql`${tasks.status} <> 'done'`,
          ),
          columns: { id: true },
        });
        const unfinishedIds = unfinishedTasks.map((task) => task.id);
        if (unfinishedIds.length > 0) {
          await tx
            .update(sprintTaskMemberships)
            .set({ removedAt: now, removedBy: user.id })
            .where(
              and(
                eq(sprintTaskMemberships.sprintId, sprintId),
                inArray(sprintTaskMemberships.taskId, unfinishedIds),
                isNull(sprintTaskMemberships.removedAt),
              ),
            );
          if (unfinished === "next_sprint" && options.nextSprintId) {
            await tx.insert(sprintTaskMemberships).values(
              unfinishedIds.map((taskId) => ({
                projectId,
                sprintId: options.nextSprintId!,
                taskId,
                addedBy: user.id,
                addedAt: now,
              })),
            );
          }
          await tx
            .update(tasks)
            .set({
              sprintId:
                unfinished === "next_sprint" ? options.nextSprintId : null,
              updatedAt: now,
            })
            .where(inArray(tasks.id, unfinishedIds));
        }
      }
      await tx.insert(projectSprintEvents).values({
        projectId,
        sprintId,
        actorId: user.id,
        eventType: "completed",
        payload: { unfinished, nextSprintId: options.nextSprintId ?? null },
        createdAt: now,
      });
    });
    const sprint = await readLifecycleSprint(projectId, sprintId);
    await revalidateProjectPaths(projectId);
    await enqueueProjectNotificationBestEffort(
      {
        projectId,
        actorUserId: user.id,
        ...actorNotificationSnapshot(user),
        eventKey: "sprints.completed",
        title: `Sprint completed: ${sprint.name}`,
        body:
          unfinished === "backlog"
            ? "Unfinished work moved to the backlog."
            : unfinished === "next_sprint"
              ? "Unfinished work moved to the next Planning sprint."
              : "The Sprint scope was preserved for review.",
        sourceEventId: `${sprintId}:completed:${sprint.completedAt ?? now.toISOString()}`,
        entityRefs: { projectId, sprintId },
      },
      { sprintId },
    );
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      actorId: user.id,
      action: "complete",
      success: true,
      unfinished,
    });
    return { success: true as const, sprint };
  } catch (error) {
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      action: "complete",
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to complete sprint",
    });
    return {
      success: false as const,
      error:
        error instanceof Error ? error.message : "Failed to complete sprint",
    };
  }
}

export async function reopenSprintAction(sprintId: string, projectId: string) {
  if (process.env.ALLOW_MANUAL_SPRINT_LIFECYCLE !== "true") {
    return {
      success: false as const,
      error: "Completed sprints are immutable. Create a follow-up sprint instead.",
    };
  }
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await requireSprintOwner(projectId, user.id);
    const now = new Date();
    await db.transaction(async (tx) => {
      const active = await tx.query.projectSprints.findFirst({
        where: and(
          eq(projectSprints.projectId, projectId),
          eq(projectSprints.status, "active"),
        ),
        columns: { id: true },
      });
      if (active && active.id !== sprintId)
        throw new Error("Complete the current active Sprint first");
      const [updated] = await tx
        .update(projectSprints)
        .set({
          status: "active",
          completedAt: null,
          archivedAt: null,
          startedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(projectSprints.id, sprintId),
            eq(projectSprints.projectId, projectId),
            eq(projectSprints.status, "completed"),
          ),
        )
        .returning({ id: projectSprints.id });
      if (!updated) throw new Error("Only a Completed sprint can be reopened");
      await tx.insert(projectSprintEvents).values({
        projectId,
        sprintId,
        actorId: user.id,
        eventType: "reopened",
        payload: {},
        createdAt: now,
      });
    });
    const sprint = await readLifecycleSprint(projectId, sprintId);
    await revalidateProjectPaths(projectId);
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      actorId: user.id,
      action: "reopen",
      success: true,
    });
    return { success: true as const, sprint };
  } catch (error) {
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      action: "reopen",
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to reopen sprint",
    });
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to reopen sprint",
    };
  }
}

export async function archiveSprintAction(sprintId: string, projectId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await requireSprintOwner(projectId, user.id);
    const now = new Date();
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(projectSprints)
        .set({ status: "archived", archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(projectSprints.id, sprintId),
            eq(projectSprints.projectId, projectId),
            or(
              eq(projectSprints.status, "completed"),
              eq(projectSprints.status, "cancelled"),
            ),
          ),
        )
        .returning({ id: projectSprints.id });
      if (!updated)
        throw new Error("Complete or cancel the Sprint before archiving it");
      await tx.insert(projectSprintEvents).values({
        projectId,
        sprintId,
        actorId: user.id,
        eventType: "archived",
        payload: {},
        createdAt: now,
      });
    });
    const sprint = await readLifecycleSprint(projectId, sprintId);
    await revalidateProjectPaths(projectId);
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      actorId: user.id,
      action: "archive",
      success: true,
    });
    return { success: true as const, sprint };
  } catch (error) {
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      action: "archive",
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to archive sprint",
    });
    return {
      success: false as const,
      error:
        error instanceof Error ? error.message : "Failed to archive sprint",
    };
  }
}

export async function cancelSprintAction(sprintId: string, projectId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");
    await requireSprintOwner(projectId, user.id);
    const now = new Date();
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(projectSprints)
        .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
        .where(
          and(
            eq(projectSprints.id, sprintId),
            eq(projectSprints.projectId, projectId),
            or(
              eq(projectSprints.status, "planning"),
              eq(projectSprints.status, "active"),
            ),
          ),
        )
        .returning({ id: projectSprints.id });
      if (!updated)
        throw new Error("Only a Planning or Active sprint can be cancelled");

      const currentTasks = await tx.query.tasks.findMany({
        where: and(
          eq(tasks.projectId, projectId),
          eq(tasks.sprintId, sprintId),
          isNull(tasks.deletedAt),
        ),
        columns: { id: true },
      });
      const taskIds = currentTasks.map((task) => task.id);
      await tx
        .update(sprintTaskMemberships)
        .set({ removedAt: now, removedBy: user.id })
        .where(
          and(
            eq(sprintTaskMemberships.sprintId, sprintId),
            isNull(sprintTaskMemberships.removedAt),
          ),
        );
      if (taskIds.length > 0) {
        await tx
          .update(tasks)
          .set({ sprintId: null, updatedAt: now })
          .where(inArray(tasks.id, taskIds));
      }
      await tx.insert(projectSprintEvents).values({
        projectId,
        sprintId,
        actorId: user.id,
        eventType: "cancelled",
        payload: { returnedTaskCount: taskIds.length },
        createdAt: now,
      });
    });
    const sprint = await readLifecycleSprint(projectId, sprintId);
    await revalidateProjectPaths(projectId);
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      actorId: user.id,
      action: "cancel",
      success: true,
    });
    return { success: true as const, sprint };
  } catch (error) {
    recordSprintMetric("project.sprint.lifecycle.result", {
      projectId,
      sprintId,
      action: "cancel",
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to cancel sprint",
    });
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Failed to cancel sprint",
    };
  }
}

export async function deleteTaskAction(taskId: string, projectId: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    // Access Check - Only project owner can delete tasks
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      columns: { ownerId: true, slug: true },
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
          sprintId: true,
          title: true,
          taskNumber: true,
          status: true,
        },
      });

      if (!existingTask) {
        throw new Error("Task not found in this project");
      }

      // Soft-deleting a task must not strand its private working files behind
      // the hidden task workspace. Preserve them in one explicit recovery
      // folder, then detach their task ownership and links.
      const taskNodes = await tx.query.projectNodes.findMany({
        where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.taskId, taskId)),
        columns: { id: true, parentId: true, name: true, path: true, type: true },
      });
      if (taskNodes.length > 0) {
        const scopedIds = new Set(taskNodes.map((node) => node.id));
        const rootNodes = taskNodes.filter((node) => !node.parentId || !scopedIds.has(node.parentId));
        const recoveryName = `Recovered task files ${taskId.slice(0, 8)}`;
        let recoveryFolder = await tx.query.projectNodes.findFirst({
          where: and(eq(projectNodes.projectId, projectId), isNull(projectNodes.parentId), eq(projectNodes.name, recoveryName)),
          columns: { id: true, path: true },
        });
        if (!recoveryFolder) {
          const [created] = await tx.insert(projectNodes).values({
            projectId,
            parentId: null,
            type: "folder",
            name: recoveryName,
            path: `/${recoveryName}`,
            createdBy: user.id,
          }).returning({ id: projectNodes.id, path: projectNodes.path });
          recoveryFolder = created!;
        }
        for (const node of rootNodes) {
          const nextPath = `${recoveryFolder.path}/${node.name}`;
          await tx.update(projectNodes)
            .set({ parentId: recoveryFolder.id, path: nextPath, taskId: null, updatedAt: new Date() })
            .where(eq(projectNodes.id, node.id));
          if (node.type === "folder") {
            await tx.execute(sql`
              UPDATE project_nodes
              SET task_id = NULL,
                  path = ${nextPath} || SUBSTRING(path FROM ${node.path.length + 1}),
                  updated_at = NOW()
              WHERE project_id = ${projectId}
                AND path LIKE ${`${node.path}/%`}
            `);
          }
        }
        await tx.delete(taskNodeLinks).where(eq(taskNodeLinks.taskId, taskId));
      }

      await tx
        .update(tasks)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(tasks.id, taskId),
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
          ),
        );
      await tx.insert(taskActivityEvents).values({
        taskId,
        projectId,
        sprintId: existingTask.sprintId,
        actorId: user.id,
        eventType: "deleted",
        payload: {
          version: 1,
          taskTitle: existingTask.title,
          taskNumber: existingTask.taskNumber,
          taskStatus: existingTask.status,
        },
      });
      return existingTask;
    });

    await queueCounterRefreshBestEffort([deletedTask?.assigneeId ?? null]);

    const slugOrId = project.slug || projectId;
    revalidatePath(`/projects/${slugOrId}`);
    revalidatePath(`/projects/${projectId}`);

    return { success: true };
  } catch (error) {
    console.error("Failed to delete task:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete task",
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
      errorCode:
        | "UNAUTHORIZED"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "PROJECT_CONFLICT"
        | "INVALID_INPUT"
        | "INTERNAL_ERROR";
      latest?: {
        currentStageIndex: number;
        updatedAt: string | null;
      };
    };

export async function updateProjectStageAction(
  projectId: string,
  currentStageIndex: number,
  options?: UpdateProjectStageOptions,
): Promise<UpdateProjectStageResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        error: "Unauthorized",
        errorCode: "UNAUTHORIZED",
      };
    }

    const normalizedIndex =
      Number.isInteger(currentStageIndex) && currentStageIndex >= 0
        ? currentStageIndex
        : null;
    if (normalizedIndex === null) {
      return {
        success: false,
        error: "Invalid stage index",
        errorCode: "INVALID_INPUT",
      };
    }

    const [projectForStageUpdate] = await db
      .select({
        ownerId: projects.ownerId,
        lifecycleStages: projects.lifecycleStages,
        currentStageIndex: projects.currentStageIndex,
        stageCompletionDates: projects.stageCompletionDates,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!projectForStageUpdate) {
      return {
        success: false,
        error: "Project not found",
        errorCode: "NOT_FOUND",
      };
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
      return {
        success: false,
        error: "Stage index out of range",
        errorCode: "INVALID_INPUT",
      };
    }

    let expectedUpdatedAtDate: Date | null = null;
    const expectedUpdatedAtRaw = options?.expectedUpdatedAt?.trim();
    if (expectedUpdatedAtRaw) {
      expectedUpdatedAtDate = new Date(expectedUpdatedAtRaw);
      if (Number.isNaN(expectedUpdatedAtDate.getTime())) {
        return {
          success: false,
          error: "Invalid lifecycle version",
          errorCode: "INVALID_INPUT",
        };
      }
    }

    const whereClause = expectedUpdatedAtDate
      ? and(
          eq(projects.id, projectId),
          eq(projects.ownerId, user.id),
          eq(projects.updatedAt, expectedUpdatedAtDate),
        )
      : and(eq(projects.id, projectId), eq(projects.ownerId, user.id));

    const previousStageIndex = Math.min(
      Math.max(0, projectForStageUpdate.currentStageIndex ?? 0),
      Math.max(0, lifecycleStages.length - 1),
    );
    const updatedDates = buildJourneyCompletionDates({
      completionDates: projectForStageUpdate.stageCompletionDates,
      previousStageIndex,
      nextStageIndex: normalizedIndex,
      transitionedAt: new Date().toISOString(),
    });

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
          error: "Project not found",
          errorCode: "NOT_FOUND",
        };
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
      return {
        success: false,
        error: "Failed to update project stage",
        errorCode: "INTERNAL_ERROR",
      };
    }

    const slugOrId = updated.slug || projectId;
    revalidatePath(`/projects/${slugOrId}`);
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/hub");

    return {
      success: true,
      currentStageIndex: Math.max(
        0,
        updated.currentStageIndex ?? normalizedIndex,
      ),
      updatedAt: updated.updatedAt?.toISOString?.() ?? null,
      stageCompletionDates: updated.stageCompletionDates as
        | Record<string, string>
        | undefined,
    };
  } catch (error) {
    console.error("[updateProjectStageAction] Failed:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update project stage",
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
  currentActiveStageName: string,
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    // Validate and sanitize stages
    const sanitizedStages = validateAndSanitizeLifecycleStages(newStages);

    // Get current index for Smart Rebalance calculation
    const [project] = await db
      .select({
        currentStageIndex: projects.currentStageIndex,
        lifecycleStages: projects.lifecycleStages,
        stageCompletionDates: projects.stageCompletionDates,
        slug: projects.slug,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, user.id)))
      .limit(1);

    if (!project) {
      throw new Error("Project not found or access denied");
    }

    // SMART REBALANCE: Find the new index for the current stage
    let newIndex = sanitizedStages.findIndex(
      (s) => s === currentActiveStageName,
    );
    if (newIndex === -1) {
      // Stage was deleted - fallback to previous index or 0
      newIndex = Math.max(0, (project.currentStageIndex || 0) - 1);
      // Clamp to max
      newIndex = Math.min(newIndex, sanitizedStages.length - 1);
    }

    // Completion dates are indexed because lifecycle stages predate stable
    // stage IDs. Preserve dates by stage name when a lifecycle is renamed or
    // reordered, and discard dates for stages that no longer exist.
    const previousStages = Array.isArray(project.lifecycleStages)
      ? project.lifecycleStages
      : [];
    const previousDates = normalizeJourneyCompletionDates(
      project.stageCompletionDates,
      Math.max(0, project.currentStageIndex ?? 0),
    );
    const completionDatesByStage = new Map<string, string>();
    previousStages.forEach((stage, index) => {
      const completedAt = previousDates[String(index)];
      if (index < Math.max(0, project.currentStageIndex ?? 0) && completedAt) {
        completionDatesByStage.set(stage, completedAt);
      }
    });
    const remappedCompletionDates = Object.fromEntries(
      sanitizedStages.slice(0, newIndex).flatMap((stage, index) => {
        const completedAt = completionDatesByStage.get(stage);
        return completedAt ? [[String(index), completedAt]] : [];
      }),
    );

    const [updated] = await db
      .update(projects)
      .set({
        lifecycleStages: sanitizedStages,
        currentStageIndex: newIndex,
        stageCompletionDates: remappedCompletionDates,
        updatedAt: new Date(),
      })
      .where(and(
        eq(projects.id, projectId),
        eq(projects.ownerId, user.id),
        eq(projects.updatedAt, project.updatedAt),
      ))
      .returning({ id: projects.id });

    if (!updated) {
      throw new Error("Project lifecycle changed. Refresh and retry.");
    }

    const slugOrId = project.slug || projectId;
    revalidatePath(`/projects/${slugOrId}`);
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/hub");

    return { success: true, newStageIndex: newIndex };
  } catch (error) {
    console.error("Failed to update project lifecycle:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update project lifecycle",
    };
  }
}

export async function finalizeProjectAction(
  projectId: string,
): Promise<
  | { success: true; message: string }
  | { success: false; message: string; errorCode: ProjectSettingsErrorCode }
> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        success: false,
        errorCode: "UNAUTHORIZED",
        message: "You must be signed in.",
      };
    }

    const MAX_FINALIZE_TX_RETRIES = 3;
    const isSerializationRetryable = (error: unknown) => {
      const code = (error as { code?: string } | null)?.code;
      const message =
        error instanceof Error
          ? error.message.toLowerCase()
          : String(error).toLowerCase();
      return (
        code === "40001" || // serialization_failure
        code === "40P01" || // deadlock_detected
        message.includes("could not serialize access") ||
        message.includes("serialization failure") ||
        message.includes("deadlock detected")
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
            .for("update")
            .limit(1);
          if (!project) {
            return {
              success: false as const,
              errorCode: "NOT_FOUND" as const,
              message: "Project not found.",
            };
          }
          if (project.ownerId !== user.id) {
            return {
              success: false as const,
              errorCode: "FORBIDDEN" as const,
              message: "Only the owner can finalize the project.",
            };
          }

          // 2. Re-check danger-zone blockers at mutation time (do not trust stale UI preflight)
          const [openRolesRow, pendingAppsRow, activeTasksRow] =
            await Promise.all([
              tx
                .select({ count: sql<number>`count(*)::int` })
                .from(projectOpenRoles)
                .where(eq(projectOpenRoles.projectId, projectId))
                .limit(1),
              tx
                .select({ count: sql<number>`count(*)::int` })
                .from(roleApplications)
                .where(
                  and(
                    eq(roleApplications.projectId, projectId),
                    eq(roleApplications.status, "pending"),
                  ),
                )
                .limit(1),
              tx
                .select({ count: sql<number>`count(*)::int` })
                .from(tasks)
                .where(
                  and(
                    eq(tasks.projectId, projectId),
                    isNull(tasks.deletedAt),
                    sql`${tasks.status} <> 'done'`,
                  ),
                )
                .limit(1),
            ]);

          const status =
            project.status === "draft" ||
            project.status === "active" ||
            project.status === "completed" ||
            project.status === "archived"
              ? project.status
              : "draft";
          Number(openRolesRow[0]?.count ?? 0); // queried to keep parity with danger-zone preflight
          const pendingApplicationsCount = Number(
            pendingAppsRow[0]?.count ?? 0,
          );
          const activeTasksCount = Number(activeTasksRow[0]?.count ?? 0);
          const finalizeBlockers: string[] = [];
          if (activeTasksCount > 0) {
            finalizeBlockers.push(
              `There are ${activeTasksCount} non-completed tasks.`,
            );
          }
          if (pendingApplicationsCount > 0) {
            finalizeBlockers.push(
              `There are ${pendingApplicationsCount} pending applications.`,
            );
          }
          if (status === "completed") {
            return {
              success: false as const,
              errorCode: "INVALID_INPUT" as const,
              message: "Project is already completed.",
            };
          }
          if (status === "archived") {
            return {
              success: false as const,
              errorCode: "INVALID_INPUT" as const,
              message: "Archived projects cannot be finalized.",
            };
          }
          if (finalizeBlockers.length > 0) {
            return {
              success: false as const,
              errorCode: "INVALID_INPUT" as const,
              message:
                finalizeBlockers[0] ?? "Project cannot be finalized yet.",
            };
          }

          // 3. Finalize Project
          await tx
            .update(projects)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(projects.id, projectId));

          // 4. Close open roles
          await tx
            .delete(projectOpenRoles)
            .where(eq(projectOpenRoles.projectId, projectId));

          // 5. (Future) Distribute Reputation Points
          // This would be a ledger insert

          return {
            success: true as const,
            message: "Project finalized successfully.",
          };
        });
        break;
      } catch (error) {
        if (
          isSerializationRetryable(error) &&
          attempt < MAX_FINALIZE_TX_RETRIES
        ) {
          continue;
        }
        throw error;
      }
    }

    if (!result) {
      throw new Error("Failed to finalize project due to transaction retries.");
    }
    logger.metric("project.settings.finalize.result", {
      projectId,
      userId: user.id,
      result: result.success ? "success" : "error",
      errorCode: result.success ? null : result.errorCode,
    });
    await revalidateProjectPaths(projectId);
    return result;
  } catch (error) {
    console.error("Failed to finalize project:", error);
    logger.metric("project.settings.finalize.result", {
      projectId,
      result: "error",
      errorCode: "INTERNAL_ERROR",
    });
    return {
      success: false,
      errorCode: "INTERNAL_ERROR",
      message:
        error instanceof Error ? error.message : "Failed to finalize project.",
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
      error: error instanceof Error ? error.message : "Unauthorized",
    };
  }

  try {
    return await runInFlightDeduped(
      `project:sync-status:${projectId}:${actorId ?? "anon"}`,
      async () => {
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
        const lastError = rawError
          ? canSeeDetailedError
            ? sanitizeGitErrorMessage(rawError)
            : "Import failed. Project owner can retry the import."
          : null;

        return {
          success: true as const,
          status: project?.syncStatus || "ready",
          lastError,
        };
      },
    );
  } catch (error) {
    console.error("Failed to get sync status", error);
    return { success: false as const, error: "Failed" };
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
  if (!user) return { success: false, error: "Unauthorized" };

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

    if (!project) return { success: false, error: "Project not found" };
    if (project.ownerId !== user.id)
      return { success: false, error: "Unauthorized" };

    const src = project.importSource as any;
    if (!src || src.type !== "github" || !src.repoUrl) {
      return { success: false, error: "Not a GitHub import project" };
    }

    // Inngest handles concurrency/idempotency automatically via function settings.
    // We just re-emit the event.

    const gitHubToken = session?.provider_token;
    const normalizedRepoUrl = normalizeGithubRepoUrl(src.repoUrl || "");
    if (!normalizedRepoUrl)
      return { success: false, error: "Invalid GitHub repository URL" };

    const normalizedBranch = normalizeGithubBranch(src.branch);
    if (src.branch && !normalizedBranch)
      return { success: false, error: "Invalid GitHub branch name" };

    const githubConnection = buildGithubAccountConnectionState(user);
    const githubAccountHealth = await resolveGithubExternalAccountHealth({
      linked: githubConnection.linked,
      githubId: githubConnection.githubId,
      username: githubConnection.username,
    });
    const accessCheck = await ensureGithubImportAccess(normalizedRepoUrl, {
      oauthToken: gitHubToken || null,
      preferredInstallationId: src?.metadata?.githubInstallationId ?? null,
      sealedImportToken: src?.metadata?.importAuth,
      accountLinked: githubConnection.linked,
      accountUnavailable: githubAccountHealth.state === "unavailable",
    });
    if (!accessCheck.ok) return { success: false, error: accessCheck.error };

    const sealed = gitHubToken ? sealGithubImportToken(gitHubToken) : null;
    const clearedSource = clearSealedGithubTokenFromImportSource(src) as Record<
      string,
      any
    >;
    const retryAt = new Date().toISOString();
    const nextImportSource = {
      ...clearedSource,
      repoUrl: normalizedRepoUrl,
      branch: normalizedBranch || accessCheck.defaultBranch || "main",
      metadata: {
        ...((clearedSource.metadata || {}) as Record<string, any>),
        lastError: null,
        lastRetryAt: retryAt,
        syncPhase: "pending",
        githubInstallationId: accessCheck.installationId,
        githubAuthSource: accessCheck.authSource,
        githubRepoId:
          accessCheck.repoId ??
          ((clearedSource.metadata || {}) as Record<string, unknown>)
            ?.githubRepoId ??
          null,
        githubRepoPrivate: accessCheck.isPrivate,
        ...(sealed ? { importAuth: sealed } : {}),
      },
    };

    await db
      .update(projects)
      .set({
        syncStatus: "pending",
        importSource: nextImportSource as any,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    const enqueueBranch =
      normalizedBranch || accessCheck.defaultBranch || undefined;
    const retryEventId = `${buildGithubImportEventId(projectId, normalizedRepoUrl, enqueueBranch || null)}:retry:${Date.parse(retryAt)}`;
    const dispatchResult = await enqueueGithubImportOrRunInline({
      projectId,
      userId: user.id,
      importSource: {
        type: "github",
        repoUrl: normalizedRepoUrl,
        branch: enqueueBranch,
        metadata: (
          clearSealedGithubTokenFromImportSource(nextImportSource) as Record<
            string,
            any
          >
        ).metadata,
      },
      eventId: retryEventId,
      source: "retry",
      resolutions,
    });

    if (!dispatchResult.success) {
      return { success: false, error: dispatchResult.error };
    }

    return { success: true };
  } catch (e: any) {
    const msg = sanitizeGitErrorMessage(
      typeof e?.message === "string" ? e.message : "Retry failed",
    );
    try {
      const [project] = await db
        .select({ importSource: projects.importSource })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      const clearedSource = clearSealedGithubTokenFromImportSource(
        project?.importSource,
      ) as Record<string, any>;
      await db
        .update(projects)
        .set({
          syncStatus: "failed",
          updatedAt: new Date(),
          importSource: {
            ...clearedSource,
            metadata: {
              ...((clearedSource?.metadata || {}) as Record<string, any>),
              lastError: msg,
              syncPhase: "failed",
            },
          } as any,
        })
        .where(eq(projects.id, projectId));
    } catch (updateError) {
      console.error(
        "Failed to persist sync failure metadata after retry failure",
        updateError,
      );
    }

    logger.metric("github.import.enqueue", {
      projectId,
      result: "error",
      source: "retry",
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

    const actorId = user?.id ?? null;
    return await runInFlightDeduped(
      `project:live-stats:${projectId}:${actorId ?? "anon"}`,
      async () => {
        const access = await getProjectAccessById(projectId, actorId);
        if (!access.project || !access.canRead) {
          return {
            success: false,
            error: "Project not found or access denied",
          };
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
          return { success: false, error: "Project not found" };
        }

        let liveViewCount = Math.max(0, row.viewCount ?? 0);
        if (redis && process.env.PROJECT_VIEWS_WRITE_THROUGH !== "1") {
          const bufferedVal = await redis.hget("project:views", projectId);
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
            .where(
              and(
                eq(projectFollows.userId, user.id),
                eq(projectFollows.projectId, projectId),
              ),
            )
            .limit(1);
          isFollowed = !!followRow;
        }

        return {
          success: true,
          viewCount: liveViewCount,
          followersCount,
          isFollowed,
        };
      },
    );
  } catch (error) {
    console.error("Failed to get live project stats", error);
    return { success: false, error: "Failed to get live stats" };
  }
}

export async function getProfileProjectsWithOpenRolesAction(
  targetProfileId: string,
  excludeMemberUserId?: string | null,
  input: { search?: string; cursor?: string; limit?: number } = {},
) {
  try {
    if (!targetProfileId) return { items: [], nextCursor: null };
    const requestedLimit = Number(input.limit ?? 20);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 50)) : 20;
    const search = normalizeSearchQuery(input.search, 100);
    const searchPattern = search ? containsLikePattern(search) : null;
    const separator = input.cursor?.indexOf("|") ?? -1;
    const cursorDate = separator > 0 ? new Date(input.cursor!.slice(0, separator)) : null;
    const cursorId = separator > 0 ? input.cursor!.slice(separator + 1) : null;
    const cursor = cursorDate && !Number.isNaN(cursorDate.getTime()) && cursorId && isLooseUuid(cursorId)
      ? { updatedAt: cursorDate, id: cursorId }
      : null;
    const selectionFilters = [
      gt(projects.openRolesCount, 0),
      isNull(projects.deletedAt),
      excludeMemberUserId ? sql`${projects.ownerId} <> ${excludeMemberUserId}::uuid` : undefined,
      excludeMemberUserId ? sql`NOT EXISTS (
        SELECT 1
        FROM project_members AS excluded_member
        WHERE excluded_member.project_id = ${projects.id}
          AND excluded_member.user_id = ${excludeMemberUserId}::uuid
      )` : undefined,
      searchPattern ? ilike(projects.title, searchPattern) : undefined,
      cursor ? sql`(${projects.updatedAt}, ${projects.id}) < (${cursor.updatedAt}, ${cursor.id}::uuid)` : undefined,
    ];

    const owned = await db
      .select({
        id: projects.id,
        title: projects.title,
        slug: projects.slug,
        ownerId: projects.ownerId,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .where(
        and(
          eq(projects.ownerId, targetProfileId),
          ...selectionFilters,
        ),
      )
      .orderBy(desc(projects.updatedAt), desc(projects.id))
      .limit(limit + 1);

    const member = await db
      .select({
        id: projects.id,
        title: projects.title,
        slug: projects.slug,
        ownerId: projects.ownerId,
        updatedAt: projects.updatedAt,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(
        and(
          eq(projectMembers.userId, targetProfileId),
          inArray(projectMembers.role, ["owner", "admin"]),
          ...selectionFilters,
        ),
      )
      .orderBy(desc(projects.updatedAt), desc(projects.id))
      .limit(limit + 1);

    const projectsMerged = Array.from(
      new Map([...owned, ...member].map((project) => [project.id, project])).values(),
    ).sort((left, right) =>
      right.updatedAt.getTime() - left.updatedAt.getTime() || right.id.localeCompare(left.id),
    );
    const pageProjects = projectsMerged.slice(0, limit);
    const projectIds = Array.from(
      new Set(pageProjects.map((project) => project.id)),
    );
    if (projectIds.length === 0) return { items: [], nextCursor: null };
    const eligibleProjectIds = projectIds;

    // 3. Batch fetch open roles only for projects we identified as having vacancies
    const openRolesList = Array.from(await db.execute<{
      id: string;
      projectId: string;
      role: string;
      title: string | null;
      count: number;
      filled: number;
      description: string | null;
      skills: string[] | null;
    }>(sql`
      SELECT id, project_id AS "projectId", role, title, count, filled, description, skills
      FROM (
        SELECT open_role.*,
               row_number() OVER (PARTITION BY open_role.project_id ORDER BY open_role.title, open_role.id) AS role_rank
        FROM project_open_roles AS open_role
        WHERE open_role.project_id IN (${sql.join(eligibleProjectIds.map((id) => sql`${id}::uuid`), sql`, `)})
          AND open_role.filled < open_role.count
      ) AS bounded_roles
      WHERE role_rank <= 20
      ORDER BY project_id, title, id
    `));

    const listMap = new Map<
      string,
      { id: string; title: string; slug: string | null; openRoles: any[] }
    >();

    for (const p of pageProjects) {
      if (!eligibleProjectIds.includes(p.id)) continue;
      if (!listMap.has(p.id)) {
        listMap.set(p.id, {
          id: p.id,
          title: p.title || "Untitled Project",
          slug: p.slug,
          openRoles: [],
        });
      }
    }

    for (const role of openRolesList) {
      const p = listMap.get(role.projectId);
      if (p) {
        p.openRoles.push(role);
      }
    }

    const items = Array.from(listMap.values()).filter((p) => p.openRoles.length > 0);
    const last = pageProjects.at(-1);
    return {
      items,
      nextCursor: projectsMerged.length > limit && last
        ? `${last.updatedAt.toISOString()}|${last.id}`
        : null,
    };
  } catch (error) {
    console.error("Failed to get profile projects with open roles", error);
    return { items: [], nextCursor: null };
  }
}
