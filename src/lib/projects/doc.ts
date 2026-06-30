import { createHash, randomUUID } from "crypto";
import { normalizeProjectPublicTabVisibility, normalizeProjectMemberRole, type ProjectPublicTabVisibility } from "@/lib/projects/settings-policies";
import { normalizeProjectVisibility } from "@/lib/projects/project-visibility";
import { evaluateProjectDocQuality } from "@/lib/projects/doc-quality";
import { parseProjectDocSmartBlocks, type ProjectDocSmartBlock } from "@/lib/projects/doc-blocks";
import { buildProjectDocPlainText } from "@/lib/projects/doc-plain-text";
import { extractProjectDocHeadings, type ProjectDocHeading } from "@/lib/projects/doc-headings";

export { buildProjectDocPlainText, decodeProjectDocHtmlEntities } from "@/lib/projects/doc-plain-text";
export { extractProjectDocHeadings, slugifyReadmeHeading, type ProjectDocHeading } from "@/lib/projects/doc-headings";

export type ProjectDocEditPolicy = "leaders" | "members";
export type ProjectDocPublicVisibility = "inherit_project";
export type ProjectDocVisibilityOverride = "inherit_project" | "public" | "members_only" | "leaders_only";
export type ProjectDocAssetStatus = "draft" | "published" | "orphaned";

export type ProjectDocSettings = {
    version: 1;
    editPolicy: ProjectDocEditPolicy;
    publicVisibility?: ProjectDocPublicVisibility;
    visibilityOverride: ProjectDocVisibilityOverride;
    mediaUploads: boolean;
    externalImages: boolean;
    projectBlocks: boolean;
    notifyOnPublish: boolean;
};

export type ProjectDocQualityIssue = {
    id: string;
    severity: "info" | "warning" | "error";
    label: string;
    description: string;
};

export type ProjectDocQualityReport = {
    score: number;
    issues: ProjectDocQualityIssue[];
    sectionPresence: Record<string, boolean>;
    contentBytes: number;
};

export type ProjectDocPermission = {
    canReadPublished: boolean;
    canReadDraft: boolean;
    canEdit: boolean;
    canPublish: boolean;
    canManageSettings: boolean;
    canManageAssets: boolean;
    accessLevel: "public" | "viewer" | "member" | "co_leader" | "owner" | "none";
    reason?: string | null;
};

export type ProjectDoc = {
    id: string;
    projectId: string;
    draftContent: string;
    draftUpdatedBy: string | null;
    draftUpdatedAt: string | null;
    publishedVersionId: string | null;
    settings: ProjectDocSettings;
    createdAt: string;
    updatedAt: string;
};

export type ProjectDocVersion = {
    id: string;
    projectId: string;
    versionNumber: number;
    displayVersionNumber: number;
    content: string;
    excerpt: string | null;
    headings: ProjectDocHeading[];
    qualityReport: ProjectDocQualityReport;
    contentHash: string;
    changeSummary: string | null;
    coAuthors: { id: string; name: string; avatarUrl: string | null }[];
    createdBy: string | null;
    createdByName: string | null;
    createdAt: string;
    deletedAt: string | null;
};

export type ProjectDocAsset = {
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
    status: ProjectDocAssetStatus;
    createdBy: string | null;
    createdAt: string;
    deletedAt: string | null;
};

export type ProjectDocPublishedPayload = {
    projectId: string;
    canEdit: boolean;
    permission: ProjectDocPermission;
    settings: ProjectDocSettings;
    version: ProjectDocVersion | null;
    smartBlocks: ProjectDocSmartBlock[];
    linkedNodeId?: string | null;
    linkedNode?: { id: string; name: string; path: string; s3Key: string } | null;
};

export type ProjectDocDraftPayload = {
    projectId: string;
    permission: ProjectDocPermission;
    settings: ProjectDocSettings;
    draftContent: string;
    draftUpdatedAt: string | null;
    publishedVersion: ProjectDocVersion | null;
    qualityReport: ProjectDocQualityReport;
    linkedNodeId?: string | null;
    linkedNode?: { id: string; name: string; path: string; s3Key: string } | null;
};

export const PROJECT_DOC_MAX_CONTENT_BYTES = 500 * 1024;
export const PROJECT_DOC_ASSET_MAX_BYTES = 5 * 1024 * 1024;
export const PROJECT_DOC_ASSET_BUCKET = "project-files";
export const PROJECT_DOC_ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const PROJECT_DOC_DEFAULT_SLUG = "readme";
export const PROJECT_DOC_SLUG_MAX_LENGTH = 80;
const GENERATED_COLLABORATION_FOOTER_RE = /(?:\n{1,3}|^)\s{0,3}#{0,6}\s*Collaborator\s+[^\n]{1,120}?\s+publish(?:ed|es)?\b[^\n]*(?:\n\s*)?$/i;

export const DEFAULT_PROJECT_DOC_SETTINGS: ProjectDocSettings = {
    version: 1,
    editPolicy: "leaders",
    publicVisibility: "inherit_project",
    visibilityOverride: "inherit_project",
    mediaUploads: true,
    externalImages: false,
    projectBlocks: true,
    notifyOnPublish: false,
};

export function normalizeProjectDocSlug(value: unknown, fallback = PROJECT_DOC_DEFAULT_SLUG) {
    const fallbackSlug = typeof fallback === "string" && fallback.trim()
        ? fallback.trim().toLowerCase()
        : PROJECT_DOC_DEFAULT_SLUG;
    const raw = typeof value === "string" ? value : "";
    const normalized = raw
        .trim()
        .toLowerCase()
        .replace(/\.(md|mdx|markdown)$/i, "")
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-_]+|[-_]+$/g, "")
        .slice(0, PROJECT_DOC_SLUG_MAX_LENGTH)
        .replace(/^[-_]+|[-_]+$/g, "");
    return normalized || fallbackSlug;
}

export function isProjectDocSlugCanonical(value: unknown) {
    return typeof value === "string" && value === normalizeProjectDocSlug(value);
}

export function normalizeProjectDocSettings(value: unknown): ProjectDocSettings {
    const source = value && typeof value === "object" ? value as Partial<ProjectDocSettings> : {};
    const visibilityOverride = source.visibilityOverride === "public" || source.visibilityOverride === "members_only" || source.visibilityOverride === "leaders_only" || source.visibilityOverride === "inherit_project"
        ? source.visibilityOverride
        : "inherit_project";
    return {
        version: 1,
        editPolicy: source.editPolicy === "members" ? "members" : "leaders",
        publicVisibility: "inherit_project",
        visibilityOverride,
        mediaUploads: typeof source.mediaUploads === "boolean" ? source.mediaUploads : DEFAULT_PROJECT_DOC_SETTINGS.mediaUploads,
        externalImages: typeof source.externalImages === "boolean" ? source.externalImages : DEFAULT_PROJECT_DOC_SETTINGS.externalImages,
        projectBlocks: typeof source.projectBlocks === "boolean" ? source.projectBlocks : DEFAULT_PROJECT_DOC_SETTINGS.projectBlocks,
        notifyOnPublish: typeof source.notifyOnPublish === "boolean" ? source.notifyOnPublish : DEFAULT_PROJECT_DOC_SETTINGS.notifyOnPublish,
    };
}

const README_REPEATED_TAIL_MIN_CHARS = 200;

function firstMeaningfulReadmeLine(value: string) {
    return value
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "";
}

function stripRepeatedReadmeTail(value: string) {
    if (value.length < README_REPEATED_TAIL_MIN_CHARS * 2) return value;

    const firstLine = firstMeaningfulReadmeLine(value);
    if (firstLine.length < 8) return value;

    let searchFrom = firstLine.length;
    while (searchFrom >= 0 && searchFrom < value.length) {
        const duplicateStart = value.indexOf(firstLine, searchFrom);
        if (duplicateStart < 0) return value;

        const duplicateTail = value.slice(duplicateStart);
        const duplicateTailTrimmed = duplicateTail.trimEnd();
        const originalPrefix = value.slice(0, duplicateTailTrimmed.length);
        const originalPrefixTrimmed = originalPrefix.trimEnd();
        const startsAtLineBoundary = duplicateStart === 0 || value[duplicateStart - 1] === "\n";
        const isMeaningfulTail = duplicateTailTrimmed.length >= README_REPEATED_TAIL_MIN_CHARS;

        if (
            startsAtLineBoundary
            && isMeaningfulTail
            && originalPrefixTrimmed === duplicateTailTrimmed
        ) {
            return value.slice(0, duplicateStart).trimEnd();
        }

        searchFrom = duplicateStart + firstLine.length;
    }

    return value;
}

export function normalizeProjectDocContent(content: unknown) {
    const value = typeof content === "string"
        ? stripRepeatedReadmeTail(content.replace(/\r\n?/g, "\n").replace(GENERATED_COLLABORATION_FOOTER_RE, ""))
        : "";
    return value.length > PROJECT_DOC_MAX_CONTENT_BYTES ? value.slice(0, PROJECT_DOC_MAX_CONTENT_BYTES) : value;
}

export type ProjectDocCollaborationContentResolution = {
    content: string;
    repaired: boolean;
    reason: "repeated-canonical-draft" | "repeated-draft-tail" | null;
    repeatCount: number;
};

function normalizeDocCollaborationText(value: unknown) {
    return typeof value === "string" ? value.replace(/\r\n?/g, "\n") : "";
}

function isRepeatedCanonicalReadmeContent(collaborativeContent: string, canonicalContent: string, repeatCount: number) {
    for (let offset = 0; offset < collaborativeContent.length; offset += canonicalContent.length) {
        if (collaborativeContent.slice(offset, offset + canonicalContent.length) !== canonicalContent) {
            return false;
        }
    }
    return repeatCount >= 2;
}

export function resolveProjectDocCollaborationContent(input: {
    canonicalContent: string;
    collaborativeContent: string;
}): ProjectDocCollaborationContentResolution {
    const canonicalContent = normalizeDocCollaborationText(input.canonicalContent);
    const collaborativeContent = normalizeDocCollaborationText(input.collaborativeContent);

    if (!canonicalContent || !collaborativeContent || collaborativeContent === canonicalContent) {
        return {
            content: collaborativeContent,
            repaired: false,
            reason: null,
            repeatCount: 1,
        };
    }

    const repeatCount = collaborativeContent.length % canonicalContent.length === 0
        ? collaborativeContent.length / canonicalContent.length
        : 1;
    if (isRepeatedCanonicalReadmeContent(collaborativeContent, canonicalContent, repeatCount)) {
        return {
            content: canonicalContent,
            repaired: true,
            reason: "repeated-canonical-draft",
            repeatCount,
        };
    }

    const repairedCollaborativeContent = stripRepeatedReadmeTail(collaborativeContent);
    if (repairedCollaborativeContent !== collaborativeContent) {
        return {
            content: repairedCollaborativeContent,
            repaired: true,
            reason: "repeated-draft-tail",
            repeatCount: 2,
        };
    }

    return {
        content: collaborativeContent,
        repaired: false,
        reason: null,
        repeatCount: 1,
    };
}

export function assertProjectDocContentSize(content: string) {
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > PROJECT_DOC_MAX_CONTENT_BYTES) {
        throw new Error("Doc content is too large. Keep it under 500 KiB.");
    }
}

export function hashProjectDocContent(content: string) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}

export function buildProjectDocStorageKey(projectId: string, userId: string, extension: string) {
    const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
    return `projects/${projectId}/doc-assets/${userId}/${Date.now()}-${randomUUID()}.${safeExtension}`;
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

export function buildProjectDocExcerpt(content: string, maxLength = 220) {
    return buildProjectDocPlainText(content, { maxLength });
}

export function normalizeProjectDocHeadings(value: unknown): ProjectDocHeading[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            if (!item || typeof item !== "object") return null;
            const source = item as Partial<ProjectDocHeading>;
            const id = typeof source.id === "string" ? source.id : "";
            const text = typeof source.text === "string" ? source.text : "";
            const level = Number(source.level);
            if (!id || !text || !Number.isFinite(level)) return null;
            return { id, text, level: Math.min(4, Math.max(1, Math.trunc(level))) };
        })
        .filter((item): item is ProjectDocHeading => Boolean(item));
}

export function buildProjectDocQualityReport(content: string): ProjectDocQualityReport {
    return evaluateProjectDocQuality(content);
}

export function buildProjectDocPublishMetadata(content: string) {
    const normalized = normalizeProjectDocContent(content);
    assertProjectDocContentSize(normalized);
    return {
        content: normalized,
        headings: extractProjectDocHeadings(normalized),
        excerpt: buildProjectDocExcerpt(normalized),
        qualityReport: buildProjectDocQualityReport(normalized),
        contentHash: hashProjectDocContent(normalized),
        smartBlocks: parseProjectDocSmartBlocks(normalized),
    };
}

export function resolveProjectDocPermission(input: {
    actorUserId?: string | null;
    projectVisibility?: unknown;
    publicTabVisibility?: unknown;
    settings?: unknown;
    membershipRole?: unknown;
    isOwner?: boolean;
    isActiveMember?: boolean;
    hasPublishedReadme?: boolean;
}) : ProjectDocPermission {
    const settings = normalizeProjectDocSettings(input.settings);
    const visibility = normalizeProjectVisibility(input.projectVisibility);
    const publicTabs = normalizeProjectPublicTabVisibility(input.publicTabVisibility);
    const isActiveMember = Boolean(input.isActiveMember || input.isOwner);
    const role = isActiveMember
        ? normalizeProjectMemberRole(input.membershipRole, input.isOwner ? "owner" : "member")
        : null;
    const isOwner = Boolean(input.isOwner) || role === "owner";
    const isCoLeader = role === "admin";
    const isMember = isActiveMember || isOwner || isCoLeader || role === "member" || role === "viewer";
    
    const override = settings.visibilityOverride || "inherit_project";

    let isPublishedPublic = false;
    if (override === "public") {
        isPublishedPublic = Boolean(input.hasPublishedReadme);
    } else if (override === "members_only") {
        isPublishedPublic = false;
    } else if (override === "leaders_only") {
        isPublishedPublic = false;
    } else {
        isPublishedPublic = visibility === "public" && publicTabs.readme && Boolean(input.hasPublishedReadme);
    }

    let canReadPublished = false;
    if (override === "leaders_only") {
        canReadPublished = isOwner || isCoLeader;
    } else if (override === "members_only") {
        canReadPublished = isMember;
    } else {
        canReadPublished = isMember || isPublishedPublic;
    }

    const isLeader = isOwner || isCoLeader;
    const canReadDraft = isLeader || (isMember && settings.editPolicy === "members" && override !== "leaders_only");
    const canEdit = canReadDraft;
    const canPublish = canEdit;
    const canManageSettings = isLeader;
    const canManageAssets = canEdit && settings.mediaUploads;
    const accessLevel: ProjectDocPermission["accessLevel"] = isOwner
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
        reason: canReadPublished || canReadDraft ? null : "Document is not available for this viewer.",
    };
}
