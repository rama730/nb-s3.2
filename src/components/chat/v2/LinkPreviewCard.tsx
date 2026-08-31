'use client';

import Image from 'next/image';
import type { LinkPreview } from '@/hooks/useLinkPreview';

interface LinkPreviewCardProps {
    preview: LinkPreview;
    isOwn: boolean;
    loading?: boolean;
    onContentLoad?: () => void;
}

export function LinkPreviewCard({
    preview,
    isOwn,
    loading = false,
    onContentLoad,
}: LinkPreviewCardProps) {
    if (!loading && !preview.title && !preview.description && !preview.image) return null;
    const skeletonClass = isOwn ? 'bg-white/20' : 'bg-zinc-200/80 dark:bg-zinc-700/70';
    const skeletonSoftClass = isOwn ? 'bg-white/15' : 'bg-zinc-200/60 dark:bg-zinc-700/50';

    return (
        <a
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className={`msg-rich-content mt-2 flex min-h-[80px] w-full max-w-full min-w-0 sm:max-w-sm flex-row items-center overflow-hidden rounded-xl border ${
                isOwn
                    ? 'border-white/20 bg-white/10 hover:bg-white/15'
                    : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:bg-zinc-800/80'
            } transition-colors duration-200`}
        >
            {(preview.image || loading) && (
                <div className="h-[80px] w-[80px] shrink-0 overflow-hidden bg-black/5 dark:bg-white/5">
                    {preview.image ? (
                        <Image
                            src={preview.image}
                            alt=""
                            width={80}
                            height={80}
                            sizes="80px"
                            unoptimized
                            loading="lazy"
                            onLoad={onContentLoad}
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <div className={`h-full w-full animate-pulse ${skeletonClass}`} />
                    )}
                </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col p-3">
                <div className={`truncate text-[10px] uppercase tracking-wide font-semibold ${isOwn ? 'text-white/60' : 'text-zinc-500 dark:text-zinc-400'}`}>
                    {preview.domain}
                </div>
                {loading && !preview.title ? (
                    <div className={`mt-1 h-3.5 w-4/5 rounded ${skeletonClass}`} />
                ) : preview.title ? (
                    <div className={`mt-0.5 line-clamp-1 break-words text-xs font-bold leading-snug ${isOwn ? 'text-white' : 'text-zinc-900 dark:text-zinc-100'}`}>
                        {preview.title}
                    </div>
                ) : null}
                {loading && !preview.description ? (
                    <div className={`mt-1 h-3 w-2/3 rounded ${skeletonSoftClass}`} />
                ) : preview.description ? (
                    <div className={`mt-0.5 line-clamp-1 break-words text-[11px] leading-tight ${isOwn ? 'text-white/80' : 'text-zinc-600 dark:text-zinc-400'}`}>
                        {preview.description}
                    </div>
                ) : null}
            </div>
        </a>
    );
}
