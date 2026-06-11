export const PROJECT_UPDATE_TYPES = [
    "progress",
    "milestone",
    "release",
    "blocker",
    "decision",
    "collaboration_request",
    "behind_the_scenes",
] as const;

export type ProjectUpdateType = typeof PROJECT_UPDATE_TYPES[number];
export type ProjectUpdateVisibility = "public" | "members";
export type ProjectUpdateReplyPolicy = "logged_in" | "members";
export type ProjectUpdateFilter = "all" | ProjectUpdateType;

export const PROJECT_UPDATE_TYPE_LABELS: Record<ProjectUpdateType, string> = {
    progress: "Progress",
    milestone: "Milestone",
    release: "Release",
    blocker: "Blocker",
    decision: "Decision",
    collaboration_request: "Collaboration request",
    behind_the_scenes: "Behind the scenes",
};

export const PROJECT_UPDATE_FILTERS: Array<{ id: ProjectUpdateFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "progress", label: "Progress" },
    { id: "milestone", label: "Milestones" },
    { id: "release", label: "Releases" },
    { id: "blocker", label: "Blockers" },
    { id: "decision", label: "Decisions" },
];

export type ProjectUpdateEntityRefs = {
    taskId?: string | null;
    sprintId?: string | null;
    fileId?: string | null;
    readmeVersionId?: string | null;
    roleId?: string | null;
    milestoneId?: string | null;
    references?: ProjectUpdateReference[];
};

export type ProjectUpdateMediaItem = {
    type: "image" | "file" | "link";
    url?: string | null;
    label?: string | null;
    altText?: string | null;
    mimeType?: string | null;
    size?: number | null;
    width?: number | null;
    height?: number | null;
    bucket?: string | null;
    storageKey?: string | null;
};

export type ProjectUpdateContextKind = "task" | "sprint" | "file";

export type ProjectUpdateReference = {
    kind: ProjectUpdateContextKind;
    id: string;
};

export type ProjectUpdateCommentView = {
    id: string;
    updateId: string;
    projectId: string;
    parentId: string | null;
    userId: string | null;
    author: {
        id: string;
    } | null;
};

export type ProjectUpdateContextOption = {
    kind: ProjectUpdateContextKind;
    id: string;
    label: string;
    description: string | null;
    href: string | null;
    status?: string | null;
};

export type ProjectUpdateContextSummary = {
    task?: ProjectUpdateContextOption | null;
    sprint?: ProjectUpdateContextOption | null;
    file?: ProjectUpdateContextOption | null;
    references?: ProjectUpdateContextOption[];
};

export type ProjectUpdateAuthorRoleSource = "snapshot" | "project_role" | "membership";

export type ProjectUpdateAuthorRoleSnapshot = {
    displayRoleLabel: string | null;
    roleTitle: string | null;
    membershipRoleLabel: string | null;
    source: ProjectUpdateAuthorRoleSource;
    capturedAt: string;
};

export const PROJECT_UPDATE_PAGE_SIZE = 20;
export const PROJECT_UPDATE_COMMENT_PAGE_SIZE = 20;
export const PROJECT_UPDATE_VIRTUALIZE_THRESHOLD = 80;
export const PROJECT_UPDATE_MAX_MEDIA_ITEMS = 4;
export const PROJECT_UPDATE_MAX_REFERENCES = 8;
export const PROJECT_UPDATE_MEDIA_BUCKET = "project-files";
export const PROJECT_UPDATE_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const PROJECT_UPDATE_ALLOWED_IMAGE_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
]);
export const PROJECT_UPDATE_MAX_SYNC_NOTIFICATION_RECIPIENTS = 120;

export const PROJECT_UPDATE_PERFORMANCE_BUDGETS = {
    readMs: 100,
    createMs: 300,
    commentMs: 250,
    fanoutSyncRecipients: PROJECT_UPDATE_MAX_SYNC_NOTIFICATION_RECIPIENTS,
    initialPayloadKb: 80,
} as const;

export const PROJECT_UPDATE_SCHEMA_CONTRACT = {
    tables: ["project_updates", "project_update_likes", "project_update_comments", "project_update_drafts"],
    indexes: [
        "project_updates_project_pinned_created_idx",
        "project_updates_project_created_active_idx",
        "project_updates_public_feed_idx",
        "project_updates_author_created_idx",
        "project_updates_deleted_at_idx",
        "project_update_likes_update_idx",
        "project_update_likes_user_idx",
        "project_update_likes_unique",
        "project_update_comments_update_created_idx",
        "project_update_comments_update_active_idx",
        "project_update_comments_project_created_idx",
        "project_update_comments_user_created_idx",
        "project_update_drafts_updated_at_idx",
    ],
    minPolicyCounts: {
        project_updates: 3,
        project_update_likes: 3,
        project_update_comments: 3,
        project_update_drafts: 1,
    },
} as const;

export function isProjectUpdateType(value: unknown): value is ProjectUpdateType {
    return typeof value === "string" && PROJECT_UPDATE_TYPES.includes(value as ProjectUpdateType);
}

export function normalizeProjectUpdateType(value: unknown): ProjectUpdateType | null {
    return isProjectUpdateType(value) ? value : null;
}

export function normalizeProjectUpdateFilter(value: unknown): ProjectUpdateFilter {
    if (value === "all") return "all";
    return normalizeProjectUpdateType(value) ?? "all";
}

export function sanitizeProjectUpdateContent(value: unknown, maxLength = 2_000) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function projectUpdateExcerpt(value: string, maxLength = 180) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function projectUpdateDraftStorageKey(projectId: string, userId: string | null | undefined) {
    return `nb.project-updates.draft.${projectId}.${userId || "anonymous"}`;
}

export function sanitizeProjectUpdateRoleTitle(value: unknown, maxLength = 80) {
    if (typeof value !== "string") return null;
    const normalized = value.replace(/\s+/g, " ").trim().slice(0, maxLength);
    return normalized.length > 0 ? normalized : null;
}

export function composeProjectUpdateRoleLabel(input: {
    roleTitle?: string | null;
    membershipRoleLabel?: string | null;
}) {
    const roleTitle = sanitizeProjectUpdateRoleTitle(input.roleTitle);
    const membershipRoleLabel = sanitizeProjectUpdateRoleTitle(input.membershipRoleLabel);
    if (!roleTitle) return membershipRoleLabel;
    if (!membershipRoleLabel) return roleTitle;
    const normalizedMembership = membershipRoleLabel.toLowerCase();
    const normalizedTitle = roleTitle.toLowerCase();
    if (normalizedTitle.includes(normalizedMembership)) return roleTitle;
    if (normalizedMembership === "lead" || normalizedMembership === "co-lead") {
        return `${membershipRoleLabel} ${roleTitle}`;
    }
    return roleTitle;
}

export function isGenericProjectUpdateRoleTitle(value: unknown, membershipRoleLabel?: string | null) {
    const roleTitle = sanitizeProjectUpdateRoleTitle(value);
    if (!roleTitle) return false;
    const normalizedTitle = roleTitle.toLowerCase();
    const normalizedMembership = sanitizeProjectUpdateRoleTitle(membershipRoleLabel)?.toLowerCase() ?? null;
    return normalizedTitle === normalizedMembership
        || ["lead", "co-lead", "co lead", "admin", "member", "viewer", "owner", "contributor"].includes(normalizedTitle);
}

export function normalizeProjectUpdateAuthorRoleSnapshot(value: unknown): ProjectUpdateAuthorRoleSnapshot | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Record<string, unknown>;
    const displayRoleLabel = sanitizeProjectUpdateRoleTitle(source.displayRoleLabel);
    const roleTitle = sanitizeProjectUpdateRoleTitle(source.roleTitle);
    const membershipRoleLabel = sanitizeProjectUpdateRoleTitle(source.membershipRoleLabel);
    const roleSource = source.source === "project_role" || source.source === "membership"
        ? source.source
        : "snapshot";
    const capturedAt = typeof source.capturedAt === "string" && !Number.isNaN(new Date(source.capturedAt).getTime())
        ? source.capturedAt
        : new Date(0).toISOString();
    if (!displayRoleLabel && !roleTitle && !membershipRoleLabel) return null;
    const composedRoleLabel = composeProjectUpdateRoleLabel({ roleTitle, membershipRoleLabel });
    return {
        displayRoleLabel: composedRoleLabel ?? displayRoleLabel ?? roleTitle ?? membershipRoleLabel,
        roleTitle,
        membershipRoleLabel,
        source: roleSource,
        capturedAt,
    };
}

export function resolveProjectUpdateAuthorRoleDisplay(input: {
    snapshot?: ProjectUpdateAuthorRoleSnapshot | null;
    projectRoleTitle?: string | null;
    membershipRoleLabel?: string | null;
}) {
    const snapshot = input.snapshot ?? null;
    if (snapshot?.displayRoleLabel) {
        const projectRoleTitle = sanitizeProjectUpdateRoleTitle(input.projectRoleTitle);
        const effectiveMembershipRoleLabel = snapshot.membershipRoleLabel ?? input.membershipRoleLabel;
        const snapshotRoleTitle = isGenericProjectUpdateRoleTitle(snapshot.roleTitle, effectiveMembershipRoleLabel)
            ? null
            : sanitizeProjectUpdateRoleTitle(snapshot.roleTitle);
        const effectiveRoleTitle = projectRoleTitle ?? snapshotRoleTitle;
        return {
            roleLabel: composeProjectUpdateRoleLabel({
                roleTitle: effectiveRoleTitle,
                membershipRoleLabel: effectiveMembershipRoleLabel,
            }) ?? snapshot.displayRoleLabel,
            roleTitle: effectiveRoleTitle ?? snapshot.displayRoleLabel,
            membershipRoleLabel: effectiveMembershipRoleLabel ?? null,
            roleSource: projectRoleTitle ? "project_role" as const : "snapshot" as const,
        };
    }
    const projectRoleTitle = sanitizeProjectUpdateRoleTitle(input.projectRoleTitle);
    if (projectRoleTitle) {
        return {
            roleLabel: composeProjectUpdateRoleLabel({ roleTitle: projectRoleTitle, membershipRoleLabel: input.membershipRoleLabel }),
            roleTitle: projectRoleTitle,
            membershipRoleLabel: input.membershipRoleLabel ?? null,
            roleSource: "project_role" as const,
        };
    }
    const membershipRoleLabel = sanitizeProjectUpdateRoleTitle(input.membershipRoleLabel);
    return {
        roleLabel: membershipRoleLabel,
        roleTitle: null,
        membershipRoleLabel,
        roleSource: membershipRoleLabel ? "membership" as const : null,
    };
}

export function isSafeProjectUpdateUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    if (trimmed.startsWith("/api/v1/projects/")) return true;
    try {
        const url = new URL(trimmed);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
}

export function normalizeProjectUpdateReferenceKind(value: unknown): ProjectUpdateContextKind | null {
    return value === "task" || value === "sprint" || value === "file" ? value : null;
}

export function normalizeProjectUpdateReferences(value: unknown, maxItems = PROJECT_UPDATE_MAX_REFERENCES): ProjectUpdateReference[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const references: ProjectUpdateReference[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const source = item as Record<string, unknown>;
        const kind = normalizeProjectUpdateReferenceKind(source.kind);
        const id = typeof source.id === "string" ? source.id.trim() : "";
        if (!kind || !id) continue;
        const key = `${kind}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        references.push({ kind, id });
        if (references.length >= maxItems) break;
    }
    return references;
}

export function normalizeProjectUpdateMediaItems(value: unknown, maxItems = PROJECT_UPDATE_MAX_MEDIA_ITEMS): ProjectUpdateMediaItem[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, maxItems).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const source = item as Record<string, unknown>;
        const type = source.type === "image" || source.type === "file" || source.type === "link" ? source.type : null;
        if (!type) return [];
        const url = typeof source.url === "string" ? source.url.trim().slice(0, 2_000) : null;
        if (url && !isSafeProjectUpdateUrl(url)) return [];
        return [{
            type,
            url,
            label: typeof source.label === "string" ? source.label.trim().slice(0, 160) : null,
            altText: typeof source.altText === "string" ? source.altText.trim().slice(0, 240) : null,
            mimeType: typeof source.mimeType === "string" ? source.mimeType.trim().slice(0, 160) : null,
            size: typeof source.size === "number" && Number.isFinite(source.size) ? Math.max(0, Math.trunc(source.size)) : null,
            width: typeof source.width === "number" && Number.isFinite(source.width) ? Math.max(0, Math.trunc(source.width)) : null,
            height: typeof source.height === "number" && Number.isFinite(source.height) ? Math.max(0, Math.trunc(source.height)) : null,
            bucket: typeof source.bucket === "string" ? source.bucket.trim().slice(0, 160) : null,
            storageKey: typeof source.storageKey === "string" ? source.storageKey.trim().slice(0, 1_024) : null,
        }];
    });
}

export function hasProjectUpdateLinkedContext(entityRefs: ProjectUpdateEntityRefs | null | undefined, media: ProjectUpdateMediaItem[] | null | undefined) {
    return Boolean(
        entityRefs && (
            Object.values(entityRefs).some((value) => typeof value === "string" && value.length > 0)
            || normalizeProjectUpdateReferences(entityRefs.references).length > 0
        )
        || media?.some((item) => Boolean(item.url || item.label)),
    );
}

export function projectUpdateImageExtensionFromMimeType(mimeType: string) {
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "image/gif") return "gif";
    return "jpg";
}

export function shouldNotifyProjectUpdateFollowers(input: {
    content: string;
    entityRefs?: ProjectUpdateEntityRefs | null;
    media?: ProjectUpdateMediaItem[] | null;
}) {
    const content = sanitizeProjectUpdateContent(input.content);
    if (content.length >= 80) return true;
    if (/[.!?]\s*$/.test(content) && content.length >= 40) return true;
    return hasProjectUpdateLinkedContext(input.entityRefs, input.media);
}
