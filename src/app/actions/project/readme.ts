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
    projectNodeEvents,
    projectNodes,
    projectOpenRoles,
    projectReadmeAssets,
    projectReadmeVersions,
    projectReadmes,
    projectReadmeDraftContributors,
    projectSprints,
    projects,
    tasks,
    fileVersions,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { enqueueProjectNotificationEvent } from "@/lib/notifications/project-events";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createUploadIntent, finalizeUploadIntent } from "@/lib/upload/upload-intents";
import { normalizeAndValidateFileSize, normalizeAndValidateMimeType } from "@/lib/upload/security";
import {
    buildProjectReadmePublishMetadata,
    buildProjectReadmeStorageKey,
    DEFAULT_PROJECT_README_SETTINGS,
    PROJECT_README_ALLOWED_IMAGE_MIME_TYPES,
    PROJECT_README_ASSET_BUCKET,
    PROJECT_README_ASSET_MAX_BYTES,
    buildProjectReadmeQualityReport,
    normalizeProjectReadmeContent,
    normalizeProjectReadmeHeadings,
    normalizeProjectReadmeSettings,
    readmeImageExtensionFromMimeType,
    resolveProjectReadmePermission,
    type ProjectReadmeAsset,
    type ProjectReadmeDraftPayload,
    type ProjectReadmePublishedPayload,
    type ProjectReadmeQualityReport,
    type ProjectReadmeSettings,
    type ProjectReadmeVersion,
} from "@/lib/projects/readme";
import { isReadmeLikePath } from "@/lib/projects/readme-create-intent";
import { normalizeProjectPublicTabVisibility } from "@/lib/projects/settings-policies";
import type {
    ProjectReadmeReferenceKind,
    ProjectReadmeReferenceOption,
    ProjectReadmeSmartBlock,
    ProjectReadmeSmartBlockPreview,
} from "@/lib/projects/readme-blocks";
import { parseProjectReadmeSmartBlocks } from "@/lib/projects/readme-blocks";

const PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG = "public-project-detail-shell";
const PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG = "public-project-detail-metadata";
const PROJECT_README_ASSET_ROUTE_PREFIX = "/api/v1/projects";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const profileDisplayNameSql = (userId: unknown) => sql<string | null>`(
    SELECT COALESCE(NULLIF(full_name, ''), NULLIF(username, ''))
    FROM profiles
    WHERE id = ${userId}
    LIMIT 1
)`;

const readmeSettingsSchema = z.object({
    editPolicy: z.enum(["leaders", "members"]).optional(),
    publicVisibility: z.literal("inherit_project").optional(),
    mediaUploads: z.boolean().optional(),
    externalImages: z.boolean().optional(),
    projectBlocks: z.boolean().optional(),
    notifyOnPublish: z.boolean().optional(),
});

const saveDraftSchema = z.object({
    content: z.string(),
    expectedDraftUpdatedAt: z.string().nullable().optional(),
});

const publishSchema = z.object({
    content: z.string().optional(),
    changeSummary: z.string().max(500).nullable().optional(),
    notifyFollowers: z.boolean().optional(),
    expectedDraftUpdatedAt: z.string().nullable().optional(),
    syncToFilesTab: z.boolean().optional().default(true),
});

const uploadUrlSchema = z.object({
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
    query: z.string().max(80).optional(),
    limit: z.number().int().min(1).max(30).optional(),
});

const importReadmeSchema = z.object({
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

function toIso(value: Date | string | null | undefined) {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeStoredQualityReport(value: unknown, fallbackContent: string): ProjectReadmeQualityReport {
    if (value && typeof value === "object") {
        const report = value as Partial<ProjectReadmeQualityReport>;
        if (
            typeof report.score === "number"
            && Array.isArray(report.issues)
            && report.sectionPresence
            && typeof report.sectionPresence === "object"
            && typeof report.contentBytes === "number"
        ) {
            return {
                score: report.score,
                issues: report.issues as ProjectReadmeQualityReport["issues"],
                sectionPresence: report.sectionPresence as Record<string, boolean>,
                contentBytes: report.contentBytes,
            };
        }
    }
    return buildProjectReadmeQualityReport(fallbackContent);
}

function toReadmeVersion(row: (typeof projectReadmeVersions.$inferSelect & { createdByName?: string | null }) | null | undefined, displayVersionNumber?: number, coAuthorsData?: { id: string; name: string; avatarUrl: string | null }[]): ProjectReadmeVersion | null {
    if (!row) return null;
    return {
        id: row.id,
        projectId: row.projectId,
        versionNumber: row.versionNumber,
        displayVersionNumber: displayVersionNumber ?? row.versionNumber,
        content: row.content,
        excerpt: row.excerpt,
        headings: normalizeProjectReadmeHeadings(row.headings),
        qualityReport: normalizeStoredQualityReport(row.qualityReport, row.content),
        contentHash: row.contentHash,
        changeSummary: row.changeSummary,
        coAuthors: coAuthorsData ?? [],
        createdBy: row.createdBy,
        createdByName: row.createdByName ?? null,
        createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
        deletedAt: toIso(row.deletedAt),
    };
}

function toReadmeAsset(row: typeof projectReadmeAssets.$inferSelect): ProjectReadmeAsset {
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

async function getReadmeProjectContext(projectId: string, actorUserId: string | null) {
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
    const readme = await db.query.projectReadmes.findFirst({
        where: eq(projectReadmes.projectId, projectId),
    });
    const settings = normalizeProjectReadmeSettings(readme?.settings);
    const hasPublishedReadme = Boolean(readme?.publishedVersionId);
    const permission = resolveProjectReadmePermission({
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

async function getOrCreateReadme(projectId: string, userId: string, settings: ProjectReadmeSettings = DEFAULT_PROJECT_README_SETTINGS) {
    const existing = await db.query.projectReadmes.findFirst({
        where: eq(projectReadmes.projectId, projectId),
    });
    if (existing) return existing;
    const [created] = await db
        .insert(projectReadmes)
        .values({
            projectId,
            draftContent: "",
            draftUpdatedBy: userId,
            draftUpdatedAt: new Date(),
            settings,
        })
        .returning();
    if (!created) throw new Error("Failed to create README");
    return created;
}

async function readPublishedVersion(versionId: string | null | undefined) {
    if (!versionId) return null;
    return db.query.projectReadmeVersions.findFirst({
        where: and(eq(projectReadmeVersions.id, versionId), isNull(projectReadmeVersions.deletedAt)),
    });
}

function revalidateProjectReadme(project: { id: string; slug: string | null }) {
    const slugOrId = project.slug || project.id;
    revalidatePath(`/projects/${slugOrId}`);
    revalidatePath(`/projects/${slugOrId}?tab=readme`);
    revalidateTag(PUBLIC_PROJECT_DETAIL_SHELL_CACHE_TAG, "max");
    revalidateTag(PUBLIC_PROJECT_DETAIL_METADATA_CACHE_TAG, "max");
}

function extractAssetIdsFromContent(content: string, projectId: string) {
    const escaped = projectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`/api/v1/projects/${escaped}/readme-assets/([a-f0-9-]{36})`, "gi");
    return Array.from(new Set(Array.from(content.matchAll(regex)).map((match) => match[1])));
}

function projectHref(project: { id: string; slug: string | null }, tab: string) {
    return `/projects/${encodeURIComponent(project.slug || project.id)}?tab=${tab}`;
}

function projectTaskHref(project: { id: string; slug: string | null }, taskId: string) {
    return `${projectHref(project, "tasks")}&drawerType=task&drawerId=${encodeURIComponent(taskId)}`;
}

function projectSprintHref(project: { id: string; slug: string | null }, sprintId: string) {
    return `/projects/${encodeURIComponent(project.slug || project.id)}/sprints/${encodeURIComponent(sprintId)}`;
}

function projectFileHref(project: { id: string; slug: string | null }, row: Pick<typeof projectNodes.$inferSelect, "path" | "name">) {
    const path = (row.path || row.name || "")
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join("/");
    return path ? `${projectHref(project, "files")}&path=${path}` : projectHref(project, "files");
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
    kind: ProjectReadmeReferenceKind,
    context: Awaited<ReturnType<typeof getReadmeProjectContext>>,
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

function blockKey(block: Pick<ProjectReadmeSmartBlock, "kind" | "ids" | "index">) {
    return `${block.kind}:${block.ids.join(",")}:${block.index}`;
}

function unavailablePreview(block: Pick<ProjectReadmeSmartBlock, "kind" | "ids" | "index">, description = "This project reference is not available to this viewer."): ProjectReadmeSmartBlockPreview {
    return {
        key: blockKey({ kind: block.kind, ids: block.ids ?? [], index: block.index ?? 0 }),
        kind: block.kind,
        title: block.kind === "unknown" ? "Unknown README block" : "Reference unavailable",
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

function optionFromTask(row: TaskReferenceRow, project: { id: string; slug: string | null }): ProjectReadmeReferenceOption {
    const assignee = truncateReferenceText(row.assigneeName, 40);
    const creator = truncateReferenceText(row.creatorName, 40);
    const assignment = assignee ? `assigned to ${assignee}` : creator ? `created by ${creator}` : "unassigned";
    const priority = row.priority ? `${formatLabel(row.priority)} priority` : null;
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
        href: projectTaskHref(project, row.id),
    };
}

function optionFromSprint(row: typeof projectSprints.$inferSelect, project: { id: string; slug: string | null }): ProjectReadmeReferenceOption {
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

function optionFromFile(row: typeof projectNodes.$inferSelect, project: { id: string; slug: string | null }): ProjectReadmeReferenceOption {
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
        context: [fileType, versions].filter(Boolean).join(" · "),
        href: projectFileHref(project, row),
    };
}

function isReadmeImportCandidate(row: Pick<typeof projectNodes.$inferSelect, "name" | "path" | "mimeType" | "size">) {
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

async function findProjectReadmeNodeByPath(projectId: string, sourcePath: string) {
    const normalizedPath = normalizeReadmeCandidatePath(sourcePath);
    if (!normalizedPath || !isReadmeLikePath(normalizedPath)) return null;
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
    return [exact, ...rows].find((row): row is typeof projectNodes.$inferSelect => Boolean(row && isReadmeImportCandidate(row))) ?? null;
}

function resolveProjectGithubSource(project: Awaited<ReturnType<typeof getReadmeProjectContext>>["project"]) {
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
    project: Awaited<ReturnType<typeof getReadmeProjectContext>>["project"],
    sourcePath: string,
) {
    const normalizedPath = normalizeReadmeCandidatePath(sourcePath);
    if (!normalizedPath || !isReadmeLikePath(normalizedPath)) return null;
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

function optionFromRole(row: typeof projectOpenRoles.$inferSelect, project: { id: string; slug: string | null }): ProjectReadmeReferenceOption {
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
}, project: { id: string; slug: string | null; ownerId?: string | null }): ProjectReadmeReferenceOption {
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

export async function readProjectReadmeAction(projectId: string): Promise<
    | { success: true; data: ProjectReadmePublishedPayload }
    | { success: false; error: string }
> {
    try {
        const actorUserId = await getOptionalUserId();
        const context = await getReadmeProjectContext(projectId, actorUserId);
        if (!context.permission.canReadPublished && !context.permission.canEdit) {
            return { success: false, error: context.permission.reason || "README unavailable" };
        }
        let versionRow = null;
        if (context.readme?.linkedNodeId) {
            const node = await db.query.projectNodes.findFirst({
                where: and(
                    eq(projectNodes.id, context.readme.linkedNodeId),
                    isNull(projectNodes.deletedAt)
                )
            });
            if (node) {
                try {
                    const content = await getProjectFileContent(projectId, node.id);
                    const metadata = buildProjectReadmePublishMetadata(content);
                    versionRow = {
                        id: `linked-${node.id}`,
                        projectId,
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
                await db.update(projectReadmes)
                    .set({ linkedNodeId: null })
                    .where(eq(projectReadmes.id, context.readme.id));
            }
        }

        let normalizedVersion = null;
        if (versionRow) {
            normalizedVersion = toReadmeVersion(versionRow);
        } else {
            const version = await readPublishedVersion(context.readme?.publishedVersionId);
            if (!version && !context.permission.canEdit) {
                return { success: false, error: "README has not been published yet." };
            }
            normalizedVersion = toReadmeVersion(version);
        }
        return {
            success: true,
            data: {
                projectId,
                canEdit: context.permission.canEdit,
                permission: context.permission,
                settings: context.settings,
                version: normalizedVersion,
                smartBlocks: normalizedVersion ? parseProjectReadmeSmartBlocks(normalizedVersion.content) : [],
            },
        };
    } catch (error) {
        logger.error("project_readme.read_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Failed to load README." };
    }
}

export async function readProjectReadmeDraftAction(projectId: string): Promise<
    | { success: true; data: ProjectReadmeDraftPayload }
    | { success: false; error: string }
> {
    try {
        const userId = await requireUserId();
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canReadDraft) return { success: false, error: "You cannot edit this README." };
        const readme = await getOrCreateReadme(projectId, userId, context.settings);
        const published = await readPublishedVersion(readme.publishedVersionId);
        let draftContent = readme.draftContent || "";

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
                    const fileContent = await getProjectFileContent(projectId, node.id);
                    const fileUpdatedAt = node.updatedAt ? new Date(node.updatedAt).getTime() : 0;
                    const draftUpdatedAt = readme.draftUpdatedAt ? new Date(readme.draftUpdatedAt).getTime() : 0;
                    
                    if (fileUpdatedAt > draftUpdatedAt || !readme.draftContent) {
                        draftContent = fileContent;
                        // Auto-sync the draft in database
                        await db.update(projectReadmes)
                            .set({
                                draftContent: fileContent,
                                draftUpdatedAt: node.updatedAt || new Date(),
                            })
                            .where(eq(projectReadmes.id, readme.id));
                    }
                } catch (err) {
                    logger.error("project_readme.fetch_linked_node_content_failed", { projectId, nodeId: node.id, error: err instanceof Error ? err.message : String(err) });
                }
            } else {
                // If it was deleted, detach it!
                await db.update(projectReadmes)
                    .set({ linkedNodeId: null })
                    .where(eq(projectReadmes.id, readme.id));
            }
        }

        return {
            success: true,
            data: {
                projectId,
                permission: context.permission,
                settings: normalizeProjectReadmeSettings(readme.settings),
                draftContent,
                draftUpdatedAt: toIso(readme.draftUpdatedAt),
                publishedVersion: toReadmeVersion(published),
                qualityReport: buildProjectReadmeQualityReport(draftContent),
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
        return { success: false, error: "Failed to load README draft." };
    }
}

export async function saveProjectReadmeDraftAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = saveDraftSchema.parse(input);
        const content = normalizeProjectReadmeContent(parsed.content);
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canEdit) return { success: false as const, error: "You cannot edit this README." };
        const result = await db.transaction(async (tx) => {
            let readme = await tx.query.projectReadmes.findFirst({ where: eq(projectReadmes.projectId, projectId) });
            if (!readme) {
                const [created] = await tx.insert(projectReadmes).values({ projectId, draftContent: "", draftUpdatedBy: userId, draftUpdatedAt: new Date(), settings: context.settings }).returning();
                readme = created;
            }
            const [lockedReadme] = await tx.select().from(projectReadmes).where(eq(projectReadmes.id, readme!.id)).for('update');
            if (!lockedReadme) throw new Error("README not found");

            const currentUpdatedAt = toIso(lockedReadme.draftUpdatedAt);

            if ((lockedReadme.draftContent || "") === content) {
                return {
                    success: true as const,
                    draftUpdatedAt: currentUpdatedAt,
                    qualityReport: buildProjectReadmeQualityReport(content),
                    unchanged: true as const,
                };
            }

            const [updated] = await tx
                .update(projectReadmes)
                .set({
                    draftContent: content,
                    draftUpdatedBy: userId,
                    draftUpdatedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(projectReadmes.id, lockedReadme.id))
                .returning();

            return {
                success: true as const,
                draftUpdatedAt: toIso(updated?.draftUpdatedAt),
                qualityReport: buildProjectReadmeQualityReport(content),
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
        return { success: false as const, error: "Failed to save README draft." };
    }
}

export async function readProjectReadmeImportCandidatesAction(projectId: string, input: unknown): Promise<
    | { success: true; candidates: ProjectReadmeReferenceOption[] }
    | { success: false; error: string }
> {
    try {
        const userId = await requireUserId();
        const parsed = importCandidatesSchema.parse(input);
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canEdit) return { success: false, error: "You cannot import a project README." };

        const query = parsed.query?.trim() || "";
        const like = `%${query.replace(/[%_]/g, "\\$&")}%`;
        const conditions = [eq(projectNodes.projectId, projectId), eq(projectNodes.type, "file"), isNull(projectNodes.deletedAt)];
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

        const rows = await db.query.projectNodes.findMany({
            where: and(...conditions),
            orderBy: [desc(projectNodes.updatedAt)],
            limit: Math.max((parsed.limit ?? 12) * 3, 30),
        });
        const candidates = rows
            .filter(isReadmeImportCandidate)
            .slice(0, parsed.limit ?? 12)
            .map((row) => optionFromFile(row, context.project));

        return { success: true, candidates };
    } catch (error) {
        logger.error("project_readme.import_candidates_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, error: "Failed to load README files." };
    }
}

export async function importProjectReadmeFromFileAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = importReadmeSchema.parse(input);
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canEdit) return { success: false as const, error: "You cannot import a project README." };

        const node = await db.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, parsed.nodeId), eq(projectNodes.projectId, projectId), eq(projectNodes.type, "file"), isNull(projectNodes.deletedAt)),
        });
        if (!node || !isReadmeImportCandidate(node)) return { success: false as const, error: "Select a Markdown or README-like file." };

        const rawContent = await getProjectFileContent(projectId, parsed.nodeId);
        const content = normalizeProjectReadmeContent(rawContent);
        const readme = await getOrCreateReadme(projectId, userId, context.settings);
        const currentUpdatedAt = toIso(readme.draftUpdatedAt);

        let publishedVersion: ProjectReadmeVersion | null = null;
        let updatedDraftAt: string | null = null;

        if (parsed.publish && context.permission.canPublish) {
            const metadata = buildProjectReadmePublishMetadata(content);
            const published = await db.transaction(async (tx) => {
                const now = new Date();
                const [latest] = await tx
                    .select({ value: max(projectReadmeVersions.versionNumber) })
                    .from(projectReadmeVersions)
                    .where(eq(projectReadmeVersions.projectId, projectId));
                const nextVersion = (latest?.value ?? 0) + 1;
                const [version] = await tx
                    .insert(projectReadmeVersions)
                    .values({
                        projectId,
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
                if (!version) throw new Error("Failed to publish README version");

                const [updated] = await tx.update(projectReadmes)
                    .set({
                        draftContent: metadata.content,
                        draftUpdatedBy: userId,
                        draftUpdatedAt: now,
                        publishedVersionId: version.id,
                        updatedAt: now,
                    })
                    .where(eq(projectReadmes.id, readme.id))
                    .returning({ draftUpdatedAt: projectReadmes.draftUpdatedAt });
                updatedDraftAt = toIso(updated?.draftUpdatedAt ?? now);

                const referencedAssetIds = extractAssetIdsFromContent(metadata.content, projectId);
                if (referencedAssetIds.length > 0) {
                    await tx.update(projectReadmeAssets)
                        .set({ status: "published", versionId: version.id })
                        .where(and(eq(projectReadmeAssets.projectId, projectId), inArray(projectReadmeAssets.id, referencedAssetIds as string[])));
                }
                await tx.update(projectReadmeAssets)
                    .set({ status: "orphaned" })
                    .where(and(eq(projectReadmeAssets.projectId, projectId), eq(projectReadmeAssets.status, "draft")));

                await tx.insert(projectNodeEvents).values([
                    {
                        projectId,
                        actorId: userId,
                        type: "project_readme.imported_from_file",
                        metadata: { nodeId: parsed.nodeId, fileName: node.name, published: true },
                    },
                    {
                        projectId,
                        actorId: userId,
                        type: "project_readme.published",
                        metadata: {
                            versionId: version.id,
                            versionNumber: version.versionNumber,
                            changeSummary: `Imported from ${node.name}`,
                            qualityScore: metadata.qualityReport.score,
                            sourceNodeId: parsed.nodeId,
                        },
                    },
                ]);

                return version;
            });
            publishedVersion = toReadmeVersion(published);

            if (context.settings.notifyOnPublish) {
                enqueueProjectNotificationEvent({
                    projectId,
                    actorUserId: userId,
                    eventKey: "readme.published",
                    title: "Project README published",
                    body: metadata.excerpt,
                    href: `/projects/${encodeURIComponent(context.project.slug || context.project.id)}?tab=readme`,
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
            const [updated] = await db.update(projectReadmes)
                .set({
                    draftContent: content,
                    draftUpdatedBy: userId,
                    draftUpdatedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(projectReadmes.id, readme.id))
                .returning();
            updatedDraftAt = toIso(updated?.draftUpdatedAt);

            await db.insert(projectNodeEvents).values({
                projectId,
                actorId: userId,
                type: "project_readme.imported_from_file",
                metadata: {
                    nodeId: parsed.nodeId,
                    fileName: node.name,
                    published: false,
                    publishRequested: Boolean(parsed.publish),
                    publishSkippedReason: parsed.publish ? "permission" : null,
                },
            });
        }

        revalidateProjectReadme(context.project);

        return {
            success: true as const,
            draftContent: content,
            draftUpdatedAt: updatedDraftAt,
            qualityReport: buildProjectReadmeQualityReport(content),
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
        return { success: false as const, error: "Failed to import README from file." };
    }
}

export async function applyProjectReadmeCreationIntentAction(projectId: string, input: unknown): Promise<
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

        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canEdit) {
            return { success: false, error: "You cannot create this README." };
        }

        const readme = await getOrCreateReadme(projectId, userId, context.settings);
        if (readme.publishedVersionId || (readme.draftContent || "").trim().length > 0) {
            return { success: true, status: "skipped", reason: "existing_readme" };
        }

        const sourcePath = normalizeReadmeCandidatePath(parsed.sourcePath);
        let content: string | null = null;
        let source: "starter" | "project_file" | "github" = "starter";
        let sourceFileName: string | null = null;

        if (parsed.mode === "detected") {
            if (sourcePath) {
                const node = await findProjectReadmeNodeByPath(projectId, sourcePath);
                if (node) {
                    content = normalizeProjectReadmeContent(await getProjectFileContent(projectId, node.id));
                    source = "project_file";
                    sourceFileName = node.name;
                } else {
                    const githubContent = await fetchGithubReadmeContentForProject(context.project, sourcePath);
                    if (githubContent) {
                        content = normalizeProjectReadmeContent(githubContent);
                        source = "github";
                        sourceFileName = readmePathBasename(sourcePath);
                    }
                }
            }

            if (!content) {
                return { success: true, status: "not_found", reason: "source_missing" };
            }
        } else {
            content = normalizeProjectReadmeContent(
                parsed.starterContent || `# ${context.project.title || "Project README"}\n\n`
            );
        }

        if (!content.trim()) {
            return { success: true, status: "skipped", reason: "empty_content" };
        }

        const now = new Date();
        const [updated] = await db.update(projectReadmes)
            .set({
                draftContent: content,
                draftUpdatedBy: userId,
                draftUpdatedAt: now,
                updatedAt: now,
            })
            .where(eq(projectReadmes.id, readme.id))
            .returning();

        await db.insert(projectNodeEvents).values({
            projectId,
            actorId: userId,
            type: "project_readme.created_from_project_creation",
            metadata: {
                mode: parsed.mode,
                source,
                sourcePath: sourcePath || null,
                sourceFileName,
                // Creation prepares a private draft only; publishing stays explicit.
                publishOnCreateRequested: Boolean(parsed.publishOnCreate),
            },
        }).catch((error) => {
            logger.warn("project_readme.creation_event_failed", {
                module: "projects",
                projectId,
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
        });

        revalidateProjectReadme(context.project);

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
        return { success: false, error: "Failed to prepare project README." };
    }
}

export async function registerReadmeContributorAction(projectId: string) {
    try {
        const userId = await requireUserId();
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canEdit) return { success: false as const, error: "Unauthorized" };

        await db.insert(projectReadmeDraftContributors)
            .values({ projectId, userId, lastContributedAt: new Date() })
            .onConflictDoUpdate({
                target: [projectReadmeDraftContributors.projectId, projectReadmeDraftContributors.userId],
                set: { lastContributedAt: new Date() }
            });

        return { success: true as const };
    } catch (error) {
        // Silently fail, it's just telemetry
        return { success: false as const, error: "Failed to register contributor" };
    }
}

export async function getReadmeDraftContributorsAction(projectId: string) {
    try {
        const userId = await requireUserId();
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canEdit) return { success: false as const, error: "Unauthorized" };

        const contributors = await db.query.projectReadmeDraftContributors.findMany({
            where: eq(projectReadmeDraftContributors.projectId, projectId),
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

export async function publishProjectReadmeAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = publishSchema.parse(input);
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canPublish) return { success: false as const, error: "Only project leaders can publish the README." };
        const published = await db.transaction(async (tx) => {
            let readme = await tx.query.projectReadmes.findFirst({ where: eq(projectReadmes.projectId, projectId) });
            if (!readme) {
                const [created] = await tx.insert(projectReadmes).values({ projectId, draftContent: "", draftUpdatedBy: userId, draftUpdatedAt: new Date(), settings: context.settings }).returning();
                readme = created;
            }
            const [lockedReadme] = await tx.select().from(projectReadmes).where(eq(projectReadmes.id, readme!.id)).for('update');
            if (!lockedReadme) throw new Error("README not found");

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
                    await tx.update(projectReadmes)
                        .set({ linkedNodeId: null })
                        .where(eq(projectReadmes.id, lockedReadme.id));
                }
            }

            const currentUpdatedAt = toIso(lockedReadme.draftUpdatedAt);

            const metadata = buildProjectReadmePublishMetadata(parsed.content ?? lockedReadme.draftContent ?? "");
            
            const [latest] = await tx
                .select({ value: max(projectReadmeVersions.versionNumber) })
                .from(projectReadmeVersions)
                .where(eq(projectReadmeVersions.projectId, projectId));
            const latestVersion = lockedReadme.publishedVersionId
                ? await tx.query.projectReadmeVersions.findFirst({
                    where: and(eq(projectReadmeVersions.id, lockedReadme.publishedVersionId), isNull(projectReadmeVersions.deletedAt)),
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
                .select({ userId: projectReadmeDraftContributors.userId })
                .from(projectReadmeDraftContributors)
                .where(eq(projectReadmeDraftContributors.projectId, projectId));
            const coAuthors = contributors.map(c => c.userId);

            const [version] = await tx
                .insert(projectReadmeVersions)
                .values({
                    projectId,
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
            if (!version) throw new Error("Failed to publish README version");

            // Clear contributors after publish
            await tx.delete(projectReadmeDraftContributors)
                .where(eq(projectReadmeDraftContributors.projectId, projectId));

            await tx.update(projectReadmes)
                .set({
                    draftContent: metadata.content,
                    draftUpdatedBy: userId,
                    draftUpdatedAt: new Date(),
                    publishedVersionId: version.id,
                    updatedAt: new Date(),
                })
                .where(eq(projectReadmes.id, lockedReadme.id));
            const referencedAssetIds = extractAssetIdsFromContent(metadata.content, projectId);
            if (referencedAssetIds.length > 0) {
                await tx.update(projectReadmeAssets)
                    .set({ status: "published", versionId: version.id })
                    .where(and(eq(projectReadmeAssets.projectId, projectId), inArray(projectReadmeAssets.id, referencedAssetIds as string[])));
            }
            await tx.update(projectReadmeAssets)
                .set({ status: "orphaned" })
                .where(and(eq(projectReadmeAssets.projectId, projectId), eq(projectReadmeAssets.status, "draft")));
            await tx.insert(projectNodeEvents).values({
                projectId,
                actorId: userId,
                type: "project_readme.published",
                metadata: {
                    versionId: version.id,
                    versionNumber: version.versionNumber,
                    changeSummary: parsed.changeSummary?.trim() || null,
                    qualityScore: metadata.qualityReport.score,
                },
            });
            return {
                success: true as const,
                version,
                metadata,
                coAuthors,
                linkedNode: activeLinkedNode ? {
                    id: activeLinkedNode.id,
                    name: activeLinkedNode.name,
                    path: activeLinkedNode.path,
                    s3Key: activeLinkedNode.s3Key,
                } : null
            };
        });

        const { version, metadata, coAuthors, linkedNode } = published;

        // Files Tab Sync
        if (parsed.syncToFilesTab) {
            try {
                const supabase = await createAdminClient();
                const targetS3Key = linkedNode?.s3Key || `${projectId}/README.md`;
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
                                    eq(projectNodes.name, 'README.md'),
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
                                name: linkedNode?.name || 'README.md',
                                path: linkedNode?.path || 'README.md',
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
                            comment: parsed.changeSummary?.trim() || 'Published from README tab',
                        });
                    });
                }
            } catch (error) {
                logger.error("project_readme.files_sync_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
            }
        }

        revalidateProjectReadme(context.project);
        if (metadata && (context.settings.notifyOnPublish || parsed.notifyFollowers)) {
            enqueueProjectNotificationEvent({
                projectId,
                actorUserId: userId,
                eventKey: "readme.published",
                title: "Project README published",
                body: metadata.excerpt,
                href: `/projects/${encodeURIComponent(context.project.slug || context.project.id)}?tab=readme`,
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
        
        return { success: true as const, version: toReadmeVersion({ ...version, createdByName }) };
    } catch (error) {
        logger.error("project_readme.publish_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to publish README." };
    }
}

export async function restoreProjectReadmeVersionAction(projectId: string, versionId: string) {
    try {
        const userId = await requireUserId();
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canEdit) return { success: false as const, error: "You cannot edit this README." };
        const version = await db.query.projectReadmeVersions.findFirst({
            where: and(eq(projectReadmeVersions.id, versionId), eq(projectReadmeVersions.projectId, projectId), isNull(projectReadmeVersions.deletedAt)),
        });
        if (!version) return { success: false as const, error: "README version not found." };
        const readme = await getOrCreateReadme(projectId, userId, context.settings);
        const [updated] = await db.update(projectReadmes)
            .set({
                draftContent: version.content,
                draftUpdatedBy: userId,
                draftUpdatedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(projectReadmes.id, readme.id))
            .returning();
        await db.insert(projectNodeEvents).values({
            projectId,
            actorId: userId,
            type: "project_readme.version_restored_to_draft",
            metadata: { versionId, versionNumber: version.versionNumber },
        });
        return {
            success: true as const,
            draftContent: version.content,
            draftUpdatedAt: toIso(updated?.draftUpdatedAt),
            qualityReport: buildProjectReadmeQualityReport(version.content),
        };
    } catch (error) {
        logger.error("project_readme.restore_failed", {
            module: "projects",
            projectId,
            versionId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to restore README version." };
    }
}

export async function setProjectReadmePublishedVersionAction(projectId: string, versionId: string) {
    try {
        const userId = await requireUserId();
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canPublish) return { success: false as const, error: "Only project leaders can set the current README version." };

        const result = await db.transaction(async (tx) => {
            const version = await tx.query.projectReadmeVersions.findFirst({
                where: and(eq(projectReadmeVersions.id, versionId), eq(projectReadmeVersions.projectId, projectId), isNull(projectReadmeVersions.deletedAt)),
            });
            if (!version) return null;
            const existingReadme = await tx.query.projectReadmes.findFirst({
                where: eq(projectReadmes.projectId, projectId),
            });
            const readme = existingReadme ?? (await tx.insert(projectReadmes)
                .values({
                    projectId,
                    draftContent: "",
                    draftUpdatedBy: userId,
                    draftUpdatedAt: new Date(),
                    settings: context.settings,
                })
                .returning())[0];
            if (!readme) throw new Error("Failed to create README");
            const [updated] = await tx.update(projectReadmes)
                .set({
                    draftContent: version.content,
                    draftUpdatedBy: userId,
                    draftUpdatedAt: new Date(),
                    publishedVersionId: version.id,
                    updatedAt: new Date(),
                })
                .where(eq(projectReadmes.id, readme.id))
                .returning();
            await tx.insert(projectNodeEvents).values({
                projectId,
                actorId: userId,
                type: "project_readme.version_set_current",
                metadata: { versionId, versionNumber: version.versionNumber },
            });
            return { version, updated };
        });

        if (!result) return { success: false as const, error: "README version not found." };
        revalidateProjectReadme(context.project);
        return {
            success: true as const,
            version: toReadmeVersion(result.version),
            draftContent: result.version.content,
            draftUpdatedAt: toIso(result.updated?.draftUpdatedAt),
            qualityReport: buildProjectReadmeQualityReport(result.version.content),
        };
    } catch (error) {
        logger.error("project_readme.set_current_failed", {
            module: "projects",
            projectId,
            versionId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to set current README version." };
    }
}

export async function deleteProjectReadmeVersionAction(projectId: string, versionId: string) {
    try {
        const userId = await requireUserId();
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canPublish) return { success: false as const, error: "Only project leaders can delete README versions." };

        const result = await db.transaction(async (tx) => {
            const readme = await tx.query.projectReadmes.findFirst({ where: eq(projectReadmes.projectId, projectId) });
            const version = await tx.query.projectReadmeVersions.findFirst({
                where: and(eq(projectReadmeVersions.id, versionId), eq(projectReadmeVersions.projectId, projectId), isNull(projectReadmeVersions.deletedAt)),
            });
            if (!readme || !version) return null;

            await tx.update(projectReadmeVersions)
                .set({ deletedAt: new Date() })
                .where(eq(projectReadmeVersions.id, version.id));

            let replacement: typeof projectReadmeVersions.$inferSelect | null = null;
            let updatedDraftAt: Date | string | null | undefined = readme.draftUpdatedAt;
            if (readme.publishedVersionId === version.id) {
                replacement = await tx.query.projectReadmeVersions.findFirst({
                    where: and(eq(projectReadmeVersions.projectId, projectId), isNull(projectReadmeVersions.deletedAt)),
                    orderBy: [desc(projectReadmeVersions.versionNumber)],
                }) ?? null;
                const [updated] = await tx.update(projectReadmes)
                    .set({
                        publishedVersionId: replacement?.id ?? null,
                        draftContent: replacement?.content ?? readme.draftContent,
                        draftUpdatedBy: replacement ? userId : readme.draftUpdatedBy,
                        draftUpdatedAt: replacement ? new Date() : readme.draftUpdatedAt,
                        updatedAt: new Date(),
                    })
                    .where(eq(projectReadmes.id, readme.id))
                    .returning();
                updatedDraftAt = updated?.draftUpdatedAt;
            }

            await tx.insert(projectNodeEvents).values({
                projectId,
                actorId: userId,
                type: "project_readme.version_deleted",
                metadata: {
                    versionId: version.id,
                    versionNumber: version.versionNumber,
                    replacedPublishedVersionId: replacement?.id ?? null,
                },
            });

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

        if (!result) return { success: false as const, error: "README version not found." };
        revalidateProjectReadme(context.project);
        return {
            success: true as const,
            deletedVersionId: result.deleted.id,
            publishedVersion: toReadmeVersion(result.replacement),
            draftContent: result.replacement?.content ?? null,
            draftUpdatedAt: toIso(result.draftUpdatedAt),
            qualityReport: buildProjectReadmeQualityReport(result.replacement?.content ?? ""),
        };
    } catch (error) {
        logger.error("project_readme.delete_version_failed", {
            module: "projects",
            projectId,
            versionId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to delete README version." };
    }
}

export async function discardProjectReadmeDraftAction(projectId: string) {
    try {
        const userId = await requireUserId();
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canEdit) return { success: false as const, error: "You cannot edit this README." };
        const readme = await getOrCreateReadme(projectId, userId, context.settings);
        const published = await readPublishedVersion(readme.publishedVersionId);
        const nextContent = published?.content ?? "";
        const [updated] = await db.update(projectReadmes)
            .set({
                draftContent: nextContent,
                draftUpdatedBy: userId,
                draftUpdatedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(projectReadmes.id, readme.id))
            .returning();
        await db.insert(projectNodeEvents).values({
            projectId,
            actorId: userId,
            type: "project_readme.draft_discarded",
            metadata: { restoredPublishedVersionId: published?.id ?? null },
        });
        return {
            success: true as const,
            draftContent: nextContent,
            draftUpdatedAt: toIso(updated?.draftUpdatedAt),
            qualityReport: buildProjectReadmeQualityReport(nextContent),
        };
    } catch (error) {
        logger.error("project_readme.discard_draft_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to discard README draft." };
    }
}

export async function listProjectReadmeVersionsAction(projectId: string, cursor?: string | null) {
    try {
        const actorUserId = await getOptionalUserId();
        const context = await getReadmeProjectContext(projectId, actorUserId);
        if (!context.permission.canReadPublished && !context.permission.canEdit) return { success: false as const, error: "README unavailable." };
        const cursorDate = cursor ? new Date(cursor) : null;
        const versionConditions = [
            eq(projectReadmeVersions.projectId, projectId),
            isNull(projectReadmeVersions.deletedAt),
        ];
        if (cursorDate && !Number.isNaN(cursorDate.getTime())) {
            versionConditions.push(lt(projectReadmeVersions.createdAt, cursorDate));
        }
        const rows = await db.query.projectReadmeVersions.findMany({
            where: and(...versionConditions),
            orderBy: [desc(projectReadmeVersions.createdAt), desc(projectReadmeVersions.versionNumber)],
            limit: 21,
            extras: {
                createdByName: profileDisplayNameSql(projectReadmeVersions.createdBy).as("createdByName"),
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
                return toReadmeVersion(row, row.versionNumber, coAuthorsData)!;
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
        return { success: false as const, error: "Failed to load README versions." };
    }
}

export async function validateProjectReadmeAction(projectId: string, content: unknown) {
    try {
        const userId = await requireUserId();
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canEdit) return { success: false as const, error: "You cannot validate this README." };
        const normalized = normalizeProjectReadmeContent(content);
        return {
            success: true as const,
            qualityReport: buildProjectReadmeQualityReport(normalized),
            headings: buildProjectReadmePublishMetadata(normalized).headings,
        };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to validate README." };
    }
}

export async function readProjectReadmeReferenceOptionsAction(projectId: string, input: unknown): Promise<
    | { success: true; options: ProjectReadmeReferenceOption[] }
    | { success: false; error: string }
> {
    try {
        const userId = await requireUserId();
        const parsed = referenceOptionsSchema.parse(input);
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canEdit) return { success: false, error: "You cannot insert README project references." };

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
        return { success: false, error: "Failed to load README references." };
    }
}

export async function readProjectReadmeSmartBlockPreviewsAction(projectId: string, input: unknown): Promise<
    | { success: true; previews: ProjectReadmeSmartBlockPreview[] }
    | { success: false; error: string }
> {
    try {
        const actorUserId = await getOptionalUserId();
        const parsed = smartBlockPreviewSchema.parse(input);
        const context = await getReadmeProjectContext(projectId, actorUserId);
        if (!context.permission.canReadPublished && !context.permission.canEdit) {
            return { success: false, error: "README references unavailable." };
        }

        const normalizedBlocks = parsed.map((block, index) => ({
            kind: block.kind,
            ids: (block.ids ?? []).filter((id) => UUID_RE.test(id)).slice(0, 12),
            index: block.index ?? index,
        }));
        const readableKinds = new Set<ProjectReadmeReferenceKind>();
        const idsByKind = new Map<ProjectReadmeReferenceKind, Set<string>>();
        const needsRecent = new Set<ProjectReadmeReferenceKind>();

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

        const tasksById = new Map<string, ProjectReadmeReferenceOption>();
        let recentTasks: ProjectReadmeReferenceOption[] = [];
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

        const sprintsById = new Map<string, ProjectReadmeReferenceOption>();
        let recentSprints: ProjectReadmeReferenceOption[] = [];
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

        const filesById = new Map<string, ProjectReadmeReferenceOption>();
        let recentFiles: ProjectReadmeReferenceOption[] = [];
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

        const rolesById = new Map<string, ProjectReadmeReferenceOption>();
        let recentRoles: ProjectReadmeReferenceOption[] = [];
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

        const contributorsById = new Map<string, ProjectReadmeReferenceOption>();
        let recentContributors: ProjectReadmeReferenceOption[] = [];
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

        const previewFor = (block: (typeof normalizedBlocks)[number]): ProjectReadmeSmartBlockPreview => {
            if (block.kind === "unknown") return unavailablePreview(block, "This README block is not recognized.");
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
            const items = block.ids.length ? block.ids.map((id) => byId.get(id)).filter((item): item is ProjectReadmeReferenceOption => Boolean(item)) : recent;

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
                    ? "Selected project context from this README."
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
        return { success: false, error: "Failed to load README project references." };
    }
}

export async function createProjectReadmeAssetUploadUrlAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = uploadUrlSchema.parse(input);
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canManageAssets) return { success: false as const, error: "README media uploads are not available." };
        const { allowed } = await consumeRateLimit(`upload:project-readme-asset:user:${userId}`, 20, 60 * 60);
        if (!allowed) return { success: false as const, error: "Too many README image upload attempts. Please try again later." };
        const mimeType = normalizeAndValidateMimeType(parsed.mimeType);
        if (!PROJECT_README_ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
            return { success: false as const, error: "Unsupported image type. Use JPG, PNG, WebP, or GIF." };
        }
        const sizeBytes = normalizeAndValidateFileSize(parsed.sizeBytes, PROJECT_README_ASSET_MAX_BYTES, "README image");
        const storageKey = buildProjectReadmeStorageKey(projectId, userId, readmeImageExtensionFromMimeType(mimeType));
        const intent = await createUploadIntent({
            userId,
            projectId,
            bucket: PROJECT_README_ASSET_BUCKET,
            storageKey,
            scope: "project_file",
            kind: "file",
            expectedMimeType: mimeType,
            expectedSize: sizeBytes,
            metadata: { kind: "project_readme_asset", altText: parsed.altText ?? null },
        });
        const admin = await createAdminClient();
        const { data, error } = await admin.storage.from(PROJECT_README_ASSET_BUCKET).createSignedUploadUrl(storageKey, { upsert: false });
        if (error || !data?.signedUrl || !data?.token) {
            return { success: false as const, error: "Failed to prepare README image upload." };
        }
        return {
            success: true as const,
            uploadUrl: data.signedUrl,
            uploadToken: data.token,
            uploadIntentId: intent.id,
            storagePath: storageKey,
            bucket: PROJECT_README_ASSET_BUCKET,
            contentType: mimeType,
        };
    } catch (error) {
        logger.error("project_readme.asset_upload_url_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to prepare README image upload." };
    }
}

export async function finalizeProjectReadmeAssetUploadAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = z.object({
            uploadIntentId: z.string().uuid(),
            altText: z.string().max(240).nullable().optional(),
            width: z.number().int().positive().nullable().optional(),
            height: z.number().int().positive().nullable().optional(),
        }).parse(input);
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canManageAssets) return { success: false as const, error: "README media uploads are not available." };
        const intent = await finalizeUploadIntent({
            intentId: parsed.uploadIntentId,
            bucket: PROJECT_README_ASSET_BUCKET,
            userId,
            projectId,
            expectedScope: "project_file",
            expectedKind: "file",
        });
        const [asset] = await db.insert(projectReadmeAssets).values({
            projectId,
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
        if (!asset) return { success: false as const, error: "Failed to finalize README image." };
        return {
            success: true as const,
            asset: toReadmeAsset(asset),
            markdown: `![${asset.altText || "Project image"}](${PROJECT_README_ASSET_ROUTE_PREFIX}/${projectId}/readme-assets/${asset.id})`,
        };
    } catch (error) {
        logger.error("project_readme.asset_finalize_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to finalize README image." };
    }
}

export async function deleteProjectReadmeAssetAction(projectId: string, assetId: string) {
    try {
        const userId = await requireUserId();
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canManageAssets) return { success: false as const, error: "You cannot manage README assets." };
        const [asset] = await db.update(projectReadmeAssets)
            .set({ deletedAt: new Date(), status: "orphaned" })
            .where(and(eq(projectReadmeAssets.projectId, projectId), eq(projectReadmeAssets.id, assetId), isNull(projectReadmeAssets.deletedAt)))
            .returning();
        if (!asset) return { success: false as const, error: "README asset not found." };
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
        return { success: false as const, error: "Failed to delete README asset." };
    }
}

export async function readProjectReadmeSettingsAction(projectId: string) {
    try {
        const userId = await requireUserId();
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canManageSettings) return { success: false as const, error: "You cannot manage README settings." };
        return { success: true as const, settings: context.settings, permission: context.permission };
    } catch (error) {
        return { success: false as const, error: "Failed to load README settings." };
    }
}

export async function updateProjectReadmeSettingsAction(projectId: string, input: unknown) {
    try {
        const userId = await requireUserId();
        const parsed = readmeSettingsSchema.parse(input);
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canManageSettings) return { success: false as const, error: "You cannot manage README settings." };
        const readme = await getOrCreateReadme(projectId, userId, context.settings);
        const nextSettings = normalizeProjectReadmeSettings({ ...context.settings, ...parsed });
        const [updated] = await db.update(projectReadmes)
            .set({ settings: nextSettings, updatedAt: new Date() })
            .where(eq(projectReadmes.id, readme.id))
            .returning();
        await db.insert(projectNodeEvents).values({
            projectId,
            actorId: userId,
            type: "project_readme.settings_updated",
            metadata: { settings: nextSettings },
        });
        revalidateProjectReadme(context.project);
        return { success: true as const, settings: normalizeProjectReadmeSettings(updated?.settings) };
    } catch (error) {
        logger.error("project_readme.settings_update_failed", {
            module: "projects",
            projectId,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to update README settings." };
    }
}

export async function linkProjectReadmeAction(projectId: string, nodeId: string) {
    try {
        const userId = await requireUserId();
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canEdit) {
            return { success: false as const, error: "Only project members can link a README file." };
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
            let readme = await tx.query.projectReadmes.findFirst({
                where: eq(projectReadmes.projectId, projectId)
            });

            if (!readme) {
                await tx.insert(projectReadmes).values({
                    projectId,
                    linkedNodeId: nodeId,
                    draftContent: "",
                    draftUpdatedBy: userId,
                    draftUpdatedAt: new Date(),
                    settings: context.settings,
                });
            } else {
                await tx.update(projectReadmes)
                    .set({
                        linkedNodeId: nodeId,
                        draftUpdatedBy: userId,
                        draftUpdatedAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .where(eq(projectReadmes.projectId, projectId));
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

export async function unlinkProjectReadmeAction(projectId: string) {
    try {
        const userId = await requireUserId();
        const context = await getReadmeProjectContext(projectId, userId);
        if (!context.permission.canEdit) {
            return { success: false as const, error: "Only project members can unlink a README file." };
        }

        await db.update(projectReadmes)
            .set({
                linkedNodeId: null,
                draftUpdatedBy: userId,
                draftUpdatedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(projectReadmes.projectId, projectId));

        revalidatePath(`/projects/${context.project.slug}/readme`);
        revalidatePath(`/projects/${context.project.slug}/files`);

        return { success: true as const };
    } catch (error) {
        logger.error("project_readme.unlink_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Internal server error." };
    }
}
