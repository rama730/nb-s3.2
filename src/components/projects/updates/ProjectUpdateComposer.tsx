"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
    ChevronDown,
    ChevronUp,
    FileText,
    Globe2,
    ImagePlus,
    Link2,
    Loader2,
    Paperclip,
    Timer,
    Users,
    X,
} from "lucide-react";
import { toast } from "sonner";
import { createPortal } from "react-dom";
import { ProjectReadmeReferencePicker } from "@/components/projects/readme/ProjectReadmeReferencePicker";
import {
    buildInlineReadmeReference,
    type ProjectReadmeReferenceKind,
} from "@/lib/projects/readme-blocks";
import { MultiAttachmentPicker } from "@/components/projects/v2/files-tab/picker/MultiAttachmentPicker";

import { 
    createProjectUpdateMediaUploadUrlAction,
    finalizeProjectUpdateMediaUploadAction,
    readProjectUpdateContextOptionsAction,
    readProjectUpdateDraftAction,
    saveProjectUpdateDraftAction,
} from "@/app/actions/project";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { queryKeys } from "@/lib/query-keys";
import {
    PROJECT_UPDATE_MAX_MEDIA_ITEMS,
    PROJECT_UPDATE_ALLOWED_IMAGE_MIME_TYPES,
    PROJECT_UPDATE_MEDIA_MAX_BYTES,
    isSafeProjectUpdateUrl,
    normalizeProjectUpdateMediaItems,
    normalizeProjectUpdateReferences,
    projectUpdateDraftStorageKey,
    type ProjectUpdateContextKind,
    type ProjectUpdateContextOption,
    type ProjectUpdateEntityRefs,
    type ProjectUpdateMediaItem,
    type ProjectUpdateVisibility,
} from "@/lib/projects/updates";
import { uploadToSupabaseSignedUrl } from "@/lib/upload/supabase-signed-upload-client";
import { cn } from "@/lib/utils";

const ProjectUpdateRichTextEditor = dynamic(
    () => import("./ProjectUpdateRichTextEditor").then((module) => module.ProjectUpdateRichTextEditor),
    {
        ssr: false,
        loading: () => <div className="min-h-28 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />,
    },
);

const EMPTY_REFS: ProjectUpdateEntityRefs = {};
const EMPTY_CONTEXT_OPTIONS: Record<ProjectUpdateContextKind, ProjectUpdateContextOption[]> = {
    task: [],
    sprint: [],
    file: [],
};
type ComposerPanel = ProjectUpdateContextKind | "link" | null;
type PendingMediaUpload = {
    id: string;
    fileName: string;
    previewUrl: string;
    altText: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
    phase: "preparing" | "uploading" | "finalizing";
    progress: number;
    error: string | null;
};

function useDebouncedValue<T>(value: T, delayMs: number) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timer);
    }, [delayMs, value]);
    return debounced;
}

function isProjectContextPanel(panel: ComposerPanel): panel is ProjectUpdateContextKind {
    return panel === "task" || panel === "sprint" || panel === "file";
}

function refKeyForContextKind(kind: ProjectUpdateContextKind): keyof ProjectUpdateEntityRefs {
    if (kind === "task") return "taskId";
    if (kind === "sprint") return "sprintId";
    return "fileId";
}

function assignLegacyContextRef(
    refs: ProjectUpdateEntityRefs,
    kind: ProjectUpdateContextKind,
    id: string | null,
) {
    if (kind === "task") refs.taskId = id;
    else if (kind === "sprint") refs.sprintId = id;
    else refs.fileId = id;
}

function selectedContextFromRefs(
    refs: ProjectUpdateEntityRefs,
    options: Record<ProjectUpdateContextKind, ProjectUpdateContextOption[]>,
) {
    const byKind = (kind: ProjectUpdateContextKind) => {
        const id = refs[refKeyForContextKind(kind)];
        return id ? options[kind].find((option) => option.id === id) ?? null : null;
    };
    return {
        task: byKind("task"),
        sprint: byKind("sprint"),
        file: byKind("file"),
    };
}

function hasEntityReferences(refs: ProjectUpdateEntityRefs) {
    return Boolean(
        normalizeProjectUpdateReferences(refs.references).length > 0 ||
            refs.taskId ||
            refs.sprintId ||
            refs.fileId ||
            refs.readmeVersionId ||
            refs.roleId ||
            refs.milestoneId,
    );
}

function referenceKey(option: Pick<ProjectUpdateContextOption, "kind" | "id">) {
    return `${option.kind}:${option.id}`;
}

function formatFileSize(bytes: number | null | undefined) {
    const value = Number(bytes ?? 0);
    if (!Number.isFinite(value) || value <= 0) return "";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function defaultAltText(file: File) {
    return file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Project update image";
}

function newUploadId() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
    if (!file.type.startsWith("image/")) return Promise.resolve(null);
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const image = new globalThis.Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve({ width: image.naturalWidth, height: image.naturalHeight });
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        image.src = url;
    });
}

export function ProjectUpdateComposer({
    projectId,
    projectName,
    currentUserId,
    currentUserName,
    currentUserAvatarUrl,
    canCreate,
    canManage,
    isPosting,
    onPost,
}: {
    projectId: string;
    projectName: string;
    currentUserId: string | null;
    currentUserName?: string | null;
    currentUserAvatarUrl?: string | null;
    canCreate: boolean;
    canManage: boolean;
    isPosting: boolean;
    onPost: (input: {
        content: string;
        updateType: null;
        visibility: ProjectUpdateVisibility;
        entityRefs: ProjectUpdateEntityRefs;
    media: ProjectUpdateMediaItem[];
    }) => void;
}) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const imageInputRef = useRef<HTMLInputElement | null>(null);
    const pendingMediaUploadsRef = useRef<PendingMediaUpload[]>([]);
    const [content, setContent] = useState("");
    const [expanded, setExpanded] = useState(false);
    const [visibility, setVisibility] = useState<ProjectUpdateVisibility>("public");
    const [entityRefs, setEntityRefs] = useState<ProjectUpdateEntityRefs>(EMPTY_REFS);
    const [media, setMedia] = useState<ProjectUpdateMediaItem[]>([]);
    const [pendingMediaUploads, setPendingMediaUploads] = useState<PendingMediaUpload[]>([]);
    const [activePanel, setActivePanel] = useState<ComposerPanel>(null);
    const [filePickerOpen, setFilePickerOpen] = useState(false);
    const [mentionPickerOpen, setMentionPickerOpen] = useState<ProjectReadmeReferenceKind | "all" | null>(null);
    const editorRef = useRef<{ insertTextAtCursor: (t: string) => void } | null>(null);
    const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
    useEffect(() => {
        setPortalTarget(typeof document !== "undefined" ? document.body : null);
    }, []);


    const [contextQuery, setContextQuery] = useState("");
    const debouncedContextQuery = useDebouncedValue(contextQuery, 250);
    const [mediaUrl, setMediaUrl] = useState("");
    const [mediaLabel, setMediaLabel] = useState("");
    const [selectedContextCache, setSelectedContextCache] = useState<Record<string, ProjectUpdateContextOption>>({});
    const draftStorageKey = useMemo(() => projectUpdateDraftStorageKey(projectId, currentUserId), [currentUserId, projectId]);
    const lastSavedDraftRef = useRef<string | null>(null);

    const activeContextKind = isProjectContextPanel(activePanel) ? activePanel : null;
    const remaining = 2_000 - content.length;
    const hasPendingUploads = pendingMediaUploads.some((item) => !item.error);
    const draftPreview = content.trim();
    const normalizedReferences = useMemo(
        () => normalizeProjectUpdateReferences(entityRefs.references),
        [entityRefs.references],
    );

    const contextOptionsQuery = useQuery({
        queryKey: queryKeys.project.detail.updateContextOptions(projectId, activeContextKind ?? "task", debouncedContextQuery),
        queryFn: async () => {
            const result = await readProjectUpdateContextOptionsAction(projectId, {
                kind: activeContextKind ?? "task",
                query: debouncedContextQuery,
                limit: 8,
            });
            if (!result.success) throw new Error(result.error || "Failed to load context");
            return result.data;
        },
        enabled: expanded && canCreate && Boolean(activeContextKind),
        staleTime: 30_000,
    });
    const contextOptions = contextOptionsQuery.data ?? EMPTY_CONTEXT_OPTIONS;
    const activeContextOptions = activeContextKind ? contextOptions[activeContextKind] : [];
    const selectedContext = useMemo(() => {
        const fromOptions = selectedContextFromRefs(entityRefs, contextOptions);
        const fromCache = (kind: ProjectUpdateContextKind) => {
            const id = entityRefs[refKeyForContextKind(kind)];
            const cached = id ? selectedContextCache[`${kind}:${id}`] : null;
            return id && cached?.id === id ? cached : null;
        };
        return {
            task: fromOptions.task ?? fromCache("task"),
            sprint: fromOptions.sprint ?? fromCache("sprint"),
            file: fromOptions.file ?? fromCache("file"),
        };
    }, [contextOptions, entityRefs, selectedContextCache]);
    const selectedReferences = useMemo(() => {
        const fromReferences = normalizedReferences.flatMap((reference) => {
            const byOptions = contextOptions[reference.kind].find((option) => option.id === reference.id);
            const cached = selectedContextCache[`${reference.kind}:${reference.id}`];
            return byOptions ?? cached ?? [];
        });
        if (fromReferences.length > 0) return fromReferences;
        return Object.values(selectedContext).filter((option): option is ProjectUpdateContextOption => Boolean(option));
    }, [contextOptions, normalizedReferences, selectedContext, selectedContextCache]);
    const hasMeaningfulUpdate = Boolean(content.trim() || normalizedReferences.length > 0 || selectedReferences.length > 0 || media.length > 0);
    const disabled = !hasMeaningfulUpdate || hasPendingUploads || remaining < 0 || isPosting;

    const draftQuery = useQuery({
        queryKey: queryKeys.project.detail.updateDraft(projectId, currentUserId ?? ""),
        queryFn: async () => {
            if (!currentUserId) return null;
            const result = await readProjectUpdateDraftAction(projectId);
            if (!result.success) return null;
            return result.data;
        },
        enabled: canCreate && Boolean(currentUserId),
    });

    const saveDraftMutation = useMutation({
        mutationFn: async (input: Parameters<typeof saveProjectUpdateDraftAction>[1]) => {
            const result = await saveProjectUpdateDraftAction(projectId, input);
            if (!result.success) throw new Error(result.error);
            return result.data;
        },
    });
    const saveDraft = saveDraftMutation.mutate;

    // We keep track if we have initialized the editor with the draft.
    const [draftInitialized, setDraftInitialized] = useState(false);

    useEffect(() => {
        if (!canCreate || draftInitialized || !draftQuery.isFetched) return;
        
        const parsed = draftQuery.data;
        if (parsed && typeof parsed.content === "string") {
            const draftText = parsed.content.slice(0, 2_200);
            setContent(draftText);
        }
        if (parsed && (parsed.visibility === "members" || parsed.visibility === "public")) setVisibility(parsed.visibility as ProjectUpdateVisibility);
        if (parsed?.entityRefs && typeof parsed.entityRefs === "object") setEntityRefs(parsed.entityRefs as ProjectUpdateEntityRefs);
        if (Array.isArray(parsed?.media)) setMedia(normalizeProjectUpdateMediaItems(parsed.media));
        
        setDraftInitialized(true);
    }, [canCreate, draftInitialized, draftQuery.data, draftQuery.isFetched]);

    useEffect(() => {
        if (!canCreate || !draftInitialized) return;
        const hasDraft = content.trim() || hasEntityReferences(entityRefs) || media.length > 0 || visibility !== "public";
        const payload = {
            content: hasDraft ? content : "",
            visibility: hasDraft ? visibility : "public",
            updateType: null,
            entityRefs: hasDraft ? entityRefs : {},
            media: hasDraft ? media : [],
        };
        const serializedPayload = JSON.stringify(payload);
        if (lastSavedDraftRef.current === serializedPayload) return;
        
        const timer = setTimeout(() => {
            lastSavedDraftRef.current = serializedPayload;
            saveDraft(payload);
        }, 500);
        
        return () => clearTimeout(timer);
    }, [canCreate, draftInitialized, content, entityRefs, media, saveDraft, visibility]);

    useEffect(() => {
        if (!expanded) return;
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (containerRef.current?.contains(target)) return;

            // Walk up the DOM to see if it is inside a portalled modal
            let curr: Node | null = target;
            let insidePortal = false;
            while (curr) {
                if (curr instanceof Element && curr.getAttribute("data-composer-portal") === "true") {
                    insidePortal = true;
                    break;
                }
                curr = curr.parentNode;
            }
            if (insidePortal) return;

            setExpanded(false);
        };
        document.addEventListener("pointerdown", handlePointerDown);
        return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, [expanded]);

    useEffect(() => {
        pendingMediaUploadsRef.current = pendingMediaUploads;
    }, [pendingMediaUploads]);

    useEffect(() => {
        return () => {
            pendingMediaUploadsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        };
    }, []);

    if (!canCreate) return null;

    const openPanel = (panel: Exclude<ComposerPanel | "media" | "file", null>) => {
        setExpanded(true);
        if (panel === "media") {
            imageInputRef.current?.click();
            return;
        }
        if (panel === "file") {
            setFilePickerOpen(true);
            return;
        }
        if (panel === "task" || panel === "sprint") {
            setMentionPickerOpen(panel === "task" ? "tasks" : "sprints");
            return;
        }
        setContextQuery("");
        setActivePanel((current) => current === panel ? null : panel as ComposerPanel);
    };

    const selectContext = (option: ProjectUpdateContextOption) => {
        setEntityRefs((current) => {
            const references = normalizeProjectUpdateReferences([
                ...(current.references ?? []),
                { kind: option.kind, id: option.id },
            ]);
            const next: ProjectUpdateEntityRefs = { ...current, references };
            assignLegacyContextRef(next, option.kind, option.id);
            return next;
        });
        setSelectedContextCache((current) => ({ ...current, [referenceKey(option)]: option }));
        setActivePanel(null);
    };

    const removeContext = (option: ProjectUpdateContextOption) => {
        setEntityRefs((current) => {
            const references = normalizeProjectUpdateReferences(current.references)
                .filter((reference) => !(reference.kind === option.kind && reference.id === option.id));
            const next: ProjectUpdateEntityRefs = { ...current, references };
            if (current[refKeyForContextKind(option.kind)] === option.id) {
                const replacement = references.find((reference) => reference.kind === option.kind);
                assignLegacyContextRef(next, option.kind, replacement?.id ?? null);
            }
            return next;
        });
        setSelectedContextCache((current) => {
            const next = { ...current };
            delete next[referenceKey(option)];
            return next;
        });
    };

    const removeMedia = (index: number) => {
        setMedia((current) => current.filter((_, itemIndex) => itemIndex !== index));
    };

    const addMediaFromPanel = (type: ProjectUpdateMediaItem["type"]) => {
        const url = mediaUrl.trim();
        if (!url) return;
        if (!isSafeProjectUpdateUrl(url)) {
            toast.error("Use a valid http or https link.");
            return;
        }
        if (media.length >= PROJECT_UPDATE_MAX_MEDIA_ITEMS) {
            toast.error(`You can attach up to ${PROJECT_UPDATE_MAX_MEDIA_ITEMS} items.`);
            return;
        }
        setMedia((current) => [...current, { type, url, label: mediaLabel.trim() || null }]);
        setMediaUrl("");
        setMediaLabel("");
        setActivePanel(null);
    };

    const updatePendingUpload = (id: string, patch: Partial<PendingMediaUpload>) => {
        setPendingMediaUploads((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    };

    const clearPendingUpload = (id: string) => {
        setPendingMediaUploads((current) => {
            const target = current.find((item) => item.id === id);
            if (target) URL.revokeObjectURL(target.previewUrl);
            return current.filter((item) => item.id !== id);
        });
    };

    const uploadImageFile = async (file: File) => {
        if (!PROJECT_UPDATE_ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
            toast.error("Use JPG, PNG, WebP, or GIF images.");
            return;
        }
        if (file.size > PROJECT_UPDATE_MEDIA_MAX_BYTES) {
            toast.error(`Update images must be ${formatFileSize(PROJECT_UPDATE_MEDIA_MAX_BYTES)} or smaller.`);
            return;
        }
        if (media.length + pendingMediaUploads.length >= PROJECT_UPDATE_MAX_MEDIA_ITEMS) {
            toast.error(`You can attach up to ${PROJECT_UPDATE_MAX_MEDIA_ITEMS} items.`);
            return;
        }
        setExpanded(true);
        const id = newUploadId();
        const previewUrl = URL.createObjectURL(file);
        const altText = defaultAltText(file);
        const dimensions = await readImageDimensions(file);
        setPendingMediaUploads((current) => [
            ...current,
            {
                id,
                fileName: file.name,
                previewUrl,
                altText,
                mimeType: file.type,
                size: file.size,
                width: dimensions?.width ?? null,
                height: dimensions?.height ?? null,
                phase: "preparing",
                progress: 15,
                error: null,
            },
        ]);
        try {
            const prepared = await createProjectUpdateMediaUploadUrlAction(projectId, {
                mimeType: file.type,
                sizeBytes: file.size,
                altText,
            });
            if (!prepared.success) throw new Error(prepared.error);
            updatePendingUpload(id, { phase: "uploading", progress: 58 });
            await uploadToSupabaseSignedUrl({
                bucket: prepared.bucket,
                storagePath: prepared.storagePath,
                uploadToken: prepared.uploadToken,
                contentType: prepared.contentType,
            }, file);
            updatePendingUpload(id, { phase: "finalizing", progress: 88 });
            const finalized = await finalizeProjectUpdateMediaUploadAction(projectId, {
                uploadIntentId: prepared.uploadIntentId,
                altText,
                label: file.name,
                width: dimensions?.width ?? null,
                height: dimensions?.height ?? null,
            });
            if (!finalized.success) throw new Error(finalized.error);
            setMedia((current) => [...current, finalized.media]);
            clearPendingUpload(id);
        } catch (error) {
            updatePendingUpload(id, {
                phase: "preparing",
                progress: 0,
                error: error instanceof Error ? error.message : "Failed to upload image.",
            });
        }
    };

    const handleImageFiles = (files: FileList | File[] | null | undefined) => {
        const selectedFiles = Array.from(files ?? []);
        if (selectedFiles.length === 0) return;
        const remainingSlots = PROJECT_UPDATE_MAX_MEDIA_ITEMS - media.length - pendingMediaUploads.length;
        if (remainingSlots <= 0) {
            toast.error(`You can attach up to ${PROJECT_UPDATE_MAX_MEDIA_ITEMS} items.`);
            return;
        }
        selectedFiles.slice(0, remainingSlots).forEach((file) => {
            void uploadImageFile(file);
        });
        if (selectedFiles.length > remainingSlots) {
            toast.error(`Only ${remainingSlots} more ${remainingSlots === 1 ? "image" : "images"} can be attached.`);
        }
    };

    const resetAfterPost = () => {
        setContent("");
        setEntityRefs(EMPTY_REFS);
        setSelectedContextCache({});
        setMedia([]);
        pendingMediaUploads.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        setPendingMediaUploads([]);
        setExpanded(false);
        setActivePanel(null);
        setMediaUrl("");
        setMediaLabel("");
        if (typeof window !== "undefined") window.localStorage.removeItem(draftStorageKey);
        if (!canManage) setVisibility("public");
        lastSavedDraftRef.current = JSON.stringify({ content: "", visibility: "public", updateType: null, entityRefs: {}, media: [] });
    };

    const toolbarButtonClass = "rounded-full p-2 text-blue-500 transition hover:bg-blue-50 aria-pressed:bg-blue-50 aria-pressed:text-blue-700 dark:hover:bg-blue-950/30 dark:aria-pressed:bg-blue-950/40 dark:aria-pressed:text-blue-200";
    const bottomPanel = expanded && activePanel ? (
        <div className={cn(
            "mt-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950",
        )}>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {activePanel === "link"
                            ? "Attach link"
                            : `${activePanel} context`}
                    </p>
                    <p className="text-xs text-zinc-500">
                        {activePanel === "link"
                            ? "Add one supporting reference to this update."
                            : "Connect this post to active project work."}
                    </p>
                </div>
                <button type="button" onClick={() => setActivePanel(null)} className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-100" aria-label="Close composer panel">
                    <X className="h-4 w-4" />
                </button>
            </div>

            {activeContextKind ? (
                <>
                    <input
                        value={contextQuery}
                        onChange={(event) => setContextQuery(event.target.value)}
                        placeholder={`Find ${activeContextKind}`}
                        className="h-10 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 text-sm outline-none transition focus:border-blue-300 focus:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-blue-800 dark:focus:bg-zinc-950"
                    />
                    <div className="mt-3 grid gap-2">
                        {contextOptionsQuery.isLoading ? (
                            <div className="h-12 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
                        ) : activeContextOptions.length === 0 ? (
                            <p className="rounded-xl bg-zinc-50 px-3 py-3 text-sm text-zinc-500 dark:bg-zinc-900/60">No matching project context.</p>
                        ) : activeContextOptions.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                onClick={() => selectContext(option)}
                                className={cn(
                                    "min-w-0 rounded-xl border px-3 py-2 text-left transition",
                                    entityRefs[refKeyForContextKind(option.kind)] === option.id
                                        ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200"
                                        : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700",
                                )}
                            >
                                <span className="block truncate text-sm font-semibold">{option.label}</span>
                                {option.description ? <span className="block truncate text-xs text-zinc-500">{option.description}</span> : null}
                            </button>
                        ))}
                    </div>
                </>
            ) : (
                <div className="grid gap-2">
                    <input
                        value={mediaUrl}
                        onChange={(event) => setMediaUrl(event.target.value)}
                        placeholder="Link URL"
                        className="h-10 rounded-full border border-zinc-200 bg-zinc-50 px-4 text-sm outline-none transition focus:border-blue-300 focus:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-blue-800 dark:focus:bg-zinc-950"
                    />
                    <input
                        value={mediaLabel}
                        onChange={(event) => setMediaLabel(event.target.value.slice(0, 80))}
                        placeholder="Optional label"
                        className="h-10 rounded-full border border-zinc-200 bg-zinc-50 px-4 text-sm outline-none transition focus:border-blue-300 focus:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:focus:border-blue-800 dark:focus:bg-zinc-950"
                    />
                    <Button
                        type="button"
                        size="sm"
                        className="justify-self-end rounded-full"
                        disabled={!mediaUrl.trim()}
                        onClick={() => addMediaFromPanel("link")}
                    >
                        Attach
                    </Button>
                </div>
            )}
        </div>
    ) : null;

    const hiddenImageInput = (
        <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            multiple
            onChange={(event) => {
                handleImageFiles(event.target.files);
                event.currentTarget.value = "";
            }}
        />
    );

    const composerBody = (
        <div className="flex gap-3 relative">
            <UserAvatar
                identity={{ fullName: currentUserName ?? "You", avatarUrl: currentUserAvatarUrl ?? null }}
                size={44}
                className="mt-1"
            />
            <div className="min-w-0 flex-1">
                <div className="absolute right-0 top-0">
                    <button
                        type="button"
                        onClick={() => setExpanded(!expanded)}
                        className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 transition"
                        aria-label={expanded ? "Collapse composer" : "Expand composer"}
                    >
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                </div>
                {!expanded ? (
                    <button
                        type="button"
                        onClick={() => setExpanded(true)}
                        className="block min-h-11 w-[calc(100%-32px)] rounded-lg px-0 text-left transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:hover:bg-zinc-900/40"
                        aria-expanded={expanded}
                    >
                        <span className={cn(
                            "block truncate text-base",
                            draftPreview ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-400",
                        )}>
                            {draftPreview || `Share a project update for ${projectName}...`}
                        </span>
                        {draftPreview ? (
                            <span className="mt-1 block text-xs font-medium text-blue-500">Draft saved</span>
                        ) : null}
                    </button>
                ) : (
                    <>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setVisibility((current) => current === "public" ? "members" : "public")}
                                className="inline-flex items-center gap-1 rounded-full border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-600 transition hover:bg-blue-50 dark:border-blue-900/60 dark:text-blue-300 dark:hover:bg-blue-950/30"
                            >
                                {visibility === "public" ? <Globe2 className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                                {visibility === "public" ? "Public followers" : "Project members"}
                            </button>
                        </div>
                        <ProjectUpdateRichTextEditor
                            content={content}
                            placeholder={`Share a project update for ${projectName}...`}
                            onChange={setContent}
                            onCommand={openPanel}
                            onMention={() => setMentionPickerOpen("all")}
                            editorRef={editorRef}
                        />
                    </>
                )}

                {expanded && (selectedReferences.length > 0 || media.length > 0 || pendingMediaUploads.length > 0) ? (
                    <div className="mt-3 space-y-2">
                        {selectedReferences.length > 0 ? (
                            <div className="space-y-2">
                                {selectedReferences.map((option) => (
                                    <div
                                        key={referenceKey(option)}
                                        className="flex min-w-0 items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                                    >
                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300">
                                            {option.kind === "task" ? <FileText className="h-4 w-4" /> : option.kind === "sprint" ? <Timer className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{option.label}</span>
                                            {option.description ? <span className="block truncate text-xs text-zinc-500">{option.description}</span> : null}
                                        </span>
                                        <button type="button" className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-100" onClick={() => removeContext(option)} aria-label={`Remove ${option.kind} context`}>
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                        {pendingMediaUploads.map((item) => (
                            <div key={item.id} className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                                <div className="relative aspect-video bg-zinc-100 dark:bg-zinc-900">
                                    <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                                    <button type="button" onClick={() => clearPendingUpload(item.id)} className="absolute right-2 top-2 rounded-full bg-zinc-950/70 p-1 text-white hover:bg-zinc-900" aria-label="Remove image">
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                                <div className="flex items-center justify-between gap-3 px-3 py-2">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{item.fileName}</p>
                                        <p className="text-xs text-zinc-500">
                                            {item.error || `${item.phase} · ${formatFileSize(item.size)}${item.width && item.height ? ` · ${item.width}×${item.height}` : ""}`}
                                        </p>
                                    </div>
                                    {item.error ? (
                                        <span className="text-xs font-semibold text-red-500">Failed</span>
                                    ) : (
                                        <span className="text-xs font-semibold text-blue-500">{item.progress}%</span>
                                    )}
                                </div>
                            </div>
                        ))}
                        {media.map((item, index) => item.type === "image" && item.url ? (
                            <div key={`${item.url}-${index}`} className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                                <div className="relative aspect-video bg-zinc-100 dark:bg-zinc-900">
                                    <img src={item.url} alt={item.altText || item.label || "Project update image"} className="h-full w-full object-cover" loading="lazy" />
                                    <button type="button" className="absolute right-2 top-2 rounded-full bg-zinc-950/70 p-1 text-white hover:bg-zinc-900" onClick={() => removeMedia(index)} aria-label="Remove image">
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                                {item.label || item.size ? (
                                    <div className="px-3 py-2 text-xs text-zinc-500">
                                        <span className="line-clamp-1">{[item.label, formatFileSize(item.size)].filter(Boolean).join(" · ")}</span>
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <div key={`${item.url}-${index}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                                    <Link2 className="h-4 w-4" />
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-700 dark:text-zinc-300">{item.label || item.url || "Linked item"}</span>
                                <button type="button" className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-100" onClick={() => removeMedia(index)} aria-label="Remove media">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                ) : null}

                {expanded ? (
                    <>
                        {bottomPanel}
                        <div className="mt-3 flex items-center justify-between gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                            <div className="flex flex-wrap items-center gap-1">
                                <button type="button" className={toolbarButtonClass} onClick={() => openPanel("task")} title="Task context" aria-label="Task context" aria-pressed={activePanel === "task"}>
                                    <FileText className="h-4 w-4" />
                                </button>
                                <button type="button" className={toolbarButtonClass} onClick={() => openPanel("sprint")} title="Sprint context" aria-label="Sprint context" aria-pressed={activePanel === "sprint"}>
                                    <Timer className="h-4 w-4" />
                                </button>
                                <button type="button" className={toolbarButtonClass} onClick={() => openPanel("file")} title="File context" aria-label="File context" aria-pressed={activePanel === "file"}>
                                    <Paperclip className="h-4 w-4" />
                                </button>
                                <span className="mx-1 h-5 w-px bg-blue-100 dark:bg-blue-900/60" aria-hidden="true" />
                                <button type="button" className={toolbarButtonClass} onClick={() => openPanel("media")} title="Add image" aria-label="Add image" aria-pressed={false}>
                                    <ImagePlus className="h-4 w-4" />
                                </button>
                                <button type="button" className={toolbarButtonClass} onClick={() => openPanel("link")} title="Add link" aria-label="Add link" aria-pressed={activePanel === "link"}>
                                    <Link2 className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className={cn("text-xs font-medium", remaining < 0 ? "text-red-500" : "text-zinc-400")}>{remaining}</span>
                                <Button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => {
                                        onPost({
                                            content,
                                            updateType: null,
                                            visibility: canManage ? visibility : "public",
                                            entityRefs: {
                                                ...entityRefs,
                                                references: normalizeProjectUpdateReferences(entityRefs.references),
                                            },
                                            media,
                                        });
                                        resetAfterPost();
                                    }}
                                    className="rounded-full"
                                >
                                    {isPosting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    Post
                                </Button>
                            </div>
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );

    return (
        <div
            ref={containerRef}
            className={cn(
                "relative border-b border-zinc-200 px-1 py-4 transition-all duration-200 ease-out dark:border-zinc-800",
                expanded ? "pb-5" : "pb-4",
            )}
        >
            {composerBody}
            {hiddenImageInput}


            {mentionPickerOpen && portalTarget ? createPortal(
                <div data-composer-portal="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" onClick={(e) => {
                    if (e.target === e.currentTarget) setMentionPickerOpen(null);
                }}>
                    <div className="w-full max-w-2xl overflow-hidden rounded-2xl shadow-2xl bg-white dark:bg-zinc-950 p-6">
                        <ProjectReadmeReferencePicker
                            projectId={projectId}
                            initialKind={mentionPickerOpen === "all" ? undefined : mentionPickerOpen}
                            onInsert={(text) => {
                                editorRef.current?.insertTextAtCursor(text + " ");
                                setMentionPickerOpen(null);
                            }}
                            onClose={() => setMentionPickerOpen(null)}
                        />
                    </div>
                </div>,
                portalTarget
            ) : null}
            <MultiAttachmentPicker
                projectId={projectId}
                projectName={projectName}
                isOpen={filePickerOpen}
                onClose={() => setFilePickerOpen(false)}
                initialAttachments={[]}
                onConfirm={(nodes) => {
                    const markdown = nodes.map(node => {
                        return buildInlineReadmeReference({
                            id: node.id,
                            kind: "files",
                            title: node.name,
                        });
                    }).join(" ");
                    if (markdown) {
                        editorRef.current?.insertTextAtCursor(markdown + " ");
                    }
                }}
            />
        </div>
    );
}
