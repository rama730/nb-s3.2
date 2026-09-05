"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
    AlertTriangle,
    Archive,
    Bell,
    ChevronDown,
    Crown,
    Download,
    FileText,
    Folder,
    Globe,
    KeyRound,
    Link2,
    Loader2,
    Lock,
    RefreshCw,
    Search,
    Settings,
    Shield,
    ShieldCheck,
    Trash2,
    UserCog,
    UserMinus,
    Users,
    Workflow,
    Plus,
    X,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SkillPicker } from "@/components/skills/SkillPicker";
import { Button } from "@/components/ui/button";
import { transferProjectOwnership } from "@/app/actions/account";
import {
    archiveProjectAction,
    clearProjectCoverImageAction,
    createProjectCoverImageUploadUrlAction,
    deleteProject,
    finalizeProjectCoverImageUploadAction,
    getProjectAccessImpactAction,
    getProjectAccessTransitionPreflightAction,
    getProjectCollaboratorSettingsAction,
    getProjectDangerZonePreflightAction,
    getProjectFileWorkspaceSettingsAction,
    getProjectMemberRemovalPreflightAction,
    getProjectSettingsAuditAction,
    readProjectMemberNotificationSettingsAction,
    readProjectNotificationSettingsAction,
    readProjectDocSettingsAction,
    removeProjectMemberAction,
    resetProjectMemberNotificationSettingsAction,
    resetProjectNotificationSettingsAction,
    updateProject,
    updateProjectLifecycleAction,
    updateProjectFileUploadDefaultsAction,
    updateProjectMemberFileUploadAction,
    updateProjectMemberNotificationSettingsAction,
    updateProjectMemberRoleAction,
    updateProjectNotificationSettingsAction,
    updateProjectPublicTabVisibilityAction,
    updateProjectDocSettingsAction,
    updateProjectVisibilityAction,
} from "@/app/actions/project";
import { cn } from "@/lib/utils";
import {
    isKnownProjectType,
    OTHER_PROJECT_TYPE_ID,
    POPULAR_PROJECT_TAGS,
    PROJECT_TYPE_OPTIONS,
} from "@/lib/projects/project-create-options";
import {
    buildDefaultProjectNotificationPolicy,
    groupProjectNotificationEntries,
    normalizeProjectMemberNotificationOverrides,
    normalizeProjectNotificationPolicy,
    resolveProjectNotificationDecision,
    summarizeProjectNotificationPolicy,
    type ProjectMemberNotificationOverrides,
    type ProjectNotificationEventKey,
    type ProjectNotificationPolicy,
    type ProjectNotificationPreset,
    type ProjectNotificationRegistryEntry,
} from "@/lib/notifications/project-policy";
import {
    buildProjectAccessImpact,
    buildProjectAccessPolicy,
    buildProjectAccessTransitionPolicy,
    buildProjectFilePolicy,
    buildProjectMemberMutationPolicy,
    buildProjectMemberRemovalPreflight,
    buildProjectPersonReference,
    buildProjectRolePolicy,
    buildProjectSettingsPreflight,
    areProjectPublicTabVisibilitiesEqual,
    DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY,
    getProjectMemberDisplayName,
    getProjectMemberRoleLabel,
    normalizeProjectPublicTabVisibility,
    getVisibleProjectSettingsSections,
    normalizeProjectVisibility,
    PROJECT_PUBLIC_TAB_DESCRIPTIONS,
    PROJECT_PUBLIC_TAB_LABELS,
    type ProjectMemberRole,
    type ProjectPublicTabId,
    type ProjectPublicTabVisibility,
    type ProjectSettingsMember,
    type ProjectSettingsSectionId,
    type ProjectSettingsVisibility,
} from "@/lib/projects/settings-policies";
import {
    DEFAULT_PROJECT_DOC_SETTINGS,
    normalizeProjectDocSettings,
    type ProjectDocSettings,
} from "@/lib/projects/doc";
import { LifecycleEditor as BaseLifecycleEditor } from "@/components/projects/LifecycleEditor";
import { ProjectRolesEditor } from "@/components/projects/settings/ProjectRolesEditor";
import { ProjectLinksManager } from "@/components/projects/dashboard/ProjectSocialLinksCard";
import {
    normalizeProjectRoleFormValues,
    type ProjectRoleFormValue,
    type ProjectRolesFormValues,
} from "@/lib/projects/project-roles-form";

interface ProjectSettingsTabProps {
    projectId: string;
    project: any;
    onProjectUpdated: (updates?: { coverImage?: string | null }) => void;
    isProjectOwner: boolean;
    actorRole?: ProjectMemberRole | null;
    members?: ProjectSettingsMember[];
    loadingMembers?: boolean;
}

type ConfirmActionResult = {
    success: boolean;
    message: string;
    refresh?: boolean;
    redirectTo?: string;
};

type ConfirmAction = {
    title: string;
    description: string;
    confirmLabel: string;
    variant: "default" | "destructive";
    content?: React.ReactNode;
    action: () => Promise<ConfirmActionResult>;
};

type DangerPreflight = {
    status: "draft" | "active" | "completed" | "archived";
    openRolesCount: number;
    pendingApplicationsCount: number;
    activeTasksCount: number;
    canArchive: boolean;
    canDelete: boolean;
};

type AccessImpact = {
    membersCount: number;
    followersCount: number;
    openRolesCount: number;
    pendingApplicationsCount: number;
    activeTasksCount: number;
};

type AccessTransitionPreflightData = {
    previousVisibility: ProjectSettingsVisibility;
    nextVisibility: ProjectSettingsVisibility;
    confirmationToken: string;
    policy: ReturnType<typeof buildProjectAccessTransitionPolicy>;
    counts: AccessImpact;
    previews: {
        followers: Array<{ id: string; username: string | null; fullName: string | null; avatarUrl: string | null }>;
        openRoles: Array<{ id: string; title: string | null; role: string | null }>;
        pendingApplications: Array<{ id: string; applicantId: string; applicantName: string | null; roleTitle: string | null; roleName: string | null }>;
    };
};

type SettingsAuditEvent = {
    id: string;
    type: string;
    createdAt: string;
    actorName: string | null;
    metadata: Record<string, unknown>;
};

type CollaboratorSettingsData = {
    members: ProjectSettingsMember[];
    roleCounts: Record<ProjectMemberRole, number>;
    hasMore: boolean;
    nextCursor: string | null;
};

type FileWorkspaceSettingsData = {
    members: Array<ProjectSettingsMember & {
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

type ProjectNotificationSettingsData = {
    policy: ProjectNotificationPolicy;
    summary: ReturnType<typeof summarizeProjectNotificationPolicy>;
};

type MemberNotificationSettingsData = {
    member: {
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
        membershipRole: ProjectMemberRole;
    };
    canEdit: boolean;
    overrides: ProjectMemberNotificationOverrides;
};

type RemovalPreflightData = {
    member: ProjectSettingsMember;
    activeAssignedTasks: number;
    activeCreatedTasks: number;
    fileReviews: number;
    acceptedApplications: number;
    projectGroupParticipant: boolean;
    visibility: ProjectSettingsVisibility;
    activeAssignedTaskItems?: Array<{ id: string; title: string; taskNumber: number | null; status: string | null }>;
    activeCreatedTaskItems?: Array<{ id: string; title: string; taskNumber: number | null; status: string | null }>;
    fileReviewItems?: Array<{ id: string; taskId: string; taskTitle: string | null; nodeName: string | null; annotation: string | null }>;
    acceptedApplicationItems?: Array<{ id: string; roleId: string; roleTitle: string | null; roleName: string | null }>;
    reassignmentCandidates?: ProjectSettingsMember[];
};
type CollaboratorFilter = "all" | "admin" | "member" | "viewer";
type RemovalMode = "preserve_history" | "unassign_active_tasks" | "reassign_active_tasks";
type RemovalTaskPreview = { id: string; title: string; taskNumber: number | null; status: string | null };

type CoverDraft = {
    file: File;
    previewUrl: string;
    naturalWidth: number;
    naturalHeight: number;
    zoom: number;
    offsetX: number;
    offsetY: number;
};

type ProjectImageDragState = {
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
};

type ScrollSnapshot = {
    routeRoot: HTMLElement | null;
    routeScrollTop: number;
    windowScrollX: number;
    windowScrollY: number;
};

const SECTION_ICONS: Record<ProjectSettingsSectionId, React.ComponentType<{ className?: string }>> = {
    general: Settings,
    links: Link2,
    access: Globe,
    collaborators: Users,
    "roles-applications": UserCog,
    "tasks-workflow": Workflow,
    "files-workspace": Folder,
    readme: FileText,
    updates: Bell,
    notifications: Bell,
    "security-audit": Shield,
    danger: AlertTriangle,
};

const VISIBILITY_OPTIONS: Array<{
    id: ProjectSettingsVisibility;
    title: string;
    description: string;
    detail: string;
}> = [
    {
        id: "public",
        title: "Public",
        description: "Anyone can discover and view the public project surface.",
        detail: "Best for open collaboration, public updates, and shareable project profiles.",
    },
    {
        id: "private",
        title: "Private",
        description: "Only the owner and approved members can view project content.",
        detail: "Best when files, tasks, applications, and updates should stay member-only.",
    },
];

const PROJECT_IMAGE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
const PROJECT_IMAGE_OUTPUT_SIZE = 1024;
const PROJECT_IMAGE_PREVIEW_SIZE = 224;
const PROJECT_IMAGE_MIN_ZOOM = 1;
const PROJECT_IMAGE_MAX_ZOOM = 2.5;
const PROJECT_TAG_LIMIT = 8;
const PROJECT_SKILL_LIMIT = 12;
const ALLOWED_PROJECT_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const projectRoleSettingsSchema = z.object({
    roles: z.array(z.object({
        id: z.string().optional(),
        role: z.string().trim().min(1, "Role name is required"),
        count: z.number().int().min(1, "Count must be at least 1"),
        description: z.string().optional(),
        skills: z.array(z.string()).optional(),
    })),
});

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function readImageDimensions(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const image = new globalThis.Image();
        image.onload = () => resolve({
            width: image.naturalWidth || PROJECT_IMAGE_OUTPUT_SIZE,
            height: image.naturalHeight || PROJECT_IMAGE_OUTPUT_SIZE,
        });
        image.onerror = () => reject(new Error("Failed to read selected image."));
        image.src = src;
    });
}

function projectImagePreviewMetrics(draft: CoverDraft) {
    const baseScale = Math.max(
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalWidth),
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalHeight),
    );
    const width = draft.naturalWidth * baseScale * draft.zoom;
    const height = draft.naturalHeight * baseScale * draft.zoom;
    return {
        width,
        height,
        maxOffsetX: Math.max(0, (width - PROJECT_IMAGE_PREVIEW_SIZE) / 2),
        maxOffsetY: Math.max(0, (height - PROJECT_IMAGE_PREVIEW_SIZE) / 2),
    };
}

function normalizeProjectImageDraft(draft: CoverDraft, updates: Partial<Pick<CoverDraft, "zoom" | "offsetX" | "offsetY">>) {
    const zoom = clamp(updates.zoom ?? draft.zoom, PROJECT_IMAGE_MIN_ZOOM, PROJECT_IMAGE_MAX_ZOOM);
    const nextDraft = { ...draft, ...updates, zoom };
    const metrics = projectImagePreviewMetrics(nextDraft);
    return {
        ...nextDraft,
        offsetX: clamp(nextDraft.offsetX, -metrics.maxOffsetX, metrics.maxOffsetX),
        offsetY: clamp(nextDraft.offsetY, -metrics.maxOffsetY, metrics.maxOffsetY),
    };
}

function fitProjectImageDraft(draft: CoverDraft) {
    const coverScale = Math.max(
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalWidth),
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalHeight),
    );
    const containScale = Math.min(
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalWidth),
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalHeight),
    );
    const zoom = clamp(containScale / coverScale, PROJECT_IMAGE_MIN_ZOOM, PROJECT_IMAGE_MAX_ZOOM);
    return normalizeProjectImageDraft(draft, { zoom, offsetX: 0, offsetY: 0 });
}

function fillProjectImageDraft(draft: CoverDraft) {
    return normalizeProjectImageDraft(draft, {
        zoom: PROJECT_IMAGE_MIN_ZOOM,
        offsetX: 0,
        offsetY: 0,
    });
}

function formatTaskPreviewLabel(task: RemovalTaskPreview) {
    const number = typeof task.taskNumber === "number" ? `#${task.taskNumber}` : "Task";
    return `${number} · ${task.title}`;
}

function RemovalImpactDetails({ preflight }: { preflight: RemovalPreflightData }) {
    const sections: Array<{
        key: string;
        label: string;
        count: number;
        items: React.ReactNode[];
        empty: string;
    }> = [
        {
            key: "assigned",
            label: "Active assigned tasks",
            count: preflight.activeAssignedTasks,
            items: (preflight.activeAssignedTaskItems ?? []).map((task) => (
                <li key={task.id} className="rounded-xl bg-white/70 px-3 py-2 dark:bg-zinc-950/60">
                    <span className="block font-medium text-zinc-800 dark:text-zinc-100">{formatTaskPreviewLabel(task)}</span>
                    <span className="text-[11px] text-zinc-500">{task.status ?? "active"} · will need reassignment if history is preserved</span>
                </li>
            )),
            empty: "No active assigned tasks.",
        },
        {
            key: "created",
            label: "Created active tasks",
            count: preflight.activeCreatedTasks,
            items: (preflight.activeCreatedTaskItems ?? []).map((task) => (
                <li key={task.id} className="rounded-xl bg-white/70 px-3 py-2 dark:bg-zinc-950/60">
                    <span className="block font-medium text-zinc-800 dark:text-zinc-100">{formatTaskPreviewLabel(task)}</span>
                    <span className="text-[11px] text-zinc-500">{task.status ?? "active"} · creator history stays visible</span>
                </li>
            )),
            empty: "No active tasks created by this member.",
        },
        {
            key: "reviews",
            label: "File review responsibilities",
            count: preflight.fileReviews,
            items: (preflight.fileReviewItems ?? []).map((review) => (
                <li key={review.id} className="rounded-xl bg-white/70 px-3 py-2 dark:bg-zinc-950/60">
                    <span className="block font-medium text-zinc-800 dark:text-zinc-100">
                        {review.nodeName ?? "Linked file"} · {review.taskTitle ?? "Task"}
                    </span>
                    <span className="text-[11px] text-zinc-500">{review.annotation ?? "Needs review"}</span>
                </li>
            )),
            empty: "No file review responsibilities found.",
        },
        {
            key: "applications",
            label: "Accepted application history",
            count: preflight.acceptedApplications,
            items: (preflight.acceptedApplicationItems ?? []).map((application) => (
                <li key={application.id} className="rounded-xl bg-white/70 px-3 py-2 dark:bg-zinc-950/60">
                    <span className="block font-medium text-zinc-800 dark:text-zinc-100">
                        {application.roleTitle ?? application.roleName ?? "Accepted role"}
                    </span>
                    <span className="text-[11px] text-zinc-500">Will show Accepted · Membership ended</span>
                </li>
            )),
            empty: "No accepted application history found.",
        },
    ];

    return (
        <details className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Exact affected records
            </summary>
            <div className="mt-3 space-y-3">
                {sections.map((section) => (
                    <div key={section.key}>
                        <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                            {section.label} <span className="text-zinc-400">({section.count})</span>
                        </p>
                        {section.items.length > 0 ? (
                            <ul className="mt-2 space-y-1.5 text-xs">{section.items}</ul>
                        ) : (
                            <p className="mt-1 text-xs text-zinc-500">{section.empty}</p>
                        )}
                        {section.count > section.items.length ? (
                            <p className="mt-1 text-[11px] text-zinc-500">
                                Showing the first {section.items.length}; the action still applies to all {section.count}.
                            </p>
                        ) : null}
                    </div>
                ))}
            </div>
        </details>
    );
}

function captureScrollSnapshot(): ScrollSnapshot {
    const routeRoot = typeof document === "undefined"
        ? null
        : document.querySelector<HTMLElement>('[data-scroll-root="route"]');
    return {
        routeRoot,
        routeScrollTop: routeRoot?.scrollTop ?? 0,
        windowScrollX: typeof window === "undefined" ? 0 : window.scrollX,
        windowScrollY: typeof window === "undefined" ? 0 : window.scrollY,
    };
}

function restoreScrollSnapshot(snapshot: ScrollSnapshot | null) {
    if (!snapshot || typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
        if (snapshot.routeRoot) {
            snapshot.routeRoot.scrollTop = snapshot.routeScrollTop;
        }
        window.scrollTo(snapshot.windowScrollX, snapshot.windowScrollY);
    });
}

function projectOwnerId(project: any): string | null {
    return project?.ownerId ?? project?.owner?.id ?? null;
}

function projectMemberRole(member: ProjectSettingsMember, ownerId: string | null) {
    if (member.membershipRole) return member.membershipRole;
    return ownerId && member.id === ownerId ? "owner" : "member";
}

function resetSettingsFromProject(project: any) {
    return {
        visibility: normalizeProjectVisibility(project?.visibility),
        publicTabVisibility: normalizeProjectPublicTabVisibility(project?.publicTabVisibility ?? project?.public_tab_visibility),
        memberUpdatesEnabled: project?.memberUpdatesEnabled ?? project?.member_updates_enabled ?? true,
    };
}

function normalizeStringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function areStringArraysEqual(left: string[], right: string[]) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => item === right[index]);
}

function splitProjectCategory(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return { choice: "", custom: "" };
    if (isKnownProjectType(trimmed)) return { choice: trimmed, custom: "" };
    return { choice: OTHER_PROJECT_TYPE_ID, custom: trimmed };
}

function resolveProjectCategory(choice: string, custom: string) {
    return choice === OTHER_PROJECT_TYPE_ID ? custom.trim() : choice.trim();
}

function resetIdentityFromProject(project: any) {
    const category = typeof project?.category === "string" ? project.category : "";
    const categoryState = splitProjectCategory(category);
    return {
        title: typeof project?.title === "string" ? project.title : "",
        shortDescription:
            typeof project?.shortDescription === "string"
                ? project.shortDescription
                : typeof project?.short_description === "string"
                    ? project.short_description
                    : "",
        description: typeof project?.description === "string" ? project.description : "",
        category,
        categoryChoice: categoryState.choice,
        customCategory: categoryState.custom,
        tags: normalizeStringArray(project?.tags),
        skills: normalizeStringArray(project?.skills),
        coverImage: getProjectCoverImage(project),
    };
}

function getProjectCoverImage(project: any): string {
    const cover = project?.coverImage ?? project?.cover_image ?? project?.coverImageUrl ?? project?.cover_image_url;
    return typeof cover === "string" ? cover.trim() : "";
}

export default function ProjectSettingsTab({
    projectId,
    project,
    onProjectUpdated,
    isProjectOwner,
    actorRole,
    members = [],
    loadingMembers = false,
}: ProjectSettingsTabProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const actorProjectRole = isProjectOwner ? "owner" : actorRole ?? "member";
    const canManageSettings = isProjectOwner || actorProjectRole === "admin";
    const sections = useMemo(() => {
        const visible = getVisibleProjectSettingsSections();
        if (isProjectOwner) return visible;
        if (actorProjectRole === "admin") {
            const adminSections: ProjectSettingsSectionId[] = [
                "links",
                "access",
                "collaborators",
                "roles-applications",
                "tasks-workflow",
                "files-workspace",
                "readme",
                "notifications",
            ];
            return visible.filter((section) => adminSections.includes(section.id));
        }
        return visible.filter((section) => section.id === "collaborators");
    }, [actorProjectRole, isProjectOwner]);
    const [activeSection, setActiveSection] = useState<ProjectSettingsSectionId>(
        canManageSettings && searchParams.get("settings") === "links"
            ? "links"
            : isProjectOwner ? "general" : "collaborators",
    );
    const [advancedOpen, setAdvancedOpen] = useState<Partial<Record<ProjectSettingsSectionId, boolean>>>({});
    const [savingSettings, setSavingSettings] = useState(false);
    const [uploadingCoverImage, setUploadingCoverImage] = useState(false);
    const [savingLifecycle, setSavingLifecycle] = useState(false);
    const [loadingExport, setLoadingExport] = useState(false);
    const [confirmLoading, setConfirmLoading] = useState(false);
    const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
    const [dangerPreflight, setDangerPreflight] = useState<DangerPreflight | null>(null);
    const [dangerPreflightLoading, setDangerPreflightLoading] = useState(false);
    const [accessImpact, setAccessImpact] = useState<AccessImpact | null>(null);
    const [accessImpactLoading, setAccessImpactLoading] = useState(false);
    const [settingsAuditEvents, setSettingsAuditEvents] = useState<SettingsAuditEvent[]>([]);
    const [settingsAuditLoading, setSettingsAuditLoading] = useState(false);
    const [transferOwnerId, setTransferOwnerId] = useState("");
    const [collaboratorData, setCollaboratorData] = useState<CollaboratorSettingsData | null>(null);
    const [collaboratorLoading, setCollaboratorLoading] = useState(false);
    const [collaboratorRefreshing, setCollaboratorRefreshing] = useState(false);
    const [collaboratorLoadingMore, setCollaboratorLoadingMore] = useState(false);
    const [collaboratorFilter, setCollaboratorFilter] = useState<CollaboratorFilter>("all");
    const [collaboratorSearch, setCollaboratorSearch] = useState("");
    const [fileWorkspaceData, setFileWorkspaceData] = useState<FileWorkspaceSettingsData | null>(null);
    const [fileWorkspaceLoading, setFileWorkspaceLoading] = useState(false);
    const [fileWorkspaceSavingMemberId, setFileWorkspaceSavingMemberId] = useState<string | null>(null);
    const [fileWorkspaceBulkSaving, setFileWorkspaceBulkSaving] = useState(false);
    const [projectNotificationData, setProjectNotificationData] = useState<ProjectNotificationSettingsData | null>(null);
    const [projectNotificationDraft, setProjectNotificationDraft] = useState<ProjectNotificationPolicy>(() => buildDefaultProjectNotificationPolicy());
    const [projectNotificationLoading, setProjectNotificationLoading] = useState(false);
    const [readmeSettings, setReadmeSettings] = useState<ProjectDocSettings>(() => DEFAULT_PROJECT_DOC_SETTINGS);
    const [readmeSettingsDraft, setReadmeSettingsDraft] = useState<ProjectDocSettings>(() => DEFAULT_PROJECT_DOC_SETTINGS);
    const [readmeSettingsLoading, setReadmeSettingsLoading] = useState(false);
    const [readmeSettingsSaving, setReadmeSettingsSaving] = useState(false);
    const [memberNotificationData, setMemberNotificationData] = useState<MemberNotificationSettingsData | null>(null);
    const [memberNotificationDraft, setMemberNotificationDraft] = useState<ProjectMemberNotificationOverrides>(() => normalizeProjectMemberNotificationOverrides(null));
    const [memberNotificationLoading, setMemberNotificationLoading] = useState(false);
    const [memberNotificationSaving, setMemberNotificationSaving] = useState(false);
    const [removalMode, setRemovalMode] = useState<RemovalMode>("preserve_history");
    const [removalReassignToUserId, setRemovalReassignToUserId] = useState("");
    const [removalPreflightDialog, setRemovalPreflightDialog] = useState<RemovalPreflightData | null>(null);
    const removalModeRef = useRef<RemovalMode>("preserve_history");
    const removalReassignToUserIdRef = useRef("");
    const collaboratorDataRef = useRef<CollaboratorSettingsData | null>(null);

    const initialSettings = useMemo(() => resetSettingsFromProject(project), [project]);
    const initialIdentity = useMemo(() => resetIdentityFromProject(project), [project]);
    const initialRoles = useMemo<ProjectRolesFormValues>(() => {
        const openRoles = normalizeProjectRoleFormValues(project?.openRoles ?? project?.open_roles);
        const metadata = (project?.importSource?.metadata || project?.import_source?.metadata || {}) as any;
        const leadRole: ProjectRoleFormValue = {
            id: "lead-role",
            role: metadata.leadFocus || "Lead",
            count: 1,
            description: metadata.leadDescription || "",
            skills: [],
        };
        return {
            roles: [leadRole, ...openRoles],
        };
    }, [project]);
    const [visibility, setVisibility] = useState<ProjectSettingsVisibility>(initialSettings.visibility);
    const [publicTabVisibility, setPublicTabVisibility] = useState<ProjectPublicTabVisibility>(initialSettings.publicTabVisibility);
    const [memberUpdatesEnabled, setMemberUpdatesEnabled] = useState<boolean>(initialSettings.memberUpdatesEnabled);
    const [projectTitle, setProjectTitle] = useState(initialIdentity.title);
    const [shortDescription, setShortDescription] = useState(initialIdentity.shortDescription);
    const [description, setDescription] = useState(initialIdentity.description);
    const [categoryChoice, setCategoryChoice] = useState(initialIdentity.categoryChoice);
    const [customCategory, setCustomCategory] = useState(initialIdentity.customCategory);
    const [tags, setTags] = useState<string[]>(initialIdentity.tags);
    const [skills, setSkills] = useState<string[]>(initialIdentity.skills);
    const [coverImage, setCoverImage] = useState(initialIdentity.coverImage);
    const [coverDraft, setCoverDraft] = useState<CoverDraft | null>(null);
    const [deletedRoleIds, setDeletedRoleIds] = useState<string[]>([]);
    const projectImageDragRef = useRef<ProjectImageDragState | null>(null);
    const coverInputRef = useRef<HTMLInputElement | null>(null);
    const filePickerScrollSnapshotRef = useRef<ScrollSnapshot | null>(null);
    const {
        register: registerRoles,
        control: rolesControl,
        handleSubmit: handleRolesSubmit,
        reset: resetRolesForm,
        formState: { errors: roleErrors, isDirty: rolesFormDirty },
    } = useForm<ProjectRolesFormValues>({
        resolver: zodResolver(projectRoleSettingsSchema),
        defaultValues: initialRoles,
    });
    const { fields: roleFields, append: appendRole, remove: removeRole } = useFieldArray({
        control: rolesControl,
        name: "roles",
        keyName: "fieldKey",
    });

    useEffect(() => {
        setVisibility(initialSettings.visibility);
        setPublicTabVisibility(initialSettings.publicTabVisibility);
        setMemberUpdatesEnabled(initialSettings.memberUpdatesEnabled);
    }, [initialSettings]);

    useEffect(() => {
        if (activeSection !== "roles-applications") return;
        resetRolesForm(initialRoles);
        setDeletedRoleIds([]);
    }, [activeSection, initialRoles, resetRolesForm]);

    useEffect(() => {
        collaboratorDataRef.current = collaboratorData;
    }, [collaboratorData]);

    useEffect(() => {
        removalModeRef.current = removalMode;
    }, [removalMode]);

    useEffect(() => {
        removalReassignToUserIdRef.current = removalReassignToUserId;
    }, [removalReassignToUserId]);

    useEffect(() => {
        setProjectTitle(initialIdentity.title);
        setShortDescription(initialIdentity.shortDescription);
        setDescription(initialIdentity.description);
        setCategoryChoice(initialIdentity.categoryChoice);
        setCustomCategory(initialIdentity.customCategory);
        setTags(initialIdentity.tags);
        setSkills(initialIdentity.skills);
        setCoverImage(initialIdentity.coverImage);
    }, [initialIdentity]);

    useEffect(() => {
        if (sections.some((section) => section.id === activeSection)) return;
        setActiveSection(sections[0]?.id ?? "collaborators");
    }, [activeSection, sections]);

    useEffect(() => {
        return () => {
            if (coverDraft?.previewUrl) {
                URL.revokeObjectURL(coverDraft.previewUrl);
            }
        };
    }, [coverDraft?.previewUrl]);

    const restoreFilePickerScroll = useCallback(() => {
        restoreScrollSnapshot(filePickerScrollSnapshotRef.current);
    }, []);

    useEffect(() => {
        const handleWindowFocus = () => {
            if (!filePickerScrollSnapshotRef.current) return;
            restoreFilePickerScroll();
            window.setTimeout(() => {
                restoreFilePickerScroll();
                filePickerScrollSnapshotRef.current = null;
            }, 120);
        };
        window.addEventListener("focus", handleWindowFocus);
        return () => window.removeEventListener("focus", handleWindowFocus);
    }, [restoreFilePickerScroll]);

    const ownerId = projectOwnerId(project);
    const accessPolicy = useMemo(() => buildProjectAccessPolicy({ visibility }), [visibility]);
    const accessImpactPolicy = useMemo(
        () => buildProjectAccessImpact({
            visibility,
            membersCount: accessImpact?.membersCount ?? members.length,
            followersCount: accessImpact?.followersCount ?? project?.followersCount ?? project?.followers_count ?? 0,
            openRolesCount: accessImpact?.openRolesCount ?? project?.openRoles?.length ?? project?.open_roles?.length ?? 0,
            pendingApplicationsCount: accessImpact?.pendingApplicationsCount ?? 0,
            activeTasksCount: accessImpact?.activeTasksCount ?? 0,
        }),
        [accessImpact, members.length, project?.followersCount, project?.followers_count, project?.openRoles?.length, project?.open_roles?.length, visibility],
    );
    const collaboratorMembers = collaboratorData?.members ?? members;
    const rolePolicy = useMemo(
        () => buildProjectRolePolicy({ isOwner: isProjectOwner, actorRole: actorProjectRole, ownerId, members: collaboratorMembers }),
        [actorProjectRole, collaboratorMembers, isProjectOwner, ownerId],
    );
    const filteredCollaborators = useMemo(() => {
        return rolePolicy.members.filter((member) => projectMemberRole(member, ownerId) !== "owner");
    }, [ownerId, rolePolicy.members]);
    const notificationSummary = useMemo(() => summarizeProjectNotificationPolicy(projectNotificationDraft), [projectNotificationDraft]);
    const notificationGroups = useMemo(() => groupProjectNotificationEntries(), []);
    const filePolicy = useMemo(() => buildProjectFilePolicy(), []);
    const preflightPolicy = useMemo(() => buildProjectSettingsPreflight(dangerPreflight), [dangerPreflight]);

    const visibilityDirty = visibility !== initialSettings.visibility;
    const publicTabVisibilityDirty = !areProjectPublicTabVisibilitiesEqual(publicTabVisibility, initialSettings.publicTabVisibility);
    const accessDirty = visibilityDirty || publicTabVisibilityDirty;
    const categoryValue = resolveProjectCategory(categoryChoice, customCategory);
    const identityDirty =
        projectTitle !== initialIdentity.title ||
        shortDescription !== initialIdentity.shortDescription ||
        description !== initialIdentity.description ||
        categoryValue !== initialIdentity.category ||
        !areStringArraysEqual(tags, initialIdentity.tags) ||
        !areStringArraysEqual(skills, initialIdentity.skills);
    const rolesDirty = rolesFormDirty || deletedRoleIds.length > 0;
    const notificationDirty = JSON.stringify(projectNotificationDraft) !== JSON.stringify(projectNotificationData?.policy ?? buildDefaultProjectNotificationPolicy());
    const readmeDirty = JSON.stringify(readmeSettingsDraft) !== JSON.stringify(readmeSettings);
    const updatesDirty = memberUpdatesEnabled !== initialSettings.memberUpdatesEnabled;
    const sectionDirty =
        activeSection === "general"
            ? identityDirty
            : activeSection === "access"
                ? accessDirty
                : activeSection === "roles-applications"
                    ? rolesDirty
                    : activeSection === "readme"
                        ? readmeDirty
                        : activeSection === "notifications"
                            ? notificationDirty
                            : activeSection === "updates"
                                ? updatesDirty
                                : false;

    const loadDangerPreflight = useCallback(async () => {
        setDangerPreflightLoading(true);
        try {
            const result = await getProjectDangerZonePreflightAction(projectId);
            if (!result.success) {
                setDangerPreflight(null);
                toast.error(result.message);
                return;
            }
            setDangerPreflight(result.data);
        } catch (error) {
            console.error("Failed to load danger-zone preflight", error);
            setDangerPreflight(null);
            toast.error("Failed to load danger-zone checks.");
        } finally {
            setDangerPreflightLoading(false);
        }
    }, [projectId]);

    const loadAccessImpact = useCallback(async () => {
        setAccessImpactLoading(true);
        try {
            const result = await getProjectAccessImpactAction(projectId);
            if (!result.success) {
                setAccessImpact(null);
                toast.error(result.message);
                return;
            }
            setAccessImpact(result.data);
        } catch (error) {
            console.error("Failed to load access impact", error);
            setAccessImpact(null);
            toast.error("Failed to load access impact.");
        } finally {
            setAccessImpactLoading(false);
        }
    }, [projectId]);

    const loadSettingsAudit = useCallback(async () => {
        setSettingsAuditLoading(true);
        try {
            const result = await getProjectSettingsAuditAction(projectId);
            if (!result.success) {
                setSettingsAuditEvents([]);
                toast.error(result.message);
                return;
            }
            setSettingsAuditEvents(result.data);
        } catch (error) {
            console.error("Failed to load settings audit", error);
            setSettingsAuditEvents([]);
            toast.error("Failed to load settings audit.");
        } finally {
            setSettingsAuditLoading(false);
        }
    }, [projectId]);

    const loadCollaborators = useCallback(async (mode: "initial" | "refresh" | "more" = "initial") => {
        const cursor = mode === "more" ? collaboratorDataRef.current?.nextCursor ?? undefined : undefined;
        if (mode === "refresh") {
            setCollaboratorRefreshing(true);
        } else if (mode === "more") {
            if (!cursor) return;
            setCollaboratorLoadingMore(true);
        } else {
            setCollaboratorLoading(true);
        }
        try {
            const result = await getProjectCollaboratorSettingsAction(projectId, {
                limit: 40,
                cursor,
                query: collaboratorSearch,
                roleFilter: collaboratorFilter,
            });
            if (!result.success) {
                setCollaboratorData(null);
                toast.error(result.message);
                return;
            }
            setCollaboratorData((current) => {
                if (mode !== "more" || !current) return result.data;
                const existingIds = new Set(current.members.map((member) => member.id));
                return {
                    ...result.data,
                    members: [
                        ...current.members,
                        ...result.data.members.filter((member) => !existingIds.has(member.id)),
                    ],
                    roleCounts: result.data.roleCounts,
                };
            });
        } catch (error) {
            console.error("Failed to load collaborators", error);
            setCollaboratorData(null);
            toast.error("Failed to load collaborators.");
        } finally {
            setCollaboratorLoading(false);
            setCollaboratorRefreshing(false);
            setCollaboratorLoadingMore(false);
        }
    }, [collaboratorFilter, collaboratorSearch, projectId]);

    const loadFileWorkspaceSettings = useCallback(async () => {
        setFileWorkspaceLoading(true);
        try {
            const result = await getProjectFileWorkspaceSettingsAction(projectId);
            if (!result.success) {
                setFileWorkspaceData(null);
                toast.error(result.message);
                return;
            }
            setFileWorkspaceData(result.data);
        } catch (error) {
            console.error("Failed to load file workspace settings", error);
            setFileWorkspaceData(null);
            toast.error("Failed to load file workspace settings.");
        } finally {
            setFileWorkspaceLoading(false);
        }
    }, [projectId]);

    const loadProjectNotificationSettings = useCallback(async () => {
        setProjectNotificationLoading(true);
        try {
            const result = await readProjectNotificationSettingsAction(projectId);
            if (!result.success) {
                setProjectNotificationData(null);
                toast.error(result.message);
                return;
            }
            setProjectNotificationData(result.data);
            setProjectNotificationDraft(result.data.policy);
        } catch (error) {
            console.error("Failed to load project notification settings", error);
            setProjectNotificationData(null);
            toast.error("Failed to load project notification settings.");
        } finally {
            setProjectNotificationLoading(false);
        }
    }, [projectId]);

    const loadReadmeSettings = useCallback(async () => {
        setReadmeSettingsLoading(true);
        try {
            const result = await readProjectDocSettingsAction(projectId);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            const normalized = normalizeProjectDocSettings(result.settings);
            setReadmeSettings(normalized);
            setReadmeSettingsDraft(normalized);
        } catch (error) {
            console.error("Failed to load document settings", error);
            toast.error("Failed to load document settings.");
        } finally {
            setReadmeSettingsLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        if (activeSection !== "danger") return;
        void loadDangerPreflight();
    }, [activeSection, loadDangerPreflight]);

    useEffect(() => {
        if (activeSection !== "access") return;
        void loadAccessImpact();
    }, [activeSection, loadAccessImpact]);

    useEffect(() => {
        if (activeSection !== "security-audit") return;
        void loadSettingsAudit();
    }, [activeSection, loadSettingsAudit]);

    useEffect(() => {
        if (activeSection !== "files-workspace") return;
        void loadFileWorkspaceSettings();
    }, [activeSection, loadFileWorkspaceSettings]);

    useEffect(() => {
        if (activeSection !== "notifications") return;
        void loadProjectNotificationSettings();
    }, [activeSection, loadProjectNotificationSettings]);

    useEffect(() => {
        if (activeSection !== "readme") return;
        void loadReadmeSettings();
    }, [activeSection, loadReadmeSettings]);

    useEffect(() => {
        if (activeSection !== "collaborators" && activeSection !== "roles-applications") return;
        const timer = window.setTimeout(() => {
            void loadCollaborators("initial");
        }, collaboratorData ? 180 : 0);
        return () => window.clearTimeout(timer);
    }, [activeSection, collaboratorFilter, collaboratorSearch, loadCollaborators]);

    const saveAccessSettings = useCallback(async (confirmationToken: string) => {
        const messages: string[] = [];
        if (visibilityDirty) {
            const result = await updateProjectVisibilityAction(projectId, visibility, confirmationToken);
            if (!result.success) {
                return { success: false, message: result.message };
            }
            messages.push(result.message);
        }
        if (publicTabVisibilityDirty) {
            const result = await updateProjectPublicTabVisibilityAction(projectId, publicTabVisibility);
            if (!result.success) {
                return { success: false, message: result.message };
            }
            messages.push(result.message);
        }
        return { success: true, message: messages.join(" ") || "Access settings updated.", refresh: true };
    }, [projectId, publicTabVisibility, publicTabVisibilityDirty, visibility, visibilityDirty]);

    const handleSaveAccess = useCallback(async () => {
        if (!accessDirty) return;

        setSavingSettings(true);
        try {
            if (!visibilityDirty) {
                const result = await updateProjectPublicTabVisibilityAction(projectId, publicTabVisibility);
                if (!result.success) {
                    toast.error(result.message);
                    return;
                }
                toast.success(result.message);
                onProjectUpdated();
                router.refresh();
                return;
            }
            const preflightResult = await getProjectAccessTransitionPreflightAction(projectId, visibility);
            if (!preflightResult.success) {
                toast.error(preflightResult.message);
                return;
            }
            const preflight: AccessTransitionPreflightData = preflightResult.data;
            const isPrivateTransition = preflight.nextVisibility === "private";
            setConfirmAction({
                title: isPrivateTransition ? "Make project private" : "Make project public",
                description: preflight.policy.confirmationSummary.join(" "),
                confirmLabel: isPrivateTransition ? "Make private" : "Make public",
                variant: isPrivateTransition ? "destructive" : "default",
                content: <AccessTransitionDetails preflight={preflight} />,
                action: () => saveAccessSettings(preflight.confirmationToken),
            });
            return;
        } catch (error) {
            console.error("Failed to prepare access transition", error);
            toast.error("Failed to prepare access transition.");
        } finally {
            setSavingSettings(false);
        }
    }, [accessDirty, onProjectUpdated, projectId, publicTabVisibility, router, saveAccessSettings, visibility, visibilityDirty]);

    const handleSaveGeneral = useCallback(async () => {
        const trimmedTitle = projectTitle.trim();
        if (!trimmedTitle) {
            toast.error("Project name cannot be empty.");
            return;
        }
        const nextCategory = resolveProjectCategory(categoryChoice, customCategory);
        if (categoryChoice === OTHER_PROJECT_TYPE_ID && !nextCategory) {
            toast.error("Add a custom category or choose one from the dropdown.");
            return;
        }
        setSavingSettings(true);
        try {
            const identityResult = await updateProject(projectId, {
                title: trimmedTitle,
                shortDescription: shortDescription.trim() || null,
                description: description.trim() || null,
                category: nextCategory || null,
                tags,
                skills,
            });
            if (!identityResult?.success) {
                toast.error("Failed to update project identity.");
                return;
            }

            toast.success("General settings updated.");
            onProjectUpdated();
            router.refresh();
        } catch (error) {
            console.error("Failed to save general project settings", error);
            toast.error(error instanceof Error ? error.message : "Failed to save general settings.");
        } finally {
            setSavingSettings(false);
        }
    }, [
        categoryChoice,
        customCategory,
        description,
        onProjectUpdated,
        projectId,
        projectTitle,
        router,
        shortDescription,
        skills,
        tags,
    ]);

    const handleAddSettingsRole = useCallback(() => {
        appendRole({ role: "New Role", count: 1, description: "", skills: [] });
    }, [appendRole]);

    const handleRemoveSettingsRole = useCallback((index: number, roleId?: string) => {
        if (roleId) {
            setDeletedRoleIds((current) => current.includes(roleId) ? current : [...current, roleId]);
        }
        removeRole(index);
    }, [removeRole]);

    const handleCancelRoles = useCallback(() => {
        resetRolesForm(initialRoles);
        setDeletedRoleIds([]);
    }, [initialRoles, resetRolesForm]);

    const handleSaveRoles = useCallback(() => {
        void handleRolesSubmit(
            async (values) => {
                setSavingSettings(true);
                try {
                    const result = await updateProject(projectId, {
                        roles: values.roles,
                        deletedRoleIds,
                    });
                    if (!result?.success) {
                        toast.error("Failed to update project roles.");
                        return;
                    }

                    const leadRole = values.roles.find((r) => r.id === "lead-role");
                    const nextOpenRoles = normalizeProjectRoleFormValues((result as { openRoles?: unknown }).openRoles);
                    const nextRoles = leadRole ? [leadRole, ...nextOpenRoles] : nextOpenRoles;
                    resetRolesForm({ roles: nextRoles });
                    setDeletedRoleIds([]);
                    toast.success("Project roles updated.");
                    onProjectUpdated();
                    router.refresh();
                } catch (error) {
                    console.error("Failed to save project roles", error);
                    toast.error(error instanceof Error ? error.message : "Failed to update project roles.");
                } finally {
                    setSavingSettings(false);
                }
            },
            () => {
                toast.error("Fix role fields before saving.");
            },
        )();
    }, [deletedRoleIds, handleRolesSubmit, onProjectUpdated, projectId, resetRolesForm, router]);

    const handleTogglePublicTab = useCallback((tabId: ProjectPublicTabId, enabled: boolean) => {
        setPublicTabVisibility((current) => ({
            ...current,
            [tabId]: enabled,
        }));
    }, []);

    const handleToggleMemberFileUpload = useCallback(async (member: FileWorkspaceSettingsData["members"][number], enabled: boolean) => {
        if (member.uploadPermissionLocked) return;
        setFileWorkspaceSavingMemberId(member.id);
        try {
            const result = await updateProjectMemberFileUploadAction(projectId, member.id, enabled);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            toast.success(result.message);
            await loadFileWorkspaceSettings();
            void loadSettingsAudit();
        } catch (error) {
            console.error("Failed to update file upload permission", error);
            toast.error("Failed to update file upload permission.");
        } finally {
            setFileWorkspaceSavingMemberId(null);
        }
    }, [loadFileWorkspaceSettings, loadSettingsAudit, projectId]);

    const handleBulkFileUploadPermission = useCallback(async (enabled: boolean) => {
        setFileWorkspaceBulkSaving(true);
        try {
            const result = await updateProjectFileUploadDefaultsAction(projectId, enabled);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            toast.success(result.message);
            await loadFileWorkspaceSettings();
            void loadSettingsAudit();
        } catch (error) {
            console.error("Failed to update file upload defaults", error);
            toast.error("Failed to update file upload defaults.");
        } finally {
            setFileWorkspaceBulkSaving(false);
        }
    }, [loadFileWorkspaceSettings, loadSettingsAudit, projectId]);

    const handleProjectNotificationPreset = useCallback((preset: ProjectNotificationPreset) => {
        setProjectNotificationDraft(buildDefaultProjectNotificationPolicy(preset));
    }, []);

    const handleProjectNotificationToggle = useCallback((eventKey: ProjectNotificationEventKey, enabled: boolean) => {
        setProjectNotificationDraft((current) => {
            const normalized = normalizeProjectNotificationPolicy(current);
            const entryDecision = resolveProjectNotificationDecision({ eventKey, projectPolicy: normalized });
            if (entryDecision.mandatory) return normalized;
            return {
                ...normalized,
                rules: {
                    ...normalized.rules,
                    [eventKey]: {
                        ...normalized.rules[eventKey],
                        enabled,
                    },
                },
            };
        });
    }, []);

    const handleSaveNotifications = useCallback(async () => {
        setSavingSettings(true);
        try {
            const result = await updateProjectNotificationSettingsAction(projectId, projectNotificationDraft);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            setProjectNotificationData(result.data);
            setProjectNotificationDraft(result.data.policy);
            toast.success(result.message ?? "Project notification settings updated.");
            void loadSettingsAudit();
        } catch (error) {
            console.error("Failed to save project notification settings", error);
            toast.error("Failed to save project notification settings.");
        } finally {
            setSavingSettings(false);
        }
    }, [loadSettingsAudit, projectId, projectNotificationDraft]);

    const handleSaveReadmeSettings = useCallback(async () => {
        setReadmeSettingsSaving(true);
        try {
            const result = await updateProjectDocSettingsAction(projectId, readmeSettingsDraft);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            const normalized = normalizeProjectDocSettings(result.settings);
            setReadmeSettings(normalized);
            setReadmeSettingsDraft(normalized);
            toast.success("Document settings updated.");
            void loadSettingsAudit();
            onProjectUpdated();
        } catch (error) {
            console.error("Failed to save document settings", error);
            toast.error("Failed to save document settings.");
        } finally {
            setReadmeSettingsSaving(false);
        }
    }, [loadSettingsAudit, onProjectUpdated, projectId, readmeSettingsDraft]);

    const handleResetNotifications = useCallback(async () => {
        setSavingSettings(true);
        try {
            const result = await resetProjectNotificationSettingsAction(projectId, "balanced");
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            setProjectNotificationData(result.data);
            setProjectNotificationDraft(result.data.policy);
            toast.success(result.message ?? "Project notification settings reset.");
            void loadSettingsAudit();
        } catch (error) {
            console.error("Failed to reset project notification settings", error);
            toast.error("Failed to reset project notification settings.");
        } finally {
            setSavingSettings(false);
        }
    }, [loadSettingsAudit, projectId]);

    const openMemberNotificationSettings = useCallback(async (member: ProjectSettingsMember) => {
        setMemberNotificationData(null);
        setMemberNotificationDraft(normalizeProjectMemberNotificationOverrides(null));
        setMemberNotificationLoading(true);
        setConfirmAction({
            title: "Member notification settings",
            description: `Review ${getProjectMemberDisplayName(member)}'s project notification preferences.`,
            confirmLabel: "Close",
            variant: "default",
            action: async () => ({ success: true, message: "Notification settings closed." }),
        });
        try {
            const result = await readProjectMemberNotificationSettingsAction(projectId, member.id);
            if (!result.success) {
                toast.error(result.message);
                setConfirmAction(null);
                return;
            }
            setMemberNotificationData(result.data);
            setMemberNotificationDraft(result.data.overrides);
        } catch (error) {
            console.error("Failed to load member notification settings", error);
            toast.error("Failed to load member notification settings.");
            setConfirmAction(null);
        } finally {
            setMemberNotificationLoading(false);
        }
    }, [projectId]);

    const handleSaveMemberNotifications = useCallback(async () => {
        if (!memberNotificationData) return;
        setMemberNotificationSaving(true);
        try {
            const result = await updateProjectMemberNotificationSettingsAction(projectId, memberNotificationData.member.id, memberNotificationDraft);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            setMemberNotificationData(result.data);
            setMemberNotificationDraft(result.data.overrides);
            toast.success(result.message ?? "Member notification preferences updated.");
        } catch (error) {
            console.error("Failed to save member notification settings", error);
            toast.error("Failed to save member notification settings.");
        } finally {
            setMemberNotificationSaving(false);
        }
    }, [memberNotificationData, memberNotificationDraft, projectId]);

    const handleResetMemberNotifications = useCallback(async () => {
        if (!memberNotificationData) return;
        setMemberNotificationSaving(true);
        try {
            const result = await resetProjectMemberNotificationSettingsAction(projectId, memberNotificationData.member.id);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            setMemberNotificationData(result.data);
            setMemberNotificationDraft(result.data.overrides);
            toast.success(result.message ?? "Member notification preferences reset.");
        } catch (error) {
            console.error("Failed to reset member notification settings", error);
            toast.error("Failed to reset member notification settings.");
        } finally {
            setMemberNotificationSaving(false);
        }
    }, [memberNotificationData, projectId]);

    const handleSaveUpdatesSettings = useCallback(async () => {
        setSavingSettings(true);
        try {
            const result = await updateProject(projectId, {
                memberUpdatesEnabled,
            });
            if (!result?.success) {
                toast.error("Failed to update updates settings.");
                return;
            }
            toast.success("Updates settings updated.");
            onProjectUpdated();
            router.refresh();
        } catch (error) {
            console.error("Failed to save updates settings", error);
            toast.error(error instanceof Error ? error.message : "Failed to save updates settings.");
        } finally {
            setSavingSettings(false);
        }
    }, [memberUpdatesEnabled, onProjectUpdated, projectId, router]);

    const handleSaveCurrentSection = useCallback(() => {
        if (activeSection === "general") {
            void handleSaveGeneral();
            return;
        }
        if (activeSection === "access") {
            void handleSaveAccess();
            return;
        }
        if (activeSection === "roles-applications") {
            handleSaveRoles();
            return;
        }
        if (activeSection === "readme") {
            void handleSaveReadmeSettings();
            return;
        }
        if (activeSection === "notifications") {
            void handleSaveNotifications();
            return;
        }
        if (activeSection === "updates") {
            void handleSaveUpdatesSettings();
        }
    }, [activeSection, handleSaveAccess, handleSaveGeneral, handleSaveNotifications, handleSaveReadmeSettings, handleSaveRoles, handleSaveUpdatesSettings]);

    const handleCancelCurrentSection = useCallback(() => {
        if (activeSection === "general") {
            setProjectTitle(initialIdentity.title);
            setShortDescription(initialIdentity.shortDescription);
            setDescription(initialIdentity.description);
            setCategoryChoice(initialIdentity.categoryChoice);
            setCustomCategory(initialIdentity.customCategory);
            setTags(initialIdentity.tags);
            setSkills(initialIdentity.skills);
            return;
        }
        if (activeSection === "access") {
            setVisibility(initialSettings.visibility);
            setPublicTabVisibility(initialSettings.publicTabVisibility);
            return;
        }
        if (activeSection === "roles-applications") {
            handleCancelRoles();
            return;
        }
        if (activeSection === "readme") {
            setReadmeSettingsDraft(readmeSettings);
            return;
        }
        if (activeSection === "notifications") {
            setProjectNotificationDraft(projectNotificationData?.policy ?? buildDefaultProjectNotificationPolicy());
            return;
        }
        if (activeSection === "updates") {
            setMemberUpdatesEnabled(initialSettings.memberUpdatesEnabled);
        }
    }, [activeSection, handleCancelRoles, initialIdentity, initialSettings, projectNotificationData?.policy, readmeSettings]);

    const handleExport = useCallback(async () => {
        setLoadingExport(true);
        try {
            const payload = {
                exportedAt: new Date().toISOString(),
                projectId,
                project: {
                    id: project?.id ?? projectId,
                    title: project?.title ?? "Project",
                    slug: project?.slug ?? null,
                    description: project?.description ?? null,
                    visibility: project?.visibility ?? null,
                    status: project?.status ?? null,
                    lifecycleStages: project?.lifecycleStages ?? project?.lifecycle_stages ?? [],
                    currentStageIndex: project?.currentStageIndex ?? project?.current_stage_index ?? 0,
                    tags: project?.tags ?? [],
                    skills: project?.skills ?? [],
                    category: project?.category ?? null,
                    lookingForCollaborators: Boolean(project?.lookingForCollaborators),
                    maxCollaborators: project?.maxCollaborators ?? null,
                },
                members: collaboratorMembers.map((member) => ({
                    id: member.id,
                    displayName: getProjectMemberDisplayName(member),
                    membershipRole: projectMemberRole(member, ownerId),
                    projectRoleTitle: member.projectRoleTitle ?? null,
                })),
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const href = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = href;
            anchor.download = `${(project?.slug || project?.title || "project").toString().replace(/\s+/g, "-").toLowerCase()}-project-export.json`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(href), 250);
            toast.success("Project snapshot exported.");
        } catch (error) {
            console.error("Failed to export project settings", error);
            toast.error("Failed to export project data.");
        } finally {
            setLoadingExport(false);
        }
    }, [collaboratorMembers, ownerId, project, projectId]);

    const handleCoverImageUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        restoreFilePickerScroll();
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        if (!ALLOWED_PROJECT_IMAGE_MIME_TYPES.has(file.type)) {
            toast.error("Unsupported image type. Use JPG, PNG, WebP, or GIF.");
            return;
        }

        const previewUrl = URL.createObjectURL(file);
        try {
            const dimensions = await readImageDimensions(previewUrl);
            setCoverDraft((current) => {
                if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
                return {
                    file,
                    previewUrl,
                    naturalWidth: dimensions.width,
                    naturalHeight: dimensions.height,
                    zoom: PROJECT_IMAGE_MIN_ZOOM,
                    offsetX: 0,
                    offsetY: 0,
                };
            });
        } catch (error) {
            URL.revokeObjectURL(previewUrl);
            console.error("Failed to prepare project avatar preview", error);
            toast.error("Failed to read selected image.");
        } finally {
            window.setTimeout(() => {
                restoreFilePickerScroll();
                filePickerScrollSnapshotRef.current = null;
            }, 50);
        }
    }, [restoreFilePickerScroll]);

    const handleOpenProjectImagePicker = useCallback(() => {
        if (uploadingCoverImage) return;
        filePickerScrollSnapshotRef.current = captureScrollSnapshot();
        coverInputRef.current?.click();
        restoreFilePickerScroll();
    }, [restoreFilePickerScroll, uploadingCoverImage]);

    const updateCoverDraftTransform = useCallback((updates: Partial<Pick<CoverDraft, "zoom" | "offsetX" | "offsetY">>) => {
        setCoverDraft((current) => current ? normalizeProjectImageDraft(current, updates) : current);
    }, []);

    const handleResetProjectImageDraft = useCallback(() => {
        setCoverDraft((current) => current ? normalizeProjectImageDraft(current, {
            zoom: PROJECT_IMAGE_MIN_ZOOM,
            offsetX: 0,
            offsetY: 0,
        }) : current);
    }, []);

    const handleFitProjectImageDraft = useCallback(() => {
        setCoverDraft((current) => current ? fitProjectImageDraft(current) : current);
    }, []);

    const handleFillProjectImageDraft = useCallback(() => {
        setCoverDraft((current) => current ? fillProjectImageDraft(current) : current);
    }, []);

    const handleProjectImagePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (!coverDraft || uploadingCoverImage) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        projectImageDragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: coverDraft.offsetX,
            offsetY: coverDraft.offsetY,
        };
    }, [coverDraft, uploadingCoverImage]);

    const handleProjectImagePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const dragState = projectImageDragRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        event.preventDefault();
        updateCoverDraftTransform({
            offsetX: dragState.offsetX + event.clientX - dragState.startX,
            offsetY: dragState.offsetY + event.clientY - dragState.startY,
        });
    }, [updateCoverDraftTransform]);

    const handleProjectImagePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (projectImageDragRef.current?.pointerId === event.pointerId) {
            projectImageDragRef.current = null;
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }, []);

    const projectImagePreviewMetricsValue = coverDraft ? projectImagePreviewMetrics(coverDraft) : null;

    const handlePublishCoverDraft = useCallback(async () => {
        if (!coverDraft) return;
        setUploadingCoverImage(true);
        try {
            const [{ prepareProjectImageForUpload }, { uploadToSupabaseSignedUrl }] = await Promise.all([
                import("@/lib/upload/image-prep-client"),
                import("@/lib/upload/supabase-signed-upload-client"),
            ]);
            const preparedImage = await prepareProjectImageForUpload(coverDraft.file, {
                maxBytes: PROJECT_IMAGE_UPLOAD_MAX_BYTES,
                size: PROJECT_IMAGE_OUTPUT_SIZE,
                previewSize: PROJECT_IMAGE_PREVIEW_SIZE,
                zoom: coverDraft.zoom,
                offsetX: coverDraft.offsetX,
                offsetY: coverDraft.offsetY,
                outputType: "image/jpeg",
            });
            const uploadSession = await createProjectCoverImageUploadUrlAction({
                projectId,
                mimeType: preparedImage.contentType,
                sizeBytes: preparedImage.blob.size,
            });
            if (!uploadSession.success) {
                throw new Error(uploadSession.error || "Failed to prepare project avatar upload");
            }

            await uploadToSupabaseSignedUrl(uploadSession, preparedImage.blob, { cacheProfile: "immutable" });

            const finalized = await finalizeProjectCoverImageUploadAction({
                projectId,
                uploadIntentId: uploadSession.uploadIntentId,
            });
            if (!finalized.success) {
                throw new Error(finalized.error || "Failed to finalize project avatar upload");
            }

            setCoverImage(finalized.publicUrl);
            setCoverDraft(null);
            toast.success(preparedImage.optimized ? "Project avatar optimized and updated." : "Project avatar updated.");
            onProjectUpdated({ coverImage: finalized.publicUrl });
            router.refresh();
        } catch (error) {
            console.error("Failed to upload project avatar", error);
            toast.error(error instanceof Error ? error.message : "Failed to upload project avatar.");
        } finally {
            setUploadingCoverImage(false);
        }
    }, [coverDraft, onProjectUpdated, projectId, router]);

    const handleCancelCoverDraft = useCallback(() => {
        setCoverDraft((current) => {
            if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
            return null;
        });
    }, []);

    const handleClearCoverImage = useCallback(async () => {
        if (coverDraft) {
            handleCancelCoverDraft();
            return;
        }
        setUploadingCoverImage(true);
        try {
            const result = await clearProjectCoverImageAction(projectId);
            if (!result?.success) {
                throw new Error(result.error || "Failed to remove project avatar");
            }
            setCoverImage("");
            toast.success("Project avatar removed.");
            onProjectUpdated({ coverImage: null });
            router.refresh();
        } catch (error) {
            console.error("Failed to remove project avatar", error);
            toast.error(error instanceof Error ? error.message : "Failed to remove project avatar.");
        } finally {
            setUploadingCoverImage(false);
        }
    }, [coverDraft, handleCancelCoverDraft, onProjectUpdated, projectId, router]);

    const runConfirmAction = useCallback(async () => {
        if (!confirmAction) return;
        setConfirmLoading(true);
        try {
            const result = await confirmAction.action();
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            toast.success(result.message);
            if (result.refresh) {
                void loadAccessImpact();
                void loadCollaborators("refresh");
                void loadSettingsAudit();
                onProjectUpdated();
                router.refresh();
            }
            setConfirmAction(null);
            setRemovalPreflightDialog(null);
            setMemberNotificationData(null);
            setMemberNotificationDraft(normalizeProjectMemberNotificationOverrides(null));
            if (result.redirectTo) {
                router.push(result.redirectTo);
            }
        } catch (error) {
            console.error("Confirm action failed", error);
            toast.error("Action failed. Please try again.");
        } finally {
            setConfirmLoading(false);
        }
    }, [confirmAction, loadAccessImpact, loadCollaborators, loadSettingsAudit, onProjectUpdated, router]);

    const prepareArchive = useCallback(() => {
        if (!dangerPreflight) {
            toast.error("Run danger-zone preflight before archiving.");
            return;
        }
        if (dangerPreflight && !dangerPreflight.canArchive) {
            toast.error("Project is already archived.");
            return;
        }
        setConfirmAction({
            title: "Archive project",
            description: "Archive hides this project from normal discovery and marks it archived. Existing members keep safe access for historical context.",
            confirmLabel: "Archive project",
            variant: "destructive",
            action: async () => {
                const result = await archiveProjectAction(projectId);
                if (!result.success) {
                    return { success: false, message: result.message };
                }
                await loadDangerPreflight();
                return { success: true, message: result.message, refresh: true };
            },
        });
    }, [dangerPreflight, loadDangerPreflight, projectId]);

    const prepareTransferToMember = useCallback((candidate: ProjectSettingsMember) => {
        setConfirmAction({
            title: "Transfer project ownership",
            description: `${getProjectMemberDisplayName(candidate)} will become the project owner. You will be demoted to admin and lose owner-only danger-zone permissions.`,
            confirmLabel: "Transfer ownership",
            variant: "destructive",
            action: async () => {
                const result = await transferProjectOwnership(projectId, candidate.id);
                if (!result.success) {
                    return {
                        success: false,
                        message: result.error ?? "Failed to transfer ownership.",
                    };
                }
                return {
                    success: true,
                    message: "Project ownership transferred.",
                    refresh: true,
                };
            },
        });
    }, [projectId]);

    const prepareTransfer = useCallback(() => {
        const candidate = rolePolicy.transferCandidates.find((member) => member.id === transferOwnerId);
        if (!candidate) {
            toast.error("Choose a member before transferring ownership.");
            return;
        }
        prepareTransferToMember(candidate);
    }, [prepareTransferToMember, rolePolicy.transferCandidates, transferOwnerId]);

    const prepareRoleChange = useCallback((member: ProjectSettingsMember, nextRole: Exclude<ProjectMemberRole, "owner">) => {
        const currentRole = projectMemberRole(member, ownerId);
        if (currentRole === nextRole) {
            toast.info(`${getProjectMemberDisplayName(member)} is already ${getProjectMemberRoleLabel(nextRole)}.`);
            return;
        }
        const policy = buildProjectMemberMutationPolicy({
            actorIsOwner: isProjectOwner,
            actorRole: actorProjectRole,
            ownerId,
            targetUserId: member.id,
            targetRole: currentRole,
            nextRole,
        });
        if (!policy.canChangeRole) {
            toast.error(policy.blockedReason ?? "This member role cannot be changed.");
            return;
        }
        setConfirmAction({
            title: `Change role to ${getProjectMemberRoleLabel(nextRole)}`,
            description: `${getProjectMemberDisplayName(member)} will move from ${getProjectMemberRoleLabel(currentRole as ProjectMemberRole)} to ${getProjectMemberRoleLabel(nextRole)}. This updates collaborator permissions, task/file access, application review affordances, notifications, and project audit history.`,
            confirmLabel: "Change role",
            variant: nextRole === "viewer" ? "destructive" : "default",
            action: async () => {
                const result = await updateProjectMemberRoleAction(projectId, member.id, nextRole);
                if (!result.success) {
                    return { success: false, message: result.message };
                }
                return { success: true, message: result.message, refresh: true };
            },
        });
    }, [actorProjectRole, isProjectOwner, ownerId, projectId]);

    const prepareRemoveMember = useCallback(async (member: ProjectSettingsMember) => {
        const currentRole = projectMemberRole(member, ownerId);
        const policy = buildProjectMemberMutationPolicy({
            actorIsOwner: isProjectOwner,
            actorRole: actorProjectRole,
            ownerId,
            targetUserId: member.id,
            targetRole: currentRole,
        });
        if (!policy.canRemove) {
            toast.error(policy.blockedReason ?? "This member cannot be removed.");
            return;
        }

        try {
            const result = await getProjectMemberRemovalPreflightAction(projectId, member.id);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            const preflight: RemovalPreflightData = result.data;
            const policyPreview = buildProjectMemberRemovalPreflight(preflight);
            setRemovalMode(policyPreview.defaultMode);
            setRemovalReassignToUserId(preflight.reassignmentCandidates?.[0]?.id ?? "");
            setRemovalPreflightDialog(preflight);
            setConfirmAction({
                title: `Remove ${policyPreview.displayName}`,
                description: `${policyPreview.summary} Choose how active task assignments should be handled before removing access.`,
                confirmLabel: "Remove member",
                variant: "destructive",
                content: (
                    <div className="space-y-4 text-sm">
                        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100">
                            <p className="font-semibold">Access removal impact</p>
                            <ul className="mt-2 space-y-1 text-xs leading-5">
                                {policyPreview.affectedAreas.map((area) => (
                                    <li key={area}>{area}</li>
                                ))}
                            </ul>
                        </div>

                        <RemovalImpactDetails preflight={preflight} />

                        <fieldset className="space-y-2">
                            <legend className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Removal mode</legend>
                            {([
                                ["preserve_history", "Preserve history", "Keep active assignments in place and label them Removed from project · Needs reassignment."],
                                ["unassign_active_tasks", "Unassign active tasks", "Clear this member from active task assignee fields while preserving creator/comment/file history."],
                                ["reassign_active_tasks", "Reassign active tasks", "Move active assigned tasks to another eligible active collaborator."],
                            ] as const).map(([mode, label, detail]) => (
                                <label key={mode} className="flex cursor-pointer gap-3 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
                                    <input
                                        type="radio"
                                        name="project-member-removal-mode"
                                        value={mode}
                                        checked={removalMode === mode}
                                        onChange={() => setRemovalMode(mode)}
                                        className="mt-1"
                                    />
                                    <span>
                                        <span className="block font-semibold text-zinc-950 dark:text-zinc-50">{label}</span>
                                        <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{detail}</span>
                                    </span>
                                </label>
                            ))}
                        </fieldset>

                        {removalMode === "reassign_active_tasks" ? (
                            <label className="block">
                                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Replacement assignee</span>
                                <select
                                    value={removalReassignToUserId}
                                    onChange={(event) => setRemovalReassignToUserId(event.target.value)}
                                    className="mt-2 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-zinc-800 dark:bg-zinc-950"
                                >
                                    {(preflight.reassignmentCandidates ?? []).map((candidate) => (
                                        <option key={candidate.id} value={candidate.id}>
                                            {getProjectMemberDisplayName(candidate)} · {getProjectMemberRoleLabel(candidate.membershipRole)}
                                        </option>
                                    ))}
                                </select>
                                {(preflight.reassignmentCandidates ?? []).length === 0 ? (
                                    <span className="mt-2 block text-xs text-red-500">No eligible replacement assignee is available.</span>
                                ) : null}
                            </label>
                        ) : null}
                    </div>
                ),
                action: async () => {
                    const nextMode = removalModeRef.current;
                    const reassignToUserId = removalReassignToUserIdRef.current || null;
                    if (nextMode === "reassign_active_tasks" && !reassignToUserId) {
                        return { success: false, message: "Choose a replacement assignee." };
                    }
                    const removeResult = await removeProjectMemberAction(projectId, member.id, {
                        mode: nextMode,
                        reassignToUserId: nextMode === "reassign_active_tasks" ? reassignToUserId : null,
                    });
                    if (!removeResult.success) {
                        return { success: false, message: removeResult.message };
                    }
                    return { success: true, message: removeResult.message, refresh: true };
                },
            });
        } catch (error) {
            console.error("Failed to load member removal preflight", error);
            toast.error("Failed to load removal impact.");
        }
    }, [actorProjectRole, isProjectOwner, ownerId, projectId]);

    const prepareDelete = useCallback(() => {
        if (!dangerPreflight) {
            toast.error("Run danger-zone preflight before deleting.");
            return;
        }
        if (dangerPreflight && !dangerPreflight.canDelete) {
            toast.error("Project cannot be deleted.");
            return;
        }
        setConfirmAction({
            title: "Delete project",
            description: "This permanently deletes the project and its associated data. This action cannot be undone.",
            confirmLabel: "Delete project",
            variant: "destructive",
            action: async () => {
                const result = await deleteProject(projectId);
                if (!result.success) {
                    return { success: false, message: result.message };
                }
                return {
                    success: true,
                    message: result.message,
                    redirectTo: result.data.redirectTo,
                };
            },
        });
    }, [dangerPreflight, projectId]);

    const toggleAdvanced = useCallback((sectionId: ProjectSettingsSectionId) => {
        setAdvancedOpen((current) => ({
            ...current,
            [sectionId]: !current[sectionId],
        }));
    }, []);

    if (!canManageSettings) {
        return (
            <div className="mx-auto flex max-w-xl flex-col items-center justify-center rounded-3xl border border-zinc-200 bg-white px-8 py-16 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-900">
                    <Lock className="h-8 w-8 text-zinc-400" />
                </div>
                <h3 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Settings require collaborator management access</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                    Leads can manage every setting. Co-leaders can manage member and viewer lifecycle. Ask the lead for access if you need to change collaborators.
                </p>
            </div>
        );
    }

    const coverImageUrl = coverImage.trim();
    const coverInputId = `project-image-${projectId}`;
    const confirmDialogContent = removalPreflightDialog ? (() => {
        const policyPreview = buildProjectMemberRemovalPreflight(removalPreflightDialog);
        return (
            <div className="space-y-4 text-sm">
                <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100">
                    <p className="font-semibold">Access removal impact</p>
                    <ul className="mt-2 space-y-1 text-xs leading-5">
                        {policyPreview.affectedAreas.map((area) => (
                            <li key={area}>{area}</li>
                        ))}
                    </ul>
                </div>

                <RemovalImpactDetails preflight={removalPreflightDialog} />

                <fieldset className="space-y-2">
                    <legend className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Removal mode</legend>
                    {([
                        ["preserve_history", "Preserve history", "Keep active assignments in place and label them Removed from project · Needs reassignment."],
                        ["unassign_active_tasks", "Unassign active tasks", "Clear this member from active task assignee fields while preserving creator/comment/file history."],
                        ["reassign_active_tasks", "Reassign active tasks", "Move active assigned tasks to another eligible active collaborator."],
                    ] as const).map(([mode, label, detail]) => (
                        <label key={mode} className="flex cursor-pointer gap-3 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
                            <input
                                type="radio"
                                name="project-member-removal-mode"
                                value={mode}
                                checked={removalMode === mode}
                                onChange={() => setRemovalMode(mode)}
                                className="mt-1"
                            />
                            <span>
                                <span className="block font-semibold text-zinc-950 dark:text-zinc-50">{label}</span>
                                <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{detail}</span>
                            </span>
                        </label>
                    ))}
                </fieldset>

                {removalMode === "reassign_active_tasks" ? (
                    <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Replacement assignee</span>
                        <select
                            value={removalReassignToUserId}
                            onChange={(event) => setRemovalReassignToUserId(event.target.value)}
                            className="mt-2 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-zinc-800 dark:bg-zinc-950"
                        >
                            {(removalPreflightDialog.reassignmentCandidates ?? []).map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                    {getProjectMemberDisplayName(candidate)} · {getProjectMemberRoleLabel(candidate.membershipRole)}
                                </option>
                            ))}
                        </select>
                        {(removalPreflightDialog.reassignmentCandidates ?? []).length === 0 ? (
                            <span className="mt-2 block text-xs text-red-500">No eligible replacement assignee is available.</span>
                        ) : null}
                    </label>
                ) : null}
            </div>
        );
    })() : memberNotificationLoading || memberNotificationData ? (
        <MemberNotificationSettingsEditor
            data={memberNotificationData}
            draft={memberNotificationDraft}
            isLoading={memberNotificationLoading}
            isSaving={memberNotificationSaving}
            projectPolicy={projectNotificationData?.policy ?? projectNotificationDraft}
            onDraftChange={setMemberNotificationDraft}
            onSave={handleSaveMemberNotifications}
            onReset={handleResetMemberNotifications}
        />
    ) : confirmAction?.content;

    return (
        <div className="mx-auto grid w-full max-w-7xl gap-6 p-4 sm:p-6 lg:p-8 xl:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="h-fit rounded-3xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-var(--ui-topnav-height)-8rem)] xl:overflow-y-auto xl:app-scroll xl:app-scroll-y xl:app-scroll-gutter">
                <div className="px-3 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-400">Project settings</p>
                    <h2 className="mt-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">Control center</h2>
                    <p className="mt-2 text-sm leading-5 text-zinc-500">
                        {isProjectOwner
                            ? "Lead settings with one canonical policy path across the app."
                            : "Role-scoped access with canonical fallback checks."}
                    </p>
                </div>
                <nav className="mt-2 space-y-1">
                    {sections.map((section) => {
                        const Icon = SECTION_ICONS[section.id];
                        const active = activeSection === section.id;
                        return (
                            <button
                                key={section.id}
                                type="button"
                                onClick={() => setActiveSection(section.id)}
                                className={cn(
                                    "flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition",
                                    active
                                        ? "bg-zinc-950 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950"
                                        : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
                                )}
                            >
                                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>
                                    <span className="block text-sm font-semibold">{section.label}</span>
                                    <span className={cn("mt-0.5 block text-xs leading-4", active ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-400")}>
                                        {section.description}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </nav>
            </aside>

            <main className="min-w-0 space-y-5 pb-8">
                <SectionHeader
                    title={sections.find((section) => section.id === activeSection)?.label ?? "Settings"}
                    description={sections.find((section) => section.id === activeSection)?.description ?? ""}
                    dirty={sectionDirty}
                    onCancel={handleCancelCurrentSection}
                    onSave={handleSaveCurrentSection}
                    saving={savingSettings}
                />

                {activeSection === "general" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Public identity"
                            description="These fields define how the project appears in headers, cards, search, notifications, and shared links."
                            icon={Settings}
                            meta={[
                                ["Slug", project?.slug ?? "Locked"],
                                ["Project avatar", coverImageUrl ? "Used everywhere" : "Generated fallback"],
                            ]}
                        />

                        <SettingsCard
                            title="Project avatar"
                            description="Upload a square project avatar. It publishes immediately to project cards and link previews, and older stored images are cleaned up after replacement."
                        >
                            <div className="grid gap-4">
                                {coverDraft ? (
                                    <div className="grid gap-4 rounded-2xl border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
                                        <div className="grid place-items-center rounded-xl border border-blue-200 bg-zinc-950 p-4 dark:border-blue-900/60">
                                            <div
                                                role="img"
                                                aria-label={`${projectTitle || "Project"} image adjustment preview`}
                                                className="relative h-56 w-56 touch-none overflow-hidden rounded-2xl border border-white/15 bg-zinc-950 shadow-inner"
                                                onPointerDown={handleProjectImagePointerDown}
                                                onPointerMove={handleProjectImagePointerMove}
                                                onPointerUp={handleProjectImagePointerEnd}
                                                onPointerCancel={handleProjectImagePointerEnd}
                                                onLostPointerCapture={handleProjectImagePointerEnd}
                                            >
                                                <Image
                                                    src={coverDraft.previewUrl}
                                                    alt=""
                                                    draggable={false}
                                                    className="absolute left-1/2 top-1/2 max-w-none select-none"
                                                    width={projectImagePreviewMetricsValue?.width ?? PROJECT_IMAGE_PREVIEW_SIZE}
                                                    height={projectImagePreviewMetricsValue?.height ?? PROJECT_IMAGE_PREVIEW_SIZE}
                                                    style={{
                                                        transform: `translate(calc(-50% + ${coverDraft.offsetX}px), calc(-50% + ${coverDraft.offsetY}px))`,
                                                    }}
                                                    unoptimized
                                                />
                                                <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/20" />
                                            </div>
                                        </div>
                                        <div className="grid gap-3">
                                            <div className="flex flex-wrap items-center justify-center gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleResetProjectImageDraft}
                                                    disabled={uploadingCoverImage}
                                                >
                                                    Reset
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleFitProjectImageDraft}
                                                    disabled={uploadingCoverImage}
                                                >
                                                    Fit
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleFillProjectImageDraft}
                                                    disabled={uploadingCoverImage}
                                                >
                                                    Fill
                                                </Button>
                                            </div>
                                            <label className="grid gap-2">
                                                <span className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">
                                                    <span>Zoom</span>
                                                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] tracking-normal text-blue-700 dark:bg-blue-500/15 dark:text-blue-200">
                                                        Drag image to position
                                                    </span>
                                                </span>
                                                <input
                                                    type="range"
                                                    min={PROJECT_IMAGE_MIN_ZOOM}
                                                    max={PROJECT_IMAGE_MAX_ZOOM}
                                                    step={0.01}
                                                    value={coverDraft.zoom}
                                                    onChange={(event) => {
                                                        const next = Number(event.target.value);
                                                        updateCoverDraftTransform({ zoom: next });
                                                    }}
                                                />
                                            </label>
                                        </div>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="text-xs leading-5 text-blue-700 dark:text-blue-300">
                                                Drag and zoom before publishing. The saved square avatar powers cards and link previews from metadata.
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={handleCancelCoverDraft}
                                                    disabled={uploadingCoverImage}
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    type="button"
                                                    onClick={() => void handlePublishCoverDraft()}
                                                    disabled={uploadingCoverImage}
                                                >
                                                    {uploadingCoverImage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                                    Save avatar
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ) : coverImageUrl ? (
                                    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                                        <div className="flex justify-center bg-zinc-950 p-4">
                                            <div className="relative h-44 w-44">
                                                <Image
                                                    src={coverImageUrl}
                                                    alt={`${projectTitle || "Project"} image`}
                                                    className="rounded-xl object-cover"
                                                    fill
                                                    sizes="176px"
                                                />
                                            </div>
                                        </div>
                                        <div className="border-t border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
                                            Used in project cards and share previews. Last updated after the most recent save.
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">
                                        No project avatar is attached yet. Shared links will use the generated project preview until an image exists.
                                    </div>
                                )}
                                <div className="flex flex-wrap items-center gap-2">
                                    <input
                                        ref={coverInputRef}
                                        id={coverInputId}
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp,image/gif"
                                        tabIndex={-1}
                                        aria-hidden="true"
                                        className="hidden"
                                        onChange={(event) => void handleCoverImageUpload(event)}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleOpenProjectImagePicker}
                                        disabled={uploadingCoverImage}
                                        className={cn(
                                            "inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900",
                                            uploadingCoverImage && "cursor-not-allowed opacity-60",
                                        )}
                                    >
                                        {uploadingCoverImage ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : null}
                                        {coverDraft ? "Choose different avatar" : coverImage ? "Replace avatar" : "Upload avatar"}
                                    </button>
                                    {coverDraft || coverImage ? (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => void handleClearCoverImage()}
                                            disabled={uploadingCoverImage}
                                        >
                                            {coverDraft ? "Cancel adjustment" : "Remove"}
                                        </Button>
                                    ) : null}
                                </div>
                                <p className="text-xs leading-5 text-zinc-500">
                                    JPG, PNG, WebP, or GIF. Large images are cropped square and optimized before upload; stored avatars must be under 2MB.
                                </p>
                            </div>
                        </SettingsCard>

                        <SettingsCard
                            title="Identity"
                            description="These public fields update project headers, cards, search, notifications, and project links that render project copy."
                        >
                            <div className="grid gap-4">
                                <ReadOnlySlugField slug={project?.slug ?? ""} />
                                <TextField
                                    label="Project name"
                                    value={projectTitle}
                                    onChange={setProjectTitle}
                                    placeholder="Project name"
                                />
                                <TextField
                                    label="Short description"
                                    value={shortDescription}
                                    onChange={setShortDescription}
                                    placeholder="A one-line project summary"
                                />
                                <TextAreaField
                                    label="Description"
                                    value={description}
                                    onChange={setDescription}
                                    placeholder="Describe what this project does and why it matters"
                                />
                                <CategorySelector
                                    choice={categoryChoice}
                                    customValue={customCategory}
                                    onChoiceChange={setCategoryChoice}
                                    onCustomChange={setCustomCategory}
                                />
                            </div>
                        </SettingsCard>

                        <SettingsCard
                            title="Tags and skills"
                            description="This uses the same chip-entry pattern as the Info phase of project creation."
                        >
                            <div className="grid min-w-0 gap-6">
                                <ChipEditor
                                    label="Tags"
                                    values={tags}
                                    onChange={setTags}
                                    suggestions={POPULAR_PROJECT_TAGS}
                                    placeholder="Add a tag"
                                    tone="indigo"
                                    limit={PROJECT_TAG_LIMIT}
                                />
                                <SkillPicker
                                    value={skills}
                                    onChange={setSkills}
                                    maxSkills={PROJECT_SKILL_LIMIT}
                                    label="Project skills and technologies"
                                    description="Select the technologies and professional skills used by this project."
                                />
                            </div>
                        </SettingsCard>

                        <AdvancedDisclosure
                            open={Boolean(advancedOpen.general)}
                            onToggle={() => toggleAdvanced("general")}
                            title="Advanced identity notes"
                        >
                            <AffectedAreas
                                items={[
                                    "Project header, cards, search, and notification titles update from this single identity source.",
                                    "Shared links use the project avatar and short description through canonical metadata.",
                                    "Application intake, collaborator previews, Docs, and Updates surfaces reuse these same fields.",
                                ]}
                            />
                        </AdvancedDisclosure>
                    </div>
                )}

                {activeSection === "access" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Access policy"
                            description={accessPolicy.summary}
                            icon={Globe}
                            meta={[
                                ["Current visibility", accessPolicy.label],
                                ["Discovery", visibility === "public" ? "Enabled" : "Members only"],
                            ]}
                        />

                        {isProjectOwner ? (
                            <SettingsCard
                                title="Project visibility"
                                description="This one owner-controlled policy is used by project cards, detail pages, search, files, applications, notifications, and future Docs/Updates surfaces."
                            >
                                <div className="grid gap-3">
                                    {VISIBILITY_OPTIONS.map((option) => (
                                        <button
                                            key={option.id}
                                            type="button"
                                            onClick={() => setVisibility(option.id)}
                                            className={cn(
                                                "rounded-2xl border p-4 text-left transition",
                                                visibility === option.id
                                                    ? "border-blue-500 bg-blue-50/70 shadow-sm dark:bg-blue-950/20"
                                                    : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700",
                                            )}
                                        >
                                            <span className="flex items-center justify-between gap-3">
                                                <span className="font-semibold text-zinc-950 dark:text-zinc-50">{option.title}</span>
                                                <span className={cn("h-3 w-3 rounded-full border", visibility === option.id ? "border-blue-500 bg-blue-500" : "border-zinc-300 dark:border-zinc-700")} />
                                            </span>
                                            <span className="mt-1 block text-sm text-zinc-500">{option.description}</span>
                                            <span className="mt-3 block rounded-xl bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-500 dark:bg-zinc-900/70 dark:text-zinc-400">
                                                {option.detail}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </SettingsCard>
                        ) : null}

                        <SettingsCard
                            title="Public surface visibility"
                            description="Choose which project tabs public visitors can see. Members, leaders, and Co-leaders keep access to their workspace tabs."
                        >
                            <PublicTabVisibilityEditor
                                value={publicTabVisibility}
                                onChange={handleTogglePublicTab}
                                disabled={savingSettings}
                            />
                            <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
                                Defaults are Dashboard and Files on; Sprints, Tasks, and Analytics off. If the project is Private, these settings are saved but only apply after the project becomes Public again.
                            </div>
                        </SettingsCard>

                        <SettingsCard
                            title="Viewer access matrix"
                            description="Private projects behave like a private repository: members keep access, outsiders do not receive project content or metadata."
                        >
                            <AccessMatrix rows={accessPolicy.viewerRows} activeVisibility={visibility} />
                        </SettingsCard>

                        <SettingsCard title="Affected areas" description="Visibility changes are not cosmetic; they change access decisions across the product.">
                            <AffectedAreas items={accessPolicy.affectedAreas} />
                        </SettingsCard>

                        <SettingsCard
                            title="Access impact"
                            description="Live counts help owners understand who and what is affected before saving a visibility change."
                        >
                            <AccessImpactGrid items={accessImpactPolicy.metrics} isLoading={accessImpactLoading} />
                            {accessImpactPolicy.summary.length > 0 && (
                                <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/70 p-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-100">
                                    {accessImpactPolicy.summary.join(" ")}
                                </div>
                            )}
                        </SettingsCard>

                        <SettingsCard
                            title={visibility === "private" ? "Private transition checklist" : "Public transition checklist"}
                            description="This is the exact save pipeline we expect after the visibility setting changes."
                        >
                            <PolicyList items={accessImpactPolicy.transitionChecklist} />
                        </SettingsCard>

                        <AdvancedDisclosure
                            open={Boolean(advancedOpen.access)}
                            onToggle={() => toggleAdvanced("access")}
                            title="Access transition details"
                        >
                            <AffectedAreas
                                items={[
                                    "Switching to Private requires confirmation because public links, discovery, share metadata, follower update surfaces, and outsider access are restricted.",
                                    "Switching to Public re-enables discovery and public share previews, but role-based write access remains unchanged.",
                                    "Older projects that still store legacy Unlisted are normalized as Public in the product so access behavior stays predictable.",
                                ]}
                            />
                        </AdvancedDisclosure>
                    </div>
                )}

                {activeSection === "links" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Project links"
                            description="The same ordered links and connected repository shown beside the project title on every project tab."
                            icon={Link2}
                            meta={[["Display", "Project header"], ["Detection", "URL based"]]}
                        />
                        <SettingsCard
                            title="Project links"
                            description="Add, edit, reorder, or remove user-managed links. Connected repositories remain managed by their integration."
                        >
                            <ProjectLinksManager
                                mode="inline"
                                projectId={projectId}
                                links={project?.externalLinks ?? project?.external_links}
                                githubRepoUrl={project?.githubRepoUrl ?? project?.github_repo_url}
                                health={project?.externalLinkMetadata ?? project?.external_link_metadata}
                                projectType={project?.category}
                                onSaved={() => onProjectUpdated()}
                            />
                        </SettingsCard>
                    </div>
                )}

                {activeSection === "collaborators" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Collaborator control center"
                            description="Manage the single project lead, Co-leaders, members, viewers, and safe removal without rewriting project history."
                            icon={Users}
                            meta={[
                                ["Members loaded", collaboratorLoading || loadingMembers ? "Loading..." : String(rolePolicy.members.length)],
                                ["Co-leaders", String(rolePolicy.roleCounts.admin)],
                                ["Transfer candidates", String(rolePolicy.transferCandidates.length)],
                            ]}
                        />

                        <SettingsCard title="Role summary" description="Stored roles stay canonical; Co-leader is the product label for admin permissions.">
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                {([
                                    ["Lead", rolePolicy.roleCounts.owner, "One true lead controls transfer, archive, and delete."],
                                    ["Co-leaders", rolePolicy.roleCounts.admin, "Trusted peers who share full workflow control."],
                                    ["Members", rolePolicy.roleCounts.member, "Can contribute according to project permissions."],
                                    ["Viewers", rolePolicy.roleCounts.viewer, "Read-focused access; not assignable to tasks."],
                                ] as const).map(([label, value, detail]) => (
                                    <div key={label} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
                                        <p className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
                                        <p className="mt-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{label}</p>
                                        <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{detail}</p>
                                    </div>
                                ))}
                            </div>
                        </SettingsCard>

                        <SettingsCard title="Leadership" description="The lead is unique. Co-leaders are elevated admins, not additional leads.">
                            <div className="grid gap-3 lg:grid-cols-2">
                                {rolePolicy.owner ? (
                                    <CollaboratorCard
                                        member={rolePolicy.owner}
                                        ownerId={ownerId}
                                        isProjectOwner={isProjectOwner}
                                        actorRole={actorProjectRole}
                                        onRoleChange={prepareRoleChange}
                                        onRemove={prepareRemoveMember}
                                        onTransfer={prepareTransferToMember}
                                        onNotificationSettings={openMemberNotificationSettings}
                                    />
                                ) : (
                                    <div className="mt-4">
                                        <p className="rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">Lead record is unavailable.</p>
                                    </div>
                                )}
                                {rolePolicy.coLeaders.length > 0 ? (
                                    rolePolicy.coLeaders.map((member) => (
                                        <CollaboratorCard
                                            key={member.id}
                                            member={member}
                                            ownerId={ownerId}
                                            isProjectOwner={isProjectOwner}
                                            actorRole={actorProjectRole}
                                            onRoleChange={prepareRoleChange}
                                            onRemove={prepareRemoveMember}
                                            onTransfer={prepareTransferToMember}
                                            onNotificationSettings={openMemberNotificationSettings}
                                        />
                                    ))
                                ) : (
                                    <div className="rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
                                        No Co-leaders yet. Promote a trusted member when they need to manage tasks, files, roles, and workflow without receiving destructive lead permissions.
                                    </div>
                                )}
                            </div>
                        </SettingsCard>

                        <SettingsCard title="Members" description="Search, filter, promote, demote, transfer ownership, or remove members through the canonical collaborator actions.">
                            <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                                <div className="relative min-w-0 flex-1">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                                    <input
                                        value={collaboratorSearch}
                                        onChange={(event) => setCollaboratorSearch(event.target.value)}
                                        placeholder="Search collaborators..."
                                        aria-label="Search collaborators"
                                        className="h-10 w-full rounded-xl border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-blue-500 dark:border-zinc-800 dark:bg-zinc-950"
                                    />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {([
                                        ["all", "All"],
                                        ["admin", "Co-leaders"],
                                        ["member", "Members"],
                                        ["viewer", "Viewers"],
                                    ] as const).map(([id, label]) => (
                                        <button
                                            key={id}
                                            type="button"
                                            aria-pressed={collaboratorFilter === id}
                                            onClick={() => setCollaboratorFilter(id)}
                                            className={cn(
                                                "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                                                collaboratorFilter === id
                                                    ? "bg-blue-600 text-white"
                                                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
                                            )}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void loadCollaborators("refresh")}
                                        disabled={collaboratorRefreshing}
                                        className="gap-2"
                                    >
                                        <RefreshCw className={cn("h-3.5 w-3.5", collaboratorRefreshing && "animate-spin")} />
                                        Refresh
                                    </Button>
                                </div>
                            </div>

                            {collaboratorLoading || loadingMembers ? (
                                <div className="flex items-center gap-2 text-sm text-zinc-500">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading members...
                                </div>
                            ) : filteredCollaborators.length === 0 ? (
                                <p className="text-sm text-zinc-500">No members loaded yet.</p>
                            ) : (
                                <div className="grid gap-3 lg:grid-cols-2">
                                    {filteredCollaborators.map((member) => (
                                        <CollaboratorCard
                                            key={member.id}
                                            member={member}
                                            ownerId={ownerId}
                                            isProjectOwner={isProjectOwner}
                                            actorRole={actorProjectRole}
                                            onRoleChange={prepareRoleChange}
                                            onRemove={prepareRemoveMember}
                                            onTransfer={prepareTransferToMember}
                                            onNotificationSettings={openMemberNotificationSettings}
                                        />
                                    ))}
                                </div>
                            )}
                            {collaboratorData?.hasMore ? (
                                <div className="mt-4 flex justify-center">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => void loadCollaborators("more")}
                                        disabled={collaboratorLoadingMore}
                                        className="gap-2"
                                    >
                                        {collaboratorLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                        Load more collaborators
                                    </Button>
                                </div>
                            ) : null}
                        </SettingsCard>

                        <AdvancedDisclosure
                            open={Boolean(advancedOpen.collaborators)}
                            onToggle={() => toggleAdvanced("collaborators")}
                            title="Role impact preview"
                        >
                            <AffectedAreas items={rolePolicy.affectedAreas} />
                        </AdvancedDisclosure>
                    </div>
                )}

                {activeSection === "roles-applications" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Project Roles Editor"
                            description="Manage the same open roles used by the top Edit Project flow, application intake, reviewer routing, and project notifications."
                            icon={UserCog}
                            meta={[
                                ["Open roles", String(roleFields.length)],
                                ["Applications", "Canonical application flow"],
                                ["Save path", "Project update action"],
                            ]}
                        />

                        <SettingsCard
                            title="Project roles"
                            description="These are the exact role cards from Edit Project. Changes here update application entry points and public/private project role surfaces."
                        >
                            <ProjectRolesEditor
                                fields={roleFields}
                                register={registerRoles}
                                control={rolesControl}
                                errors={roleErrors}
                                disabled={savingSettings}
                                onAddRole={handleAddSettingsRole}
                                onRemoveRole={handleRemoveSettingsRole}
                                members={collaboratorMembers}
                            />
                        </SettingsCard>

                        <SettingsCard title="Application behavior" description="No decorative switches here; these are the flows currently backed by server state.">
                            <PolicyList
                                items={[
                                    "Open roles define application entry points and role visibility.",
                                    "Application decisions route durable notifications to applicants.",
                                    "Accepted applicants become project members through the canonical member flow.",
                                    "Reviewer routing stays attached to role/application server actions.",
                                ]}
                            />
                        </SettingsCard>

                        <AdvancedDisclosure
                            open={Boolean(advancedOpen["roles-applications"])}
                            onToggle={() => toggleAdvanced("roles-applications")}
                            title="Roles and application touchpoints"
                        >
                            <AffectedAreas
                                items={[
                                    "Project dashboard role cards and application buttons read from these saved open roles.",
                                    "Deleting a role removes the entry point for new applications, while existing application history stays intact.",
                                    "Accepted applicants continue through the canonical collaborator lifecycle instead of a settings-only path.",
                                ]}
                            />
                        </AdvancedDisclosure>
                    </div>
                )}

                {activeSection === "tasks-workflow" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Project Lifecycle"
                            description="Edit the same journey model used by the dashboard. Task labels/templates stay hidden until they have a canonical backend."
                            icon={Workflow}
                            meta={[
                                ["Lifecycle", "Enabled"],
                                ["Task templates", "Hidden until enforceable"],
                            ]}
                        />
                        <SettingsCard title="Project lifecycle" description="Define the journey stages used by the project dashboard.">
                            <LifecycleSettingsEditor
                                initialStages={project?.lifecycle_stages || project?.lifecycleStages || ["Concept", "MVP", "Launch"]}
                                currentStageIndex={project?.current_stage_index ?? project?.currentStageIndex ?? 0}
                                isSaving={savingLifecycle}
                                onSave={async (stages: string[], currentActiveStage: string) => {
                                    setSavingLifecycle(true);
                                    try {
                                        const result = await updateProjectLifecycleAction(projectId, stages, currentActiveStage);
                                        if (result.success) {
                                            toast.success("Lifecycle updated.");
                                            onProjectUpdated();
                                            router.refresh();
                                        } else {
                                            toast.error(result.error || "Failed to update lifecycle.");
                                        }
                                    } catch (error) {
                                        console.error("Failed to update lifecycle", error);
                                        toast.error("Failed to update lifecycle.");
                                    } finally {
                                        setSavingLifecycle(false);
                                    }
                                }}
                            />
                        </SettingsCard>
                    </div>
                )}

                {activeSection === "files-workspace" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Files and workspace"
                            description="Control file intake clearly: leaders can always upload, members can be toggled on or off, and viewers stay read-focused."
                            icon={Folder}
                            meta={[
                                ["Always allowed", String(fileWorkspaceData?.summary.alwaysAllowedCount ?? 0)],
                                ["Members on", String(fileWorkspaceData?.summary.enabledMemberCount ?? 0)],
                                ["Members off", String(fileWorkspaceData?.summary.disabledMemberCount ?? 0)],
                            ]}
                        />

                        <SettingsCard
                            title="Member upload permissions"
                            description="Turn file uploads on or off per member. This is enforced before signed upload URLs, file rows, folders, and replacement versions are created."
                        >
                            <FileWorkspaceMembers
                                data={fileWorkspaceData}
                                isLoading={fileWorkspaceLoading}
                                savingMemberId={fileWorkspaceSavingMemberId}
                                onToggle={handleToggleMemberFileUpload}
                            />
                        </SettingsCard>

                        <SettingsCard
                            title="Bulk upload control"
                            description="Bulk actions apply only to standard members. Leads and Co-leaders stay on; viewers stay off."
                        >
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={fileWorkspaceBulkSaving}
                                    onClick={() => void handleBulkFileUploadPermission(true)}
                                >
                                    Enable member uploads
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={fileWorkspaceBulkSaving}
                                    onClick={() => void handleBulkFileUploadPermission(false)}
                                >
                                    Disable member uploads
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={fileWorkspaceLoading}
                                    onClick={() => void loadFileWorkspaceSettings()}
                                    className="gap-2"
                                >
                                    <RefreshCw className={cn("h-3.5 w-3.5", fileWorkspaceLoading && "animate-spin")} />
                                    Refresh
                                </Button>
                            </div>
                        </SettingsCard>

                        <SettingsCard title="Enforced file behavior" description={filePolicy.uploadPolicySummary}>
                            <PolicyList items={filePolicy.enforcedRules} />
                        </SettingsCard>
                        <AdvancedDisclosure
                            open={Boolean(advancedOpen["files-workspace"])}
                            onToggle={() => toggleAdvanced("files-workspace")}
                            title="Affected file surfaces"
                        >
                            <AffectedAreas items={filePolicy.affectedAreas} />
                        </AdvancedDisclosure>
                    </div>
                )}

                {activeSection === "readme" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Document publishing"
                            description="Control who can edit project documentation, how media is handled, and whether published changes notify followers or members."
                            icon={FileText}
                            meta={[
                                ["Edit policy", readmeSettingsDraft.editPolicy === "members" ? "Members can edit" : "Leaders only"],
                                ["Media uploads", readmeSettingsDraft.mediaUploads ? "Enabled" : "Disabled"],
                                ["Publish notifications", readmeSettingsDraft.notifyOnPublish ? "Enabled" : "Off"],
                            ]}
                        />

                        <SettingsCard
                            title="Editing access"
                            description="Owners and Co-leaders can always edit. Members can edit only when this policy allows it."
                        >
                            <div className="grid gap-3 md:grid-cols-2">
                                {([
                                    ["leaders", "Leaders only", "Owners and Co-leaders maintain the canonical published document."],
                                    ["members", "Members can edit", "Members can help improve the draft; publishing stays leader-only."],
                                ] as const).map(([value, title, description]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        disabled={readmeSettingsLoading}
                                        onClick={() => setReadmeSettingsDraft((current) => ({ ...current, editPolicy: value }))}
                                        className={cn(
                                            "rounded-2xl border p-4 text-left transition disabled:opacity-60",
                                            readmeSettingsDraft.editPolicy === value
                                                ? "border-blue-500 bg-blue-50/70 dark:bg-blue-950/20"
                                                : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950",
                                        )}
                                    >
                                        <span className="font-semibold text-zinc-950 dark:text-zinc-50">{title}</span>
                                        <span className="mt-1 block text-sm leading-5 text-zinc-500">{description}</span>
                                    </button>
                                ))}
                            </div>
                        </SettingsCard>

                        <SettingsCard
                            title="Media, smart blocks, and notification policy"
                            description="Document media is stored in managed project storage. External images stay off by default so private project data does not leak through third-party URLs."
                        >
                            <div className="grid gap-3">
                                {([
                                    ["mediaUploads", "Managed image uploads", "Allow editors to upload document images through access-checked project storage."],
                                    ["externalImages", "External images", "Allow externally hosted images. Keep this off for private or sensitive projects."],
                                    ["projectBlocks", "Project smart blocks", "Allow blocks such as roles, contributors, files, tasks, and sprints to render safe project data."],
                                    ["notifyOnPublish", "Notify on publish", "Send optional document publish notifications through the project notification policy."],
                                ] as const).map(([key, title, description]) => (
                                    <div key={key} className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
                                        <div>
                                            <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{title}</p>
                                            <p className="mt-1 text-sm leading-5 text-zinc-500">{description}</p>
                                        </div>
                                        <TogglePill
                                            checked={Boolean(readmeSettingsDraft[key])}
                                            disabled={readmeSettingsLoading || readmeSettingsSaving}
                                            label={`Toggle ${title}`}
                                            onChange={(checked) => setReadmeSettingsDraft((current) => ({ ...current, [key]: checked }))}
                                        />
                                    </div>
                                ))}
                            </div>
                        </SettingsCard>

                        <AdvancedDisclosure
                            open={Boolean(advancedOpen.readme)}
                            onToggle={() => toggleAdvanced("readme")}
                            title="Document affected surfaces"
                        >
                            <AffectedAreas
                                items={[
                                    "The top-level Docs tab uses these settings for editor access, image rendering, and smart blocks.",
                                    "The Access tab controls whether a published document is visible to public visitors.",
                                    "Published document images are served through the access-checked document asset route, not direct public storage URLs.",
                                    "Document excerpts can support project share metadata only when the project itself is public and readable.",
                                ]}
                            />
                        </AdvancedDisclosure>
                    </div>
                )}

                {activeSection === "updates" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Updates"
                            description="Project progress posts use member publishing permissions, public tab visibility, and the project notification policy."
                            icon={Bell}
                            meta={[
                                ["Public tab", publicTabVisibility.updates ? "Visible" : "Members only"],
                                ["Publishers", memberUpdatesEnabled ? "Owner, Co-leaders, Members" : "Owner, Co-leaders"],
                                ["Engagement", "Likes and comments"],
                            ]}
                        />

                        <SettingsCard
                            title="Publishing permissions"
                            description="Configure who is allowed to publish progress updates in this project."
                        >
                            <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                                        Allow members to post updates
                                    </p>
                                    <p className="text-xs text-zinc-500 mt-1">
                                        When enabled, all project members can publish updates. When disabled, only the Lead (Owner) and Co-leaders (Admins) can publish.
                                    </p>
                                </div>
                                <TogglePill
                                    checked={memberUpdatesEnabled}
                                    disabled={savingSettings}
                                    onChange={setMemberUpdatesEnabled}
                                    label="Allow members to post updates"
                                />
                            </div>
                        </SettingsCard>

                        <SettingsCard
                            title="Publishing rules"
                            description="Updates are intentional project posts. Viewers can discuss visible updates, while creating and pinning stay tied to project membership."
                        >
                            <PolicyList
                                items={[
                                    memberUpdatesEnabled
                                        ? "Owner, Co-leaders, and Members can create updates."
                                        : "Only the Owner and Co-leaders can create updates (Member posting is disabled).",
                                    "Viewers and logged-in public visitors can comment on visible updates when the update allows logged-in replies.",
                                    "Owners and Co-leaders can pin, unpin, and moderate updates and comments.",
                                    "Authored updates remain part of project history after a member leaves unless a leader moderates them.",
                                ]}
                            />
                        </SettingsCard>

                        <SettingsCard
                            title="Follower notifications"
                            description="Public updates on public projects notify followers and members through the Updates notification group."
                        >
                            <PolicyList
                                items={[
                                    "Follower notifications deep-link to the exact update in the Updates tab.",
                                    "The actor is excluded from their own publish notification.",
                                    "Private projects do not fan out public preview content to followers.",
                                    "Low-noise digest keys are reserved for grouped update delivery.",
                                ]}
                            />
                        </SettingsCard>

                        <AdvancedDisclosure
                            open={Boolean(advancedOpen.updates)}
                            onToggle={() => toggleAdvanced("updates")}
                            title="Updates affected surfaces"
                        >
                            <AffectedAreas
                                items={[
                                    "The top-level Updates tab controls feed reading, composing, likes, comments, filters, and deep links.",
                                    "The Access tab controls whether public visitors can see project updates.",
                                    "The Notifications tab controls update publish, comment, and digest-ready follower events.",
                                    "Pinned updates are shown before the newest feed items.",
                                ]}
                            />
                        </AdvancedDisclosure>
                    </div>
                )}

                {activeSection === "notifications" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Project notification policy"
                            description="Project leaders define which project events create durable attention. Personal delivery channels, quiet hours, and push settings still live in global notification settings."
                            icon={Bell}
                            meta={[
                                ["Preset", projectNotificationDraft.preset],
                                ["Enabled triggers", `${notificationSummary.enabledCount}/${notificationSummary.visibleCount}`],
                                ["Locked safety events", `${notificationSummary.mandatoryCount}`],
                            ]}
                        />

                        <SettingsCard title="Notification preset" description="Start from a low-noise baseline, then tune exact project triggers below. Mandatory responsibility and security events stay locked on.">
                            <div className="grid gap-3 md:grid-cols-3">
                                {([
                                    ["quiet", "Quiet", "Only critical project responsibility and safety events stay active."],
                                    ["balanced", "Balanced", "Recommended for most teams: assignments, reviews, files, sprints, and applications."],
                                    ["active", "Active", "Turns on every visible project trigger for highly collaborative projects."],
                                ] as const).map(([preset, label, detail]) => (
                                    <ProjectNotificationPresetButton
                                        key={preset}
                                        preset={preset}
                                        label={label}
                                        detail={detail}
                                        activePreset={projectNotificationDraft.preset}
                                        onSelect={handleProjectNotificationPreset}
                                    />
                                ))}
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                                <Button type="button" variant="outline" onClick={() => void handleResetNotifications()} disabled={savingSettings}>
                                    Reset recommended defaults
                                </Button>
                                <Button variant="outline" onClick={() => router.push("/settings?tab=notifications")}>
                                    Open global notification settings
                                </Button>
                            </div>
                        </SettingsCard>

                        {projectNotificationLoading ? (
                            <SettingsCard title="Loading project triggers" description="Reading the current project notification policy.">
                                <div className="flex items-center gap-2 text-sm text-zinc-500">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading notification controls...
                                </div>
                            </SettingsCard>
                        ) : null}

                        {notificationGroups.map((group) => (
                            <SettingsCard key={group.id} title={group.title} description={group.description}>
                                <div className="divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                                    {group.entries.map((entry) => (
                                        <ProjectNotificationRuleRow
                                            key={entry.key}
                                            entry={entry}
                                            policy={projectNotificationDraft}
                                            disabled={savingSettings}
                                            onToggle={handleProjectNotificationToggle}
                                        />
                                    ))}
                                </div>
                            </SettingsCard>
                        ))}

                        <SettingsCard title="Member-level preferences" description="Members can reduce personal noise for optional triggers. Leaders can review effective summaries, but critical responsibility and safety notifications cannot be silently disabled for another person.">
                            <div className="grid gap-3 lg:grid-cols-2">
                                {rolePolicy.members.slice(0, 8).map((member) => {
                                    const role = projectMemberRole(member, ownerId);
                                    return (
                                        <button
                                            key={member.id}
                                            type="button"
                                            onClick={() => void openMemberNotificationSettings(member)}
                                            className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-left transition hover:border-blue-300 hover:bg-blue-50 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
                                        >
                                            <span className="min-w-0">
                                                <span className="block truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                                                    {getProjectMemberDisplayName(member)}
                                                </span>
                                                <span className="mt-1 block text-xs text-zinc-500">
                                                    {getProjectMemberRoleLabel(role)} · Review effective project notification access
                                                </span>
                                            </span>
                                            <Bell className="h-4 w-4 shrink-0 text-zinc-400" />
                                        </button>
                                    );
                                })}
                            </div>
                            {rolePolicy.members.length > 8 ? (
                                <p className="mt-3 text-xs text-zinc-500">
                                    Open the Collaborators tab to search all members and review their notification preferences from each member card.
                                </p>
                            ) : null}
                        </SettingsCard>

                        <AdvancedDisclosure
                            open={Boolean(advancedOpen.notifications)}
                            onToggle={() => toggleAdvanced("notifications")}
                            title="Affected notification surfaces"
                        >
                            <AffectedAreas items={[
                                "Source actions still succeed if notification enqueue fails; failures are logged as non-fatal project notification errors.",
                                "Durable inbox rows remain the source of truth; browser/push/email delivery continues to follow global notification settings.",
                                "Private project notifications never expose unsafe project metadata to users who lose access.",
                                "High-volume files, sprint edits, and bulk task events use stable aggregation windows instead of one-row-per-action spam.",
                                "Member overrides can reduce optional project noise, but mandatory assignment, review, access, and security events stay enabled.",
                            ]} />
                        </AdvancedDisclosure>
                    </div>
                )}

                {activeSection === "security-audit" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Security and data"
                            description="Recent settings audit, protected actions, and exportable project data live in one low-noise control center."
                            icon={Shield}
                            meta={[
                                ["Data access", "Public data and stats"],
                                ["Settings access", "Lead / Co-leader scoped"],
                                ["Follower notifications", "Automated system routing"],
                                ["Transfer ownership", "Step-up protected"],
                                ["Export", "Available"],
                            ]}
                        />
                        <SettingsCard
                            title="Recent settings audit"
                            description="Owner-visible history for access-sensitive settings changes. File policy and collaborator changes are included here."
                        >
                            <SettingsAuditTimeline events={settingsAuditEvents} isLoading={settingsAuditLoading} />
                        </SettingsCard>
                        <SettingsCard title="Protected action model" description="These guardrails keep the project stable without adding fake toggles.">
                            <PolicyList
                                items={[
                                    "Settings sections are scoped by capability; non-leaders cannot see project controls.",
                                    "Ownership transfer requires the next owner to already be a member.",
                                    "Danger Zone runs preflight checks before archive/delete.",
                                    "Permission and ownership changes reuse shared security logic.",
                                ]}
                            />
                        </SettingsCard>
                        <SettingsCard title="Export project snapshot" description="Download a JSON snapshot of project identity, settings, lifecycle, and loaded member summaries. Import and restore stay hidden until validation and rollback are safe.">
                            <Button
                                onClick={() => void handleExport()}
                                disabled={loadingExport}
                                className="gap-2"
                            >
                                {loadingExport ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                Export project snapshot
                            </Button>
                        </SettingsCard>
                    </div>
                )}

                {activeSection === "danger" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Danger Zone"
                            description="Projects behave like repositories: archive, transfer ownership, or delete. Finalize is intentionally removed."
                            icon={AlertTriangle}
                            tone="danger"
                            meta={[
                                ["Current status", preflightPolicy.status],
                                ["Archive", preflightPolicy.canArchive ? "Available" : "Unavailable"],
                                ["Delete", preflightPolicy.canDelete ? "Available" : "Unavailable"],
                            ]}
                        />

                        <SettingsCard title="Preflight" description="Risky actions use current project state before mutation.">
                            {dangerPreflightLoading ? (
                                <div className="flex items-center gap-2 text-sm text-zinc-500">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Running preflight checks...
                                </div>
                            ) : dangerPreflight ? (
                                <AffectedAreas items={preflightPolicy.affectedAreas} />
                            ) : (
                                <div className="flex flex-wrap items-center gap-3">
                                    <p className="text-sm text-zinc-500">Preflight data is not loaded yet.</p>
                                    <Button variant="outline" onClick={() => void loadDangerPreflight()}>
                                        Run checks
                                    </Button>
                                </div>
                            )}
                        </SettingsCard>

                        <DangerAction
                            icon={Archive}
                            title="Archive project"
                            description="Hide from normal discovery and mark the project archived. Existing members keep historical access."
                            actionLabel="Archive"
                            disabled={confirmLoading || dangerPreflightLoading || !dangerPreflight || !preflightPolicy.canArchive}
                            onClick={prepareArchive}
                        />

                        <SettingsCard
                            title="Transfer ownership"
                            description="Move ownership to an existing member. This is step-up protected and creates audit history for both users."
                            danger
                        >
                            <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                                <div>
                                    <label htmlFor="project-transfer-owner" className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                                        New owner
                                    </label>
                                    <select
                                        id="project-transfer-owner"
                                        value={transferOwnerId}
                                        onChange={(event) => setTransferOwnerId(event.target.value)}
                                        className="mt-2 h-10 w-full rounded-xl border border-red-200 bg-white px-3 text-sm outline-none focus:border-red-500 dark:border-red-900/60 dark:bg-zinc-950"
                                    >
                                        <option value="">Choose an existing member</option>
                                        {rolePolicy.transferCandidates.map((member) => (
                                            <option key={member.id} value={member.id}>
                                                {getProjectMemberDisplayName(member)} · {getProjectMemberRoleLabel(projectMemberRole(member, ownerId))}
                                            </option>
                                        ))}
                                    </select>
                                    {rolePolicy.transferCandidates.length === 0 ? (
                                        <p className="mt-2 text-xs text-red-500">Add another project member before ownership can be transferred.</p>
                                    ) : null}
                                </div>
                                <Button
                                    variant="destructive"
                                    onClick={prepareTransfer}
                                    disabled={confirmLoading || rolePolicy.transferCandidates.length === 0 || !transferOwnerId}
                                    className="gap-2"
                                >
                                    <Crown className="h-4 w-4" />
                                    Transfer
                                </Button>
                            </div>
                        </SettingsCard>

                        <DangerAction
                            icon={Trash2}
                            title="Delete project"
                            description="Permanently delete this project and associated data. This cannot be undone."
                            actionLabel="Delete project"
                            disabled={confirmLoading || dangerPreflightLoading || !dangerPreflight || !preflightPolicy.canDelete}
                            onClick={prepareDelete}
                        />
                    </div>
                )}
            </main>

            <ConfirmDialog
                open={Boolean(confirmAction)}
                onOpenChange={(open) => {
                    if (!open && !confirmLoading) {
                        setConfirmAction(null);
                        setRemovalPreflightDialog(null);
                        setMemberNotificationData(null);
                        setMemberNotificationDraft(normalizeProjectMemberNotificationOverrides(null));
                    }
                }}
                title={confirmAction?.title ?? ""}
                description={confirmAction?.description}
                confirmLabel={confirmAction?.confirmLabel ?? "Confirm"}
                variant={confirmAction?.variant ?? "destructive"}
                loading={confirmLoading}
                autoCloseOnConfirm={false}
                onConfirm={runConfirmAction}
            >
                {confirmDialogContent}
            </ConfirmDialog>
        </div>
    );
}

function SectionHeader({
    title,
    description,
    dirty,
    saving,
    onCancel,
    onSave,
}: {
    title: string;
    description: string;
    dirty: boolean;
    saving: boolean;
    onCancel: () => void;
    onSave: () => void;
}) {
    return (
        <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-400">Settings</p>
                    <h3 className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{title}</h3>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">{description}</p>
                </div>
                {dirty ? (
                    <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-2 dark:border-amber-900/60 dark:bg-amber-950/20">
                        <span className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">Unsaved</span>
                        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
                            Cancel
                        </Button>
                        <Button size="sm" onClick={onSave} disabled={saving}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                        </Button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function SummaryCard({
    title,
    description,
    icon: Icon,
    meta,
    tone = "default",
}: {
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    meta: Array<[string, string]>;
    tone?: "default" | "danger";
}) {
    return (
        <section className={cn(
            "min-w-0 rounded-3xl border p-5 shadow-sm",
            tone === "danger"
                ? "border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20"
                : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950",
        )}>
            <div className="flex items-start gap-4">
                <div className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
                    tone === "danger" ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
                )}>
                    <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <h4 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">{title}</h4>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">{description}</p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {meta.map(([label, value]) => (
                            <div key={label} className="rounded-2xl border border-zinc-200 bg-white/70 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/60">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">{label}</p>
                                <p className="mt-1 truncate text-sm font-semibold capitalize text-zinc-900 dark:text-zinc-100">{value}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}

function SettingsCard({
    title,
    description,
    children,
    danger = false,
}: {
    title: string;
    description: string;
    children: React.ReactNode;
    danger?: boolean;
}) {
    return (
        <section className={cn(
            "min-w-0 rounded-3xl border p-5 shadow-sm",
            danger
                ? "border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20"
                : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950",
        )}>
            <div className="mb-4">
                <h4 className={cn("text-base font-semibold", danger ? "text-red-900 dark:text-red-100" : "text-zinc-950 dark:text-zinc-50")}>{title}</h4>
                <p className={cn("mt-1 text-sm leading-6", danger ? "text-red-700 dark:text-red-300" : "text-zinc-500")}>{description}</p>
            </div>
            {children}
        </section>
    );
}

function TextField({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}) {
    return (
        <label className="grid gap-2">
            <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{label}</span>
            <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 dark:border-zinc-800 dark:bg-zinc-950"
            />
        </label>
    );
}

function TextAreaField({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}) {
    return (
        <label className="grid gap-2">
            <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{label}</span>
            <textarea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                rows={4}
                className="min-h-28 resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-blue-500 dark:border-zinc-800 dark:bg-zinc-950"
            />
        </label>
    );
}

function ReadOnlySlugField({ slug }: { slug: string }) {
    const [copied, setCopied] = useState(false);
    const normalizedSlug = slug.trim() || "Not set";
    const handleCopy = useCallback(async () => {
        const trimmedSlug = slug.trim();
        if (!trimmedSlug || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
        try {
            await navigator.clipboard.writeText(trimmedSlug);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch (error) {
            console.error("Failed to copy project slug", error);
            toast.error("Failed to copy slug.");
        }
    }, [slug]);

    return (
        <div className="grid gap-2">
            <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Slug</span>
            <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">{normalizedSlug}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                        Project links use this slug. Editing is locked for now to avoid broken links and stale share previews.
                    </p>
                </div>
                {slug.trim() ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()} className="shrink-0">
                        {copied ? "Copied" : "Copy"}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

function CategorySelector({
    choice,
    customValue,
    onChoiceChange,
    onCustomChange,
}: {
    choice: string;
    customValue: string;
    onChoiceChange: (value: string) => void;
    onCustomChange: (value: string) => void;
}) {
    return (
        <div className="grid gap-3">
            <label className="grid gap-2">
                <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Category</span>
                <select
                    value={choice}
                    onChange={(event) => onChoiceChange(event.target.value)}
                    className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 dark:border-zinc-800 dark:bg-zinc-950"
                >
                    <option value="">Choose a category</option>
                    {PROJECT_TYPE_OPTIONS.map((type) => (
                        <option key={type.id} value={type.id}>
                            {type.label}
                        </option>
                    ))}
                    <option value={OTHER_PROJECT_TYPE_ID}>Others</option>
                </select>
            </label>
            {choice === OTHER_PROJECT_TYPE_ID ? (
                <TextField
                    label="Custom category"
                    value={customValue}
                    onChange={onCustomChange}
                    placeholder="Enter a custom category"
                />
            ) : null}
        </div>
    );
}

function ChipEditor({
    label,
    values,
    onChange,
    suggestions,
    placeholder,
    tone,
    prefix = "",
    limit,
}: {
    label: string;
    values: string[];
    onChange: (values: string[]) => void;
    suggestions: readonly string[];
    placeholder: string;
    tone: "indigo" | "emerald";
    prefix?: string;
    limit: number;
}) {
    const [draft, setDraft] = useState("");
    const addValue = useCallback((rawValue: string) => {
        const nextValue = rawValue.trim();
        if (!nextValue) return;
        if (values.length >= limit) {
            toast.error(`${label} can include up to ${limit} items.`);
            return;
        }
        if (values.some((value) => value.toLowerCase() === nextValue.toLowerCase())) {
            setDraft("");
            return;
        }
        onChange([...values, nextValue]);
        setDraft("");
    }, [label, limit, onChange, values]);
    const removeValue = useCallback((value: string) => {
        onChange(values.filter((item) => item !== value));
    }, [onChange, values]);
    const chipClass = tone === "emerald"
        ? "border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
        : "border-indigo-100 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300";

    return (
        <div className="min-w-0">
            <div className="flex items-center justify-between gap-3">
                <label className="block text-sm font-semibold text-zinc-950 dark:text-zinc-50">{label}</label>
                <span className="text-xs font-medium text-zinc-400">{values.length}/{limit}</span>
            </div>
            <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50/30 p-4 dark:border-zinc-800 dark:bg-zinc-900/20">
                {values.length > 0 ? (
                    <div className="mb-3 flex min-w-0 flex-wrap gap-2">
                        {values.map((value) => (
                            <span
                                key={value}
                                className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm", chipClass)}
                            >
                                <span className="truncate">{prefix}{value}</span>
                                <button
                                    type="button"
                                    onClick={() => removeValue(value)}
                                    className="opacity-70 transition hover:opacity-100"
                                    aria-label={`Remove ${value}`}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </span>
                        ))}
                    </div>
                ) : null}
                <div className="flex gap-2">
                    <input
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            addValue(draft);
                        }}
                        className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-blue-500 dark:border-zinc-800 dark:bg-zinc-950"
                        placeholder={placeholder}
                        disabled={values.length >= limit}
                    />
                    <button
                        type="button"
                        onClick={() => addValue(draft)}
                        disabled={values.length >= limit}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        aria-label={`Add ${label.toLowerCase()}`}
                    >
                        <Plus className="h-4 w-4" />
                    </button>
                </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
                {suggestions
                    .filter((suggestion) => !values.some((value) => value.toLowerCase() === suggestion.toLowerCase()))
                    .slice(0, 5)
                    .map((suggestion) => (
                        <button
                            key={suggestion}
                            type="button"
                            onClick={() => addValue(suggestion)}
                            disabled={values.length >= limit}
                            className="rounded-lg bg-zinc-100 px-2 py-1 text-xs text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                        >
                            + {suggestion}
                        </button>
                    ))}
            </div>
        </div>
    );
}

function formatJoinedAt(value?: string | null) {
    if (!value) return "Joined date unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Joined date unavailable";
    return `Joined ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)}`;
}

function responsibilityHints(member: ProjectSettingsMember) {
    const counts = member.responsibilityCounts;
    if (!counts) return [];
    return [
        counts.activeAssignedTasks > 0 ? `${counts.activeAssignedTasks} active assigned` : null,
        counts.activeCreatedTasks > 0 ? `${counts.activeCreatedTasks} created active` : null,
        counts.fileReviews > 0 ? `${counts.fileReviews} file review` : null,
        counts.acceptedApplications > 0 ? `${counts.acceptedApplications} accepted role` : null,
        counts.projectGroupParticipant ? "Project group" : null,
    ].filter((item): item is string => Boolean(item));
}

function CollaboratorCard({
    member,
    ownerId,
    isProjectOwner,
    actorRole,
    onRoleChange,
    onRemove,
    onTransfer,
    onNotificationSettings,
}: {
    member: ProjectSettingsMember;
    ownerId: string | null;
    isProjectOwner: boolean;
    actorRole: ProjectMemberRole;
    onRoleChange: (member: ProjectSettingsMember, role: Exclude<ProjectMemberRole, "owner">) => void;
    onRemove: (member: ProjectSettingsMember) => void | Promise<void>;
    onTransfer: (member: ProjectSettingsMember) => void;
    onNotificationSettings: (member: ProjectSettingsMember) => void | Promise<void>;
}) {
    const role = projectMemberRole(member, ownerId) as ProjectMemberRole;
    const reference = buildProjectPersonReference({
        person: {
            id: member.id,
            fullName: getProjectMemberDisplayName(member),
            username: member.username ?? null,
            avatarUrl: member.avatarUrl ?? null,
        },
        membershipRole: role,
        isActiveMember: true,
    });
    const mutationPolicy = buildProjectMemberMutationPolicy({
        actorIsOwner: isProjectOwner,
        actorRole,
        ownerId,
        targetUserId: member.id,
        targetRole: role,
    });
    const hints = responsibilityHints(member);
    const roleOptions: Array<Exclude<ProjectMemberRole, "owner">> = ["admin", "member", "viewer"];

    return (
        <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-start gap-3">
                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 text-sm font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    {reference.avatarUrl ? (
                        <Image src={reference.avatarUrl} alt="" className="object-cover rounded-full" fill sizes="48px" />
                    ) : (
                        reference.displayName.slice(0, 1).toUpperCase()
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{reference.displayName}</p>
                        <span className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            role === "owner"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                                : role === "admin"
                                    ? "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
                                    : role === "viewer"
                                        ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-300"
                                        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
                        )}>
                            {reference.roleLabel}
                        </span>
                        {!reference.isAssignable ? (
                            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-800 dark:bg-orange-950/40 dark:text-orange-200">
                                Not assignable
                            </span>
                        ) : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-zinc-500">
                        {member.projectRoleTitle || member.username || member.id}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">{formatJoinedAt(member.joinedAt)}</p>
                </div>
            </div>

            {hints.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {hints.map((hint) => (
                        <span key={hint} className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                            {hint}
                        </span>
                    ))}
                </div>
            ) : null}

            <details className="group mt-4">
                <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900">
                    Actions
                    <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
                </summary>
                <div className="mt-2 grid gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/60">
                    {role !== "owner" ? roleOptions.map((option) => {
                        const optionPolicy = buildProjectMemberMutationPolicy({
                            actorIsOwner: isProjectOwner,
                            actorRole,
                            ownerId,
                            targetUserId: member.id,
                            targetRole: role,
                            nextRole: option,
                        });
                        return (
                            <Button
                                key={option}
                                type="button"
                                variant={role === option ? "default" : "outline"}
                                size="sm"
                                disabled={!optionPolicy.canChangeRole || role === option}
                                onClick={() => onRoleChange(member, option)}
                                className="justify-start"
                            >
                                {option === "admin" ? <ShieldCheck className="h-3.5 w-3.5" /> : null}
                                Change role to {getProjectMemberRoleLabel(option)}
                            </Button>
                        );
                    }) : (
                        <Button type="button" variant="outline" size="sm" disabled className="justify-start">
                            <Crown className="h-3.5 w-3.5" />
                            True owner
                        </Button>
                    )}

                    {mutationPolicy.canTransferOwnership ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => onTransfer(member)} className="justify-start">
                            <Crown className="h-3.5 w-3.5" />
                            Transfer ownership
                        </Button>
                    ) : null}

                    {mutationPolicy.canRemove ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => void onRemove(member)} className="justify-start text-red-600 hover:text-red-700 dark:text-red-300">
                            <UserMinus className="h-3.5 w-3.5" />
                            Remove member
                        </Button>
                    ) : null}

                    <Button type="button" variant="outline" size="sm" onClick={() => void onNotificationSettings(member)} className="justify-start">
                        <Bell className="h-3.5 w-3.5" />
                        Notification settings
                    </Button>
                </div>
            </details>
        </article>
    );
}

function ProjectNotificationPresetButton({
    preset,
    label,
    detail,
    activePreset,
    onSelect,
}: {
    preset: ProjectNotificationPreset;
    label: string;
    detail: string;
    activePreset: ProjectNotificationPreset;
    onSelect: (preset: ProjectNotificationPreset) => void;
}) {
    const active = activePreset === preset;
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(preset)}
            className={cn(
                "rounded-2xl border p-4 text-left transition",
                active
                    ? "border-blue-500 bg-blue-50 text-blue-950 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-100"
                    : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200 dark:hover:border-zinc-700",
            )}
        >
            <span className="text-sm font-semibold">{label}</span>
            <span className="mt-2 block text-xs leading-5 text-zinc-500 dark:text-zinc-400">{detail}</span>
        </button>
    );
}

function formatProjectNotificationRecipients(entry: ProjectNotificationRegistryEntry) {
    return entry.defaultRecipients.map((recipient) => recipient.replace(/_/g, " "));
}

function formatProjectNotificationAggregate(entry: ProjectNotificationRegistryEntry) {
    if (entry.aggregate === "burst_10m") return "10m burst";
    if (entry.aggregate === "digest_only") return "Digest";
    return "Realtime";
}

function ProjectNotificationRuleRow({
    entry,
    policy,
    disabled,
    onToggle,
}: {
    entry: ProjectNotificationRegistryEntry;
    policy: ProjectNotificationPolicy;
    disabled: boolean;
    onToggle: (eventKey: ProjectNotificationEventKey, enabled: boolean) => void;
}) {
    const decision = resolveProjectNotificationDecision({ eventKey: entry.key, projectPolicy: policy });
    const enabled = decision.enabled;
    return (
        <div className="grid gap-3 bg-white p-4 dark:bg-zinc-950 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{entry.label}</p>
                    {entry.mandatory ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            <Lock className="h-3 w-3" />
                            mandatory
                        </span>
                    ) : null}
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-300">
                        {policy.rules[entry.key]?.importance === "important" ? "Important" : "More"}
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-300">
                        {formatProjectNotificationAggregate(entry)}
                    </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{entry.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {formatProjectNotificationRecipients(entry).map((recipient) => (
                        <span key={recipient} className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-semibold capitalize text-blue-700 dark:bg-blue-950/30 dark:text-blue-200">
                            {recipient}
                        </span>
                    ))}
                </div>
            </div>
            <TogglePill
                checked={enabled}
                disabled={disabled || entry.mandatory}
                onChange={(nextEnabled) => onToggle(entry.key, nextEnabled)}
                label={entry.mandatory ? "Locked on" : enabled ? "On" : "Off"}
            />
        </div>
    );
}

function MemberNotificationSettingsEditor({
    data,
    draft,
    isLoading,
    isSaving,
    projectPolicy,
    onDraftChange,
    onSave,
    onReset,
}: {
    data: MemberNotificationSettingsData | null;
    draft: ProjectMemberNotificationOverrides;
    isLoading: boolean;
    isSaving: boolean;
    projectPolicy: ProjectNotificationPolicy;
    onDraftChange: React.Dispatch<React.SetStateAction<ProjectMemberNotificationOverrides>>;
    onSave: () => void | Promise<void>;
    onReset: () => void | Promise<void>;
}) {
    const groups = useMemo(() => groupProjectNotificationEntries(), []);
    const memberName = data?.member.fullName || data?.member.username || data?.member.id || "Member";

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading member notification preferences...
            </div>
        );
    }

    if (!data) {
        return (
            <p className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
                Member notification preferences are unavailable.
            </p>
        );
    }

    return (
        <div className="space-y-4 text-sm">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
                <p className="font-semibold text-zinc-950 dark:text-zinc-50">{memberName}</p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {data.canEdit
                        ? "Member preferences can reduce optional project noise. Locked responsibility and security notifications stay enabled."
                        : "Leaders can review this member's effective policy summary, but only the member can change personal notification overrides."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {([
                        ["inherit", "Use project defaults"],
                        ["custom", "Customize"],
                    ] as const).map(([mode, label]) => (
                        <button
                            key={mode}
                            type="button"
                            aria-pressed={draft.mode === mode}
                            disabled={!data.canEdit}
                            onClick={() => onDraftChange((current) => ({ ...current, mode }))}
                            className={cn(
                                "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                                draft.mode === mode
                                    ? "bg-blue-600 text-white"
                                    : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800",
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {draft.mode === "custom" ? (
                <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1 app-scroll app-scroll-y app-scroll-gutter">
                    {groups.map((group) => (
                        <div key={group.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800">
                            <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">{group.title}</p>
                            </div>
                            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                                {group.entries.map((entry) => (
                                    <MemberNotificationRuleRow
                                        key={entry.key}
                                        entry={entry}
                                        projectPolicy={projectPolicy}
                                        draft={draft}
                                        canEdit={data.canEdit}
                                        onDraftChange={onDraftChange}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
                    This member inherits the project-level policy. Changes to project defaults will automatically apply to optional triggers.
                </p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" disabled={isSaving || !data.canEdit} onClick={() => void onReset()}>
                    Reset to project defaults
                </Button>
                <Button type="button" disabled={isSaving || !data.canEdit} onClick={() => void onSave()}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save member settings
                </Button>
            </div>
        </div>
    );
}

function MemberNotificationRuleRow({
    entry,
    projectPolicy,
    draft,
    canEdit,
    onDraftChange,
}: {
    entry: ProjectNotificationRegistryEntry;
    projectPolicy: ProjectNotificationPolicy;
    draft: ProjectMemberNotificationOverrides;
    canEdit: boolean;
    onDraftChange: React.Dispatch<React.SetStateAction<ProjectMemberNotificationOverrides>>;
}) {
    const decision = resolveProjectNotificationDecision({ eventKey: entry.key, projectPolicy, memberOverrides: draft });
    const projectDecision = resolveProjectNotificationDecision({ eventKey: entry.key, projectPolicy });
    const disabled = !canEdit || entry.mandatory || !entry.allowMemberOverride || !projectDecision.enabled;
    const checked = decision.enabled;

    return (
        <div className="grid gap-3 bg-white p-3 dark:bg-zinc-950 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
                <p className="text-xs font-semibold text-zinc-950 dark:text-zinc-50">{entry.label}</p>
                <p className="mt-1 text-[11px] leading-4 text-zinc-500">
                    {entry.mandatory
                        ? "Locked on for responsibility or safety."
                        : !projectDecision.enabled
                            ? "Disabled by project defaults."
                            : entry.allowMemberOverride
                                ? "Optional personal preference."
                                : "Managed by project policy."}
                </p>
            </div>
            <TogglePill
                checked={checked}
                disabled={disabled}
                label={disabled ? "Locked" : checked ? "On" : "Off"}
                onChange={(enabled) => {
                    onDraftChange((current) => ({
                        ...current,
                        mode: "custom",
                        rules: {
                            ...current.rules,
                            [entry.key]: enabled,
                        },
                    }));
                }}
            />
        </div>
    );
}

function AdvancedDisclosure({
    title,
    open,
    onToggle,
    children,
}: {
    title: string;
    open: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <button
                type="button"
                onClick={onToggle}
                className="flex w-full items-center justify-between gap-4 text-left"
            >
                <div>
                    <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{title}</p>
                    <p className="mt-1 text-xs text-zinc-500">Progressive details for owners who need the full impact.</p>
                </div>
                <ChevronDown className={cn("h-4 w-4 text-zinc-400 transition", open && "rotate-180")} />
            </button>
            {open ? <div className="mt-4">{children}</div> : null}
        </section>
    );
}

function AffectedAreas({ items }: { items: string[] }) {
    return (
        <div className="grid gap-2">
            {items.map((item) => (
                <div key={item} className="flex items-start gap-2 rounded-2xl bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900/70 dark:text-zinc-300">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                    <span>{item}</span>
                </div>
            ))}
        </div>
    );
}

function AccessMatrix({
    rows,
    activeVisibility,
}: {
    rows: Array<{ viewer: string; publicAccess: string; privateAccess: string }>;
    activeVisibility: ProjectSettingsVisibility;
}) {
    return (
        <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <div className="grid grid-cols-[1fr_1fr] border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/60 sm:grid-cols-[180px_1fr_1fr]">
                <div className="hidden px-3 py-3 sm:block">Viewer</div>
                <div className={cn("px-3 py-3", activeVisibility === "public" && "text-blue-600 dark:text-blue-300")}>Public</div>
                <div className={cn("px-3 py-3", activeVisibility === "private" && "text-blue-600 dark:text-blue-300")}>Private</div>
            </div>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {rows.map((row) => (
                    <div key={row.viewer} className="grid gap-0 text-sm sm:grid-cols-[180px_1fr_1fr]">
                        <div className="border-b border-zinc-100 bg-zinc-50 px-3 py-3 font-semibold text-zinc-900 dark:border-zinc-900 dark:bg-zinc-900/40 dark:text-zinc-100 sm:border-b-0">
                            {row.viewer}
                        </div>
                        <div className={cn("px-3 py-3 text-zinc-600 dark:text-zinc-300", activeVisibility === "public" && "bg-blue-50/60 text-blue-800 dark:bg-blue-950/20 dark:text-blue-200")}>
                            {row.publicAccess}
                        </div>
                        <div className={cn("px-3 py-3 text-zinc-600 dark:text-zinc-300", activeVisibility === "private" && "bg-blue-50/60 text-blue-800 dark:bg-blue-950/20 dark:text-blue-200")}>
                            {row.privateAccess}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function AccessImpactGrid({
    items,
    isLoading,
}: {
    items: Array<{ label: string; value: number; detail: string }>;
    isLoading: boolean;
}) {
    if (isLoading) {
        return (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="h-24 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60" />
                ))}
            </div>
        );
    }

    return (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
                <div key={item.label} className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                    <p className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{item.value}</p>
                    <p className="mt-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{item.label}</p>
                    <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{item.detail}</p>
                </div>
            ))}
        </div>
    );
}

const PUBLIC_TAB_ORDER: ProjectPublicTabId[] = ["dashboard", "readme", "updates", "sprints", "tasks", "analytics", "files"];

function TogglePill({
    checked,
    disabled,
    onChange,
    label,
}: {
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
    label: string;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={cn(
                "inline-flex h-7 w-14 items-center rounded-full border p-0.5 transition disabled:cursor-not-allowed disabled:opacity-60",
                checked
                    ? "border-blue-500 bg-blue-600"
                    : "border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900",
            )}
        >
            <span
                className={cn(
                    "h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                    checked ? "translate-x-7" : "translate-x-0",
                )}
            />
        </button>
    );
}

function PublicTabVisibilityEditor({
    value,
    onChange,
    disabled,
}: {
    value: ProjectPublicTabVisibility;
    onChange: (tabId: ProjectPublicTabId, enabled: boolean) => void;
    disabled?: boolean;
}) {
    return (
        <div className="grid gap-3">
            {PUBLIC_TAB_ORDER.map((tabId) => (
                <div
                    key={tabId}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
                >
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{PROJECT_PUBLIC_TAB_LABELS[tabId]}</p>
                        <p className="mt-1 text-sm leading-5 text-zinc-500 dark:text-zinc-400">{PROJECT_PUBLIC_TAB_DESCRIPTIONS[tabId]}</p>
                        <p className="mt-2 text-xs font-medium text-zinc-400">
                            Default: {DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY[tabId] ? "Visible to public" : "Members only"}
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <span className={cn(
                            "text-xs font-semibold",
                            value[tabId] ? "text-blue-600 dark:text-blue-300" : "text-zinc-400",
                        )}>
                            {value[tabId] ? "On" : "Off"}
                        </span>
                        <TogglePill
                            checked={value[tabId]}
                            disabled={disabled}
                            label={`Toggle public ${PROJECT_PUBLIC_TAB_LABELS[tabId]} visibility`}
                            onChange={(next) => onChange(tabId, next)}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}

function FileWorkspaceMembers({
    data,
    isLoading,
    savingMemberId,
    onToggle,
}: {
    data: FileWorkspaceSettingsData | null;
    isLoading: boolean;
    savingMemberId: string | null;
    onToggle: (member: FileWorkspaceSettingsData["members"][number], enabled: boolean) => void | Promise<void>;
}) {
    if (isLoading && !data) {
        return (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading file upload permissions...
            </div>
        );
    }
    const members = data?.members ?? [];
    if (members.length === 0) {
        return <p className="text-sm text-zinc-500">No project members found.</p>;
    }
    return (
        <div className="grid gap-3">
            {members.map((member) => {
                const role = member.membershipRole as ProjectMemberRole;
                const displayName = getProjectMemberDisplayName(member);
                const isSaving = savingMemberId === member.id;
                return (
                    <div
                        key={member.id}
                        className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
                    >
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 text-sm font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                                {member.avatarUrl ? (
                                    <Image src={member.avatarUrl} alt="" className="object-cover rounded-full" fill sizes="44px" />
                                ) : (
                                    displayName.slice(0, 1).toUpperCase()
                                )}
                            </div>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{displayName}</p>
                                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-300">
                                        {getProjectMemberRoleLabel(role)}
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-zinc-500">
                                    {member.projectRoleTitle || member.username || member.uploadPermissionLabel}
                                </p>
                                <p className="mt-1 text-xs text-zinc-400">{formatJoinedAt(member.joinedAt)}</p>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <span className={cn(
                                "text-xs font-semibold",
                                member.fileUploadEnabled ? "text-blue-600 dark:text-blue-300" : "text-zinc-400",
                            )}>
                                {isSaving ? "Saving" : member.fileUploadEnabled ? "On" : "Off"}
                            </span>
                            {isSaving ? (
                                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                            ) : (
                                <TogglePill
                                    checked={member.fileUploadEnabled}
                                    disabled={member.uploadPermissionLocked}
                                    label={`Toggle file uploads for ${displayName}`}
                                    onChange={(next) => void onToggle(member, next)}
                                />
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function LifecycleSettingsEditor({
    initialStages,
    currentStageIndex,
    isSaving,
    onSave,
}: {
    initialStages: string[];
    currentStageIndex: number;
    isSaving: boolean;
    onSave: (stages: string[], currentStageIdentity: string) => Promise<void>;
}) {
    const [stages, setStages] = useState(initialStages);
    const currentStageIdentity = initialStages[currentStageIndex] || "";
    useEffect(() => {
        setStages(initialStages);
    }, [initialStages]);

    const handleSave = useCallback(async () => {
        const cleaned = stages.map((stage) => stage.trim().replace(/\s+/g, " ")).filter(Boolean);
        if (cleaned.length === 0) {
            toast.error("You must have at least one stage");
            return;
        }
        await onSave(cleaned, currentStageIdentity);
    }, [currentStageIdentity, onSave, stages]);

    return (
        <div className="space-y-4">
            <BaseLifecycleEditor
                stages={stages}
                onChange={setStages}
                currentStageIndex={currentStageIndex}
            />
            <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving || stages.length === 0}
                className="bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {isSaving ? "Saving..." : "Save Lifecycle"}
            </Button>
        </div>
    );
}

function AccessTransitionDetails({ preflight }: { preflight: AccessTransitionPreflightData }) {
    const previewRows = [
        {
            label: "Followers",
            items: preflight.previews.followers.map((follower) => follower.fullName || follower.username || "Follower"),
            fallback: "No follower previews are affected.",
        },
        {
            label: "Open roles",
            items: preflight.previews.openRoles.map((role) => role.title || role.role || "Open role"),
            fallback: "No open role previews are affected.",
        },
        {
            label: "Pending applications",
            items: preflight.previews.pendingApplications.map((application) => {
                const roleLabel = application.roleTitle || application.roleName || "role";
                return `${application.applicantName || "Applicant"} · ${roleLabel}`;
            }),
            fallback: "No pending application previews are affected.",
        },
    ];

    return (
        <div className="space-y-4 text-sm">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
                <p className="font-semibold text-zinc-950 dark:text-zinc-50">Affected counts</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {[
                        ["Members", preflight.counts.membersCount],
                        ["Followers", preflight.counts.followersCount],
                        ["Open roles", preflight.counts.openRolesCount],
                        ["Pending applications", preflight.counts.pendingApplicationsCount],
                        ["Active tasks", preflight.counts.activeTasksCount],
                    ].map(([label, value]) => (
                        <div key={label} className="rounded-xl bg-white px-3 py-2 text-xs dark:bg-zinc-950">
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{value}</span>
                            <span className="ml-2 text-zinc-500">{label}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Transition checklist</p>
                <PolicyList items={preflight.policy.transitionChecklist} />
            </div>

            {preflight.policy.irreversibleNotes.length > 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                    <p className="font-semibold">Important notes</p>
                    <ul className="mt-2 space-y-1 text-xs leading-5">
                        {preflight.policy.irreversibleNotes.map((note) => (
                            <li key={note}>{note}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            <div className="grid gap-3">
                {previewRows.map((row) => (
                    <div key={row.label} className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">{row.label}</p>
                        {row.items.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                                {row.items.map((item, index) => (
                                    <span key={`${row.label}-${index}-${item}`} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                                        {item}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p className="mt-2 text-xs text-zinc-500">{row.fallback}</p>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function SettingsAuditTimeline({
    events,
    isLoading,
}: {
    events: SettingsAuditEvent[];
    isLoading: boolean;
}) {
    if (isLoading) {
        return (
            <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="h-16 animate-pulse rounded-2xl bg-zinc-50 dark:bg-zinc-900/70" />
                ))}
            </div>
        );
    }

    if (events.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                No settings audit events have been recorded yet.
            </div>
        );
    }

    return (
        <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {events.map((event) => (
                <div key={event.id} className="flex flex-col gap-1 bg-white px-4 py-3 text-sm dark:bg-zinc-950 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">{formatSettingsAuditEvent(event)}</p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {event.actorName || "System"} · {formatAuditDate(event.createdAt)}
                        </p>
                    </div>
                    <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                        Audit
                    </span>
                </div>
            ))}
        </div>
    );
}

function formatSettingsAuditEvent(event: SettingsAuditEvent) {
    const targetName = typeof event.metadata.targetDisplayName === "string"
        ? event.metadata.targetDisplayName
        : typeof (event.metadata.targetSnapshot as { fullName?: unknown; username?: unknown } | undefined)?.fullName === "string"
            ? String((event.metadata.targetSnapshot as { fullName?: unknown }).fullName)
            : typeof (event.metadata.targetSnapshot as { username?: unknown } | undefined)?.username === "string"
                ? String((event.metadata.targetSnapshot as { username?: unknown }).username)
                : "Member";
    if (event.type === "project_settings.visibility_changed") {
        const previous = typeof event.metadata.previousVisibility === "string" ? event.metadata.previousVisibility : "unknown";
        const next = typeof event.metadata.nextVisibility === "string" ? event.metadata.nextVisibility : "unknown";
        return `Visibility changed from ${previous} to ${next}`;
    }
    if (event.type === "project_member.role_changed") {
        const previous = typeof event.metadata.previousRole === "string" ? event.metadata.previousRole : "unknown";
        const next = typeof event.metadata.nextRole === "string" ? event.metadata.nextRole : "unknown";
        return `${targetName} changed from ${getProjectMemberRoleLabel(previous)} to ${getProjectMemberRoleLabel(next)}`;
    }
    if (event.type === "project_member.removed") {
        const previous = typeof event.metadata.previousRole === "string" ? event.metadata.previousRole : "unknown";
        return `${targetName} removed from ${getProjectMemberRoleLabel(previous)}`;
    }
    if (event.type === "project_member.ownership_transferred") {
        const previousOwner = (event.metadata.previousOwnerSnapshot as { fullName?: string | null; username?: string | null } | null)?.fullName
            || (event.metadata.previousOwnerSnapshot as { username?: string | null } | null)?.username
            || "Previous owner";
        const newOwner = (event.metadata.newOwnerSnapshot as { fullName?: string | null; username?: string | null } | null)?.fullName
            || (event.metadata.newOwnerSnapshot as { username?: string | null } | null)?.username
            || "New owner";
        return `Ownership transferred from ${previousOwner} to ${newOwner}`;
    }
    return event.type.replace(/^project_settings\./, "").replace(/_/g, " ");
}

function formatAuditDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown time";
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

function PolicyList({ items }: { items: string[] }) {
    return (
        <ul className="grid gap-2">
            {items.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                    <KeyRound className="mt-1 h-4 w-4 shrink-0 text-zinc-400" />
                    <span>{item}</span>
                </li>
            ))}
        </ul>
    );
}

function DangerAction({
    icon: Icon,
    title,
    description,
    actionLabel,
    disabled,
    onClick,
}: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description: string;
    actionLabel: string;
    disabled: boolean;
    onClick: () => void;
}) {
    return (
        <SettingsCard title={title} description={description} danger>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 text-sm text-red-700 dark:text-red-300">
                    <Icon className="h-5 w-5" />
                    This change affects project visibility, routing, and member access.
                </div>
                <Button variant="destructive" onClick={onClick} disabled={disabled} className="gap-2">
                    <Icon className="h-4 w-4" />
                    {actionLabel}
                </Button>
            </div>
        </SettingsCard>
    );
}
