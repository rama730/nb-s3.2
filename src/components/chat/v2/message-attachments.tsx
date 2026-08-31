'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
    File,
    Image as ImageIcon,
    Video,
} from 'lucide-react';
import {
    fitMediaWithinBounds,
    MESSAGE_MEDIA_INLINE_BOUNDS,
    normalizeMediaDimensions,
    type MediaDimensions,
} from '@/lib/messages/media-metadata';
import { cn } from '@/lib/utils';
import { MediaViewerModal } from '@/components/ui/media-viewer';

export interface ChatAttachmentV2 {
    id: string;
    type: 'image' | 'video' | 'file';
    url: string;
    filename: string;
    sizeBytes: number | null;
    mimeType: string | null;
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
    localUrl?: string;
}

export function MessageAttachmentsV2({
    attachments,
    onContentLoad,
}: {
    attachments: ChatAttachmentV2[];
    onContentLoad?: () => void;
    isOwn?: boolean;
    hasReactions?: boolean;
}) {
    const normalizedAttachments = useMemo(() => {
        return attachments.map(att => {
            if (att.type === 'file') {
                const ext = att.filename.split('.').pop()?.toLowerCase();
                const isVideoExt = ext === 'mp4' || ext === 'webm' || ext === 'ogg' || ext === 'mov';
                const isImageExt = ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'gif' || ext === 'webp';
                if (att.mimeType?.startsWith('video/') || isVideoExt) {
                    return { ...att, type: 'video' as const };
                }
                if (att.mimeType?.startsWith('image/') || isImageExt) {
                    return { ...att, type: 'image' as const };
                }
            }
            return att;
        });
    }, [attachments]);

    const [activeAttachmentId, setActiveAttachmentId] = useState<string | null>(null);
    const [originRect, setOriginRect] = useState<DOMRect | null>(null);
    const [videoTime, setVideoTime] = useState<number>(0);
    const [returnedVideoState, setReturnedVideoState] = useState<{ id: string; time: number } | null>(null);
    const mediaAttachments = useMemo(
        () => normalizedAttachments.filter((attachment) => attachment.type === 'image' || attachment.type === 'video'),
        [normalizedAttachments],
    );
    const fileAttachments = useMemo(
        () => normalizedAttachments.filter((attachment) => attachment.type === 'file'),
        [normalizedAttachments],
    );
    const viewableAttachments = useMemo(
        () => normalizedAttachments.filter((attachment) => (
            attachment.type === 'image'
            || attachment.type === 'video'
            || attachment.filename.toLowerCase().endsWith('.pdf')
        )),
        [normalizedAttachments],
    );
    const viewerAttachments = useMemo(
        () => viewableAttachments.map((attachment) => ({
            ...attachment,
            localUrl: attachment.localUrl || undefined,
            thumbnailUrl: attachment.thumbnailUrl || undefined,
        })),
        [viewableAttachments],
    );

    if (attachments.length === 0) return null;

    return (
        <>
            <div className="w-fit min-w-0 max-w-full space-y-2">
                {mediaAttachments.length > 0 ? (
                    <MediaAttachmentListV2
                        attachments={mediaAttachments}
                        onOpenMedia={(id, rect, time) => {
                            setActiveAttachmentId(id);
                            setOriginRect(rect);
                            if (time !== undefined) setVideoTime(time);
                            setReturnedVideoState(null); // Clear previous return state when opening
                        }}
                        onContentLoad={onContentLoad}
                        returnedVideoState={returnedVideoState}
                    />
                ) : null}

                {fileAttachments.length > 0 ? (
                    <div className="w-[380px] min-w-0 max-w-full space-y-1 overflow-hidden">
                        {fileAttachments.map((attachment) => (
                            <FileAttachmentCardV2
                                key={attachment.id}
                                attachment={attachment}
                                onPreview={attachment.filename.toLowerCase().endsWith('.pdf')
                                    ? () => {
                                        setActiveAttachmentId(attachment.id);
                                        setOriginRect(null);
                                    }
                                    : undefined}
                            />
                        ))}
                    </div>
                ) : null}
            </div>

            {activeAttachmentId ? (
                <MediaViewerModal
                    attachments={viewerAttachments}
                    initialAttachmentId={activeAttachmentId}
                    originRect={originRect}
                    initialVideoTime={videoTime}
                    onClose={(returnedState) => {
                        setActiveAttachmentId(null);
                        setOriginRect(null);
                        setVideoTime(0);
                        if (returnedState) {
                            setReturnedVideoState(returnedState);
                        }
                    }}
                />
            ) : null}
        </>
    );
}

function MediaAttachmentListV2({
    attachments,
    onOpenMedia,
    onContentLoad,
    returnedVideoState,
}: {
    attachments: ChatAttachmentV2[];
    onOpenMedia: (id: string, rect: DOMRect, time?: number) => void;
    onContentLoad?: () => void;
    returnedVideoState?: { id: string; time: number } | null;
}) {
    return (
        <div
            className="msg-bento-grid gap-1.5"
            data-count={Math.min(attachments.length, 4)}
        >
            {attachments.map((attachment) => (
                <MediaAttachmentTileV2
                    key={attachment.id}
                    attachment={attachment}
                    onClick={(rect, time) => onOpenMedia(attachment.id, rect, time)}
                    onContentLoad={onContentLoad}
                    returnedVideoState={returnedVideoState}
                />
            ))}
        </div>
    );
}

function MediaAttachmentTileV2({
    attachment,
    onClick,
    onContentLoad,
    returnedVideoState,
}: {
    attachment: ChatAttachmentV2;
    onClick: (rect: DOMRect, time?: number) => void;
    onContentLoad?: () => void;
    returnedVideoState?: { id: string; time: number } | null;
}) {
    const initialDimensions = useMemo(
        () => normalizeMediaDimensions(attachment.width, attachment.height),
        [attachment.height, attachment.width],
    );
    const [dimensions, setDimensions] = useState<MediaDimensions | null>(initialDimensions);
    const [loaded, setLoaded] = useState(false);
    const [hasError, setHasError] = useState(false);
    const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

    const previewUrl = attachment.type === 'image'
        ? attachment.localUrl || attachment.thumbnailUrl || attachment.url
        : attachment.thumbnailUrl;
    const displayUrl = fallbackUrl || previewUrl;

    // Reset loaded/error states only if the underlying preview URL changes (e.g. optimistic -> remote)
    useEffect(() => {
        setLoaded(false);
        setHasError(false);
        setFallbackUrl(null);
    }, [previewUrl]);

    const fittedSize = dimensions
        ? fitMediaWithinBounds(dimensions, MESSAGE_MEDIA_INLINE_BOUNDS)
        : null;
    const frameStyle: CSSProperties = fittedSize
        ? {
            width: `${fittedSize.width}px`,
            aspectRatio: `${dimensions!.width} / ${dimensions!.height}`,
        }
        : {
            width: `${MESSAGE_MEDIA_INLINE_BOUNDS.maxWidth}px`,
            aspectRatio: '1 / 1',
        };

    const recordDimensions = useCallback((width: number, height: number) => {
        const nextDimensions = normalizeMediaDimensions(width, height);
        if (nextDimensions) setDimensions(nextDimensions);
    }, []);

    return (
        <div
            className={cn(
                'msg-media-frame relative max-w-full overflow-hidden rounded-2xl bg-zinc-100',
                'dark:bg-zinc-800',
            )}
            style={frameStyle}
            data-media-orientation={getMediaOrientation(dimensions)}
        >
            {!hasError ? (
                <button
                    type="button"
                    onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const time = returnedVideoState?.id === attachment.id
                            ? returnedVideoState.time
                            : 0;
                        onClick(rect, time);
                    }}
                    aria-label={attachment.filename
                        ? `Open media viewer for ${attachment.filename}`
                        : 'Open media viewer'}
                    className="absolute inset-0 z-10 rounded-[inherit] border-0 focus:outline-none focus-visible:bg-black/5 dark:focus-visible:bg-white/5"
                />
            ) : null}

            {attachment.type === 'image' ? (
                <div
                    className={cn(
                        'pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-200 transition-opacity duration-200 dark:bg-zinc-800',
                        loaded ? 'opacity-0' : 'animate-pulse opacity-100',
                    )}
                >
                    <ImageIcon className="h-8 w-8 text-zinc-400/50 dark:text-zinc-500/50" />
                </div>
            ) : null}

            {attachment.type === 'video' ? (
                displayUrl ? (
                    // Historical video tiles deliberately render only the stored thumbnail.
                    // The selected viewer owns the first video-body request and playback.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={displayUrl}
                        alt={attachment.filename || ''}
                        onLoad={() => {
                            setLoaded(true);
                            onContentLoad?.();
                        }}
                        onError={() => {
                            setHasError(true);
                            setLoaded(true);
                        }}
                        className="absolute inset-0 block h-full w-full rounded-[inherit] object-cover"
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-zinc-200 dark:bg-zinc-800">
                        <Video className="h-8 w-8 text-zinc-400/70 dark:text-zinc-500/70" aria-hidden="true" />
                    </div>
                )
            ) : (
                // Native img is intentional: local object URLs and remote
                // attachment fallbacks are not compatible with image loaders.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={displayUrl || undefined}
                    alt={attachment.filename || ''}
                    onLoad={(event) => {
                        const target = event.currentTarget as HTMLImageElement;
                        recordDimensions(target.naturalWidth, target.naturalHeight);
                        setLoaded(true);
                        onContentLoad?.();
                    }}
                    onError={() => {
                        if (!fallbackUrl && displayUrl !== attachment.url) {
                            setFallbackUrl(attachment.url);
                        } else {
                            setHasError(true);
                            setLoaded(true);
                        }
                    }}
                    className={cn(
                        'absolute inset-0 h-full w-full block rounded-[inherit] object-cover transition-opacity duration-200',
                        loaded && !hasError ? 'opacity-100' : 'opacity-0',
                    )}
                />
            )}

            {hasError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400">
                    <File className="h-6 w-6 mb-1 text-zinc-400" />
                    <p className="text-[11px] font-semibold">Media unavailable</p>
                    <p className="mt-0.5 max-w-full truncate px-2 text-[10px]">{attachment.filename}</p>
                </div>
            ) : null}

        </div>
    );
}

function FileAttachmentCardV2({
    attachment,
    onPreview,
}: {
    attachment: ChatAttachmentV2;
    onPreview?: () => void;
}) {
    const content = (
        <>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 dark:bg-primary/15">
                <File className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
                <p className="truncate break-all text-sm font-medium text-zinc-900 dark:text-white">
                    {attachment.filename}
                </p>
                {attachment.sizeBytes ? (
                    <p className="text-xs text-zinc-500">{formatFileSize(attachment.sizeBytes)}</p>
                ) : null}
            </div>
        </>
    );

    if (onPreview) {
        return (
            <button
                type="button"
                onClick={onPreview}
                className="flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-lg bg-zinc-100 p-3 text-left transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
            >
                {content}
            </button>
        );
    }

    return (
        <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            download={attachment.filename}
            className="flex w-full min-w-0 max-w-full items-center gap-3 overflow-hidden rounded-lg bg-zinc-100 p-3 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
        >
            {content}
        </a>
    );
}

export function PdfViewerV2({ attachment }: { attachment: { localUrl?: string; url: string; filename: string } }) {
    const [sourceUrl, setSourceUrl] = useState(attachment.localUrl || attachment.url);
    const [error, setError] = useState(false);

    useEffect(() => {
        setSourceUrl(attachment.localUrl || attachment.url);
        setError(false);
    }, [attachment.localUrl, attachment.url]);

    if (error) {
        return (
            <div className="flex h-full flex-col items-center justify-center p-4 text-center text-zinc-900">
                <File className="mb-2 h-12 w-12 text-zinc-400" />
                <p className="mb-4 text-sm font-medium text-zinc-600">Security restrictions prevent inline viewing.</p>
                <a
                    href={attachment.url || attachment.localUrl || '#'}
                    download={attachment.filename}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                >
                    Download PDF
                </a>
            </div>
        );
    }

    return (
        <iframe
            src={sourceUrl}
            className="block h-full w-full border-0 bg-white"
            title={attachment.filename}
            onError={() => {
                if (sourceUrl === attachment.localUrl && attachment.url) {
                    setSourceUrl(attachment.url);
                    return;
                }
                setError(true);
            }}
        />
    );
}
function getMediaOrientation(dimensions: MediaDimensions | null) {
    if (!dimensions || dimensions.width === dimensions.height) return 'square';
    return dimensions.width > dimensions.height ? 'landscape' : 'portrait';
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
