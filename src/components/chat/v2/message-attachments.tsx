'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
    ChevronLeft,
    ChevronRight,
    Download,
    File,
    Image as ImageIcon,
    Volume2,
    VolumeX,
    Video,
    X,
} from 'lucide-react';
import {
    fitMediaWithinBounds,
    MESSAGE_MEDIA_INLINE_BOUNDS,
    normalizeMediaDimensions,
    type MediaDimensions,
} from '@/lib/messages/media-metadata';
import { cn } from '@/lib/utils';

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
}

export function MessageAttachmentsV2({
    attachments,
    onContentLoad,
}: {
    attachments: ChatAttachmentV2[];
    onContentLoad?: () => void;
}) {
    const [activeAttachmentId, setActiveAttachmentId] = useState<string | null>(null);
    const mediaAttachments = useMemo(
        () => attachments.filter((attachment) => attachment.type === 'image' || attachment.type === 'video'),
        [attachments],
    );
    const fileAttachments = useMemo(
        () => attachments.filter((attachment) => attachment.type === 'file'),
        [attachments],
    );
    const viewableAttachments = useMemo(
        () => attachments.filter((attachment) => (
            attachment.type === 'image'
            || attachment.type === 'video'
            || attachment.filename.toLowerCase().endsWith('.pdf')
        )),
        [attachments],
    );

    if (attachments.length === 0) return null;

    return (
        <>
            <div className="w-fit min-w-0 max-w-full space-y-2">
                {mediaAttachments.length > 0 ? (
                    <MediaAttachmentListV2
                        attachments={mediaAttachments}
                        onOpenMedia={setActiveAttachmentId}
                        onContentLoad={onContentLoad}
                    />
                ) : null}

                {fileAttachments.length > 0 ? (
                    <div className="w-[380px] min-w-0 max-w-full space-y-1 overflow-hidden">
                        {fileAttachments.map((attachment) => (
                            <FileAttachmentCardV2
                                key={attachment.id}
                                attachment={attachment}
                                onPreview={attachment.filename.toLowerCase().endsWith('.pdf')
                                    ? () => setActiveAttachmentId(attachment.id)
                                    : undefined}
                            />
                        ))}
                    </div>
                ) : null}
            </div>

            {activeAttachmentId ? (
                <MediaViewerModalV2
                    attachments={viewableAttachments}
                    initialAttachmentId={activeAttachmentId}
                    onClose={() => setActiveAttachmentId(null)}
                />
            ) : null}
        </>
    );
}

function MediaAttachmentListV2({
    attachments,
    onOpenMedia,
    onContentLoad,
}: {
    attachments: ChatAttachmentV2[];
    onOpenMedia: (id: string) => void;
    onContentLoad?: () => void;
}) {
    return (
        <div className="flex w-fit min-w-0 max-w-full flex-col items-start gap-2">
            {attachments.map((attachment) => (
                <MediaAttachmentTileV2
                    key={attachment.id}
                    attachment={attachment}
                    onClick={() => onOpenMedia(attachment.id)}
                    onContentLoad={onContentLoad}
                />
            ))}
        </div>
    );
}

function MediaAttachmentTileV2({
    attachment,
    onClick,
    onContentLoad,
}: {
    attachment: ChatAttachmentV2;
    onClick: () => void;
    onContentLoad?: () => void;
}) {
    const initialDimensions = useMemo(
        () => normalizeMediaDimensions(attachment.width, attachment.height),
        [attachment.height, attachment.width],
    );
    const [dimensions, setDimensions] = useState<MediaDimensions | null>(initialDimensions);
    const [loaded, setLoaded] = useState(false);
    const [muted, setMuted] = useState(true);
    const [hasAudioTrack, setHasAudioTrack] = useState<boolean | null>(null);
    const [retriedOriginal, setRetriedOriginal] = useState(false);
    const previewUrl = attachment.type === 'image'
        ? attachment.thumbnailUrl || attachment.url
        : attachment.url;
    const [currentUrl, setCurrentUrl] = useState(previewUrl);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        setCurrentUrl(previewUrl);
        setDimensions(initialDimensions);
        setLoaded(false);
        setMuted(true);
        setHasAudioTrack(null);
        setRetriedOriginal(false);
    }, [attachment.id, initialDimensions, previewUrl]);

    useEffect(() => {
        if (!videoRef.current) return;
        videoRef.current.muted = muted;
        if (!muted) {
            void videoRef.current.play().catch(() => setMuted(true));
        }
    }, [muted]);

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

    const updateAudioTrackState = useCallback(() => {
        if (!videoRef.current) return;
        const detected = detectVideoAudioTrack(videoRef.current);
        if (detected !== null) setHasAudioTrack(detected);
    }, []);

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
            <button
                type="button"
                onClick={onClick}
                aria-label={attachment.filename
                    ? `Open media viewer for ${attachment.filename}`
                    : 'Open media viewer'}
                className="absolute inset-0 z-10 rounded-[inherit] border-0 focus:outline-none focus-visible:bg-black/5 dark:focus-visible:bg-white/5"
            />

            <div
                className={cn(
                    'pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-200 transition-opacity duration-200 dark:bg-zinc-800',
                    loaded ? 'opacity-0' : 'animate-pulse opacity-100',
                )}
            >
                {attachment.type === 'video' ? (
                    <Video className="h-8 w-8 text-zinc-400/50 dark:text-zinc-500/50" />
                ) : (
                    <ImageIcon className="h-8 w-8 text-zinc-400/50 dark:text-zinc-500/50" />
                )}
            </div>

            {attachment.type === 'video' ? (
                <video
                    ref={videoRef}
                    src={attachment.url}
                    autoPlay
                    muted={muted}
                    loop
                    playsInline
                    preload="metadata"
                    poster={attachment.thumbnailUrl || undefined}
                    onLoadedMetadata={(event) => {
                        recordDimensions(event.currentTarget.videoWidth, event.currentTarget.videoHeight);
                        updateAudioTrackState();
                    }}
                    onLoadedData={() => {
                        updateAudioTrackState();
                        setLoaded(true);
                        onContentLoad?.();
                    }}
                    className={cn(
                        'block h-full w-full rounded-[inherit] object-contain transition-opacity duration-200',
                        loaded ? 'opacity-100' : 'opacity-0',
                    )}
                />
            ) : (
                // Native image dimensions are authoritative when legacy rows do not include metadata.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={currentUrl}
                    alt={attachment.filename}
                    loading="lazy"
                    onLoad={(event) => {
                        recordDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
                        setLoaded(true);
                        onContentLoad?.();
                    }}
                    onError={() => {
                        if (!retriedOriginal && currentUrl !== attachment.url) {
                            setRetriedOriginal(true);
                            setCurrentUrl(attachment.url);
                        }
                    }}
                    className={cn(
                        'block h-full w-full rounded-[inherit] object-contain transition-opacity duration-200',
                        loaded ? 'opacity-100' : 'opacity-0',
                    )}
                />
            )}

            {attachment.type === 'video' && hasAudioTrack !== false ? (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        setMuted((current) => !current);
                    }}
                    className="absolute bottom-2 right-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border-0 bg-black/60 text-white backdrop-blur-sm hover:bg-black/75 focus:outline-none focus-visible:bg-black/85"
                    aria-label={muted ? 'Turn audio on' : 'Turn audio off'}
                    aria-pressed={!muted}
                >
                    {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                </button>
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

function MediaViewerModalV2({
    attachments,
    initialAttachmentId,
    onClose,
}: {
    attachments: ChatAttachmentV2[];
    initialAttachmentId: string;
    onClose: () => void;
}) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const initialIndex = useMemo(() => {
        const index = attachments.findIndex((attachment) => attachment.id === initialAttachmentId);
        return index === -1 ? 0 : index;
    }, [attachments, initialAttachmentId]);
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [videoSpeed, setVideoSpeed] = useState(1);
    const [viewerMuted, setViewerMuted] = useState(true);
    const [viewerHasAudioTrack, setViewerHasAudioTrack] = useState<boolean | null>(null);
    const [mounted, setMounted] = useState(false);
    const currentAttachment = attachments[currentIndex] ?? null;
    const currentAttachmentId = currentAttachment?.id ?? null;
    const hasMultiple = attachments.length > 1;

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        setCurrentIndex(initialIndex);
        setZoomLevel(1);
    }, [initialIndex]);

    useEffect(() => {
        setViewerMuted(true);
        setViewerHasAudioTrack(null);
        setZoomLevel(1);
    }, [currentAttachmentId]);

    useEffect(() => {
        if (!videoRef.current) return;
        videoRef.current.playbackRate = videoSpeed;
        videoRef.current.muted = viewerMuted;
    }, [currentAttachmentId, videoSpeed, viewerMuted]);

    const moveNext = useCallback(() => {
        if (attachments.length === 0) return;
        setCurrentIndex((previous) => (previous + 1) % attachments.length);
    }, [attachments.length]);

    const movePrevious = useCallback(() => {
        if (attachments.length === 0) return;
        setCurrentIndex((previous) => (previous - 1 + attachments.length) % attachments.length);
    }, [attachments.length]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (!hasMultiple) return;
            if (event.key === 'ArrowRight') moveNext();
            if (event.key === 'ArrowLeft') movePrevious();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [hasMultiple, moveNext, movePrevious, onClose]);

    const updateViewerAudioTrackState = useCallback(() => {
        if (!videoRef.current) return;
        const detected = detectVideoAudioTrack(videoRef.current);
        if (detected !== null) setViewerHasAudioTrack(detected);
    }, []);

    if (!currentAttachment || !mounted) return null;

    return createPortal(
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
            <button type="button" onClick={onClose} aria-label="Close media viewer" className="absolute inset-0" />

            <div className="relative z-10 flex max-h-[92vh] w-full max-w-6xl flex-col">
                <div className="mb-3 flex w-full items-center justify-between px-1 text-white">
                    <div className="min-w-0">
                        <p className="truncate text-sm">{currentAttachment.filename}</p>
                        {hasMultiple ? (
                            <p className="text-xs text-white/70">
                                {currentIndex + 1} / {attachments.length}
                            </p>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                        <a
                            href={currentAttachment.url}
                            download={currentAttachment.filename}
                            className="rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
                            aria-label="Download media"
                        >
                            <Download className="h-5 w-5" />
                        </a>
                        {currentAttachment.type === 'image' ? (
                            <div className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1">
                                <button
                                    type="button"
                                    onClick={() => setZoomLevel((previous) => Math.max(1, previous - 0.25))}
                                    className="px-1 text-xs hover:text-white"
                                >
                                    -
                                </button>
                                <span className="w-10 text-center text-xs">{Math.round(zoomLevel * 100)}%</span>
                                <button
                                    type="button"
                                    onClick={() => setZoomLevel((previous) => Math.min(3, previous + 0.25))}
                                    className="px-1 text-xs hover:text-white"
                                >
                                    +
                                </button>
                            </div>
                        ) : null}
                        {currentAttachment.type === 'video' ? (
                            <>
                                {viewerHasAudioTrack !== false ? (
                                    <button
                                        type="button"
                                        onClick={() => setViewerMuted((current) => !current)}
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border-0 bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:bg-white/25"
                                        aria-label={viewerMuted ? 'Turn audio on' : 'Turn audio off'}
                                        aria-pressed={!viewerMuted}
                                    >
                                        {viewerMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                                    </button>
                                ) : null}
                                <select
                                    value={videoSpeed}
                                    onChange={(event) => setVideoSpeed(Number(event.target.value))}
                                    className="rounded border border-white/20 bg-white/10 px-2 py-1 text-xs text-white"
                                    aria-label="Playback speed"
                                >
                                    <option value={0.75}>0.75x</option>
                                    <option value={1}>1x</option>
                                    <option value={1.25}>1.25x</option>
                                    <option value={1.5}>1.5x</option>
                                    <option value={2}>2x</option>
                                </select>
                            </>
                        ) : null}
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
                            aria-label="Close"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <div className="relative flex min-h-[60vh] w-full flex-1 items-center justify-center overflow-hidden">
                    {currentAttachment.type === 'video' ? (
                        <video
                            ref={videoRef}
                            key={currentAttachment.id}
                            src={currentAttachment.url}
                            controls
                            autoPlay
                            muted={viewerMuted}
                            playsInline
                            preload="metadata"
                            onLoadedMetadata={updateViewerAudioTrackState}
                            onLoadedData={updateViewerAudioTrackState}
                            onVolumeChange={() => setViewerMuted(videoRef.current?.muted ?? true)}
                            className="h-auto max-h-[82vh] w-auto max-w-full rounded-lg bg-black object-contain"
                        />
                    ) : currentAttachment.filename.toLowerCase().endsWith('.pdf') ? (
                        <div className="relative h-[82vh] w-full overflow-hidden rounded-lg bg-white">
                            <iframe
                                key={currentAttachment.id}
                                src={`${currentAttachment.url}#view=FitH&toolbar=0&navpanes=0`}
                                sandbox="allow-scripts allow-same-origin"
                                className="block h-full w-full border-0"
                                style={{ colorScheme: 'light' }}
                                title={currentAttachment.filename}
                            />
                        </div>
                    ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            key={currentAttachment.id}
                            src={currentAttachment.url}
                            alt={currentAttachment.filename}
                            className="h-auto max-h-[82vh] w-auto max-w-full select-none rounded-lg object-contain"
                            style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}
                        />
                    )}

                    {hasMultiple ? (
                        <>
                            <button
                                type="button"
                                onClick={movePrevious}
                                className="absolute left-2 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70 md:left-4"
                                aria-label="Previous media"
                            >
                                <ChevronLeft className="h-6 w-6" />
                            </button>
                            <button
                                type="button"
                                onClick={moveNext}
                                className="absolute right-2 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70 md:right-4"
                                aria-label="Next media"
                            >
                                <ChevronRight className="h-6 w-6" />
                            </button>
                        </>
                    ) : null}
                </div>
            </div>
        </div>,
        document.body,
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

function detectVideoAudioTrack(video: HTMLVideoElement): boolean | null {
    const withAudioTracks = video as HTMLVideoElement & {
        audioTracks?: { length: number };
        mozHasAudio?: boolean;
        webkitAudioDecodedByteCount?: number;
    };

    if (typeof withAudioTracks.mozHasAudio === 'boolean') return withAudioTracks.mozHasAudio;
    if (withAudioTracks.audioTracks && typeof withAudioTracks.audioTracks.length === 'number') {
        return withAudioTracks.audioTracks.length > 0;
    }
    if (typeof withAudioTracks.webkitAudioDecodedByteCount === 'number' && withAudioTracks.webkitAudioDecodedByteCount > 0) {
        return true;
    }
    return null;
}
