"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ImageOff, LoaderCircle } from "lucide-react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog";
import type { ProjectUpdateMediaItem } from "@/lib/projects/updates";
import { cn } from "@/lib/utils";

type ProjectUpdateMediaFrameItem = Pick<
    ProjectUpdateMediaItem,
    "altText" | "height" | "label" | "mimeType" | "type" | "url" | "width"
>;

type ProjectUpdateMediaOrientation = "landscape" | "portrait";
type ProjectUpdateMediaLoadState = "loading" | "ready" | "error";

function mediaRatio(item: ProjectUpdateMediaFrameItem) {
    const width = Number(item.width ?? 0);
    const height = Number(item.height ?? 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
    }
    return width / height;
}

function mediaOrientation(item: ProjectUpdateMediaFrameItem): ProjectUpdateMediaOrientation {
    const ratio = mediaRatio(item);
    if (!ratio) return "portrait";
    if (ratio > 1.08) return "landscape";
    return "portrait";
}

function mediaAspectRatio(item: ProjectUpdateMediaFrameItem) {
    const orientation = mediaOrientation(item);
    if (orientation === "portrait") return "10 / 16";
    const ratio = mediaRatio(item);
    if (ratio) return `${item.width} / ${item.height}`;
    return "16 / 9";
}

export function isProjectUpdateVideoMedia(item: ProjectUpdateMediaFrameItem, src = item.url ?? "") {
    if (item.mimeType?.toLowerCase().startsWith("video/")) return true;
    return /\.(mp4|m4v|mov|webm|ogg)(?:[?#].*)?$/i.test(src);
}

export function ProjectUpdateMediaFrame({
    item,
    src,
    alt,
    actions,
    className,
    href,
    loading = "lazy",
    onOpen,
    openLabel,
}: {
    item: ProjectUpdateMediaFrameItem;
    src: string;
    alt?: string;
    actions?: ReactNode;
    className?: string;
    href?: string;
    loading?: "eager" | "lazy";
    onOpen?: () => void;
    openLabel?: string;
}) {
    const orientation = mediaOrientation(item);
    const isPortrait = orientation === "portrait";
    const isVideo = isProjectUpdateVideoMedia(item, src);
    const [loadState, setLoadState] = useState<ProjectUpdateMediaLoadState>("loading");

    useEffect(() => {
        setLoadState("loading");
    }, [src]);

    const style: CSSProperties = {
        aspectRatio: mediaAspectRatio(item),
    };
    const frame = (
        <div
            className={cn(
                "relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900",
                "transition hover:border-blue-200 dark:hover:border-blue-900/60",
                isPortrait
                    ? "-ml-1 mr-auto w-full max-w-[320px]"
                    : "w-full max-w-full",
                className,
            )}
            data-project-update-media-frame="true"
            data-media-orientation={orientation}
            data-media-load-state={loadState}
            aria-busy={loadState === "loading"}
            style={style}
        >
            {loadState === "loading" ? (
                <div
                    className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-100 dark:bg-zinc-900"
                    role="status"
                    aria-live="polite"
                >
                    <LoaderCircle className="h-5 w-5 animate-spin text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
                    <span className="sr-only">Loading media</span>
                </div>
            ) : null}
            {loadState === "error" ? (
                <div
                    className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-zinc-100 px-4 text-center text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
                    role="alert"
                >
                    <ImageOff className="h-5 w-5" aria-hidden="true" />
                    <span className="text-xs font-medium">Media unavailable</span>
                </div>
            ) : null}
            {isVideo ? (
                <video
                    className={cn(
                        "absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-200",
                        loadState === "ready" ? "opacity-100" : "pointer-events-none opacity-0",
                    )}
                    controls
                    playsInline
                    preload="metadata"
                    src={src}
                    onLoadedData={() => setLoadState("ready")}
                    onError={() => setLoadState("error")}
                />
            ) : (
                <img
                    src={src}
                    alt={alt ?? item.altText ?? item.label ?? "Project update media"}
                    className={cn(
                        "absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-200",
                        loadState === "ready" ? "opacity-100" : "opacity-0",
                    )}
                    loading={loading}
                    decoding="async"
                    onLoad={() => setLoadState("ready")}
                    onError={() => setLoadState("error")}
                />
            )}
            {actions ? (
                <div className="pointer-events-none absolute inset-0 z-20 [&>*]:pointer-events-auto">
                    {actions}
                </div>
            ) : null}
        </div>
    );

    if (!href || isVideo) {
        if (onOpen && !isVideo) {
            return (
                <button
                    type="button"
                    onClick={onOpen}
                    className={cn(
                        "block text-left focus:outline-none    ",
                        isPortrait ? "-ml-1 mr-auto w-full max-w-[320px]" : "w-full max-w-full",
                    )}
                    aria-label={openLabel ?? "Open project update media"}
                >
                    {frame}
                </button>
            );
        }
        return frame;
    }

    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className={cn(
                "block",
                isPortrait ? "-ml-1 mr-auto w-full max-w-[320px]" : "w-full max-w-full",
            )}
        >
            {frame}
        </a>
    );
}

export function ProjectUpdateMediaViewer({
    item,
    onOpenChange,
}: {
    item: ProjectUpdateMediaItem | null;
    onOpenChange: (open: boolean) => void;
}) {
    const src = item?.url ?? "";
    const isVideo = item ? isProjectUpdateVideoMedia(item, src) : false;
    const title = item?.label || item?.altText || "Project update media";

    return (
        <Dialog open={Boolean(item && src)} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-h-[92vh] w-[min(94vw,1040px)] overflow-hidden border-zinc-800 bg-zinc-950 p-0 text-zinc-50 shadow-2xl sm:max-w-[min(94vw,1040px)]"
                overlayClassName="bg-black/80"
            >
                <DialogTitle className="sr-only">{title}</DialogTitle>
                <DialogDescription className="sr-only">
                    Project update media preview.
                </DialogDescription>
                <div className="flex max-h-[92vh] min-h-0 flex-col">
                    <div className="border-b border-white/10 px-4 py-3 pr-12">
                        <p className="truncate text-sm font-semibold text-white">{title}</p>
                        {item?.mimeType ? (
                            <p className="mt-0.5 text-xs text-zinc-400">{item.mimeType}</p>
                        ) : null}
                    </div>
                    <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-3">
                        {isVideo ? (
                            <video
                                className="max-h-[78vh] max-w-full rounded-lg object-contain"
                                controls
                                playsInline
                                src={src}
                            />
                        ) : (
                            <img
                                src={src}
                                alt={item?.altText || item?.label || "Project update media"}
                                className="max-h-[78vh] max-w-full rounded-lg object-contain"
                                decoding="async"
                            />
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
