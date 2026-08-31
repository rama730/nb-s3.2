'use client';

import { useEffect, useRef, type RefObject } from 'react';

export default function ResolvedVideoPlayer({
    url,
    className,
    muted,
    autoPlay,
    controls,
    loop,
    playsInline,
    paused,
    initialTime,
    playbackRate = 1,
    preload = 'metadata',
    elementRef,
    onVolumeChange,
    onCanPlay,
    onError,
}: {
    url: string;
    className?: string;
    muted?: boolean;
    autoPlay?: boolean;
    controls?: boolean;
    loop?: boolean;
    playsInline?: boolean;
    paused?: boolean;
    initialTime?: number;
    playbackRate?: number;
    preload?: 'none' | 'metadata' | 'auto';
    elementRef?: RefObject<HTMLVideoElement | null>;
    onVolumeChange?: () => void;
    onCanPlay?: () => void;
    onError?: () => void;
}) {
    const internalRef = useRef<HTMLVideoElement>(null);
    const videoRef = elementRef ?? internalRef;

    // Apply initial time on mount
    useEffect(() => {
        const video = videoRef.current;
        if (video && initialTime !== undefined && initialTime > 0) {
            video.currentTime = initialTime;
        }
    }, [initialTime, videoRef]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (paused) {
            video.pause();
        } else if (autoPlay) {
            void video.play().catch(() => undefined);
        }
    }, [paused, autoPlay, videoRef]);

    useEffect(() => {
        const video = videoRef.current;
        if (video && muted !== undefined) {
            video.muted = muted;
        }
    }, [muted, videoRef]);

    useEffect(() => {
        if (videoRef.current) videoRef.current.playbackRate = playbackRate;
    }, [playbackRate, videoRef]);

    return (
        <video
            ref={videoRef}
            src={url}
            className={className}
            controls={controls}
            autoPlay={autoPlay}
            muted={muted}
            loop={loop}
            playsInline={playsInline}
            preload={preload}
            onVolumeChange={onVolumeChange ? () => onVolumeChange() : undefined}
            onCanPlay={onCanPlay}
            onError={onError}
        />
    );
}
