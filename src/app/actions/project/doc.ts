'use server';

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { and, desc, eq, ilike, inArray, isNull, lt, max, or, sql } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";

import { getProjectFileContent } from "@/app/actions/files/content";
import { parseGithubRepo } from "@/lib/github/repo-preview";
import { db } from "@/lib/db";
import {
    profiles,
    projectMembers,
    projectNodes,
    projectOpenRoles,
    projectMarkdownAssets,
    projectMarkdownVersions,
    projectMarkdowns,
    projectMarkdownDraftContributors,
    projectSprints,
    projects,
    tasks,
    fileVersions,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { toIsoString as toIso } from "@/lib/utils/date";
import { isUuid } from "@/lib/validations/uuid";
import { enqueueProjectNotificationEvent } from "@/lib/notifications/project-events";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { recordNodeEvent } from "@/lib/files/internal-helpers";
import { createUploadIntent, finalizeUploadIntent } from "@/lib/upload/upload-intents";
import { normalizeAndValidateFileSize, normalizeAndValidateMimeType } from "@/lib/upload/security";
import {
    buildProjectDocPublishMetadata,
    buildProjectDocStorageKey,
    DEFAULT_PROJECT_DOC_SETTINGS,
    PROJECT_DOC_ALLOWED_IMAGE_MIME_TYPES,
    PROJECT_DOC_ASSET_BUCKET,
    PROJECT_DOC_ASSET_MAX_BYTES,
    buildProjectDocQualityReport,
    normalizeProjectDocContent,
    normalizeProjectDocHeadings,
    normalizeProjectDocSettings,
    normalizeProjectDocSlug,
    readmeImageExtensionFromMimeType,
    resolveProjectDocPermission,
    type ProjectDocAsset,
    type ProjectDocDraftPayload,
    type ProjectDocPublishedPayload,
    type ProjectDocQualityReport,
    type ProjectDocSettings,
    type ProjectDocVersion,
} from "@/lib/projects/doc";
import { isDocLikePath } from "@/lib/projects/doc-create-intent";
import { normalizeProjectPublicTabVisibility } from "@/lib/projects/settings-policies";
import type {
    ProjectDocReferenceKind,
    ProjectDocReferenceOption,
    ProjectDocSmartBlock,
    ProjectDocSmartBlockPreview,
} from "@/lib/projects/doc-blocks";
import { parseProjectDocSmartBlocks } from "@/lib/projects/doc-blocks";

const PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG = "public-project-detail-shell";
const PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG = "public-project-detail-metadata";
const PROJECT_DOC_ASSET_ROUTE_PREFIX = "/api/v1/projects";
const profileDisplayNameSql = (userId: unknown) => sql<string | null>`(
    SELECT COALESCE(NULLIF(full_name, ''), NULLIF(username, ''))
    FROM profiles
    WHERE id = ${userId}
    LIMIT 1
)`;
const docSlugSchema = z.string().optional().default("readme").transform((value) => normalizeProjectDocSlug(value));

const readmeSettingsSchema = z.object({
    docSlug: docSlugSchema,
    editPolicy: z.enum(["leaders", "members"]).optional(),
    publicVisibility: z.literal("inherit_project").optional(),
    mediaUploads: z.boolean().optional(),
    externalImages: z.boolean().optional(),
    projectBlocks: z.boolean().optional(),
    notifyOnPublish: z.boolean().optional(),
});

const saveDraftSchema = z.object({
    docSlug: docSlugSchema,
    content: z.string(),
    expectedDraftUpdatedAt: z.string().nullable().optional(),
});

const publishSchema = z.object({
    docSlug: docSlugSchema,
    content: z.string().optional(),
    changeSummary: z.string().max(500).nullable().optional(),
    notifyFollowers: z.boolean().optional(),
    expectedDraftUpdatedAt: z.string().nullable().optional(),
    syncToFilesTab: z.boolean().optional().default(true),
});

const uploadUrlSchema = z.object({
    docSlug: docSlugSchema,
    mimeType: z.string(),
    sizeBytes: z.number().int().positive(),
    altText: z.string().max(240).nullable().optional(),
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
});

const referenceKindSchema = z.enum(["roles", "contributors", "files", "tasks", "sprints"]);

const referenceOptionsSchema = z.object({
    kind: referenceKindSchema,
    query: z.string().max(80).optional(),
    limit: z.number().int().min(1).max(20).optional(),
});

const importCandidatesSchema = z.object({
    docSlug: docSlugSchema,
    query: z.string().max(80).optional(),
    limit: z.number().int().min(1).max(30).optional(),
});

const importReadmeSchema = z.object({
    docSlug: docSlugSchema,
    nodeId: z.string().uuid(),
    expectedDraftUpdatedAt: z.string().nullable().optional(),
    publish: z.boolean().optional(),
});

const applyCreationIntentSchema = z.object({
    mode: z.enum(["detected", "starter", "skip"]).default("starter"),
    sourcePath: z.string().max(500).nullable().optional(),
    starterContent: z.string().max(500 * 1024).optional(),
    publishOnCreate: z.boolean().optional(),
    includeRoles: z.boolean().optional(),
});

const smartBlockPreviewSchema = z.array(z.object({
    kind: z.enum(["roles", "contributors", "files", "tasks", "sprints", "unknown"]),
    ids: z.array(z.string().max(80)).max(25).optional(),
    index: z.number().int().min(0).optional(),
    raw: z.string().max(300).optional(),
})).max(20);

function normalizeStoredQualityReport(value: unknown, fallbackContent: string): ProjectDocQualityReport {
    if (value && typeof value === "object") {
        const report = value as Partial<ProjectDocQualityReport>;
        if (
            typeof report.score === "number"
            && Array.isArray(report.issues)
            && report.sectionPresence
            && typeof report.sectionPresence === "object"
            && typeof report.contentBytes === "number"
        ) {
            return {
                score: report.score,
                issues: report.issues as ProjectDocQualityReport["issues"],
                sectionPresence: report.sectionPresence as Record<string, boolean>,
                contentBytes: report.contentBytes,
            };
        }
    }
    return buildProjectDocQualityReport(fallbackContent);
}

function toDocVersion(row: (typeof projectMarkdownVersions.$inferSelect & { createdByName?: string | null }) | null | undefined, displayVersionNumber?: number, coAuthorsData?: { id: string; name: string; avatarUrl: string | null }[]): ProjectDocVersion | null {
    if (!row) return null;
    const content = normalizeProjectDocContent(row.content);
    const cleanedMetadata = content === row.content ? null : buildProjectDocPublishMetadata(content);
    return {
        id: row.id,
        projectId: row.projectId,
        versionNumber: row.versionNumber,
        displayVersionNumber: displayVersionNumber ?? row.versionNumber,
        content,
        excerpt: cleanedMetadata?.excerpt ?? row.excerpt,
        headings: cleanedMetadata?.headings ?? normalizeProjectDocHeadings(row.headings),
        qualityReport: cleanedMetadata?.qualityReport ?? normalizeStoredQualityReport(row.qualityReport, content),
        contentHash: cleanedMetadata?.contentHash ?? row.contentHash,
        changeSummary: row.changeSummary,
        coAuthors: coAuthorsData ?? [],
        createdBy: row.createdBy,
        createdByName: row.createdByName ?? null,
        createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
        deletedAt: toIso(row.deletedAt),
    };
}

function toDocAsset(row: typeof projectMarkdownAssets.$inferSelect): ProjectDocAsset {
    return {
        id: row.id,
        projectId: row.projectId,
        versionId: row.versionId,
        bucket: row.bucket,
        storageKey: row.storageKey,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        width: row.width,
        height: row.height,
        altText: row.altText,
        status: row.status,
        createdBy: row.createdBy,
        createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
        deletedAt: toIso(row.deletedAt),
    };
}

async function getOptionalUserId() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
}

async function requireUserId() {
    const userId = await getOptionalUserId();
    if (!userId) throw new Error("Unauthorized");
    return userId;
}

async function getDocProjectContext(projectId: string, actorUserId: string | null, docSlug: string = "readme") {
    docSlug = normalizeProjectDocSlug(docSlug);
    const [project] = await db
        .select({
            id: projects.id,
            slug: projects.slug,
            title: projects.title,
            ownerId: projects.ownerId,
            visibility: projects.visibility,
            publicTabVisibility: projects.publicTabVisibility,
            deletedAt: projects.deletedAt,
            importSource: projects.importSource,
            githubRepoUrl: projects.githubRepoUrl,
            githubDefaultBranch: projects.githubDefaultBranch,
            key: projects.key,
        })
        .from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1);
    if (!project) throw new Error("Project not found");

    const membership = actorUserId
        ? await db.query.projectMembers.findFirst({
            where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorUserId)),
            columns: { role: true },
        })
        : null;
    const readme = await db.query.projectMarkdowns.findFirst({
        where: and(eq(projectMarkdowns.projectId, projectId), eq(projectMarkdowns.slug, docSlug)),
    });
    const settings = normalizeProjectDocSettings(readme?.settings);
    const hasPublishedReadme = Boolean(readme?.publishedVersionId) || Boolean(readme?.linkedNodeId);
    const permission = resolveProjectDocPermission({
        actorUserId,
        projectVisibility: project.visibility,
        publicTabVisibility: project.publicTabVisibility,
        settings,
        membershipRole: membership?.role,
        isOwner: actorUserId === project.ownerId,
        isActiveMember: Boolean(membership),
        hasPublishedReadme,
    });
    return { project, membership, readme, settings, permission };
}

async function getOrCreateMarkdown(projectId: string, userId: string, docSlug: string = "readme", settings: ProjectDocSettings = DEFAULT_PROJECT_DOC_SETTINGS) {
    docSlug = normalizeProjectDocSlug(docSlug);
    const existing = await db.query.projectMarkdowns.findFirst({
        where: and(eq(projectMarkdowns.projectId, projectId), eq(projectMarkdowns.slug, docSlug)),
    });
    if (existing) return existing;
    const filename = docSlug === "readme" ? "README.md" : `${docSlug.toUpperCase()}.md`;
    const [created] = await db
        .insert(projectMarkdowns)
        .values({
            projectId,
            slug: docSlug,
            filename,
            draftContent: "",
            draftUpdatedBy: userId,
            draftUpdatedAt: new Date(),
            settings,
        })
        .returning();
    if (!created) throw new Error("Failed to create markdown document");
    return created;
}

async function readPublishedVersion(versionId: string | null | undefined) {
    if (!versionId) return null;
    return db.query.projectMarkdownVersions.findFirst({
        where: and(eq(projectMarkdownVersions.id, versionId), isNull(projectMarkdownVersions.deletedAt)),
    });
}

function revalidateProjectDoc(project: { id: string; slug: string | null }) {
    const slugOrId = project.slug || project.id;
    revalidatePath(`/projects/${slugOrId}`);
    revalidatePath(`/projects/${slugOrId}?tab=docs&doc=readme`);
    revalidateTag(PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG, "max");
    revalidateTag(PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG, "max");
}

function extractAssetIdsFromContent(content: string, projectId: string) {
    const escaped = projectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`/api/v1/projects/${escaped}/doc-assets/([a-f0-9-]{36})`, "gi");
    return Array.from(new Set(Array.from(content.matchAll(regex)).map((match) => match[1])));
}

function projectHref(project: { id: string; slug: string | null }, tab: string) {
    return `/projects/${encodeURIComponent(project.slug || project.id)}?tab=${tab}`;
}

function projectTaskHref(project: { id: string; slug: string | null }, taskId: string) {
    return `${projectHref(project, "tasks")}&drawerType=task&drawerId=${encodeURIComponent(taskId)}`;
}

function projectSprintHref(project: { id: string; slug: string | null }, sprintId: string) {
    return `/projects/${encodeURIComponent(project.slug || project.id)}?tab=sprints&sprintId=${encodeURIComponent(sprintId)}`;
}

function encodeProjectNodePath(row: { path: string | null; name: string }) {
    const pathParts = row.path && row.path !== "/"
        ? row.path.split("/").filter(Boolean)
        : [row.name];
    return pathParts.map((part) => encodeURIComponent(part)).join("/");
}

function projectFileHref(project: { id: string; slug: string | null }, row: { id: string; path: string | null; name: string }) {
    const encodedPath = encodeProjectNodePath(row);
    const fileId = encodeURIComponent(row.id);
    return encodedPath
        ? `${projectHref(project, "files")}&fileId=${fileId}&path=${encodedPath}`
        : `${projectHref(project, "files")}&fileId=${fileId}`;
}

function projectRoleApplyHref(project: { id: string; slug: string | null }, roleId: string) {
    return `${projectHref(project, "dashboard")}&applyRole=${encodeURIComponent(roleId)}`;
}

function profileHref(row: { userId: string; username: string | null }) {
    return `/u/${encodeURIComponent(row.username || row.userId)}`;
}

function normalizeReferenceCount(value: number | null | undefined) {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, Math.floor(value));
}

function canReadReferenceKind(
    kind: ProjectDocReferenceKind,
    context: Awaited<ReturnType<typeof getDocProjectContext>>,
) {
    if (context.permission.canEdit || context.permission.accessLevel === "owner" || context.membership) return true;
    if (context.project.visibility !== "public" || !context.permission.canReadPublished) return false;
    const tabs = normalizeProjectPublicTabVisibility(context.project.publicTabVisibility);
    if (kind === "files") return tabs.files;
    if (kind === "tasks") return tabs.tasks;
    if (kind === "sprints") return tabs.sprints;
    if (kind === "contributors") return tabs.dashboard;
    return true;
}

function blockKey(block: Pick<ProjectDocSmartBlock, "kind" | "ids" | "index">) {
    return `${block.kind}:${block.ids.join(",")}:${block.index}`;
}

function unavailablePreview(block: Pick<ProjectDocSmartBlock, "kind" | "ids" | "index">, description = "This project reference is not available to this viewer."): ProjectDocSmartBlockPreview {
    return {
        key: blockKey({ kind: block.kind, ids: block.ids ?? [], index: block.index ?? 0 }),
        kind: block.kind,
        title: block.kind === "unknown" ? "Unknown document block" : "Reference unavailable",
        description,
        items: [],
        unavailableCount: block.ids?.length ?? 0,
        safeUnavailable: true,
    };
}

function formatLabel(value: string | null | undefined) {
    if (!value) return null;
    return value
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
        .join(" ");
}

function formatMemberRole(role: string | null | undefined, isOwner = false) {
    if (isOwner || role === "owner") return "Owner";
    if (role === "admin") return "Co-leader";
    if (role === "viewer") return "Viewer";
    return "Member";
}

function truncateReferenceText(value: string | null | undefined, maxLength = 96) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized) return null;
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}…` : normalized;
}

function formatShortDate(value: Date | string | null | undefined) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function formatSprintDateRange(startDate: Date | string, endDate: Date | string) {
    const start = formatShortDate(startDate);
    const end = formatShortDate(endDate);
    return [start, end].filter(Boolean).join(" - ");
}

function formatFileType(row: Pick<typeof projectNodes.$inferSelect, "name" | "mimeType" | "type">) {
    const extension = row.name.includes(".") ? row.name.split(".").pop()?.trim() : null;
    if (extension) return extension.toUpperCase();
    if (row.mimeType?.includes("/")) return row.mimeType.split("/").pop()?.toUpperCase() || "File";
    return formatLabel(row.mimeType || row.type) || "File";
}

function formatTaskReferenceTitle(title: string | null | undefined) {
    const normalized = truncateReferenceText(title, 120)
        ?.replace(/^task\s*#?\s*\d+\s*[:.\-–—]\s*/i, "")
        .trim();
    return `Task: ${normalized || "Untitled task"}`;
}

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

type TaskReferenceRow = Pick<typeof tasks.$inferSelect,
    "id" | "title" | "description" | "status" | "priority" | "taskNumber" | "assigneeId" | "creatorId"
> & {
    assigneeName?: string | null;
    creatorName?: string | null;
};

function optionFromTask(row: TaskReferenceRow, project: { id: string; slug: string | null; key?: string | null }): ProjectDocReferenceOption {
    const assignee = truncateReferenceText(row.assigneeName, 40);
    const creator = truncateReferenceText(row.creatorName, 40);
    const assignment = assignee ? `assigned to ${assignee}` : creator ? `created by ${creator}` : "unassigned";
    const priority = row.priority ? `${formatLabel(row.priority)} priority` : null;
    const taskCode = project.key && row.taskNumber ? `${project.key}-${row.taskNumber}` : row.id;
    return {
        id: row.id,
        kind: "tasks",
        kindLabel: "Task",
        title: formatTaskReferenceTitle(row.title),
        subtitle: truncateReferenceText(row.description),
        status: formatLabel(row.status),
        meta: assignment,
        context: [formatLabel(row.status), assignment, priority].filter(Boolean).join(" · "),
        badges: [priority].filter((badge): badge is string => Boolean(badge)),
        href: projectTaskHref(project, taskCode),
    };
}

function optionFromSprint(row: typeof projectSprints.$inferSelect, project: { id: string; slug: string | null }): ProjectDocReferenceOption {
    const dateRange = formatSprintDateRange(row.startDate, row.endDate);
    return {
        id: row.id,
        kind: "sprints",
        kindLabel: "Sprint",
        title: `Sprint: ${truncateReferenceText(row.name, 80) || "Untitled sprint"}`,
        subtitle: truncateReferenceText(row.goal || row.description),
        status: formatLabel(row.status),
        meta: dateRange,
        context: [formatLabel(row.status), dateRange].filter(Boolean).join(" · "),
        href: projectSprintHref(project, row.id),
    };
}

function optionFromFile(row: typeof projectNodes.$inferSelect, project: { id: string; slug: string | null }): ProjectDocReferenceOption {
    const versions = row.currentVersion > 1 ? `${row.currentVersion} versions` : "1 version";
    const fileType = formatFileType(row);
    return {
        id: row.id,
        kind: "files",
        kindLabel: "File",
        title: row.name,
        subtitle: row.path || "/",
        status: fileType,
        meta: versions,
        href: projectFileHref(project, row),
    };
}

function isDocImportCandidate(row: Pick<typeof projectNodes.$inferSelect, "name" | "path" | "mimeType" | "size">) {
    const name = row.name.toLowerCase();
    const path = row.path.toLowerCase();
    const mimeType = row.mimeType?.toLowerCase() ?? "";
    const markdownName = /\.(md|mdx|markdown|mdown)$/i.test(name);
    const markdownPath = /\.(md|mdx|markdown|mdown)$/i.test(path);
    const readmeishName = /^readme(?:[._-]|$)/i.test(name) || /readme.*\.(md|mdx|markdown|mdown|txt)$/i.test(name);
    const readmeishPath = /(^|\/)readme(?:[._-]|$)/i.test(path) || /(^|\/).*readme.*\.(md|mdx|markdown|mdown|txt)$/i.test(path);
    const bareReadme = name === "readme" || /(^|\/)readme$/i.test(path);
    const markdownMime = mimeType.includes("markdown") || mimeType === "text/x-markdown" || mimeType === "text/markdown";
    const textMime = mimeType === "text/plain" && (readmeishName || readmeishPath);
    const safeSize = typeof row.size !== "number" || row.size <= 500 * 1024;
    return safeSize && (markdownName || markdownPath || readmeishName || readmeishPath || bareReadme || markdownMime || textMime);
}

function normalizeReadmeCandidatePath(value: string | null | undefined) {
    return (value || "")
        .trim()
        .replace(/^\/+/, "")
        .replace(/\/+/g, "/");
}

function readmePathBasename(path: string) {
    return path.split("/").filter(Boolean).pop() || path;
}

async function findProjectDocNodeByPath(projectId: string, sourcePath: string) {
    const normalizedPath = normalizeReadmeCandidatePath(sourcePath);
    if (!normalizedPath || !isDocLikePath(normalizedPath)) return null;
    const fileName = readmePathBasename(normalizedPath);
    const rows = await db.query.projectNodes.findMany({
        where: and(
            eq(projectNodes.projectId, projectId),
            eq(projectNodes.type, "file"),
            isNull(projectNodes.deletedAt),
            or(
                eq(projectNodes.path, normalizedPath),
                eq(projectNodes.path, `/${normalizedPath}`),
                eq(projectNodes.name, normalizedPath),
                eq(projectNodes.name, fileName),
                ilike(projectNodes.path, `%${normalizedPath}`),
            )!,
        ),
        orderBy: [desc(projectNodes.updatedAt)],
        limit: 40,
    });
    const exact = rows.find((row) => {
        const rowPath = normalizeReadmeCandidatePath(row.path);
        const rowName = normalizeReadmeCandidatePath(row.name);
        return rowPath === normalizedPath || rowPath === `/${normalizedPath}` || rowName === normalizedPath || rowName === fileName;
    });
    return [exact, ...rows].find((row): row is typeof projectNodes.$inferSelect => Boolean(row && isDocImportCandidate(row))) ?? null;
}

function resolveProjectGithubSource(project: Awaited<ReturnType<typeof getDocProjectContext>>["project"]) {
    const importSource = (project.importSource || {}) as {
        repoUrl?: string | null;
        branch?: string | null;
        metadata?: Record<string, unknown> | null;
    };
    const metadata = importSource.metadata || {};
    const metadataRepoUrl =
        typeof metadata.normalizedRepoUrl === "string" ? metadata.normalizedRepoUrl
            : typeof metadata.repoUrl === "string" ? metadata.repoUrl
                : null;
    return {
        repoUrl: project.githubRepoUrl || importSource.repoUrl || metadataRepoUrl,
        branch: importSource.branch || project.githubDefaultBranch || "main",
    };
}

async function getGithubProviderToken() {
    try {
        const supabase = await createClient();
        const { data } = await supabase.auth.getSession();
        const session = data.session as { provider_token?: string | null } | null;
        return session?.provider_token || null;
    } catch {
        return null;
    }
}

async function fetchGithubReadmeContentForProject(
    project: Awaited<ReturnType<typeof getDocProjectContext>>["project"],
    sourcePath: string,
) {
    const normalizedPath = normalizeReadmeCandidatePath(sourcePath);
    if (!normalizedPath || !isDocLikePath(normalizedPath)) return null;
    const { repoUrl, branch } = resolveProjectGithubSource(project);
    if (!repoUrl) return null;
    const parsed = parseGithubRepo(repoUrl);
    if (!parsed) return null;

    const encodedPath = normalizedPath.split("/").map(encodeURIComponent).join("/");
    const url = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
    const token = await getGithubProviderToken();
    const response = await fetch(url, {
        cache: "no-store",
        headers: {
            Accept: "application/vnd.github+json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
    if (!response.ok) return null;

    const payload = await response.json() as {
        type?: string;
        encoding?: string;
        size?: number;
        content?: string | null;
    };
    if (payload.type !== "file" || !payload.content) return null;
    if (typeof payload.size === "number" && payload.size > 500 * 1024) return null;
    if (payload.encoding !== "base64") return null;
    return Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8");
}

function optionFromRole(row: typeof projectOpenRoles.$inferSelect, project: { id: string; slug: string | null }): ProjectDocReferenceOption {
    const count = normalizeReferenceCount(row.count);
    const filled = count > 0
        ? Math.min(normalizeReferenceCount(row.filled), count)
        : normalizeReferenceCount(row.filled);
    const available = count > 0 ? Math.max(0, count - filled) : 0;
    const isOpen = available > 0;
    const roleTitle = truncateReferenceText(row.title || row.role, 80) || "Open role";
    const capacity = count > 0 ? `${filled}/${count}` : `${filled}`;
    return {
        id: row.id,
        kind: "roles",
        kindLabel: "Role",
        title: count > 0 ? `${roleTitle} (${capacity})` : roleTitle,
        subtitle: truncateReferenceText(row.description),
        status: isOpen ? "Open" : "Filled",
        meta: count > 0 ? `${capacity} filled` : `${filled} filled`,
        context: [roleTitle, count > 0 ? `${capacity} filled` : `${filled} filled`, isOpen ? "Open for applications" : "Filled"].join(" · "),
        href: projectRoleApplyHref(project, row.id),
    };
}

function optionFromContributor(row: {
    userId: string;
    role: string;
    fullName: string | null;
    username: string | null;
    avatarUrl: string | null;
    projectRoleTitle?: string | null;
}, project: { id: string; slug: string | null; ownerId?: string | null }): ProjectDocReferenceOption {
    const roleLabel = formatMemberRole(row.role, row.userId === project.ownerId);
    const projectRoleTitle = truncateReferenceText(row.projectRoleTitle, 48);
    return {
        id: row.userId,
        kind: "contributors",
        kindLabel: "Contributor",
        title: row.fullName || row.username || "Project member",
        subtitle: row.username ? `@${row.username}` : null,
        status: roleLabel,
        meta: projectRoleTitle ? `(${projectRoleTitle})` : null,
        context: [roleLabel, projectRoleTitle ? `Role: ${projectRoleTitle}` : null].filter(Boolean).join(" · "),
        badges: [roleLabel, projectRoleTitle].filter((badge): badge is string => Boolean(badge)),
        avatarUrl: row.avatarUrl,
        href: profileHref(row),
    };
}

export async function readProjectDocAction(projectId: string, docSlug: string = "readme"): Promise<
    | { success: true; data: ProjectDocPublishedPayload }
    | { success: false; error: string }
> {
    try {
        docSlug = normalizeProjectDocSlug(docSlug);
        const actorUserId = await getOptionalUserId();
        const context = await getDocProjectContext(projectId, actorUserId, docSlug);
        if (!context.permission.canReadPublished && !context.permission.canEdit) {
            return { success: false, error: context.permission.reason || "Document unavailable" };
        }
        let versionRow = null;
        let linkedNode = null;
        if (context.readme?.linkedNodeId) {
            const node = await db.query.projectNodes.findFirst({
                where: and(
                    eq(projectNodes.id, context.readme.linkedNodeId),
                    isNull(projectNodes.deletedAt)
                )
            });
            if (node) {
                linkedNode = {
                    id: node.id,
                    name: node.name,
                    path: node.path,
                    s3Key: node.s3Key ?? "",
                };
                try {
                    const content = await getProjectFileContent(projectId, node.id, { skipFileTabCheck: true });
                    const metadata = buildProjectDocPublishMetadata(content);
                    versionRow = {
                        id: `linked-${node.id}`,
                        projectId,
                        markdownId: context.readme!.id,
                        versionNumber: 1,
                        content: metadata.content,
                        excerpt: metadata.excerpt,
                        headings: metadata.headings,
                        qualityReport: metadata.qualityReport,
                        contentHash: metadata.contentHash,
                        changeSummary: "Linked file content",
                        coAuthors: [],
                        createdBy: node.createdBy,
                        createdByName: "System",
                        createdAt: node.updatedAt || new Date(),
                        deletedAt: null,
                    };
                } catch (err) {
                    logger.error("project_readme.read_linked_node_failed", { projectId, nodeId: node.id, error: err instanceof Error ? err.message : String(err) });
                }
            } else {
                // If it was deleted, detach it
                await db.update(projectMarkdowns)
                    .set({ linkedNodeId: null })
                    .where(eq(projectMarkdowns.id, context.readme.id));
            }
        }

        let normalizedVersion = null;
        if (versionRow) {
            normalizedVersion = toDocVersion(versionRow);
        } else {
            const version = await readPublishedVersion(context.readme?.publishedVersionId);
            if (!version && !context.permission.canEdit) {
                return { success: false, error: "Document has not been published yet." };
            }
            normalizedVersion = toDocVersion(version);
        }
        return {
            success: true,
            data: {
                projectId,
                canEdit: context.permission.canEdit,
                permission: context.permission,
                settings: context.settings,
                version: normalizedVersion,
                smartBlocks: normalizedVersion ? parseProjectDocSmartBlocks(normalizedVersion.content) : [],
                linkedNodeId: context.readme?.linkedNodeId ?? null,
                linkedNode,
            },
        };
    } catch (error) {
        logger.error("project_readme.read_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Failed to load document." };
    }
}

export async function readProjectDocDraftAction(projectId: string, docSlug: string = "readme"): Promise<
    | { success: true; data: ProjectDocDraftPayload }
    | { success: false; error: string }
> {
    try {
        docSlug = normalizeProjectDocSlug(docSlug);
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canReadDraft) return { success: false, error: "You cannot edit this document." };
        const readme = await getOrCreateMarkdown(projectId, userId, docSlug, context.settings);
        const published = await readPublishedVersion(readme.publishedVersionId);
        let draftContent = normalizeProjectDocContent(readme.draftContent || "");
        let draftUpdatedAt = readme.draftUpdatedAt;
        if ((readme.draftContent || "") !== draftContent) {
            draftUpdatedAt = new Date();
            await db.update(projectMarkdowns)
                .set({
                    draftContent,
                    draftUpdatedAt,
                    updatedAt: draftUpdatedAt,
                })
                .where(eq(projectMarkdowns.id, readme.id));
        }

        let linkedNode = null;
        if (readme.linkedNodeId) {
            const node = await db.query.projectNodes.findFirst({
                where: and(
                    eq(projectNodes.id, readme.linkedNodeId),
                    eq(projectNodes.projectId, projectId),
                    eq(projectNodes.type, 'file'),
                    isNull(projectNodes.deletedAt)
                )
            });
            if (node) {
                linkedNode = {
                    id: node.id,
                    name: node.name,
                    path: node.path,
                    s3Key: node.s3Key ?? "",
                };
                try {
                    const fileContent = normalizeProjectDocContent(await getProjectFileContent(projectId, node.id, { skipFileTabCheck: true }));
                    const fileUpdatedAt = node.updatedAt ? new Date(node.updatedAt).getTime() : 0;
                    const currentDraftUpdatedAt = draftUpdatedAt ? new Date(draftUpdatedAt).getTime() : 0;
                    
                    if (fileUpdatedAt > currentDraftUpdatedAt || !readme.draftContent) {
                        const nextDraftUpdatedAt = node.updatedAt || new Date();
                        draftContent = fileContent;
                        draftUpdatedAt = nextDraftUpdatedAt;
                        // Auto-sync the draft in database
                        await db.update(projectMarkdowns)
                            .set({
                                draftContent: fileContent,
                                draftUpdatedAt: nextDraftUpdatedAt,
                                updatedAt: nextDraftUpdatedAt,
                            })
                            .where(eq(projectMarkdowns.id, readme.id));
                    }
                } catch (err) {
                    logger.error("project_readme.fetch_linked_node_content_failed", { projectId, nodeId: node.id, error: err instanceof Error ? err.message : String(err) });
                }
            } else {
                // If it was deleted, detach it!
                await db.update(projectMarkdowns)
                    .set({ linkedNodeId: null })
                    .where(eq(projectMarkdowns.id, readme.id));
            }
        }

        return {
            success: true,
            data: {
                projectId,
                permission: context.permission,
                settings: normalizeProjectDocSettings(readme.settings),
                draftContent,
                draftUpdatedAt: toIso(draftUpdatedAt),
                publishedVersion: toDocVersion(published),
                qualityReport: buildProjectDocQualityReport(draftContent),
                linkedNodeId: linkedNode ? readme.linkedNodeId : null,
                linkedNode,
            },
        };
    } catch (error) {
        logger.error("project_readme.read_draft_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Failed to load document draft." };
    }
}

export async function saveProjectDocDraftAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = saveDraftSchema.parse(input);
        const docSlug = parsed.docSlug;
        const content = normalizeProjectDocContent(parsed.content);
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canEdit) return { success: false as const, error: "You cannot edit this document." };
        const result = await db.transaction(async (tx) => {
            let readme = await tx.query.projectMarkdowns.findFirst({ where: and(eq(projectMarkdowns.projectId, projectId), eq(projectMarkdowns.slug, docSlug)) });
            if (!readme) {
                const filename = docSlug === "readme" ? "README.md" : `${docSlug.toUpperCase()}.md`;
                const [created] = await tx.insert(projectMarkdowns).values({ projectId, slug: docSlug, filename, draftContent: "", draftUpdatedBy: userId, draftUpdatedAt: new Date(), settings: context.settings }).returning();
                readme = created;
            }
            const [lockedReadme] = await tx.select().from(projectMarkdowns).where(eq(projectMarkdowns.id, readme!.id)).for('update');
            if (!lockedReadme) throw new Error("Document not found");

            const currentUpdatedAt = toIso(lockedReadme.draftUpdatedAt);

            if ((lockedReadme.draftContent || "") === content) {
                return {
                    success: true as const,
                    draftContent: content,
                    draftUpdatedAt: currentUpdatedAt,
                    qualityReport: buildProjectDocQualityReport(content),
                    unchanged: true as const,
                };
            }

            const [updated] = await tx
                .update(projectMarkdowns)
                .set({
                    draftContent: content,
                    draftUpdatedBy: userId,
                    draftUpdatedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(projectMarkdowns.id, lockedReadme.id))
                .returning();

            return {
                success: true as const,
                draftContent: content,
                draftUpdatedAt: toIso(updated?.draftUpdatedAt),
                qualityReport: buildProjectDocQualityReport(content),
            };
        });
        if (result.success === true && result.draftUpdatedAt) {
            return result;
        }
        return result;
    } catch (error) {
        logger.error("project_readme.save_draft_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to save document draft." };
    }
}

export async function readProjectDocImportCandidatesAction(projectId: string, input: unknown): Promise<
    | { success: true; candidates: ProjectDocReferenceOption[] }
    | { success: false; error: string }
> {
    try {
        const userId = await requireUserId();
        const parsed = importCandidatesSchema.parse(input);
        const context = await getDocProjectContext(projectId, userId);
        if (!context.permission.canEdit) return { success: false, error: "You cannot import a project document." };

        const query = parsed.query?.trim() || "";
        const like = `%${query.replace(/[%_]/g, "\\$&")}%`;
        const conditions = [eq(projectNodes.projectId, projectId), eq(projectNodes.type, "file"), isNull(projectNodes.deletedAt), isNull(projectNodes.taskId)];
        conditions.push(or(
            ilike(projectNodes.name, "%.md"),
            ilike(projectNodes.name, "%.mdx"),
            ilike(projectNodes.name, "%.markdown"),
            ilike(projectNodes.name, "%.mdown"),
            ilike(projectNodes.name, "%.txt"),
            ilike(projectNodes.name, "readme"),
            ilike(projectNodes.name, "readme.%"),
            ilike(projectNodes.name, "%readme%"),
            ilike(projectNodes.path, "%.md"),
            ilike(projectNodes.path, "%.mdx"),
            ilike(projectNodes.path, "%.markdown"),
            ilike(projectNodes.path, "%.mdown"),
            ilike(projectNodes.path, "%.txt"),
            ilike(projectNodes.path, "%/readme"),
            ilike(projectNodes.path, "%/readme.%"),
            ilike(projectNodes.path, "%readme%"),
            ilike(projectNodes.mimeType, "%markdown%"),
            ilike(projectNodes.mimeType, "text/x-markdown"),
            ilike(projectNodes.mimeType, "text/markdown"),
        )!);
        if (query) conditions.push(or(ilike(projectNodes.name, like), ilike(projectNodes.path, like))!);

        const linkedDocs = await db
            .select({ linkedNodeId: projectMarkdowns.linkedNodeId })
            .from(projectMarkdowns)
            .where(eq(projectMarkdowns.projectId, projectId));
        const linkedNodeIds = new Set(linkedDocs.map((d) => d.linkedNodeId).filter(Boolean));

        const rows = await db.query.projectNodes.findMany({
            where: and(...conditions),
            orderBy: [desc(projectNodes.updatedAt)],
            limit: Math.max((parsed.limit ?? 12) * 3, 30),
        });

        const seenPaths = new Set<string>();
        const candidates = rows
            .filter((row) => {
                if (!isDocImportCandidate(row)) return false;
                const pathKey = row.path || row.name;
                if (seenPaths.has(pathKey)) return false;
                seenPaths.add(pathKey);
                return true;
            })
            .slice(0, parsed.limit ?? 12)
            .map((row) => optionFromFile(row, context.project));

        return { success: true, candidates };
    } catch (error) {
        logger.error("project_readme.import_candidates_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Failed to load document files." };
    }
}

export async function importProjectDocFromFileAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = importReadmeSchema.parse(input);
        const docSlug = parsed.docSlug;
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canEdit) return { success: false as const, error: "You cannot import this document." };

        const node = await db.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, parsed.nodeId), eq(projectNodes.projectId, projectId), eq(projectNodes.type, "file"), isNull(projectNodes.deletedAt)),
        });
        if (!node || !isDocImportCandidate(node)) return { success: false as const, error: "Select a Markdown or document file." };

        const rawContent = await getProjectFileContent(projectId, parsed.nodeId);
        const content = normalizeProjectDocContent(rawContent);
        const readme = await getOrCreateMarkdown(projectId, userId, docSlug, context.settings);
        let publishedVersion: ProjectDocVersion | null = null;
        let updatedDraftAt: string | null = null;

        if (parsed.publish && context.permission.canPublish) {
            const metadata = buildProjectDocPublishMetadata(content);
            const published = await db.transaction(async (tx) => {
                const now = new Date();
                const [latest] = await tx
                    .select({ value: max(projectMarkdownVersions.versionNumber) })
                    .from(projectMarkdownVersions)
                    .where(eq(projectMarkdownVersions.markdownId, readme.id));
                const nextVersion = (latest?.value ?? 0) + 1;
                const [version] = await tx
                    .insert(projectMarkdownVersions)
                    .values({
                        projectId,
                        markdownId: readme.id,
                        versionNumber: nextVersion,
                        content: metadata.content,
                        excerpt: metadata.excerpt,
                        headings: metadata.headings,
                        qualityReport: metadata.qualityReport,
                        contentHash: metadata.contentHash,
                        changeSummary: `Imported from ${node.name}`,
                        createdBy: userId,
                    })
                    .returning();
                if (!version) throw new Error("Failed to publish version");

                const [updated] = await tx.update(projectMarkdowns)
                    .set({
                        draftContent: metadata.content,
                        draftUpdatedBy: userId,
                        draftUpdatedAt: now,
                        publishedVersionId: version.id,
                        updatedAt: now,
                    })
                    .where(eq(projectMarkdowns.id, readme.id))
                    .returning({ draftUpdatedAt: projectMarkdowns.draftUpdatedAt });
                updatedDraftAt = toIso(updated?.draftUpdatedAt ?? now);

                const referencedAssetIds = extractAssetIdsFromContent(metadata.content, projectId);
                if (referencedAssetIds.length > 0) {
                    await tx.update(projectMarkdownAssets)
                        .set({ status: "published", versionId: version.id })
                        .where(and(eq(projectMarkdownAssets.markdownId, readme.id), inArray(projectMarkdownAssets.id, referencedAssetIds as string[])));
                }
                await tx.update(projectMarkdownAssets)
                    .set({ status: "orphaned" })
                    .where(and(eq(projectMarkdownAssets.markdownId, readme.id), eq(projectMarkdownAssets.status, "draft")));

                await recordNodeEvent(projectId, userId, null, "project_readme.imported_from_file", {
                    nodeId: parsed.nodeId,
                    fileName: node.name,
                    published: true,
                }, tx);
                await recordNodeEvent(projectId, userId, null, "project_readme.published", {
                    versionId: version.id,
                    versionNumber: version.versionNumber,
                    changeSummary: `Imported from ${node.name}`,
                    qualityScore: metadata.qualityReport.score,
                    sourceNodeId: parsed.nodeId,
                }, tx);

                return version;
            });
            publishedVersion = toDocVersion(published);

            if (context.settings.notifyOnPublish) {
                enqueueProjectNotificationEvent({
                    projectId,
                    actorUserId: userId,
                    eventKey: "readme.published",
                    title: "Project document published",
                    body: metadata.excerpt,
                    href: `/projects/${encodeURIComponent(context.project.slug || context.project.id)}?tab=docs&doc=${docSlug}`,
                    entityRefs: { projectId },
                    sourceEventId: `readme:${published.id}`,
                }).catch((error) => logger.warn("project_readme.notification_failed", {
                    module: "projects",
                    projectId,
                    versionId: published.id,
                    error: error instanceof Error ? error.message : String(error),
                }));
            }
        } else {
            const [updated] = await db.update(projectMarkdowns)
                .set({
                    draftContent: content,
                    draftUpdatedBy: userId,
                    draftUpdatedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(projectMarkdowns.id, readme.id))
                .returning();
            updatedDraftAt = toIso(updated?.draftUpdatedAt);

            await recordNodeEvent(projectId, userId, null, "project_readme.imported_from_file", {
                nodeId: parsed.nodeId,
                fileName: node.name,
                published: false,
                publishRequested: Boolean(parsed.publish),
                publishSkippedReason: parsed.publish ? "permission" : null,
            });
        }

        revalidateProjectDoc(context.project);

        return {
            success: true as const,
            draftContent: content,
            draftUpdatedAt: updatedDraftAt,
            qualityReport: buildProjectDocQualityReport(content),
            published: Boolean(publishedVersion),
            version: publishedVersion,
            sourceFileName: node.name,
        };
    } catch (error) {
        logger.error("project_readme.import_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to import document from file." };
    }
}

export async function applyProjectDocCreationIntentAction(projectId: string, input: unknown): Promise<
    | {
        success: true;
        status: "created" | "imported" | "skipped" | "not_found";
        draftUpdatedAt?: string | null;
        sourceFileName?: string | null;
        reason?: string;
    }
    | { success: false; error: string }
> {
    try {
        const userId = await requireUserId();
        const parsed = applyCreationIntentSchema.parse(input);
        if (parsed.mode === "skip") {
            return { success: true, status: "skipped", reason: "user_skipped" };
        }

        const context = await getDocProjectContext(projectId, userId);
        if (!context.permission.canEdit) {
            return { success: false, error: "You cannot create this document." };
        }

        const readme = await getOrCreateMarkdown(projectId, userId, "readme", context.settings);
        if (readme.publishedVersionId || (readme.draftContent || "").trim().length > 0) {
            return { success: true, status: "skipped", reason: "existing_readme" };
        }

        const sourcePath = normalizeReadmeCandidatePath(parsed.sourcePath);
        let content: string | null = null;
        let source: "starter" | "project_file" | "github" = "starter";
        let sourceFileName: string | null = null;

        if (parsed.mode === "detected") {
            if (sourcePath) {
                const node = await findProjectDocNodeByPath(projectId, sourcePath);
                if (node) {
                    content = normalizeProjectDocContent(await getProjectFileContent(projectId, node.id));
                    source = "project_file";
                    sourceFileName = node.name;
                } else {
                    const githubContent = await fetchGithubReadmeContentForProject(context.project, sourcePath);
                    if (githubContent) {
                        content = normalizeProjectDocContent(githubContent);
                        source = "github";
                        sourceFileName = readmePathBasename(sourcePath);
                    }
                }
            }

            if (!content) {
                return { success: true, status: "not_found", reason: "source_missing" };
            }
        } else {
            content = normalizeProjectDocContent(
                parsed.starterContent || `# ${context.project.title || "Project Document"}\n\n`
            );
        }

        if (!content.trim()) {
            return { success: true, status: "skipped", reason: "empty_content" };
        }

        const now = new Date();
        const [updated] = await db.update(projectMarkdowns)
            .set({
                draftContent: content,
                draftUpdatedBy: userId,
                draftUpdatedAt: now,
                updatedAt: now,
            })
            .where(eq(projectMarkdowns.id, readme.id))
            .returning();

        await recordNodeEvent(projectId, userId, null, "project_readme.created_from_project_creation", {
            mode: parsed.mode,
            source,
            sourcePath: sourcePath || null,
            sourceFileName,
            // Creation prepares a private draft only; publishing stays explicit.
            publishOnCreateRequested: Boolean(parsed.publishOnCreate),
        }).catch((error) => {
            logger.warn("project_readme.creation_event_failed", {
                module: "projects",
                projectId,
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
        });

        revalidateProjectDoc(context.project);

        return {
            success: true,
            status: source === "starter" ? "created" : "imported",
            draftUpdatedAt: toIso(updated?.draftUpdatedAt ?? now),
            sourceFileName,
        };
    } catch (error) {
        logger.error("project_readme.creation_intent_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Failed to prepare project document." };
    }
}

export async function registerReadmeContributorAction(projectId: string, docSlug: string = "readme") {
    try {
        docSlug = normalizeProjectDocSlug(docSlug);
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canEdit || !context.readme) return { success: false as const, error: "Unauthorized" };

        await db.insert(projectMarkdownDraftContributors)
            .values({ projectId, markdownId: context.readme.id, userId, lastContributedAt: new Date() })
            .onConflictDoUpdate({
                target: [projectMarkdownDraftContributors.markdownId, projectMarkdownDraftContributors.userId],
                set: { lastContributedAt: new Date() }
            });

        return { success: true as const };
    } catch (error) {
        // Silently fail, it's just telemetry
        return { success: false as const, error: "Failed to register contributor" };
    }
}

export async function getDocDraftContributorsAction(projectId: string, docSlug: string = "readme") {
    try {
        docSlug = normalizeProjectDocSlug(docSlug);
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canEdit || !context.readme) return { success: false as const, error: "Unauthorized" };

        const contributors = await db.query.projectMarkdownDraftContributors.findMany({
            where: eq(projectMarkdownDraftContributors.markdownId, context.readme.id),
        });

        const userIds = contributors.map(c => c.userId);
        if (userIds.length === 0) return { success: true as const, contributors: [] };

        const profilesData = await db.query.profiles.findMany({
            where: inArray(profiles.id, userIds),
            columns: { id: true, fullName: true, email: true, avatarUrl: true },
        });

        const mapped = profilesData.map(p => ({
            id: p.id,
            name: p.fullName || p.email,
            avatarUrl: p.avatarUrl,
        }));

        return { success: true as const, contributors: mapped };
    } catch (error) {
        return { success: false as const, error: "Failed to get contributors" };
    }
}

export async function publishProjectDocAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = publishSchema.parse(input);
        const docSlug = parsed.docSlug;
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canPublish) return { success: false as const, error: "Only project leaders can publish documentation." };
        const published = await db.transaction(async (tx) => {
            let readme = await tx.query.projectMarkdowns.findFirst({
                where: and(
                    eq(projectMarkdowns.projectId, projectId),
                    eq(projectMarkdowns.slug, docSlug)
                )
            });
            if (!readme) {
                const filename = docSlug === "readme" ? "README.md" : `${docSlug.toUpperCase()}.md`;
                const [created] = await tx.insert(projectMarkdowns).values({
                    projectId,
                    slug: docSlug,
                    filename,
                    draftContent: "",
                    draftUpdatedBy: userId,
                    draftUpdatedAt: new Date(),
                    settings: context.settings
                }).returning();
                readme = created;
            }
            const [lockedReadme] = await tx.select().from(projectMarkdowns).where(eq(projectMarkdowns.id, readme!.id)).for('update');
            if (!lockedReadme) throw new Error("Document not found");

            let activeLinkedNode = null;
            if (lockedReadme.linkedNodeId) {
                activeLinkedNode = await tx.query.projectNodes.findFirst({
                    where: and(
                        eq(projectNodes.id, lockedReadme.linkedNodeId),
                        isNull(projectNodes.deletedAt)
                    )
                });
                if (!activeLinkedNode) {
                    // Node has been deleted, detaching
                    await tx.update(projectMarkdowns)
                        .set({ linkedNodeId: null })
                        .where(eq(projectMarkdowns.id, lockedReadme.id));
                }
            }

            const metadata = buildProjectDocPublishMetadata(parsed.content ?? lockedReadme.draftContent ?? "");
            
            const [latest] = await tx
                .select({ value: max(projectMarkdownVersions.versionNumber) })
                .from(projectMarkdownVersions)
                .where(eq(projectMarkdownVersions.markdownId, lockedReadme.id));
            const latestVersion = lockedReadme.publishedVersionId
                ? await tx.query.projectMarkdownVersions.findFirst({
                    where: and(eq(projectMarkdownVersions.id, lockedReadme.publishedVersionId), isNull(projectMarkdownVersions.deletedAt)),
                })
                : null;
            if (latestVersion?.contentHash === metadata.contentHash) {
                return {
                    success: true as const,
                    version: latestVersion,
                    metadata,
                    coAuthors: [],
                    linkedNode: activeLinkedNode ? {
                        id: activeLinkedNode.id,
                        name: activeLinkedNode.name,
                        path: activeLinkedNode.path,
                        s3Key: activeLinkedNode.s3Key,
                    } : null
                };
            }
            const nextVersion = (latest?.value ?? 0) + 1;

            // Fetch contributors
            const contributors = await tx
                .select({ userId: projectMarkdownDraftContributors.userId })
                .from(projectMarkdownDraftContributors)
                .where(eq(projectMarkdownDraftContributors.markdownId, lockedReadme.id));
            const coAuthors = contributors.map(c => c.userId);

            const [version] = await tx
                .insert(projectMarkdownVersions)
                .values({
                    projectId,
                    markdownId: lockedReadme.id,
                    versionNumber: nextVersion,
                    content: metadata.content,
                    excerpt: metadata.excerpt,
                    headings: metadata.headings,
                    qualityReport: metadata.qualityReport,
                    contentHash: metadata.contentHash,
                    changeSummary: parsed.changeSummary?.trim() || null,
                    coAuthors,
                    createdBy: userId,
                })
                .returning();
            if (!version) throw new Error("Failed to publish document version");

            // Clear contributors after publish
            await tx.delete(projectMarkdownDraftContributors)
                .where(eq(projectMarkdownDraftContributors.markdownId, lockedReadme.id));

            await tx.update(projectMarkdowns)
                .set({
                    draftContent: metadata.content,
                    draftUpdatedBy: userId,
                    draftUpdatedAt: new Date(),
                    publishedVersionId: version.id,
                    updatedAt: new Date(),
                })
                .where(eq(projectMarkdowns.id, lockedReadme.id));
            const referencedAssetIds = extractAssetIdsFromContent(metadata.content, projectId);
            if (referencedAssetIds.length > 0) {
                await tx.update(projectMarkdownAssets)
                    .set({ status: "published", versionId: version.id })
                    .where(and(eq(projectMarkdownAssets.markdownId, lockedReadme.id), inArray(projectMarkdownAssets.id, referencedAssetIds as string[])));
            }

            const orphanedAssets = await tx
                .select({
                    id: projectMarkdownAssets.id,
                    bucket: projectMarkdownAssets.bucket,
                    storageKey: projectMarkdownAssets.storageKey,
                })
                .from(projectMarkdownAssets)
                .where(and(
                    eq(projectMarkdownAssets.markdownId, lockedReadme.id),
                    eq(projectMarkdownAssets.status, "draft")
                ));

            if (orphanedAssets.length > 0) {
                await tx.update(projectMarkdownAssets)
                    .set({ status: "orphaned" })
                    .where(and(eq(projectMarkdownAssets.markdownId, lockedReadme.id), eq(projectMarkdownAssets.status, "draft")));
            }

            await recordNodeEvent(projectId, userId, null, "project_readme.published", {
                versionId: version.id,
                versionNumber: version.versionNumber,
                changeSummary: parsed.changeSummary?.trim() || null,
                qualityScore: metadata.qualityReport.score,
                docSlug,
            }, tx);
            return {
                success: true as const,
                version,
                metadata,
                coAuthors,
                lockedReadme,
                orphanedAssets,
                linkedNode: activeLinkedNode ? {
                    id: activeLinkedNode.id,
                    name: activeLinkedNode.name,
                    path: activeLinkedNode.path,
                    s3Key: activeLinkedNode.s3Key,
                } : null
            };
        });

        const { version, metadata, lockedReadme, orphanedAssets, linkedNode } = published;
        if (!lockedReadme) throw new Error("Document not found");

        // Dispatch background media asset cleanup
        if (orphanedAssets && orphanedAssets.length > 0) {
            try {
                const { inngest } = await import("@/inngest/client");
                await inngest.send({
                    name: "project/docs.cleanup",
                    data: {
                        projectId,
                        assets: orphanedAssets,
                    },
                });
            } catch (inngestErr) {
                logger.error("project_readme.send_cleanup_failed", { projectId, error: inngestErr instanceof Error ? inngestErr.message : String(inngestErr) });
            }
        }

        // Files Tab Sync
        if (parsed.syncToFilesTab) {
            try {
                const supabase = await createAdminClient();
                const targetS3Key = linkedNode?.s3Key || `${projectId}/${lockedReadme.filename}`;
                const contentBuffer = Buffer.from(metadata.content, 'utf-8');
                const size = contentBuffer.byteLength;
                const mimeType = 'text/markdown';
                const contentHash = createHash('sha256').update(contentBuffer).digest('hex');

                const { error: uploadError } = await supabase.storage
                    .from('project-files')
                    .upload(targetS3Key, contentBuffer, {
                        contentType: mimeType,
                        upsert: true
                    });

                if (uploadError) {
                    logger.error("project_readme.files_sync_upload_failed", { projectId, error: uploadError.message });
                } else {
                    await db.transaction(async (tx) => {
                        let node = null;
                        if (linkedNode) {
                            node = await tx.query.projectNodes.findFirst({
                                where: and(
                                    eq(projectNodes.id, linkedNode.id),
                                    isNull(projectNodes.deletedAt)
                                )
                            });
                        } else {
                            node = await tx.query.projectNodes.findFirst({
                                where: and(
                                    eq(projectNodes.projectId, projectId),
                                    eq(projectNodes.name, lockedReadme.filename),
                                    isNull(projectNodes.parentId),
                                    isNull(projectNodes.deletedAt)
                                )
                            });
                        }

                        if (!node) {
                            const [created] = await tx.insert(projectNodes).values({
                                projectId,
                                parentId: null,
                                type: 'file',
                                name: linkedNode?.name || lockedReadme.filename,
                                path: linkedNode?.path || lockedReadme.filename,
                                s3Key: targetS3Key,
                                size,
                                mimeType,
                                createdBy: userId,
                            }).returning();
                            node = created;
                        } else {
                            const [updated] = await tx.update(projectNodes)
                                .set({ size, mimeType, s3Key: targetS3Key, updatedAt: new Date() })
                                .where(eq(projectNodes.id, node!.id))
                                .returning();
                            node = updated;
                        }

                        const [latestFileVersion] = await tx.select({ version: max(fileVersions.version) })
                            .from(fileVersions)
                            .where(eq(fileVersions.nodeId, node!.id));
                        
                        const nextFileVersionNumber = (latestFileVersion?.version ?? 0) + 1;

                        await tx.insert(fileVersions).values({
                            nodeId: node!.id,
                            version: nextFileVersionNumber,
                            s3Key: targetS3Key,
                            size,
                            mimeType,
                            contentHash,
                            uploadedBy: userId,
                            comment: parsed.changeSummary?.trim() || `Published from ${lockedReadme.filename}`,
                        });
                    });
                }
            } catch (error) {
                logger.error("project_readme.files_sync_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
            }
        }

        revalidateProjectDoc(context.project);
        if (metadata && (context.settings.notifyOnPublish || parsed.notifyFollowers)) {
            const title = docSlug === "readme" ? "Project document published" : `Project document ${lockedReadme.filename} published`;
            enqueueProjectNotificationEvent({
                projectId,
                actorUserId: userId,
                eventKey: "readme.published",
                title,
                body: metadata.excerpt,
                href: `/projects/${encodeURIComponent(context.project.slug || context.project.id)}?tab=docs&doc=${docSlug}`,
                entityRefs: { projectId },
                sourceEventId: `readme:${version.id}`,
            }).catch((error) => logger.warn("project_readme.notification_failed", {
                module: "projects",
                projectId,
                versionId: version.id,
                error: error instanceof Error ? error.message : String(error),
            }));
        }
        
        let createdByName: string | null = null;
        try {
            const [profile] = await db.select({ displayName: profileDisplayNameSql(userId) }).from(profiles).where(eq(profiles.id, userId));
            createdByName = profile?.displayName ?? null;
        } catch (e) {
            // ignore
        }
        
        return { success: true as const, version: toDocVersion({ ...version, createdByName }) };
    } catch (error) {
        logger.error("project_readme.publish_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to publish document." };
    }
}

export async function restoreProjectDocVersionAction(projectId: string, versionId: string, docSlug: string = "readme") {
    try {
        docSlug = normalizeProjectDocSlug(docSlug);
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canEdit) return { success: false as const, error: "You cannot edit this document." };
        if (!context.readme) return { success: false as const, error: "Document not found." };
        const version = await db.query.projectMarkdownVersions.findFirst({
            where: and(eq(projectMarkdownVersions.id, versionId), eq(projectMarkdownVersions.markdownId, context.readme.id), isNull(projectMarkdownVersions.deletedAt)),
        });
        if (!version) return { success: false as const, error: "Document version not found." };
        const restoredContent = normalizeProjectDocContent(version.content);
        const readme = await getOrCreateMarkdown(projectId, userId, docSlug, context.settings);
        const [updated] = await db.update(projectMarkdowns)
            .set({
                draftContent: restoredContent,
                draftUpdatedBy: userId,
                draftUpdatedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(projectMarkdowns.id, readme.id))
            .returning();
        await recordNodeEvent(projectId, userId, null, "project_readme.version_restored_to_draft", { versionId, versionNumber: version.versionNumber });
        return {
            success: true as const,
            draftContent: restoredContent,
            draftUpdatedAt: toIso(updated?.draftUpdatedAt),
            qualityReport: buildProjectDocQualityReport(restoredContent),
        };
    } catch (error) {
        logger.error("project_readme.restore_failed", {
            module: "projects",
            projectId,
            versionId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to restore document version." };
    }
}

export async function setProjectDocPublishedVersionAction(projectId: string, versionId: string, docSlug: string = "readme") {
    try {
        docSlug = normalizeProjectDocSlug(docSlug);
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canPublish) return { success: false as const, error: "Only project leaders can set the current version." };
        if (!context.readme) return { success: false as const, error: "Document not found." };

        const result = await db.transaction(async (tx) => {
            const version = await tx.query.projectMarkdownVersions.findFirst({
                where: and(eq(projectMarkdownVersions.id, versionId), eq(projectMarkdownVersions.markdownId, context.readme!.id), isNull(projectMarkdownVersions.deletedAt)),
            });
            if (!version) return null;
            const readme = context.readme!;
            if (!readme) throw new Error("Failed to create document");
            const nextContent = normalizeProjectDocContent(version.content);
            const [updated] = await tx.update(projectMarkdowns)
                .set({
                    draftContent: nextContent,
                    draftUpdatedBy: userId,
                    draftUpdatedAt: new Date(),
                    publishedVersionId: version.id,
                    updatedAt: new Date(),
                })
                .where(eq(projectMarkdowns.id, readme.id))
                .returning();
            await recordNodeEvent(projectId, userId, null, "project_readme.version_set_current", { versionId, versionNumber: version.versionNumber }, tx);
            return { version, updated };
        });

        if (!result) return { success: false as const, error: "Document version not found." };
        revalidateProjectDoc(context.project);
        const draftContent = normalizeProjectDocContent(result.version.content);
        return {
            success: true as const,
            version: toDocVersion(result.version),
            draftContent,
            draftUpdatedAt: toIso(result.updated?.draftUpdatedAt),
            qualityReport: buildProjectDocQualityReport(draftContent),
        };
    } catch (error) {
        logger.error("project_readme.set_current_failed", {
            module: "projects",
            projectId,
            versionId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to set current document version." };
    }
}

export async function deleteProjectDocVersionAction(projectId: string, versionId: string, docSlug: string = "readme") {
    try {
        docSlug = normalizeProjectDocSlug(docSlug);
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canPublish) return { success: false as const, error: "Only project leaders can delete versions." };
        if (!context.readme) return { success: false as const, error: "Document not found." };

        const result = await db.transaction(async (tx) => {
            const readme = context.readme!;
            const version = await tx.query.projectMarkdownVersions.findFirst({
                where: and(eq(projectMarkdownVersions.id, versionId), eq(projectMarkdownVersions.markdownId, readme.id), isNull(projectMarkdownVersions.deletedAt)),
            });
            if (!version) return null;

            await tx.update(projectMarkdownVersions)
                .set({ deletedAt: new Date() })
                .where(eq(projectMarkdownVersions.id, version.id));

            let replacement: typeof projectMarkdownVersions.$inferSelect | null = null;
            let updatedDraftAt: Date | string | null | undefined = readme.draftUpdatedAt;
            if (readme.publishedVersionId === version.id) {
                replacement = await tx.query.projectMarkdownVersions.findFirst({
                    where: and(eq(projectMarkdownVersions.markdownId, readme.id), isNull(projectMarkdownVersions.deletedAt)),
                    orderBy: [desc(projectMarkdownVersions.versionNumber)],
                }) ?? null;
                const [updated] = await tx.update(projectMarkdowns)
                    .set({
                        publishedVersionId: replacement?.id ?? null,
                        draftContent: replacement?.content ?? readme.draftContent,
                        draftUpdatedBy: replacement ? userId : readme.draftUpdatedBy,
                        draftUpdatedAt: replacement ? new Date() : readme.draftUpdatedAt,
                        updatedAt: new Date(),
                    })
                    .where(eq(projectMarkdowns.id, readme.id))
                    .returning();
                updatedDraftAt = updated?.draftUpdatedAt;
            }

            await recordNodeEvent(projectId, userId, null, "project_readme.version_deleted", {
                versionId: version.id,
                versionNumber: version.versionNumber,
                replacedPublishedVersionId: replacement?.id ?? null,
            }, tx);

            const readmeNode = await tx.query.projectNodes.findFirst({
                where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.name, "README.md"), isNull(projectNodes.deletedAt)),
            });
            
            if (readmeNode) {
                const matchingFileVersion = await tx.query.fileVersions.findFirst({
                    where: and(
                        eq(fileVersions.nodeId, readmeNode.id),
                        eq(fileVersions.contentHash, version.contentHash)
                    ),
                });
                
                if (matchingFileVersion) {
                    await tx.delete(fileVersions)
                        .where(eq(fileVersions.id, matchingFileVersion.id));
                }
            }

            return { deleted: version, replacement, draftUpdatedAt: updatedDraftAt };
        });

        if (!result) return { success: false as const, error: "Document version not found." };
        revalidateProjectDoc(context.project);
        return {
            success: true as const,
            deletedVersionId: result.deleted.id,
            publishedVersion: toDocVersion(result.replacement),
            draftContent: result.replacement?.content ?? null,
            draftUpdatedAt: toIso(result.draftUpdatedAt),
            qualityReport: buildProjectDocQualityReport(result.replacement?.content ?? ""),
        };
    } catch (error) {
        logger.error("project_readme.delete_version_failed", {
            module: "projects",
            projectId,
            versionId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to delete document version." };
    }
}

export async function discardProjectDocDraftAction(projectId: string, docSlug: string = "readme") {
    try {
        docSlug = normalizeProjectDocSlug(docSlug);
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canEdit) return { success: false as const, error: "You cannot edit this document." };
        
        const result = await db.transaction(async (tx) => {
            const readme = await getOrCreateMarkdown(projectId, userId, docSlug, context.settings);
            const published = await readPublishedVersion(readme.publishedVersionId);
            const nextContent = normalizeProjectDocContent(published?.content ?? "");
            
            const orphanedAssets = await tx
                .select({
                    id: projectMarkdownAssets.id,
                    bucket: projectMarkdownAssets.bucket,
                    storageKey: projectMarkdownAssets.storageKey,
                })
                .from(projectMarkdownAssets)
                .where(and(
                    eq(projectMarkdownAssets.markdownId, readme.id),
                    eq(projectMarkdownAssets.status, "draft")
                ));

            if (orphanedAssets.length > 0) {
                await tx.update(projectMarkdownAssets)
                    .set({ status: "orphaned" })
                    .where(and(eq(projectMarkdownAssets.markdownId, readme.id), eq(projectMarkdownAssets.status, "draft")));
            }

            const [updated] = await tx.update(projectMarkdowns)
                .set({
                    draftContent: nextContent,
                    draftUpdatedBy: userId,
                    draftUpdatedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(projectMarkdowns.id, readme.id))
                .returning();

            await recordNodeEvent(projectId, userId, null, "project_readme.draft_discarded", { restoredPublishedVersionId: published?.id ?? null }, tx);

            return { updated, nextContent, orphanedAssets };
        });

        if (result.orphanedAssets && result.orphanedAssets.length > 0) {
            try {
                const { inngest } = await import("@/inngest/client");
                await inngest.send({
                    name: "project/docs.cleanup",
                    data: {
                        projectId,
                        assets: result.orphanedAssets,
                    },
                });
            } catch (inngestErr) {
                logger.error("project_readme.send_cleanup_failed", { projectId, error: inngestErr instanceof Error ? inngestErr.message : String(inngestErr) });
            }
        }

        return {
            success: true as const,
            draftContent: result.nextContent,
            draftUpdatedAt: toIso(result.updated?.draftUpdatedAt),
            qualityReport: buildProjectDocQualityReport(result.nextContent),
        };
    } catch (error) {
        logger.error("project_readme.discard_draft_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to discard document draft." };
    }
}

export async function listProjectDocVersionsAction(projectId: string, docSlug: string = "readme", cursor?: string | null) {
    try {
        docSlug = normalizeProjectDocSlug(docSlug);
        const actorUserId = await getOptionalUserId();
        const context = await getDocProjectContext(projectId, actorUserId, docSlug);
        if (!context.readme) return { success: true as const, versions: [], hasMore: false, nextCursor: null };
        if (!context.permission.canReadPublished && !context.permission.canEdit) return { success: false as const, error: "Document unavailable." };
        const cursorDate = cursor ? new Date(cursor) : null;
        const versionConditions = [
            eq(projectMarkdownVersions.markdownId, context.readme.id),
            isNull(projectMarkdownVersions.deletedAt),
        ];
        if (cursorDate && !Number.isNaN(cursorDate.getTime())) {
            versionConditions.push(lt(projectMarkdownVersions.createdAt, cursorDate));
        }
        const rows = await db.query.projectMarkdownVersions.findMany({
            where: and(...versionConditions),
            orderBy: [desc(projectMarkdownVersions.createdAt), desc(projectMarkdownVersions.versionNumber)],
            limit: 21,
            extras: {
                createdByName: profileDisplayNameSql(projectMarkdownVersions.createdBy).as("createdByName"),
            },
        });

        const pageRows = rows.slice(0, 20);
        const allCoAuthorIds = Array.from(new Set(pageRows.flatMap(r => Array.isArray(r.coAuthors) ? r.coAuthors.map(String) : [])));
        const profilesMap = new Map<string, { id: string; name: string; avatarUrl: string | null }>();
        if (allCoAuthorIds.length > 0) {
            const profilesData = await db.query.profiles.findMany({
                where: inArray(profiles.id, allCoAuthorIds),
                columns: { id: true, fullName: true, email: true, avatarUrl: true },
            });
            for (const p of profilesData) {
                profilesMap.set(p.id, { id: p.id, name: p.fullName || p.email, avatarUrl: p.avatarUrl });
            }
        }

        const visibleVersions = pageRows
            .map((row) => {
                const coAuthorIds = Array.isArray(row.coAuthors) ? row.coAuthors.map(String) : [];
                const coAuthorsData = coAuthorIds.map(id => profilesMap.get(id)).filter(Boolean) as { id: string; name: string; avatarUrl: string | null }[];
                return toDocVersion(row, row.versionNumber, coAuthorsData)!;
            });
        return {
            success: true as const,
            versions: visibleVersions,
            hasMore: rows.length > 20,
            nextCursor: visibleVersions.length ? visibleVersions[visibleVersions.length - 1]!.createdAt : null,
        };
    } catch (error) {
        logger.error("project_readme.versions_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to load document versions." };
    }
}

export async function validateProjectDocAction(projectId: string, content: unknown) {
    try {
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId);
        if (!context.permission.canEdit) return { success: false as const, error: "You cannot validate this document." };
        const normalized = normalizeProjectDocContent(content);
        return {
            success: true as const,
            qualityReport: buildProjectDocQualityReport(normalized),
            headings: buildProjectDocPublishMetadata(normalized).headings,
        };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to validate document." };
    }
}

export async function readProjectDocReferenceOptionsAction(projectId: string, input: unknown): Promise<
    | { success: true; options: ProjectDocReferenceOption[] }
    | { success: false; error: string }
> {
    try {
        const userId = await requireUserId();
        const parsed = referenceOptionsSchema.parse(input);
        const context = await getDocProjectContext(projectId, userId);
        if (!context.permission.canEdit) return { success: false, error: "You cannot insert document project references." };

        const query = parsed.query?.trim() || "";
        const like = `%${query.replace(/[%_]/g, "\\$&")}%`;
        const limit = parsed.limit ?? 12;

        if (parsed.kind === "tasks") {
            const taskConditions = [eq(tasks.projectId, projectId), isNull(tasks.deletedAt)];
            if (query) taskConditions.push(or(ilike(tasks.title, like), ilike(tasks.description, like))!);
            const rows = await db
                .select({
                    id: tasks.id,
                    title: tasks.title,
                    description: tasks.description,
                    status: tasks.status,
                    priority: tasks.priority,
                    taskNumber: tasks.taskNumber,
                    assigneeId: tasks.assigneeId,
                    creatorId: tasks.creatorId,
                    assigneeName: profileDisplayNameSql(tasks.assigneeId),
                    creatorName: profileDisplayNameSql(tasks.creatorId),
                })
                .from(tasks)
                .where(and(...taskConditions))
                .orderBy(desc(tasks.updatedAt))
                .limit(limit);
            return { success: true, options: rows.map((row) => optionFromTask(row, context.project)) };
        }

        if (parsed.kind === "sprints") {
            const sprintConditions = [eq(projectSprints.projectId, projectId)];
            if (query) sprintConditions.push(or(ilike(projectSprints.name, like), ilike(projectSprints.goal, like), ilike(projectSprints.description, like))!);
            const rows = await db.query.projectSprints.findMany({
                where: and(...sprintConditions),
                orderBy: [desc(projectSprints.updatedAt)],
                limit,
            });
            return { success: true, options: rows.map((row) => optionFromSprint(row, context.project)) };
        }

        if (parsed.kind === "files") {
            const fileConditions = [eq(projectNodes.projectId, projectId), eq(projectNodes.type, "file"), isNull(projectNodes.deletedAt)];
            if (query) fileConditions.push(or(ilike(projectNodes.name, like), ilike(projectNodes.path, like))!);
            const rows = await db.query.projectNodes.findMany({
                where: and(...fileConditions),
                orderBy: [desc(projectNodes.updatedAt)],
                limit,
            });
            return { success: true, options: rows.map((row) => optionFromFile(row, context.project)) };
        }

        if (parsed.kind === "roles") {
            const roleConditions = [eq(projectOpenRoles.projectId, projectId)];
            if (query) roleConditions.push(or(ilike(projectOpenRoles.role, like), ilike(projectOpenRoles.title, like), ilike(projectOpenRoles.description, like))!);
            const rows = await db.query.projectOpenRoles.findMany({
                where: and(...roleConditions),
                orderBy: [desc(projectOpenRoles.updatedAt)],
                limit,
            });
            return { success: true, options: rows.map((row) => optionFromRole(row, context.project)) };
        }

        const contributorConditions = [eq(projectMembers.projectId, projectId), isNull(profiles.deletedAt)];
        if (query) contributorConditions.push(or(ilike(profiles.fullName, like), ilike(profiles.username, like))!);
        const rows = await db
            .select({
                userId: projectMembers.userId,
                role: projectMembers.role,
                fullName: profiles.fullName,
                username: profiles.username,
                avatarUrl: profiles.avatarUrl,
                projectRoleTitle: acceptedRoleTitleSql(projectId, projectMembers.userId),
            })
            .from(projectMembers)
            .innerJoin(profiles, eq(profiles.id, projectMembers.userId))
            .where(and(...contributorConditions))
            .orderBy(desc(projectMembers.joinedAt))
            .limit(limit);

        return { success: true, options: rows.map((row) => optionFromContributor(row, context.project)) };
    } catch (error) {
        logger.error("project_readme.reference_options_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Failed to load document references." };
    }
}

export async function readProjectDocSmartBlockPreviewsAction(projectId: string, input: unknown): Promise<
    | { success: true; previews: ProjectDocSmartBlockPreview[] }
    | { success: false; error: string }
> {
    try {
        const actorUserId = await getOptionalUserId();
        const parsed = smartBlockPreviewSchema.parse(input);
        const context = await getDocProjectContext(projectId, actorUserId);
        if (!context.permission.canReadPublished && !context.permission.canEdit) {
            return { success: false, error: "Document references unavailable." };
        }

        const normalizedBlocks = parsed.map((block, index) => ({
            kind: block.kind,
            ids: (block.ids ?? []).filter((id) => isUuid(id)).slice(0, 12),
            index: block.index ?? index,
        }));
        const readableKinds = new Set<ProjectDocReferenceKind>();
        const idsByKind = new Map<ProjectDocReferenceKind, Set<string>>();
        const needsRecent = new Set<ProjectDocReferenceKind>();

        for (const block of normalizedBlocks) {
            if (block.kind === "unknown" || !canReadReferenceKind(block.kind, context)) continue;
            readableKinds.add(block.kind);
            if (block.ids.length) {
                const ids = idsByKind.get(block.kind) ?? new Set<string>();
                block.ids.forEach((id) => ids.add(id));
                idsByKind.set(block.kind, ids);
            } else {
                needsRecent.add(block.kind);
            }
        }

        const tasksById = new Map<string, ProjectDocReferenceOption>();
        let recentTasks: ProjectDocReferenceOption[] = [];
        if (readableKinds.has("tasks")) {
            const taskIds = [...(idsByKind.get("tasks") ?? [])];
            const [selectedRows, recentRows] = await Promise.all([
                taskIds.length ? db
                    .select({
                        id: tasks.id,
                        title: tasks.title,
                        description: tasks.description,
                        status: tasks.status,
                        priority: tasks.priority,
                        taskNumber: tasks.taskNumber,
                        assigneeId: tasks.assigneeId,
                        creatorId: tasks.creatorId,
                        assigneeName: profileDisplayNameSql(tasks.assigneeId),
                        creatorName: profileDisplayNameSql(tasks.creatorId),
                    })
                    .from(tasks)
                    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), inArray(tasks.id, taskIds)))
                    .orderBy(desc(tasks.updatedAt))
                    .limit(taskIds.length) : Promise.resolve([]),
                needsRecent.has("tasks") ? db
                    .select({
                        id: tasks.id,
                        title: tasks.title,
                        description: tasks.description,
                        status: tasks.status,
                        priority: tasks.priority,
                        taskNumber: tasks.taskNumber,
                        assigneeId: tasks.assigneeId,
                        creatorId: tasks.creatorId,
                        assigneeName: profileDisplayNameSql(tasks.assigneeId),
                        creatorName: profileDisplayNameSql(tasks.creatorId),
                    })
                    .from(tasks)
                    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
                    .orderBy(desc(tasks.updatedAt))
                    .limit(4) : Promise.resolve([]),
            ]);
            selectedRows.forEach((row) => tasksById.set(row.id, optionFromTask(row, context.project)));
            recentTasks = recentRows.map((row) => optionFromTask(row, context.project));
        }

        const sprintsById = new Map<string, ProjectDocReferenceOption>();
        let recentSprints: ProjectDocReferenceOption[] = [];
        if (readableKinds.has("sprints")) {
            const sprintIds = [...(idsByKind.get("sprints") ?? [])];
            const [selectedRows, recentRows] = await Promise.all([
                sprintIds.length ? db.query.projectSprints.findMany({
                    where: and(eq(projectSprints.projectId, projectId), inArray(projectSprints.id, sprintIds)),
                    orderBy: [desc(projectSprints.updatedAt)],
                    limit: sprintIds.length,
                }) : Promise.resolve([]),
                needsRecent.has("sprints") ? db.query.projectSprints.findMany({
                    where: eq(projectSprints.projectId, projectId),
                    orderBy: [desc(projectSprints.updatedAt)],
                    limit: 4,
                }) : Promise.resolve([]),
            ]);
            selectedRows.forEach((row) => sprintsById.set(row.id, optionFromSprint(row, context.project)));
            recentSprints = recentRows.map((row) => optionFromSprint(row, context.project));
        }

        const filesById = new Map<string, ProjectDocReferenceOption>();
        let recentFiles: ProjectDocReferenceOption[] = [];
        if (readableKinds.has("files")) {
            const fileIds = [...(idsByKind.get("files") ?? [])];
            const [selectedRows, recentRows] = await Promise.all([
                fileIds.length ? db.query.projectNodes.findMany({
                    where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.type, "file"), isNull(projectNodes.deletedAt), inArray(projectNodes.id, fileIds)),
                    orderBy: [desc(projectNodes.updatedAt)],
                    limit: fileIds.length,
                }) : Promise.resolve([]),
                needsRecent.has("files") ? db.query.projectNodes.findMany({
                    where: and(eq(projectNodes.projectId, projectId), eq(projectNodes.type, "file"), isNull(projectNodes.deletedAt)),
                    orderBy: [desc(projectNodes.updatedAt)],
                    limit: 4,
                }) : Promise.resolve([]),
            ]);
            selectedRows.forEach((row) => filesById.set(row.id, optionFromFile(row, context.project)));
            recentFiles = recentRows.map((row) => optionFromFile(row, context.project));
        }

        const rolesById = new Map<string, ProjectDocReferenceOption>();
        let recentRoles: ProjectDocReferenceOption[] = [];
        if (readableKinds.has("roles")) {
            const roleIds = [...(idsByKind.get("roles") ?? [])];
            const [selectedRows, recentRows] = await Promise.all([
                roleIds.length ? db.query.projectOpenRoles.findMany({
                    where: and(eq(projectOpenRoles.projectId, projectId), inArray(projectOpenRoles.id, roleIds)),
                    orderBy: [desc(projectOpenRoles.updatedAt)],
                    limit: roleIds.length,
                }) : Promise.resolve([]),
                needsRecent.has("roles") ? db.query.projectOpenRoles.findMany({
                    where: eq(projectOpenRoles.projectId, projectId),
                    orderBy: [desc(projectOpenRoles.updatedAt)],
                    limit: 4,
                }) : Promise.resolve([]),
            ]);
            selectedRows.forEach((row) => rolesById.set(row.id, optionFromRole(row, context.project)));
            recentRoles = recentRows.map((row) => optionFromRole(row, context.project));
        }

        const contributorsById = new Map<string, ProjectDocReferenceOption>();
        let recentContributors: ProjectDocReferenceOption[] = [];
        if (readableKinds.has("contributors")) {
            const contributorIds = [...(idsByKind.get("contributors") ?? [])];
            const selectedRows = contributorIds.length ? await db
                .select({
                    userId: projectMembers.userId,
                    role: projectMembers.role,
                    fullName: profiles.fullName,
                    username: profiles.username,
                    avatarUrl: profiles.avatarUrl,
                    projectRoleTitle: acceptedRoleTitleSql(projectId, projectMembers.userId),
                })
                .from(projectMembers)
                .innerJoin(profiles, eq(profiles.id, projectMembers.userId))
                .where(and(
                    eq(projectMembers.projectId, projectId),
                    isNull(profiles.deletedAt),
                    inArray(projectMembers.userId, contributorIds),
                ))
                .orderBy(desc(projectMembers.joinedAt))
                .limit(contributorIds.length) : [];
            const recentRows = needsRecent.has("contributors") ? await db
                .select({
                    userId: projectMembers.userId,
                    role: projectMembers.role,
                    fullName: profiles.fullName,
                    username: profiles.username,
                    avatarUrl: profiles.avatarUrl,
                    projectRoleTitle: acceptedRoleTitleSql(projectId, projectMembers.userId),
                })
                .from(projectMembers)
                .innerJoin(profiles, eq(profiles.id, projectMembers.userId))
                .where(and(eq(projectMembers.projectId, projectId), isNull(profiles.deletedAt)))
                .orderBy(desc(projectMembers.joinedAt))
                .limit(4) : [];
            selectedRows.forEach((row) => contributorsById.set(row.userId, optionFromContributor(row, context.project)));
            recentContributors = recentRows.map((row) => optionFromContributor(row, context.project));
        }

        const previewFor = (block: (typeof normalizedBlocks)[number]): ProjectDocSmartBlockPreview => {
            if (block.kind === "unknown") return unavailablePreview(block, "This document block is not recognized.");
            if (!canReadReferenceKind(block.kind, context)) return unavailablePreview(block);
            const href = projectHref(context.project, block.kind === "files"
                ? "files"
                : block.kind === "tasks"
                    ? "tasks"
                    : block.kind === "sprints"
                        ? "sprints"
                        : block.kind === "roles"
                            ? "settings"
                            : "dashboard");
            const byId = block.kind === "tasks"
                ? tasksById
                : block.kind === "sprints"
                    ? sprintsById
                    : block.kind === "files"
                        ? filesById
                        : block.kind === "roles"
                            ? rolesById
                            : contributorsById;
            const recent = block.kind === "tasks"
                ? recentTasks
                : block.kind === "sprints"
                    ? recentSprints
                    : block.kind === "files"
                        ? recentFiles
                        : block.kind === "roles"
                            ? recentRoles
                            : recentContributors;
            const items = block.ids.length ? block.ids.map((id) => byId.get(id)).filter((item): item is ProjectDocReferenceOption => Boolean(item)) : recent;

            return {
                key: blockKey(block),
                kind: block.kind,
                title: block.kind === "tasks"
                    ? "Referenced tasks"
                    : block.kind === "sprints"
                        ? "Sprint story"
                        : block.kind === "files"
                            ? "Referenced files"
                            : block.kind === "roles"
                                ? "Open roles"
                                : "Contributors",
                description: block.ids.length
                    ? "Selected project context from this document."
                    : "Current project context rendered from live project data.",
                href,
                items,
                unavailableCount: Math.max(0, block.ids.length - items.length),
            };
        };

        const previews = normalizedBlocks.map(previewFor);

        return { success: true, previews };
    } catch (error) {
        logger.error("project_readme.smart_block_previews_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Failed to load document project references." };
    }
}

export async function createProjectDocAssetUploadUrlAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = uploadUrlSchema.parse(input);
        const docSlug = parsed.docSlug;
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canManageAssets || !context.readme) return { success: false as const, error: "Document media uploads are not available." };
        const { allowed } = await consumeRateLimit(`upload:project-readme-asset:user:${userId}`, 20, 60 * 60);
        if (!allowed) return { success: false as const, error: "Too many document image upload attempts. Please try again later." };
        const mimeType = normalizeAndValidateMimeType(parsed.mimeType);
        if (!PROJECT_DOC_ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
            return { success: false as const, error: "Unsupported image type. Use JPG, PNG, WebP, or GIF." };
        }
        const sizeBytes = normalizeAndValidateFileSize(parsed.sizeBytes, PROJECT_DOC_ASSET_MAX_BYTES, "Document image");
        const storageKey = buildProjectDocStorageKey(projectId, userId, readmeImageExtensionFromMimeType(mimeType));
        const intent = await createUploadIntent({
            userId,
            projectId,
            bucket: PROJECT_DOC_ASSET_BUCKET,
            storageKey,
            scope: "project_file",
            kind: "file",
            expectedMimeType: mimeType,
            expectedSize: sizeBytes,
            metadata: { kind: "project_readme_asset", altText: parsed.altText ?? null },
        });
        const admin = await createAdminClient();
        const { data, error } = await admin.storage.from(PROJECT_DOC_ASSET_BUCKET).createSignedUploadUrl(storageKey, { upsert: false });
        if (error || !data?.signedUrl || !data?.token) {
            return { success: false as const, error: "Failed to prepare document image upload." };
        }
        return {
            success: true as const,
            uploadUrl: data.signedUrl,
            uploadToken: data.token,
            uploadIntentId: intent.id,
            storagePath: storageKey,
            bucket: PROJECT_DOC_ASSET_BUCKET,
            contentType: mimeType,
        };
    } catch (error) {
        logger.error("project_readme.asset_upload_url_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to prepare document image upload." };
    }
}

export async function finalizeProjectDocAssetUploadAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = z.object({
            uploadIntentId: z.string().uuid(),
            altText: z.string().max(240).nullable().optional(),
            width: z.number().int().positive().nullable().optional(),
            height: z.number().int().positive().nullable().optional(),
            docSlug: docSlugSchema,
        }).parse(input);
        const docSlug = parsed.docSlug;
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canManageAssets || !context.readme) return { success: false as const, error: "Document media uploads are not available." };
        const intent = await finalizeUploadIntent({
            intentId: parsed.uploadIntentId,
            bucket: PROJECT_DOC_ASSET_BUCKET,
            userId,
            projectId,
            expectedScope: "project_file",
            expectedKind: "file",
        });
        const [asset] = await db.insert(projectMarkdownAssets).values({
            projectId,
            markdownId: context.readme!.id,
            bucket: intent.bucket,
            storageKey: intent.storageKey,
            mimeType: intent.expectedMimeType || "application/octet-stream",
            sizeBytes: intent.expectedSize,
            width: parsed.width ?? null,
            height: parsed.height ?? null,
            altText: parsed.altText?.trim() || null,
            status: "draft",
            createdBy: userId,
        }).returning();
        if (!asset) return { success: false as const, error: "Failed to finalize document image." };
        return {
            success: true as const,
            asset: toDocAsset(asset),
            markdown: `![${asset.altText || "Project image"}](${PROJECT_DOC_ASSET_ROUTE_PREFIX}/${projectId}/doc-assets/${asset.id})`,
        };
    } catch (error) {
        logger.error("project_readme.asset_finalize_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to finalize document image." };
    }
}

export async function deleteProjectDocAssetAction(projectId: string, assetId: string) {
    try {
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId);
        if (!context.permission.canManageAssets) return { success: false as const, error: "You cannot manage document assets." };
        const [asset] = await db.update(projectMarkdownAssets)
            .set({ deletedAt: new Date(), status: "orphaned" })
            .where(and(eq(projectMarkdownAssets.projectId, projectId), eq(projectMarkdownAssets.id, assetId), isNull(projectMarkdownAssets.deletedAt)))
            .returning();
        if (!asset) return { success: false as const, error: "Document asset not found." };
        const admin = await createAdminClient();
        await admin.storage.from(asset.bucket).remove([asset.storageKey]);
        return { success: true as const };
    } catch (error) {
        logger.error("project_readme.asset_delete_failed", {
            module: "projects",
            projectId,
            assetId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to delete document asset." };
    }
}

export async function readProjectDocSettingsAction(projectId: string, docSlug: string = "readme") {
    try {
        docSlug = normalizeProjectDocSlug(docSlug);
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId);
        if (!context.permission.canManageSettings) return { success: false as const, error: "You cannot manage document settings." };
        return { success: true as const, settings: context.settings, permission: context.permission };
    } catch (error) {
        return { success: false as const, error: "Failed to load document settings." };
    }
}

export async function updateProjectDocSettingsAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = readmeSettingsSchema.parse(input);
        const docSlug = parsed.docSlug;
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canManageSettings) return { success: false as const, error: "You cannot manage settings." };
        const readme = await getOrCreateMarkdown(projectId, userId, docSlug, context.settings);
        const nextSettings = normalizeProjectDocSettings({ ...context.settings, ...parsed });
        const [updated] = await db.update(projectMarkdowns)
            .set({ settings: nextSettings, updatedAt: new Date() })
            .where(eq(projectMarkdowns.id, readme.id))
            .returning();
        await recordNodeEvent(projectId, userId, null, "project_readme.settings_updated", { settings: nextSettings });
        revalidateProjectDoc(context.project);
        return { success: true as const, settings: normalizeProjectDocSettings(updated?.settings) };
    } catch (error) {
        logger.error("project_readme.settings_update_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to update document settings." };
    }
}

export async function linkProjectDocAction(projectId: string, nodeId: string, docSlug: string = "readme") {
    try {
        docSlug = normalizeProjectDocSlug(docSlug);
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canEdit) {
            return { success: false as const, error: "Only project members can link a document file." };
        }

        // Check if the node actually exists, belongs to this project, is a file, and not deleted
        const node = await db.query.projectNodes.findFirst({
            where: and(
                eq(projectNodes.id, nodeId),
                eq(projectNodes.projectId, projectId),
                eq(projectNodes.type, 'file'),
                isNull(projectNodes.deletedAt)
            )
        });

        if (!node) {
            return { success: false as const, error: "Target file not found." };
        }

        // Upsert project readme record with linkedNodeId
        await db.transaction(async (tx) => {
            const readme = await tx.query.projectMarkdowns.findFirst({
                where: and(
                    eq(projectMarkdowns.projectId, projectId),
                    eq(projectMarkdowns.slug, docSlug)
                )
            });

            if (!readme) {
                const filename = node.name || (docSlug === "readme" ? "README.md" : `${docSlug.toUpperCase()}.md`);
                await tx.insert(projectMarkdowns).values({
                    projectId,
                    slug: docSlug,
                    filename,
                    linkedNodeId: nodeId,
                    draftContent: "",
                    draftUpdatedBy: userId,
                    draftUpdatedAt: new Date(),
                    settings: context.settings,
                });
            } else {
                await tx.update(projectMarkdowns)
                    .set({
                        filename: node.name || readme.filename,
                        linkedNodeId: nodeId,
                        draftUpdatedBy: userId,
                        draftUpdatedAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .where(eq(projectMarkdowns.id, readme.id));
            }
        });

        revalidatePath(`/projects/${context.project.slug}/readme`);
        revalidatePath(`/projects/${context.project.slug}/files`);

        return { success: true as const };
    } catch (error) {
        logger.error("project_readme.link_failed", { projectId, nodeId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Internal server error." };
    }
}

export async function unlinkProjectDocAction(projectId: string, docSlug: string = "readme") {
    try {
        docSlug = normalizeProjectDocSlug(docSlug);
        const userId = await requireUserId();
        const context = await getDocProjectContext(projectId, userId, docSlug);
        if (!context.permission.canEdit) {
            return { success: false as const, error: "Only project members can unlink a document file." };
        }

        if (docSlug === "readme") {
            await db.update(projectMarkdowns)
                .set({
                    linkedNodeId: null,
                    draftUpdatedBy: userId,
                    draftUpdatedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(and(
                    eq(projectMarkdowns.projectId, projectId),
                    eq(projectMarkdowns.slug, docSlug)
                ));
        } else {
            if (context.readme) {
                // Find all assets to clean up storage
                const assets = await db
                    .select({
                        bucket: projectMarkdownAssets.bucket,
                        storageKey: projectMarkdownAssets.storageKey,
                    })
                    .from(projectMarkdownAssets)
                    .where(eq(projectMarkdownAssets.markdownId, context.readme.id));

                if (assets.length > 0) {
                    try {
                        const admin = await createAdminClient();
                        for (const asset of assets) {
                            await admin.storage.from(asset.bucket).remove([asset.storageKey]);
                        }
                    } catch (err) {
                        logger.error("project_readme.unlink_delete_assets_failed", {
                            projectId,
                            docSlug,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                }

                await db.delete(projectMarkdowns)
                    .where(and(
                        eq(projectMarkdowns.projectId, projectId),
                        eq(projectMarkdowns.slug, docSlug)
                    ));
            }
        }

        revalidateProjectDoc(context.project);
        revalidatePath(`/projects/${context.project.slug}/readme`);
        revalidatePath(`/projects/${context.project.slug}/files`);

        return { success: true as const };
    } catch (error) {
        logger.error("project_readme.unlink_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Internal server error." };
    }
}

export async function readProjectMarkdownSearchAction(projectId: string, queryText: string) {
    try {
        const actorUserId = await getOptionalUserId();
        const [project] = await db
            .select({
                id: projects.id,
                slug: projects.slug,
                ownerId: projects.ownerId,
                visibility: projects.visibility,
                publicTabVisibility: projects.publicTabVisibility,
            })
            .from(projects)
            .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
            .limit(1);
        if (!project) return { success: false as const, error: "Project not found" };

        const membership = actorUserId
            ? await db.query.projectMembers.findFirst({
                where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorUserId)),
                columns: { role: true },
            })
            : null;

        const docs = await db
            .select({
                id: projectMarkdowns.id,
                slug: projectMarkdowns.slug,
                filename: projectMarkdowns.filename,
                draftContent: projectMarkdowns.draftContent,
                publishedVersionId: projectMarkdowns.publishedVersionId,
                settings: projectMarkdowns.settings,
                publishedContent: projectMarkdownVersions.content,
            })
            .from(projectMarkdowns)
            .leftJoin(projectMarkdownVersions, eq(projectMarkdowns.publishedVersionId, projectMarkdownVersions.id))
            .where(eq(projectMarkdowns.projectId, projectId));

        const results: { slug: string; filename: string; matches: { line: number; text: string }[] }[] = [];
        const isOwner = actorUserId === project.ownerId;
        const term = queryText.trim().toLowerCase();

        if (!term) {
            return { success: true as const, results: [] };
        }

        for (const doc of docs) {
            const settings = normalizeProjectDocSettings(doc.settings);
            const hasPublishedReadme = Boolean(doc.publishedVersionId);
            const permission = resolveProjectDocPermission({
                actorUserId,
                projectVisibility: project.visibility,
                publicTabVisibility: project.publicTabVisibility,
                settings,
                membershipRole: isOwner ? "owner" : membership?.role,
                isOwner,
                isActiveMember: isOwner || Boolean(membership),
                hasPublishedReadme,
            });

            if (!permission.canReadPublished && !permission.canEdit) {
                continue;
            }

            const contentToSearch = (permission.canReadDraft ? doc.draftContent : doc.publishedContent) || "";
            if (!contentToSearch) continue;

            const lines = contentToSearch.split("\n");
            const matches: { line: number; text: string }[] = [];

            lines.forEach((lineText, idx) => {
                if (lineText.toLowerCase().includes(term)) {
                    matches.push({
                        line: idx + 1,
                        text: lineText.trim(),
                    });
                }
            });

            if (matches.length > 0) {
                results.push({
                    slug: doc.slug,
                    filename: doc.filename,
                    matches: matches.slice(0, 100),
                });
            }
        }

        return { success: true as const, results };
    } catch (error) {
        logger.error("project_readme.search_failed", { projectId, queryText, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Failed to perform search." };
    }
}

export async function listProjectMarkdownsAction(projectId: string) {
    try {
        const actorUserId = await getOptionalUserId();
        const [project] = await db
            .select({
                id: projects.id,
                slug: projects.slug,
                ownerId: projects.ownerId,
                visibility: projects.visibility,
                publicTabVisibility: projects.publicTabVisibility,
            })
            .from(projects)
            .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
            .limit(1);
        if (!project) return { success: false as const, error: "Project not found" };

        const membership = actorUserId
            ? await db.query.projectMembers.findFirst({
                where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actorUserId)),
                columns: { role: true },
            })
            : null;

        const docs = await db
            .select({
                id: projectMarkdowns.id,
                slug: projectMarkdowns.slug,
                filename: projectMarkdowns.filename,
                linkedNodeId: projectMarkdowns.linkedNodeId,
                publishedVersionId: projectMarkdowns.publishedVersionId,
                settings: projectMarkdowns.settings,
            })
            .from(projectMarkdowns)
            .where(eq(projectMarkdowns.projectId, projectId));

        const results: { id: string; slug: string; filename: string; linkedNodeId: string | null }[] = [];
        const isOwner = actorUserId === project.ownerId;

        for (const doc of docs) {
            const settings = normalizeProjectDocSettings(doc.settings);
            const hasPublishedReadme = Boolean(doc.publishedVersionId);
            const permission = resolveProjectDocPermission({
                actorUserId,
                projectVisibility: project.visibility,
                publicTabVisibility: project.publicTabVisibility,
                settings,
                membershipRole: isOwner ? "owner" : membership?.role,
                isOwner,
                isActiveMember: isOwner || Boolean(membership),
                hasPublishedReadme,
            });

            if (permission.canReadPublished || permission.canEdit) {
                results.push({
                    id: doc.id,
                    slug: doc.slug,
                    filename: doc.filename,
                    linkedNodeId: doc.linkedNodeId,
                });
            }
        }

        // Sort documents: 'readme' slug first, then alphabetically by filename
        results.sort((a, b) => {
            if (a.slug === "readme") return -1;
            if (b.slug === "readme") return 1;
            return a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base', numeric: true });
        });

        return { success: true as const, markdowns: results };
    } catch (error) {
        logger.error("project_readme.list_markdowns_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Failed to list documents." };
    }
}

const createMarkdownSchema = z.object({
    filename: z.string().min(1).max(100),
    content: z.string().optional().default(""),
});

export async function createProjectMarkdownAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = createMarkdownSchema.parse(input);
        const filename = parsed.filename.trim();
        const slug = normalizeProjectDocSlug(filename, "doc");
        
        const context = await getDocProjectContext(projectId, userId, slug);
        if (!context.permission.canEdit) return { success: false as const, error: "You cannot create documents in this project." };
        
        const readme = await getOrCreateMarkdown(projectId, userId, slug, context.settings);
        
        await db.update(projectMarkdowns)
            .set({ filename })
            .where(eq(projectMarkdowns.id, readme.id));
            
        if (parsed.content) {
            await db.update(projectMarkdowns)
                .set({ draftContent: parsed.content, draftUpdatedAt: new Date() })
                .where(eq(projectMarkdowns.id, readme.id));
        }

        revalidateProjectDoc(context.project);

        return { success: true as const, slug };
    } catch (error) {
        logger.error("project_readme.create_markdown_failed", {
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create document." };
    }
}
