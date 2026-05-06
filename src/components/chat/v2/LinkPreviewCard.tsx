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
            className={`msg-rich-content mt-2 block w-full max-w-full min-w-0 overflow-hidden rounded-lg border ${
                isOwn
                    ? 'border-white/20 bg-white/10'
                    : 'border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50'
            }`}
        >
            {(preview.image || loading) && (
                <div className="aspect-[1.91/1] max-h-36 w-full min-w-0 overflow-hidden">
                    {preview.image ? (
                        <Image
                            src={preview.image}
                            alt=""
                            width={400}
                            height={200}
                            sizes="(max-width: 480px) 72vw, 360px"
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
            <div className="min-w-0 p-2.5">
                <div className={`truncate text-[10px] ${isOwn ? 'text-white/60' : 'text-zinc-400'}`}>
                    {preview.domain}
                </div>
                {loading && !preview.title ? (
                    <div className={`mt-1.5 h-4 w-4/5 rounded ${skeletonClass}`} />
                ) : preview.title ? (
                    <div className={`mt-0.5 line-clamp-2 break-words text-sm font-semibold leading-snug ${isOwn ? 'text-white' : 'text-zinc-900 dark:text-zinc-100'}`}>
                        {preview.title}
                    </div>
                ) : null}
                {loading && !preview.description ? (
                    <div className={`mt-1 h-3 w-2/3 rounded ${skeletonSoftClass}`} />
                ) : preview.description ? (
                    <div className={`mt-0.5 line-clamp-2 break-words text-xs ${isOwn ? 'text-white/80' : 'text-zinc-500 dark:text-zinc-400'}`}>
                        {preview.description}
                    </div>
                ) : null}
            </div>
        </a>
    );
}
