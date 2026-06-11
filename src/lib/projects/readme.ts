import { createHash, randomUUID } from "crypto";
import { normalizeProjectPublicTabVisibility, normalizeProjectMemberRole, type ProjectPublicTabVisibility } from "@/lib/projects/settings-policies";
import { normalizeProjectVisibility } from "@/lib/projects/project-visibility";
import { evaluateProjectReadmeQuality } from "@/lib/projects/readme-quality";
import { parseProjectReadmeSmartBlocks, type ProjectReadmeSmartBlock } from "@/lib/projects/readme-blocks";
import { buildProjectReadmePlainText } from "@/lib/projects/readme-plain-text";
import { extractProjectReadmeHeadings, type ProjectReadmeHeading } from "@/lib/projects/readme-headings";

export { buildProjectReadmePlainText, decodeProjectReadmeHtmlEntities } from "@/lib/projects/readme-plain-text";
export { extractProjectReadmeHeadings, slugifyReadmeHeading, type ProjectReadmeHeading } from "@/lib/projects/readme-headings";

export type ProjectReadmeEditPolicy = "leaders" | "members";
export type ProjectReadmePublicVisibility = "inherit_project";
export type ProjectReadmeAssetStatus = "draft" | "published" | "orphaned";

export type ProjectReadmeSettings = {
    version: 1;
    editPolicy: ProjectReadmeEditPolicy;
    publicVisibility: ProjectReadmePublicVisibility;
    mediaUploads: boolean;
    externalImages: boolean;
    projectBlocks: boolean;
    notifyOnPublish: boolean;
};

export type ProjectReadmeQualityIssue = {
    id: string;
    severity: "info" | "warning" | "error";
    label: string;
    description: string;
};

export type ProjectReadmeQualityReport = {
    score: number;
    issues: ProjectReadmeQualityIssue[];
    sectionPresence: Record<string, boolean>;
    contentBytes: number;
};

export type ProjectReadmePermission = {
    canReadPublished: boolean;
    canReadDraft: boolean;
    canEdit: boolean;
    canPublish: boolean;
    canManageSettings: boolean;
    canManageAssets: boolean;
    accessLevel: "public" | "viewer" | "member" | "co_leader" | "owner" | "none";
    reason?: string | null;
};

export type ProjectReadme = {
    id: string;
    projectId: string;
    draftContent: string;
    draftUpdatedBy: string | null;
    draftUpdatedAt: string | null;
    publishedVersionId: string | null;
    settings: ProjectReadmeSettings;
    createdAt: string;
    updatedAt: string;
};

export type ProjectReadmeVersion = {
    id: string;
    projectId: string;
    versionNumber: number;
    displayVersionNumber: number;
    content: string;
    excerpt: string | null;
    headings: ProjectReadmeHeading[];
    qualityReport: ProjectReadmeQualityReport;
    contentHash: string;
    changeSummary: string | null;
    coAuthors: { id: string; name: string; avatarUrl: string | null }[];
    createdBy: string | null;
    createdByName: string | null;
    createdAt: string;
    deletedAt: string | null;
};

export type ProjectReadmeAsset = {
    id: string;
    projectId: string;
    versionId: string | null;
    bucket: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    altText: string | null;
    status: ProjectReadmeAssetStatus;
    createdBy: string | null;
    createdAt: string;
    deletedAt: string | null;
};

export type ProjectReadmePublishedPayload = {
    projectId: string;
    canEdit: boolean;
    permission: ProjectReadmePermission;
    settings: ProjectReadmeSettings;
    version: ProjectReadmeVersion | null;
    smartBlocks: ProjectReadmeSmartBlock[];
};

export type ProjectReadmeDraftPayload = {
    projectId: string;
    permission: ProjectReadmePermission;
    settings: ProjectReadmeSettings;
    draftContent: string;
    draftUpdatedAt: string | null;
    publishedVersion: ProjectReadmeVersion | null;
    qualityReport: ProjectReadmeQualityReport;
    linkedNodeId?: string | null;
    linkedNode?: { id: string; name: string; path: string; s3Key: string } | null;
};

export const PROJECT_README_MAX_CONTENT_BYTES = 500 * 1024;
export const PROJECT_README_ASSET_MAX_BYTES = 5 * 1024 * 1024;
export const PROJECT_README_ASSET_BUCKET = "project-files";
export const PROJECT_README_ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export const DEFAULT_PROJECT_README_SETTINGS: ProjectReadmeSettings = {
    version: 1,
    editPolicy: "leaders",
    publicVisibility: "inherit_project",
    mediaUploads: true,
    externalImages: false,
    projectBlocks: true,
    notifyOnPublish: false,
};

export function normalizeProjectReadmeSettings(value: unknown): ProjectReadmeSettings {
    const source = value && typeof value === "object" ? value as Partial<ProjectReadmeSettings> : {};
    return {
        version: 1,
        editPolicy: source.editPolicy === "members" ? "members" : "leaders",
        publicVisibility: "inherit_project",
        mediaUploads: typeof source.mediaUploads === "boolean" ? source.mediaUploads : DEFAULT_PROJECT_README_SETTINGS.mediaUploads,
        externalImages: typeof source.externalImages === "boolean" ? source.externalImages : DEFAULT_PROJECT_README_SETTINGS.externalImages,
        projectBlocks: typeof source.projectBlocks === "boolean" ? source.projectBlocks : DEFAULT_PROJECT_README_SETTINGS.projectBlocks,
        notifyOnPublish: typeof source.notifyOnPublish === "boolean" ? source.notifyOnPublish : DEFAULT_PROJECT_README_SETTINGS.notifyOnPublish,
    };
}

export function normalizeProjectReadmeContent(content: unknown) {
    const value = typeof content === "string" ? content.replace(/\r\n?/g, "\n") : "";
    return value.length > PROJECT_README_MAX_CONTENT_BYTES ? value.slice(0, PROJECT_README_MAX_CONTENT_BYTES) : value;
}

export function assertProjectReadmeContentSize(content: string) {
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > PROJECT_README_MAX_CONTENT_BYTES) {
        throw new Error("README content is too large. Keep it under 500 KiB.");
    }
}

export function hashProjectReadmeContent(content: string) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}

export function buildProjectReadmeStorageKey(projectId: string, userId: string, extension: string) {
    const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
    return `projects/${projectId}/readme-assets/${userId}/${Date.now()}-${randomUUID()}.${safeExtension}`;
}

export function readmeImageExtensionFromMimeType(mimeType: string) {
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

export function buildProjectReadmeExcerpt(content: string, maxLength = 220) {
    return buildProjectReadmePlainText(content, { maxLength });
}

export function normalizeProjectReadmeHeadings(value: unknown): ProjectReadmeHeading[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            if (!item || typeof item !== "object") return null;
            const source = item as Partial<ProjectReadmeHeading>;
            const id = typeof source.id === "string" ? source.id : "";
            const text = typeof source.text === "string" ? source.text : "";
            const level = Number(source.level);
            if (!id || !text || !Number.isFinite(level)) return null;
            return { id, text, level: Math.min(4, Math.max(1, Math.trunc(level))) };
        })
        .filter((item): item is ProjectReadmeHeading => Boolean(item));
}

export function buildProjectReadmeQualityReport(content: string): ProjectReadmeQualityReport {
    return evaluateProjectReadmeQuality(content);
}

export function buildProjectReadmePublishMetadata(content: string) {
    const normalized = normalizeProjectReadmeContent(content);
    assertProjectReadmeContentSize(normalized);
    return {
        content: normalized,
        headings: extractProjectReadmeHeadings(normalized),
        excerpt: buildProjectReadmeExcerpt(normalized),
        qualityReport: buildProjectReadmeQualityReport(normalized),
        contentHash: hashProjectReadmeContent(normalized),
        smartBlocks: parseProjectReadmeSmartBlocks(normalized),
    };
}

export function resolveProjectReadmePermission(input: {
    actorUserId?: string | null;
    projectVisibility?: unknown;
    publicTabVisibility?: unknown;
    settings?: unknown;
    membershipRole?: unknown;
    isOwner?: boolean;
    isActiveMember?: boolean;
    hasPublishedReadme?: boolean;
}) : ProjectReadmePermission {
    const settings = normalizeProjectReadmeSettings(input.settings);
    const visibility = normalizeProjectVisibility(input.projectVisibility);
    const publicTabs = normalizeProjectPublicTabVisibility(input.publicTabVisibility);
    const isActiveMember = Boolean(input.isActiveMember || input.isOwner);
    const role = isActiveMember
        ? normalizeProjectMemberRole(input.membershipRole, input.isOwner ? "owner" : "member")
        : null;
    const isOwner = Boolean(input.isOwner) || role === "owner";
    const isCoLeader = role === "admin";
    const isMember = isActiveMember || isOwner || isCoLeader || role === "member" || role === "viewer";
    const isPublishedPublic = visibility === "public" && publicTabs.readme && Boolean(input.hasPublishedReadme);
    const canReadPublished = isMember || isPublishedPublic;
    const canReadDraft = isOwner || isCoLeader || (role === "member" && settings.editPolicy === "members");
    const canEdit = canReadDraft;
    const canPublish = canEdit;
    const canManageSettings = isOwner || isCoLeader;
    const canManageAssets = canEdit && settings.mediaUploads;
    const accessLevel: ProjectReadmePermission["accessLevel"] = isOwner
        ? "owner"
        : isCoLeader
            ? "co_leader"
            : role === "member"
                ? "member"
                : role === "viewer"
                    ? "viewer"
                    : isPublishedPublic
                        ? "public"
                        : "none";
    return {
        canReadPublished,
        canReadDraft,
        canEdit,
        canPublish,
        canManageSettings,
        canManageAssets,
        accessLevel,
        reason: canReadPublished || canReadDraft ? null : "README is not available for this viewer.",
    };
}
