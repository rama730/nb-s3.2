"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Download, VolumeX, Volume2, X, ChevronLeft, ChevronRight, Image as ImageIcon, Video } from 'lucide-react';
import ResolvedVideoPlayer from '@/components/chat/v2/resolved-video-player';
import { PdfViewerV2 } from '@/components/chat/v2/message-attachments'; 
import { cn } from '@/lib/utils';

export interface MediaItem {
    id: string;
    url: string;
    localUrl?: string;
    thumbnailUrl?: string;
    filename: string;
    type: 'image' | 'video' | 'file' | 'audio' | string;
}

interface MediaViewerProps {
    attachments: MediaItem[];
    initialAttachmentId: string;
    originRect: DOMRect | null;
    initialVideoTime?: number;
    onClose: (returnedState?: { id: string; time: number }) => void;
}

export function MediaViewerModal({
    attachments,
    initialAttachmentId,
    originRect,
    initialVideoTime,
    onClose,
}: MediaViewerProps) {
    const initialIndex = useMemo(() => {
        const index = attachments.findIndex((attachment) => attachment.id === initialAttachmentId);
        return index === -1 ? 0 : index;
    }, [attachments, initialAttachmentId]);

    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [videoSpeed, setVideoSpeed] = useState(1);
    const [viewerMuted, setViewerMuted] = useState(true);
    const [mounted, setMounted] = useState(false);
    const [isEntering, setIsEntering] = useState(true);
    const [isExiting, setIsExiting] = useState(false);
    const [isMediaLoaded, setIsMediaLoaded] = useState(false);
    const viewerVideoRef = useRef<HTMLVideoElement>(null);

    const currentAttachment = attachments[currentIndex] ?? null;
    const currentAttachmentId = currentAttachment?.id ?? null;
    const hasMultiple = attachments.length > 1;

    // Swipe gesture refs
    const touchStartX = useRef(0);
    const touchEndX = useRef(0);
    const touchStartY = useRef(0);
    const [dragY, setDragY] = useState(0);
    const [isDragging, setIsDragging] = useState(false);

    const handleClose = useCallback(() => {
        setIsExiting(true);
        let returnedState = undefined;
        if (currentAttachment?.type === 'video') {
            const video = viewerVideoRef.current;
            if (video) {
                returnedState = { id: currentAttachment.id, time: video.currentTime };
            }
        }
        setTimeout(() => onClose(returnedState), 250); // Match transiton duration
    }, [onClose, currentAttachment]);

    useEffect(() => {
        setMounted(true);
        const timer = setTimeout(() => setIsEntering(false), 50);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        setCurrentIndex(initialIndex);
        setZoomLevel(1);
    }, [initialIndex]);

    useEffect(() => {
        setViewerMuted(true);
        setZoomLevel(1);
        setIsMediaLoaded(false);
    }, [currentAttachmentId]);

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
            if (event.key === 'Escape') handleClose();
            if (event.key === ' ') {
                event.preventDefault();
                const video = viewerVideoRef.current;
                if (video) {
                    if (video.paused) video.play().catch(() => undefined);
                    else video.pause();
                }
            }
            if (event.key.toLowerCase() === 'm') {
                setViewerMuted((prev) => !prev);
            }
            if (!hasMultiple) return;
            if (event.key === 'ArrowRight') moveNext();
            if (event.key === 'ArrowLeft') movePrevious();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [hasMultiple, moveNext, movePrevious, handleClose]);

    if (!currentAttachment || !mounted) return null;

    // FLIP animation coordinates calculation
    const originX = originRect ? originRect.left + originRect.width / 2 : window.innerWidth / 2;
    const originY = originRect ? originRect.top + originRect.height / 2 : window.innerHeight / 2;
    const transX = originX - window.innerWidth / 2;
    const transY = originY - window.innerHeight / 2;
    const initScale = originRect ? Math.min(originRect.width / 800, originRect.height / 600) : 0.15;

    const animationStyle: CSSProperties = (isEntering || isExiting)
        ? {
            transform: `translate3d(${transX}px, ${transY}px, 0) scale(${initScale})`,
            opacity: 0,
            transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease-in-out',
        }
        : isDragging || dragY !== 0
            ? {
                transform: `translate3d(0, ${dragY}px, 0) scale(${Math.max(0.8, 1 - Math.abs(dragY) / 1000)})`,
                opacity: Math.max(0.4, 1 - Math.abs(dragY) / 500),
                transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease-out',
            }
            : {
                transform: 'translate3d(0, 0, 0) scale(1)',
                opacity: 1,
                transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease-out',
            };

    // Swipe gesture handlers
    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.targetTouches[0]) {
            touchStartX.current = e.targetTouches[0].clientX;
            touchEndX.current = e.targetTouches[0].clientX;
            touchStartY.current = e.targetTouches[0].clientY;
            setIsDragging(true);
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (e.targetTouches[0]) {
            touchEndX.current = e.targetTouches[0].clientX;
            setDragY(e.targetTouches[0].clientY - touchStartY.current);
        }
    };

    const handleTouchEnd = () => {
        setIsDragging(false);
        const deltaX = touchStartX.current - touchEndX.current;
        if (Math.abs(dragY) > 100) {
            handleClose();
        } else if (Math.abs(deltaX) > 75) {
            if (deltaX > 0) moveNext();
            else movePrevious();
            setDragY(0);
        } else {
            setDragY(0);
        }
    };

    const placeholderUrl = currentAttachment.type === 'image'
        ? currentAttachment.localUrl || currentAttachment.thumbnailUrl
        : currentAttachment.thumbnailUrl;

    return createPortal(
        <div
            className={cn(
                "fixed inset-0 z-[9999] flex flex-col items-center justify-between bg-black/90 p-4 backdrop-blur-md transition-opacity duration-300",
                (isEntering || isExiting) ? "opacity-0" : "opacity-100"
            )}
            style={isDragging || dragY !== 0 ? { backgroundColor: `rgba(0,0,0,${Math.max(0, 0.9 - Math.abs(dragY) / 400)})` } : undefined}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            <button type="button" onClick={handleClose} aria-label="Close media viewer" className="absolute inset-0" />

            <div
                style={animationStyle}
                className="relative z-10 flex max-h-[85vh] w-full max-w-6xl flex-1 flex-col justify-center"
            >
                <div className="mb-3 flex w-full items-center justify-between px-1 text-white">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{currentAttachment.filename}</p>
                        {hasMultiple ? (
                            <p className="text-xs text-white/60">
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
                                <button
                                    type="button"
                                    onClick={() => setViewerMuted((current) => !current)}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border-0 bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:bg-white/25"
                                    aria-label={viewerMuted ? 'Turn audio on' : 'Turn audio off'}
                                    aria-pressed={!viewerMuted}
                                >
                                    {viewerMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                                </button>
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
                            onClick={handleClose}
                            className="rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
                            aria-label="Close"
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <div className="relative flex min-h-[50vh] w-full flex-1 items-center justify-center overflow-hidden">
                    {/* CSS Blur-up placeholder while loading */}
                    {!isMediaLoaded && currentAttachment.type !== 'file' && placeholderUrl && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                            <img
                                src={placeholderUrl}
                                alt=""
                                className="absolute inset-0 h-full w-full select-none object-contain blur-xl scale-105 opacity-50 transition-opacity duration-300"
                            />
                        </div>
                    )}

                    {currentAttachment.type === 'video' ? (
                        <ResolvedVideoPlayer
                            key={currentAttachment.id}
                            url={currentAttachment.localUrl || currentAttachment.url}
                            controls={true}
                            autoPlay={true}
                            muted={viewerMuted}
                            playsInline={true}
                            preload="auto"
                            playbackRate={videoSpeed}
                            elementRef={viewerVideoRef}
                            initialTime={currentIndex === initialIndex ? initialVideoTime : undefined}
                            onVolumeChange={() => setViewerMuted(viewerVideoRef.current?.muted ?? true)}
                            onCanPlay={() => {
                                setIsMediaLoaded(true);
                            }}
                            onError={() => {
                                setIsMediaLoaded(true);
                            }}
                            className="lightbox-video h-auto max-h-[82vh] w-auto max-w-full rounded-lg bg-black object-contain"
                        />
                    ) : currentAttachment.filename.toLowerCase().endsWith('.pdf') ? (
                        <div className="relative h-[82vh] w-full overflow-hidden rounded-lg bg-white">
                            <PdfViewerV2
                                key={currentAttachment.id}
                                attachment={currentAttachment}
                            />
                        </div>
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-12">
                            <img
                                key={currentAttachment.id}
                                src={currentAttachment.localUrl || currentAttachment.url || undefined}
                                alt={currentAttachment.filename || ''}
                                onLoad={() => setIsMediaLoaded(true)}
                                className="h-full w-full select-none object-contain"
                                style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}
                            />
                        </div>
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

            {/* Scrollable Horizontal Thumbnail Strip */}
            {hasMultiple && (
                <div className="relative z-10 flex w-full justify-center overflow-hidden py-2 select-none">
                    <div className="flex gap-2 overflow-x-auto px-4 py-1 max-w-full no-scrollbar">
                        {attachments.map((att, idx) => (
                            <button
                                key={att.id}
                                type="button"
                                onClick={() => setCurrentIndex(idx)}
                                aria-label={`View ${att.filename}`}
                                aria-current={currentIndex === idx ? 'true' : undefined}
                                className={cn(
                                    "relative h-12 w-12 shrink-0 overflow-hidden rounded-md border-2 bg-zinc-900/50 transition-all duration-200 hover:scale-105",
                                    currentIndex === idx ? "border-primary scale-110 opacity-100 ring-2 ring-primary/20" : "border-transparent opacity-50 hover:opacity-100"
                                )}
                            >
                                {att.type === 'video' ? (
                                    <div className="relative flex h-full w-full items-center justify-center bg-zinc-800 text-white">
                                        <Video className="h-4 w-4" />
                                    </div>
                                ) : att.localUrl || att.thumbnailUrl ? (
                                    <img
                                        src={att.localUrl || att.thumbnailUrl || undefined}
                                        alt=""
                                        className="h-full w-full object-cover block"
                                    />
                                ) : (
                                    <div className="flex h-full w-full items-center justify-center bg-zinc-800 text-white">
                                        <ImageIcon className="h-4 w-4" aria-hidden="true" />
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}

        </div>,
        document.body,
    );
}
