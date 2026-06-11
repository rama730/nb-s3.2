"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import Image from "next/image";
import { Check, ImagePlus, Loader2, X } from "lucide-react";

import {
    createProjectReadmeAssetUploadUrlAction,
    finalizeProjectReadmeAssetUploadAction,
} from "@/app/actions/project";
import {
    PROJECT_README_ALLOWED_IMAGE_MIME_TYPES,
    PROJECT_README_ASSET_MAX_BYTES,
} from "@/lib/projects/readme";
import {
    buildProjectReadmeImageMarkdown,
    type ProjectReadmeImageIntent,
} from "@/lib/projects/readme-media";
import { uploadToSupabaseSignedUrl } from "@/lib/upload/supabase-signed-upload-client";
import { cn } from "@/lib/utils";

type UploadPhase = "idle" | "preparing" | "uploading" | "finalizing" | "inserted";
type ImageDimensions = { width: number; height: number };

function defaultAltText(file: File) {
    return file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
}

function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readImageDimensions(file: File): Promise<ImageDimensions | null> {
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

export function ProjectReadmeAssetUploader({
    projectId,
    projectVisibility,
    imageIntent = "screenshot",
    displayWidth = null,
    caption = "",
    onInserted,
}: {
    projectId: string;
    projectVisibility?: string | null;
    imageIntent?: ProjectReadmeImageIntent;
    displayWidth?: number | null;
    caption?: string;
    onInserted: (markdown: string) => void;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const pendingFileRef = useRef<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [imageDimensions, setImageDimensions] = useState<ImageDimensions | null>(null);
    const [altText, setAltText] = useState("");
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);
    const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
    const [uploadProgress, setUploadProgress] = useState(0);

    useEffect(() => {
        if (!pendingFile) {
            setPreviewUrl(null);
            return undefined;
        }
        const url = URL.createObjectURL(pendingFile);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [pendingFile]);

    const handleFileSelected = (file: File | null | undefined) => {
        if (!file) return;
        if (!PROJECT_README_ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
            setError("Use JPG, PNG, WebP, or GIF images for README media.");
            return;
        }
        if (file.size > PROJECT_README_ASSET_MAX_BYTES) {
            setError(`README images must be ${formatFileSize(PROJECT_README_ASSET_MAX_BYTES)} or smaller.`);
            return;
        }
        pendingFileRef.current = file;
        setPendingFile(file);
        setImageDimensions(null);
        setAltText(defaultAltText(file));
        setError(null);
        void readImageDimensions(file).then((dimensions) => {
            if (pendingFileRef.current === file) setImageDimensions(dimensions);
        });
    };

    const clearPendingFile = () => {
        pendingFileRef.current = null;
        setPendingFile(null);
        setImageDimensions(null);
        setAltText("");
        setError(null);
        setUploadPhase("idle");
        setUploadProgress(0);
        if (inputRef.current) inputRef.current.value = "";
    };

    const uploadPendingFile = async () => {
        const file = pendingFile;
        if (!file) return;
        const normalizedAltText = altText.trim();
        if (!normalizedAltText) {
            setError("Add short alt text before uploading the image.");
            return;
        }
        setUploading(true);
        setError(null);
        setUploadPhase("preparing");
        setUploadProgress(18);
        try {
            const upload = await createProjectReadmeAssetUploadUrlAction(projectId, {
                mimeType: file.type,
                sizeBytes: file.size,
                altText: normalizedAltText,
                width: imageDimensions?.width ?? null,
                height: imageDimensions?.height ?? null,
            });
            if (!upload.success) throw new Error(upload.error);
            setUploadPhase("uploading");
            setUploadProgress(55);
            await uploadToSupabaseSignedUrl({
                bucket: upload.bucket,
                storagePath: upload.storagePath,
                uploadToken: upload.uploadToken,
                contentType: upload.contentType,
            }, file);
            setUploadPhase("finalizing");
            setUploadProgress(88);
            const finalized = await finalizeProjectReadmeAssetUploadAction(projectId, {
                uploadIntentId: upload.uploadIntentId,
                altText: normalizedAltText,
                width: imageDimensions?.width ?? null,
                height: imageDimensions?.height ?? null,
            });
            if (!finalized.success) throw new Error(finalized.error);
            setUploadPhase("inserted");
            setUploadProgress(100);
            const assetSrc = finalized.asset?.id
                ? `/api/v1/projects/${projectId}/readme-assets/${finalized.asset.id}`
                : finalized.markdown.match(/\]\(([^)]+)\)/)?.[1] ?? "";
            const markdown = buildProjectReadmeImageMarkdown({
                src: assetSrc,
                alt: normalizedAltText,
                intent: imageIntent,
                width: displayWidth,
                height: null,
                caption,
            });
            onInserted(`\n${markdown || finalized.markdown}\n`);
            clearPendingFile();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to upload image.");
            setUploadPhase("idle");
            setUploadProgress(0);
        } finally {
            setUploading(false);
        }
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setDragging(false);
        if (uploading) return;
        handleFileSelected(event.dataTransfer.files?.[0]);
    };

    const privacyCopy = projectVisibility === "public"
        ? "This image will be served from the managed README media route."
        : "This image follows the project access rules after it is inserted.";

    return (
        <div className="space-y-2" data-readme-asset-uploader="true">
            <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={(event) => handleFileSelected(event.target.files?.[0])}
            />
            <div
                onDragOver={(event) => {
                    event.preventDefault();
                    if (!uploading) setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className={cn(
                    "rounded-2xl border border-dashed border-zinc-200 p-3 transition dark:border-zinc-800",
                    dragging && "border-blue-400 bg-blue-50/60 dark:border-blue-600 dark:bg-blue-950/20",
                )}
            >
                <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-blue-300 hover:text-blue-600 disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-300"
                >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                    {uploading ? "Uploading…" : "Upload or drop image"}
                </button>
                <p className="mt-2 text-xs leading-5 text-zinc-500">
                    Drag a screenshot here, then confirm alt text before inserting.
                </p>
            </div>
            {pendingFile ? (
                <div className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                            {previewUrl ? (
                                <div className="relative h-12 w-12 shrink-0">
                                    <Image src={previewUrl} alt="" className="rounded-xl border border-zinc-200 object-cover dark:border-zinc-800" fill sizes="48px" unoptimized />
                                </div>
                            ) : null}
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{pendingFile.name}</p>
                                <p className="mt-0.5 text-xs text-zinc-500">
                                    {pendingFile.type || "Image"} · {formatFileSize(pendingFile.size)}
                                    {imageDimensions ? ` · ${imageDimensions.width}×${imageDimensions.height}` : ""}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={clearPendingFile}
                            disabled={uploading}
                            className="rounded-full p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                            aria-label="Clear selected image"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                    <label className="mt-3 block space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Alt text</span>
                        <input
                            value={altText}
                            onChange={(event) => setAltText(event.target.value)}
                            className="w-full rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-800"
                            placeholder="Describe the image for readers"
                        />
                    </label>
                    {uploading ? (
                        <div className="mt-3 space-y-1">
                            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${uploadProgress}%` }} />
                            </div>
                            <p className="text-xs capitalize text-zinc-500">{uploadPhase}</p>
                        </div>
                    ) : null}
                    <div className="mt-3 flex justify-end">
                        <button
                            type="button"
                            onClick={uploadPendingFile}
                            disabled={uploading || !altText.trim()}
                            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            Insert image
                        </button>
                    </div>
                </div>
            ) : null}
            <p className="text-xs leading-5 text-zinc-500">
                {privacyCopy} Add clear alt text so the published README stays accessible.
            </p>
            {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </div>
    );
}
