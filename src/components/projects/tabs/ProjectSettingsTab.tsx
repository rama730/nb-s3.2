"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
    AlertTriangle,
    Archive,
    Bell,
    ChevronDown,
    Crown,
    Database,
    Download,
    FileText,
    Folder,
    Globe,
    KeyRound,
    Loader2,
    Lock,
    Route,
    Settings,
    Shield,
    Trash2,
    UserCog,
    Users,
    Workflow,
    Plus,
    X,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { transferProjectOwnership } from "@/app/actions/account";
import {
    archiveProjectAction,
    createProjectCoverImageUploadUrlAction,
    deleteProject,
    finalizeProjectCoverImageUploadAction,
    getProjectDangerZonePreflightAction,
    updateProject,
    updateProjectLifecycleAction,
    updateProjectSettingsAction,
} from "@/app/actions/project";
import LifecycleEditor from "@/components/projects/settings/LifecycleEditor";
import { cn } from "@/lib/utils";
import {
    isKnownProjectType,
    OTHER_PROJECT_TYPE_ID,
    POPULAR_PROJECT_TAGS,
    POPULAR_PROJECT_TECH,
    PROJECT_TYPE_OPTIONS,
} from "@/lib/projects/project-create-options";
import {
    buildProjectAccessPolicy,
    buildProjectFilePolicy,
    buildProjectNotificationPolicy,
    buildProjectRolePolicy,
    buildProjectSettingsPreflight,
    getProjectMemberDisplayName,
    getVisibleProjectSettingsSections,
    normalizeProjectVisibility,
    type ProjectSettingsMember,
    type ProjectSettingsSectionId,
    type ProjectSettingsVisibility,
} from "@/lib/projects/settings-policies";
import { prepareProjectImageForUpload } from "@/lib/upload/image-prep-client";
import { uploadToSupabaseSignedUrl } from "@/lib/upload/supabase-signed-upload-client";

interface ProjectSettingsTabProps {
    projectId: string;
    project: any;
    onProjectUpdated: (updates?: { coverImage?: string | null }) => void;
    isProjectOwner: boolean;
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
    access: Globe,
    collaborators: Users,
    "roles-applications": UserCog,
    "tasks-workflow": Workflow,
    "files-workspace": Folder,
    readme: FileText,
    updates: Bell,
    notifications: Bell,
    automation: Route,
    "security-audit": Shield,
    data: Database,
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

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function readImageDimensions(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const image = new Image();
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

function formatRole(role: string | null | undefined) {
    if (!role) return "Member";
    return role.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function resetSettingsFromProject(project: any) {
    return {
        visibility: normalizeProjectVisibility(project?.visibility),
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
    members = [],
    loadingMembers = false,
}: ProjectSettingsTabProps) {
    const router = useRouter();
    const sections = useMemo(() => getVisibleProjectSettingsSections(), []);
    const [activeSection, setActiveSection] = useState<ProjectSettingsSectionId>("general");
    const [advancedOpen, setAdvancedOpen] = useState<Partial<Record<ProjectSettingsSectionId, boolean>>>({});
    const [savingSettings, setSavingSettings] = useState(false);
    const [uploadingCoverImage, setUploadingCoverImage] = useState(false);
    const [savingLifecycle, setSavingLifecycle] = useState(false);
    const [loadingExport, setLoadingExport] = useState(false);
    const [confirmLoading, setConfirmLoading] = useState(false);
    const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
    const [dangerPreflight, setDangerPreflight] = useState<DangerPreflight | null>(null);
    const [dangerPreflightLoading, setDangerPreflightLoading] = useState(false);
    const [transferOwnerId, setTransferOwnerId] = useState("");

    const initialSettings = useMemo(() => resetSettingsFromProject(project), [project]);
    const initialIdentity = useMemo(() => resetIdentityFromProject(project), [project]);
    const [visibility, setVisibility] = useState<ProjectSettingsVisibility>(initialSettings.visibility);
    const [projectTitle, setProjectTitle] = useState(initialIdentity.title);
    const [shortDescription, setShortDescription] = useState(initialIdentity.shortDescription);
    const [description, setDescription] = useState(initialIdentity.description);
    const [categoryChoice, setCategoryChoice] = useState(initialIdentity.categoryChoice);
    const [customCategory, setCustomCategory] = useState(initialIdentity.customCategory);
    const [tags, setTags] = useState<string[]>(initialIdentity.tags);
    const [skills, setSkills] = useState<string[]>(initialIdentity.skills);
    const [coverImage, setCoverImage] = useState(initialIdentity.coverImage);
    const [coverDraft, setCoverDraft] = useState<CoverDraft | null>(null);
    const projectImageDragRef = useRef<ProjectImageDragState | null>(null);
    const coverInputRef = useRef<HTMLInputElement | null>(null);
    const filePickerScrollSnapshotRef = useRef<ScrollSnapshot | null>(null);

    useEffect(() => {
        setVisibility(initialSettings.visibility);
    }, [initialSettings]);

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
    const rolePolicy = useMemo(
        () => buildProjectRolePolicy({ isOwner: isProjectOwner, ownerId, members }),
        [isProjectOwner, members, ownerId],
    );
    const notificationPolicy = useMemo(() => buildProjectNotificationPolicy(), []);
    const filePolicy = useMemo(() => buildProjectFilePolicy(), []);
    const preflightPolicy = useMemo(() => buildProjectSettingsPreflight(dangerPreflight), [dangerPreflight]);

    const accessDirty = visibility !== initialSettings.visibility;
    const categoryValue = resolveProjectCategory(categoryChoice, customCategory);
    const identityDirty =
        projectTitle !== initialIdentity.title ||
        shortDescription !== initialIdentity.shortDescription ||
        description !== initialIdentity.description ||
        categoryValue !== initialIdentity.category ||
        !areStringArraysEqual(tags, initialIdentity.tags) ||
        !areStringArraysEqual(skills, initialIdentity.skills);
    const sectionDirty =
        activeSection === "general"
            ? identityDirty
            : activeSection === "access"
                ? accessDirty
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

    useEffect(() => {
        if (activeSection !== "danger") return;
        void loadDangerPreflight();
    }, [activeSection, loadDangerPreflight]);

    const saveAccessSettings = useCallback(async () => {
        const result = await updateProjectSettingsAction(projectId, {
            visibility,
        });
        if (!result.success) {
            return { success: false, message: result.message };
        }
        return { success: true, message: result.message, refresh: true };
    }, [projectId, visibility]);

    const handleSaveAccess = useCallback(async () => {
        if (visibility === "private" && initialSettings.visibility !== "private") {
            setConfirmAction({
                title: "Make project private",
                description: "Only the owner and approved members will be able to open the project. Discovery, public search, public share metadata, follower update surfaces, files, tasks, applications, README, and Updates will become member-only where applicable.",
                confirmLabel: "Make private",
                variant: "destructive",
                action: saveAccessSettings,
            });
            return;
        }

        setSavingSettings(true);
        try {
            const result = await saveAccessSettings();
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            toast.success(result.message);
            onProjectUpdated();
            router.refresh();
        } catch (error) {
            console.error("Failed to save project settings", error);
            toast.error("Failed to save settings.");
        } finally {
            setSavingSettings(false);
        }
    }, [initialSettings.visibility, onProjectUpdated, router, saveAccessSettings, visibility]);

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

    const handleSaveCurrentSection = useCallback(() => {
        if (activeSection === "general") {
            void handleSaveGeneral();
            return;
        }
        if (activeSection === "access") {
            void handleSaveAccess();
        }
    }, [activeSection, handleSaveAccess, handleSaveGeneral]);

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
        }
    }, [activeSection, initialIdentity, initialSettings]);

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
                members: members.map((member) => ({
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
    }, [members, ownerId, project, projectId]);

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

            await uploadToSupabaseSignedUrl(uploadSession, preparedImage.blob);

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
            const result = await updateProject(projectId, { coverImage: null });
            if (!result?.success) {
                throw new Error("Failed to remove project avatar");
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
                onProjectUpdated();
                router.refresh();
            }
            setConfirmAction(null);
            if (result.redirectTo) {
                router.push(result.redirectTo);
            }
        } catch (error) {
            console.error("Confirm action failed", error);
            toast.error("Action failed. Please try again.");
        } finally {
            setConfirmLoading(false);
        }
    }, [confirmAction, onProjectUpdated, router]);

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

    const prepareTransfer = useCallback(() => {
        const candidate = rolePolicy.transferCandidates.find((member) => member.id === transferOwnerId);
        if (!candidate) {
            toast.error("Choose a member before transferring ownership.");
            return;
        }
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
    }, [projectId, rolePolicy.transferCandidates, transferOwnerId]);

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

    if (!isProjectOwner) {
        return (
            <div className="mx-auto flex max-w-xl flex-col items-center justify-center rounded-3xl border border-zinc-200 bg-white px-8 py-16 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-900">
                    <Lock className="h-8 w-8 text-zinc-400" />
                </div>
                <h3 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Settings are owner-only</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                    Project settings can change discovery, permissions, files, notifications, and destructive lifecycle actions. Ask the owner for access if you need to change them.
                </p>
            </div>
        );
    }

    const coverImageUrl = coverImage.trim();
    const coverInputId = `project-image-${projectId}`;

    return (
        <div className="mx-auto grid w-full max-w-7xl gap-6 p-4 sm:p-6 lg:p-8 xl:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="h-fit rounded-3xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-var(--ui-topnav-height)-8rem)] xl:overflow-y-auto xl:app-scroll xl:app-scroll-y xl:app-scroll-gutter">
                <div className="px-3 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-400">Project settings</p>
                    <h2 className="mt-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">Control center</h2>
                    <p className="mt-2 text-sm leading-5 text-zinc-500">
                        Owner-only settings with one canonical policy path across the app.
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
                                                <img
                                                    src={coverDraft.previewUrl}
                                                    alt=""
                                                    draggable={false}
                                                    className="absolute left-1/2 top-1/2 max-w-none select-none"
                                                    style={{
                                                        width: `${projectImagePreviewMetricsValue?.width ?? PROJECT_IMAGE_PREVIEW_SIZE}px`,
                                                        height: `${projectImagePreviewMetricsValue?.height ?? PROJECT_IMAGE_PREVIEW_SIZE}px`,
                                                        transform: `translate(calc(-50% + ${coverDraft.offsetX}px), calc(-50% + ${coverDraft.offsetY}px))`,
                                                    }}
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
                                            <img
                                                src={coverImageUrl}
                                                alt={`${projectTitle || "Project"} image`}
                                                className="h-44 w-44 rounded-xl object-cover"
                                            />
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
                            <div className="grid gap-6">
                                <ChipEditor
                                    label="Tags"
                                    values={tags}
                                    onChange={setTags}
                                    suggestions={POPULAR_PROJECT_TAGS}
                                    placeholder="Add a tag"
                                    tone="indigo"
                                    limit={PROJECT_TAG_LIMIT}
                                />
                                <ChipEditor
                                    label="Tech Stack"
                                    values={skills}
                                    onChange={setSkills}
                                    suggestions={POPULAR_PROJECT_TECH}
                                    placeholder="Add a technology"
                                    tone="emerald"
                                    limit={PROJECT_SKILL_LIMIT}
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
                                    "Application intake, collaborator previews, README, and Updates surfaces reuse these same fields.",
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

                        <SettingsCard
                            title="Project visibility"
                            description="This one owner-controlled policy is used by project cards, detail pages, search, files, applications, notifications, and future README/Updates surfaces."
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

                        <SettingsCard
                            title="Viewer access matrix"
                            description="Private projects behave like a private repository: members keep access, outsiders do not receive project content or metadata."
                        >
                            <AccessMatrix rows={accessPolicy.viewerRows} activeVisibility={visibility} />
                        </SettingsCard>

                        <SettingsCard title="Affected areas" description="Visibility changes are not cosmetic; they change access decisions across the product.">
                            <AffectedAreas items={accessPolicy.affectedAreas} />
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

                {activeSection === "collaborators" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Collaborator policy"
                            description="Members are shown through the same project member data used by dashboard, tasks, and files. Role mutations stay guarded by owner checks."
                            icon={Users}
                            meta={[
                                ["Members loaded", loadingMembers ? "Loading..." : String(rolePolicy.members.length)],
                                ["Transfer candidates", String(rolePolicy.transferCandidates.length)],
                            ]}
                        />

                        <SettingsCard title="Members" description="Current project members and effective roles. Role editing/removal should continue through the canonical member-management flow.">
                            {loadingMembers ? (
                                <div className="flex items-center gap-2 text-sm text-zinc-500">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading members...
                                </div>
                            ) : rolePolicy.members.length === 0 ? (
                                <p className="text-sm text-zinc-500">No members loaded yet.</p>
                            ) : (
                                <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                                    {rolePolicy.members.slice(0, 8).map((member) => (
                                        <MemberRow key={member.id} member={member} role={projectMemberRole(member, ownerId)} />
                                    ))}
                                </div>
                            )}
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
                            title="Roles and applications"
                            description="Application intake stays connected to open roles, reviewer routing, and project notifications."
                            icon={UserCog}
                            meta={[
                                ["Open roles", String(dangerPreflight?.openRolesCount ?? project?.openRoles?.length ?? "Load in Danger Zone")],
                                ["Applications", "Canonical application flow"],
                            ]}
                        />
                        <SettingsCard title="Current enforceable behavior" description="No decorative switches here; these are the flows currently backed by server state.">
                            <PolicyList
                                items={[
                                    "Open roles define application entry points and role visibility.",
                                    "Application decisions route durable notifications to applicants.",
                                    "Accepted applicants become project members through the canonical member flow.",
                                    "Reviewer routing stays attached to role/application server actions.",
                                ]}
                            />
                            <div className="mt-4">
                                <Button variant="outline" onClick={() => router.push(`/projects/${project?.slug ?? projectId}?tab=dashboard`)}>
                                    Review roles on dashboard
                                </Button>
                            </div>
                        </SettingsCard>
                    </div>
                )}

                {activeSection === "tasks-workflow" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Tasks and workflow"
                            description="Lifecycle stages are enforceable today and feed project progress surfaces. Task labels/templates stay hidden until they have a canonical backend."
                            icon={Workflow}
                            meta={[
                                ["Lifecycle", "Enabled"],
                                ["Task templates", "Hidden until enforceable"],
                            ]}
                        />
                        <SettingsCard title="Project lifecycle" description="Define the project journey stages used by the project dashboard.">
                            <LifecycleEditor
                                initialStages={project?.lifecycle_stages || project?.lifecycleStages || ["Concept", "MVP", "Launch"]}
                                currentStageIndex={project?.current_stage_index ?? project?.currentStageIndex ?? 0}
                                isSaving={savingLifecycle}
                                onSave={async (stages, currentActiveStage) => {
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
                            description="This section documents the file policy currently enforced by project Files and task Files."
                            icon={Folder}
                            meta={[
                                ["Open with", "Row-level"],
                                ["Versioning", "Enabled in file rows"],
                            ]}
                        />
                        <SettingsCard title="Enforced file behavior" description="The same rules are used in project Files, task Files, notifications, and Open with menus.">
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

                {activeSection === "notifications" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Project notification policy"
                            description={notificationPolicy.summary}
                            icon={Bell}
                            meta={[
                                ["Delivery channels", "Global settings"],
                                ["Project events", "Attention-only"],
                            ]}
                        />
                        <SettingsCard title="Project event categories" description="Project settings control which project events create responsibility. Personal delivery channels remain global.">
                            <PolicyList items={notificationPolicy.categories} />
                            <div className="mt-4 flex flex-wrap gap-2">
                                <Button variant="outline" onClick={() => router.push("/settings/notifications")}>
                                    Open global notification settings
                                </Button>
                            </div>
                        </SettingsCard>
                        <AdvancedDisclosure
                            open={Boolean(advancedOpen.notifications)}
                            onToggle={() => toggleAdvanced("notifications")}
                            title="Affected notification surfaces"
                        >
                            <AffectedAreas items={notificationPolicy.affectedAreas} />
                        </AdvancedDisclosure>
                    </div>
                )}

                {activeSection === "security-audit" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Security and audit"
                            description="Sensitive actions stay owner-only, step-up protected where available, and recorded through the canonical audit path."
                            icon={Shield}
                            meta={[
                                ["Settings access", "Owner only"],
                                ["Transfer ownership", "Step-up protected"],
                                ["Danger actions", "Preflight required"],
                            ]}
                        />
                        <SettingsCard title="Protected action model" description="These guardrails keep the project stable without adding fake toggles.">
                            <PolicyList
                                items={[
                                    "Settings tab is hidden from non-owners.",
                                    "Ownership transfer requires the next owner to already be a member.",
                                    "Danger Zone runs preflight checks before archive/delete.",
                                    "Permission and ownership changes reuse shared security logic.",
                                ]}
                            />
                        </SettingsCard>
                    </div>
                )}

                {activeSection === "data" && (
                    <div className="space-y-5">
                        <SummaryCard
                            title="Data"
                            description="Export is available now. Import and restore stay hidden until validation, preview, and rollback are safe."
                            icon={Database}
                            meta={[
                                ["Export", "Available"],
                                ["Import / restore", "Hidden until enforceable"],
                            ]}
                        />
                        <SettingsCard title="Export project snapshot" description="Download a JSON snapshot of project identity, settings, lifecycle, and loaded member summaries.">
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
                                                {getProjectMemberDisplayName(member)} · {formatRole(projectMemberRole(member, ownerId))}
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
                    if (!open && !confirmLoading) setConfirmAction(null);
                }}
                title={confirmAction?.title ?? ""}
                description={confirmAction?.description}
                confirmLabel={confirmAction?.confirmLabel ?? "Confirm"}
                variant={confirmAction?.variant ?? "destructive"}
                loading={confirmLoading}
                autoCloseOnConfirm={false}
                onConfirm={runConfirmAction}
            />
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
            "rounded-3xl border p-5 shadow-sm",
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
            "rounded-3xl border p-5 shadow-sm",
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
        <div>
            <div className="flex items-center justify-between gap-3">
                <label className="block text-sm font-semibold text-zinc-950 dark:text-zinc-50">{label}</label>
                <span className="text-xs font-medium text-zinc-400">{values.length}/{limit}</span>
            </div>
            <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50/30 p-4 dark:border-zinc-800 dark:bg-zinc-900/20">
                {values.length > 0 ? (
                    <div className="mb-3 flex flex-wrap gap-2">
                        {values.map((value) => (
                            <span
                                key={value}
                                className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm", chipClass)}
                            >
                                {prefix}{value}
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

function MemberRow({ member, role }: { member: ProjectSettingsMember; role: string }) {
    return (
        <div className="flex items-center justify-between gap-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                    {getProjectMemberDisplayName(member).slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{getProjectMemberDisplayName(member)}</p>
                    <p className="truncate text-xs text-zinc-500">{member.projectRoleTitle || member.username || member.id}</p>
                </div>
            </div>
            <span className="shrink-0 rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                {formatRole(role)}
            </span>
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
