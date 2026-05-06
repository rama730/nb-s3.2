'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import {
    Check,
    ChevronLeft,
    ChevronRight,
    Copy,
    Download,
    File,
    PlayCircle,
    X,
} from 'lucide-react';
import { normalizeSafeExternalUrl, parseSafeLinkToken } from '@/lib/messages/safe-links';
import { getMessagePreviewText } from '@/lib/messages/structured';

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

export function MessageTextContentV2({
    content,
    isOwn,
    isApplication = false,
}: {
    content: string | null;
    isOwn: boolean;
    isApplication?: boolean;
}) {
    if (!content) return null;

    if (isApplication) {
        const lines = content.split(/\r?\n/);
        return (
            <div className="min-w-0 max-w-full space-y-1.5">
                {lines.map((line, index) => {
                    const trimmed = line.trim();
                    if (!trimmed) return <div key={`app-space-${index}`} className="h-2" />;
                    const match = trimmed.match(/^([A-Za-z][A-Za-z ]{1,24}):\s*(.+)$/);
                    if (!match) {
                        return (
                            <p key={`app-line-${index}`} className="msg-message-text leading-relaxed">
                                {renderTextWithMentions(trimmed, isOwn)}
                            </p>
                        );
                    }

                    const label = match[1].trim();
                    const value = match[2].trim();
                    const normalizedUrl = normalizeSafeExternalUrl(value);
                    return (
                        <p key={`app-meta-${index}`} className="msg-message-text leading-relaxed">
                            <span className="font-semibold">{label}: </span>
                            {normalizedUrl ? (
                                <a
                                    href={normalizedUrl}
                                    target="_blank"
                                    rel="noopener noreferrer nofollow ugc"
                                    className={isOwn ? 'break-all underline text-white' : 'break-all underline text-primary'}
                                >
                                    {value}
                                </a>
                            ) : (
                                renderTextWithMentions(value, isOwn)
                            )}
                        </p>
                    );
                })}
            </div>
        );
    }

    const segments = getCachedMessageSegments(content);
    return (
        <div className="min-w-0 max-w-full space-y-2">
            {segments.map((segment, index) =>
                segment.type === 'code' ? (
                    <CodeSegmentV2
                        key={`code-${index}`}
                        code={segment.content}
                        language={segment.language}
                        isOwn={isOwn}
                    />
                ) : (
                    <p key={`text-${index}`} className="msg-message-text leading-relaxed">
                        {renderTextWithMentions(segment.content, isOwn)}
                    </p>
                ),
            )}
        </div>
    );
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
        () => attachments.filter((attachment) =>
            attachment.type === 'image'
            || attachment.type === 'video'
            || attachment.filename.toLowerCase().endsWith('.pdf')),
        [attachments],
    );

    if (attachments.length === 0) return null;

    return (
        <>
            <div className="mt-2 min-w-0 max-w-full space-y-2">
                {mediaAttachments.length > 0 && (
                    <MediaAttachmentGridV2
                        attachments={mediaAttachments}
                        onOpenMedia={(id) => setActiveAttachmentId(id)}
                        onContentLoad={onContentLoad}
                    />
                )}

                {fileAttachments.length > 0 && (
                    <div className="min-w-0 max-w-full overflow-hidden space-y-1">
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

export function formatMessagePreview(
    lastMessage: { content?: string | null; type?: string | null; metadata?: Record<string, unknown> | null } | null | undefined,
): string {
    if (!lastMessage) return 'No messages yet';
    return getMessagePreviewText(lastMessage);
}

function renderTextWithMentions(text: string, isOwn: boolean) {
    const parts = text.split(LINK_OR_MENTION_REGEX);
    return parts.map((part, index) => {
        if (part.startsWith('@')) {
            const username = part.slice(1).toLowerCase();
            return (
                <a
                    key={`mention-${index}`}
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
                <span key={`link-wrap-${index}`}>
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

        return <span key={`txt-${index}`}>{part}</span>;
    });
}

const _parsedContentCache = new Map<string, Array<{ type: 'text' | 'code'; content: string; language: string | null }>>();
const MAX_PARSED_CACHE_SIZE = 500;

function getCachedMessageSegments(content: string) {
    const cached = _parsedContentCache.get(content);
    if (cached) return cached;
    const parsed = parseMessageSegments(content);
    if (_parsedContentCache.size >= MAX_PARSED_CACHE_SIZE) {
        const firstKey = _parsedContentCache.keys().next().value;
        if (firstKey !== undefined) _parsedContentCache.delete(firstKey);
    }
    _parsedContentCache.set(content, parsed);
    return parsed;
}

function parseMessageSegments(content: string): Array<{ type: 'text' | 'code'; content: string; language: string | null }> {
    const segments: Array<{ type: 'text' | 'code'; content: string; language: string | null }> = [];
    const codeRegex = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
            const textChunk = content.slice(lastIndex, match.index);
            if (textChunk) segments.push({ type: 'text', content: textChunk, language: null });
        }
        segments.push({
            type: 'code',
            language: match[1] || null,
            content: (match[2] || '').trimEnd(),
        });
        lastIndex = codeRegex.lastIndex;
    }

    if (lastIndex < content.length) {
        const tail = content.slice(lastIndex);
        if (tail) segments.push({ type: 'text', content: tail, language: null });
    }

    if (segments.length === 0) {
        segments.push({ type: 'text', content, language: null });
    }

    return segments;
}

function CodeSegmentV2({
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
            className={`msg-rich-content max-w-full min-w-0 overflow-hidden rounded-lg border ${
                isOwn
                    ? 'border-white/30 bg-black/25'
                    : 'border-zinc-300 bg-zinc-900/90 dark:border-zinc-700'
            }`}
        >
            <div className="flex items-center justify-between bg-black/30 px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-300">
                <span>{language || 'code'}</span>
                <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-white/10"
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
        <div className={`${isSingle ? 'grid grid-cols-1' : 'grid grid-cols-2'} w-full max-w-full min-w-0 gap-1`}>
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
    const previewUrl = attachment.thumbnailUrl || attachment.url;
    const [retried, setRetried] = useState(false);
    const [currentUrl, setCurrentUrl] = useState(previewUrl);
    const aspectRatio = attachment.width && attachment.height && attachment.width > 0 && attachment.height > 0
        ? `${attachment.width} / ${attachment.height}`
        : '16 / 10';

    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={attachment.filename ? `Open media viewer for ${attachment.filename}` : 'Open media viewer'}
            className={`relative min-w-0 overflow-hidden rounded-lg bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-ring/60 dark:bg-zinc-800 ${isSingle ? 'w-full max-h-80' : 'h-36'} ${spanFull ? 'col-span-2' : ''}`}
            style={isSingle ? { aspectRatio } : undefined}
        >
            {!loaded && <div className="absolute inset-0 animate-pulse bg-zinc-200/80 dark:bg-zinc-700/70" />}
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
                className={`h-full w-full transition-opacity duration-200 ${
                    isSingle ? 'object-contain bg-zinc-900/40' : 'object-cover'
                } ${loaded ? 'opacity-100' : 'opacity-0'}`}
            />

            {attachment.type === 'video' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                    <PlayCircle className="h-10 w-10 text-white/90" />
                </div>
            )}

            {overlayLabel && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <span className="text-xl font-semibold text-white">{overlayLabel}</span>
                </div>
            )}
        </button>
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
    const currentAttachment = attachments[currentIndex] ?? null;
    const currentAttachmentId = currentAttachment?.id ?? null;
    const attachmentCount = attachments.length;
    const hasMultiple = attachmentCount > 1;

    useEffect(() => {
        setCurrentIndex(initialIdx);
        setZoomLevel(1);
    }, [initialIdx]);

    useEffect(() => {
        if (!currentAttachmentId) return;
        if (!videoRef.current) return;
        videoRef.current.playbackRate = videoSpeed;
    }, [currentAttachmentId, videoSpeed]);

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

    if (!currentAttachment) {
        return null;
    }

    return (
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
                            playsInline
                            preload="metadata"
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
        </div>
    );
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
