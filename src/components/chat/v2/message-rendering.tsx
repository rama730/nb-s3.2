'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { toast } from 'sonner';
import {
    Check,
    ChevronLeft,
    ChevronRight,
    Copy,
    Download,
    File,
    Image as ImageIcon,
    Volume2,
    VolumeX,
    Video,
    X,
} from 'lucide-react';
import { parseSafeLinkToken } from '@/lib/messages/safe-links';
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

const LINK_OR_MENTION_REGEX = /((?<!\S)@[a-zA-Z0-9_]{2,32}\b|(?:https?:\/\/|www\.)[^\s]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?)/g;
export const MESSAGE_TEXT_BASE_CLASS = 'msg-message-text leading-relaxed';

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
        () => attachments.filter((attachment) =>
            attachment.type === 'image'
            || attachment.type === 'video'
            || attachment.filename.toLowerCase().endsWith('.pdf')),
        [attachments],
    );

    if (attachments.length === 0) return null;

    return (
        <>
            <div className="min-w-0 max-w-[380px] space-y-2">
                {mediaAttachments.length > 0 && (
                    <MediaAttachmentGridV2
                        attachments={mediaAttachments}
                        onOpenMedia={(id) => setActiveAttachmentId(id)}
                        onContentLoad={onContentLoad}
                    />
                )}

                {fileAttachments.length > 0 && (
                    <div className="min-w-0 max-w-[380px] overflow-hidden space-y-1">
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
                )}
            </div>

            {activeAttachmentId && (
                <MediaViewerModalV2
                    attachments={viewableAttachments}
                    initialAttachmentId={activeAttachmentId}
                    onClose={() => setActiveAttachmentId(null)}
                />
            )}
        </>
    );
}

function renderInlineTextWithMentions(text: string, isOwn: boolean, baseKey: string) {
    const parts = text.split(LINK_OR_MENTION_REGEX);
    return parts.map((part, index) => {
        if (part.startsWith('@')) {
            const username = part.slice(1).toLowerCase();
            return (
                <a
                    key={`${baseKey}-mention-${index}`}
                    href={`/u/${username}`}
                    className={`font-semibold underline underline-offset-2 ${
                        isOwn ? 'text-white' : 'text-primary'
                    }`}
                >
                    {part}
                </a>
            );
        }

        const safeLink = parseSafeLinkToken(part);
        if (safeLink) {
            return (
                <span key={`${baseKey}-link-wrap-${index}`}>
                    <a
                        href={safeLink.href}
                        target="_blank"
                        rel="noopener noreferrer nofollow ugc"
                        className={`break-all underline ${isOwn ? 'text-white' : 'text-primary'}`}
                    >
                        {safeLink.display}
                    </a>
                    {safeLink.trailing}
                </span>
            );
        }

        return <span key={`${baseKey}-txt-${index}`}>{part}</span>;
    });
}

export function renderTextWithMentions(text: string, isOwn: boolean) {
    const inlineParts = text.split(/(`[^`\n]+`)/g);
    return inlineParts.map((part, index) => {
        if (part.length >= 2 && part.startsWith('`') && part.endsWith('`')) {
            return (
                <code
                    key={`inline-code-${index}`}
                    className={cn(
                        'rounded px-1.5 py-0.5 font-mono text-[0.9em]',
                        isOwn
                            ? 'bg-black/25 text-white'
                            : 'bg-zinc-200 text-zinc-950 dark:bg-zinc-800 dark:text-zinc-100',
                    )}
                >
                    {part.slice(1, -1)}
                </code>
            );
        }

        return renderInlineTextWithMentions(part, isOwn, `inline-text-${index}`);
    });
}

const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
    'cpp': 'C++',
    'cxx': 'C++',
    'c++': 'C++',
    'ts': 'TypeScript',
    'tsx': 'TypeScript (React)',
    'js': 'JavaScript',
    'jsx': 'JavaScript (React)',
    'py': 'Python',
    'python': 'Python',
    'sh': 'Bash',
    'bash': 'Bash',
    'zsh': 'Bash',
    'css': 'CSS',
    'html': 'HTML',
    'json': 'JSON',
    'sql': 'SQL',
    'go': 'Go',
    'rs': 'Rust',
    'rust': 'Rust',
    'java': 'Java',
    'c': 'C',
    'cs': 'C#',
    'csharp': 'C#',
    'php': 'PHP',
    'ruby': 'Ruby',
    'rb': 'Ruby',
    'swift': 'Swift',
    'kt': 'Kotlin',
    'kotlin': 'Kotlin',
    'dart': 'Dart',
    'xml': 'XML',
    'yaml': 'YAML',
    'yml': 'YAML',
    'md': 'Markdown',
    'markdown': 'Markdown',
};

function getDisplayLanguage(lang: string | null): string {
    if (!lang) return 'Code';
    const normalized = lang.toLowerCase();
    return LANGUAGE_DISPLAY_NAMES[normalized] || lang;
}

export function CodeSegmentV2({
    code,
    language,
    isOwn,
}: {
    code: string;
    language: string | null;
    isOwn: boolean;
}) {
    const [copied, setCopied] = useState(false);
    const copyTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (copyTimeoutRef.current) {
                clearTimeout(copyTimeoutRef.current);
                copyTimeoutRef.current = null;
            }
        };
    }, []);

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            if (copyTimeoutRef.current) {
                clearTimeout(copyTimeoutRef.current);
            }
            copyTimeoutRef.current = window.setTimeout(() => {
                copyTimeoutRef.current = null;
                setCopied(false);
            }, 1200);
        } catch {
            toast.error('Failed to copy code');
        }
    }, [code]);

    return (
        <div
            className={cn(
                'msg-rich-content max-w-full min-w-0 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950/95 shadow-sm',
                isOwn ? 'text-zinc-100' : 'text-zinc-100',
            )}
        >
            <div className="flex items-center justify-between border-b border-white/10 bg-black/50 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-zinc-300">
                <span>{getDisplayLanguage(language)}</span>
                <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                >
                    {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
            </div>
            <pre className="max-w-full overflow-x-auto px-3 py-2 text-[12px] leading-5 text-zinc-100">
                <code>{code}</code>
            </pre>
        </div>
    );
}

function MediaAttachmentGridV2({
    attachments,
    onOpenMedia,
    onContentLoad,
}: {
    attachments: ChatAttachmentV2[];
    onOpenMedia: (id: string) => void;
    onContentLoad?: () => void;
}) {
    const visibleAttachments = attachments.slice(0, 4);
    const overflowCount = attachments.length - visibleAttachments.length;
    const isSingle = visibleAttachments.length === 1;

    const isTriple = visibleAttachments.length === 3;

    return (
        <div className={cn(
            "w-full max-w-full min-w-0 overflow-hidden",
            isSingle ? "rounded-2xl" : "grid grid-cols-2 gap-[2px] rounded-[18px]"
        )}>
            {visibleAttachments.map((attachment, index) => (
                <MediaAttachmentTileV2
                    key={attachment.id}
                    attachment={attachment}
                    isSingle={isSingle}
                    spanFull={isTriple && index === 2}
                    overlayLabel={index === visibleAttachments.length - 1 && overflowCount > 0 ? `+${overflowCount}` : null}
                    onClick={() => onOpenMedia(attachment.id)}
                    onContentLoad={onContentLoad}
                />
            ))}
        </div>
    );
}

function MediaAttachmentTileV2({
    attachment,
    isSingle,
    spanFull = false,
    overlayLabel,
    onClick,
    onContentLoad,
}: {
    attachment: ChatAttachmentV2;
    isSingle: boolean;
    spanFull?: boolean;
    overlayLabel: string | null;
    onClick: () => void;
    onContentLoad?: () => void;
}) {
    const [loaded, setLoaded] = useState(false);
    const [muted, setMuted] = useState(true);
    const [hasAudioTrack, setHasAudioTrack] = useState<boolean | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const previewUrl = attachment.thumbnailUrl || attachment.url;
    const [retried, setRetried] = useState(false);
    const [currentUrl, setCurrentUrl] = useState(previewUrl);
    const hasDimensions = Boolean(attachment.width && attachment.height && attachment.width > 0 && attachment.height > 0);
    const aspectRatio = hasDimensions
        ? `${attachment.width} / ${attachment.height}`
        : undefined;

    useEffect(() => {
        if (!videoRef.current) return;
        videoRef.current.muted = muted;
        if (!muted) {
            void videoRef.current.play().catch(() => {
                setMuted(true);
            });
        }
    }, [muted]);

    const updateAudioTrackState = useCallback(() => {
        if (!videoRef.current) return;
        const detected = detectVideoAudioTrack(videoRef.current);
        if (detected !== null) setHasAudioTrack(detected);
    }, []);

    return (
        <div
            className={cn(
                "relative min-w-0 overflow-hidden bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-ring/60 dark:bg-zinc-800",
                isSingle ? (hasDimensions ? 'w-auto max-w-full max-h-[360px] rounded-2xl' : (loaded ? 'w-auto max-w-full max-h-[360px] rounded-2xl' : 'w-auto min-w-[240px] min-h-[240px] max-w-full max-h-[360px] rounded-2xl')) : 'h-[150px] w-full',
                spanFull ? 'col-span-2 aspect-[21/9] h-auto' : ''
            )}
            style={isSingle && hasDimensions ? { aspectRatio } : undefined}
        >
            <button
                type="button"
                onClick={onClick}
                aria-label={attachment.filename ? `Open media viewer for ${attachment.filename}` : 'Open media viewer'}
                className="absolute inset-0 z-10 rounded-[inherit] focus:outline-none focus:ring-2 focus:ring-ring/60"
            />
            <div className={cn(
                "absolute inset-0 flex items-center justify-center bg-zinc-200 dark:bg-zinc-800/80 transition-opacity duration-300",
                loaded ? 'opacity-0 pointer-events-none' : 'opacity-100 animate-pulse'
            )}>
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
                    onLoadedMetadata={updateAudioTrackState}
                    onLoadedData={() => {
                        updateAudioTrackState();
                        setLoaded(true);
                        onContentLoad?.();
                    }}
                    className={cn(
                        "block object-cover transition-opacity duration-300",
                        isSingle ? "h-auto w-auto max-h-[360px] max-w-full rounded-2xl" : "h-full w-full",
                        loaded ? 'opacity-100' : 'opacity-0'
                    )}
                />
            ) : (
                <Image
                    src={currentUrl}
                    alt={attachment.filename}
                    width={640}
                    height={360}
                    loading="lazy"
                    unoptimized
                    onLoad={() => {
                        setLoaded(true);
                        onContentLoad?.();
                    }}
                    onError={() => {
                        if (!retried && attachment.url !== previewUrl) {
                            setRetried(true);
                            setCurrentUrl(attachment.url);
                        }
                    }}
                    className={cn(
                        "block object-cover transition-opacity duration-300",
                        isSingle ? "h-auto w-auto max-h-[360px] max-w-full rounded-2xl" : "h-full w-full",
                        loaded ? 'opacity-100' : 'opacity-0'
                    )}
                />
            )}

            {attachment.type === 'video' && hasAudioTrack !== false && (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        setMuted((current) => !current);
                    }}
                    className="absolute bottom-2 right-2 z-20 inline-flex h-[18px] w-[22px] items-center justify-center rounded bg-black/60 px-1.5 py-0.5 text-white backdrop-blur-[2px] transition-none hover:bg-black/60 active:bg-black/60 focus:bg-black/60 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 [-webkit-tap-highlight-color:transparent]"
                    aria-label={muted ? 'Turn audio on' : 'Turn audio off'}
                    aria-pressed={!muted}
                >
                    {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                </button>
            )}

            {overlayLabel && (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/50">
                    <span className="text-xl font-semibold text-white">{overlayLabel}</span>
                </div>
            )}
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
                className="flex w-full max-w-full min-w-0 items-center gap-3 overflow-hidden rounded-lg bg-zinc-100 p-3 text-left transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
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
            className="flex w-full max-w-full min-w-0 items-center gap-3 overflow-hidden rounded-lg bg-zinc-100 p-3 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
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
    const initialIdx = useMemo(() => {
        const idx = attachments.findIndex((attachment) => attachment.id === initialAttachmentId);
        return idx !== -1 ? idx : 0;
    }, [attachments, initialAttachmentId]);
    const [currentIndex, setCurrentIndex] = useState(initialIdx);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [videoSpeed, setVideoSpeed] = useState(1);
    const [viewerMuted, setViewerMuted] = useState(true);
    const [viewerHasAudioTrack, setViewerHasAudioTrack] = useState<boolean | null>(null);
    const currentAttachment = attachments[currentIndex] ?? null;
    const currentAttachmentId = currentAttachment?.id ?? null;
    const attachmentCount = attachments.length;
    const hasMultiple = attachmentCount > 1;

    useEffect(() => {
        setCurrentIndex(initialIdx);
        setZoomLevel(1);
    }, [initialIdx]);

    useEffect(() => {
        setViewerMuted(true);
        setViewerHasAudioTrack(null);
    }, [currentAttachmentId]);

    useEffect(() => {
        if (!currentAttachmentId) return;
        if (!videoRef.current) return;
        videoRef.current.playbackRate = videoSpeed;
    }, [currentAttachmentId, videoSpeed]);

    useEffect(() => {
        if (!videoRef.current) return;
        videoRef.current.muted = viewerMuted;
    }, [currentAttachmentId, viewerMuted]);

    const updateViewerAudioTrackState = useCallback(() => {
        if (!videoRef.current) return;
        const detected = detectVideoAudioTrack(videoRef.current);
        if (detected !== null) setViewerHasAudioTrack(detected);
    }, []);

    const moveNext = useCallback(() => {
        if (attachmentCount === 0) return;
        setCurrentIndex((previous) => (previous + 1) % attachmentCount);
    }, [attachmentCount]);

    const movePrev = useCallback(() => {
        if (attachmentCount === 0) return;
        setCurrentIndex((previous) => (previous - 1 + attachmentCount) % attachmentCount);
    }, [attachmentCount]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (!hasMultiple) return;
            if (event.key === 'ArrowRight') moveNext();
            if (event.key === 'ArrowLeft') movePrev();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [hasMultiple, moveNext, movePrev, onClose]);

    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    if (!currentAttachment || !mounted) {
        return null;
    }

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
                                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/70"
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

                <div className="relative flex min-h-[60vh] w-full flex-1 items-center justify-center">
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
	                                onVolumeChange={() => {
	                                    const nextMuted = videoRef.current?.muted ?? true;
	                                    setViewerMuted((current) => (current === nextMuted ? current : nextMuted));
                                }}
	                            className="max-h-[82vh] w-auto cursor-pointer rounded-lg bg-black"
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
                        <Image
                            key={currentAttachment.id}
                            src={currentAttachment.url}
                            alt={currentAttachment.filename}
                            width={1200}
                            height={900}
                            unoptimized
                            className="max-h-[82vh] w-auto select-none rounded-lg"
                            style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}
                        />
                    )}

                    {hasMultiple ? (
                        <>
                            <button
                                type="button"
                                onClick={movePrev}
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
        document.body
    );
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
