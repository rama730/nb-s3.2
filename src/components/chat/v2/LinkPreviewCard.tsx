'use client';

import Image from 'next/image';
import type { LinkPreview } from '@/hooks/useLinkPreview';

interface LinkPreviewCardProps {
    preview: LinkPreview;
    isOwn: boolean;
}

export function LinkPreviewCard({ preview, isOwn }: LinkPreviewCardProps) {
    if (!preview.title && !preview.description && !preview.image) return null;

    return (
        <a
            href={preview.url}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className={`mt-2 block overflow-hidden rounded-lg border ${
                isOwn
                    ? 'border-white/20 bg-white/10'
                    : 'border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50'
            }`}
        >
            {preview.image && (
                <div className="h-36 w-full overflow-hidden">
                    <Image
                        src={preview.image}
                        alt=""
                        width={400}
                        height={200}
                        unoptimized
                        loading="lazy"
                        className="h-full w-full object-cover"
                    />
                </div>
            )}
            <div className="p-2.5">
                <div className={`text-[10px] ${isOwn ? 'text-white/60' : 'text-zinc-400'}`}>
                    {preview.domain}
                </div>
                {preview.title && (
                    <div className={`mt-0.5 text-sm font-semibold leading-snug line-clamp-2 ${isOwn ? 'text-white' : 'text-zinc-900 dark:text-zinc-100'}`}>
                        {preview.title}
                    </div>
                )}
                {preview.description && (
                    <div className={`mt-0.5 text-xs line-clamp-2 ${isOwn ? 'text-white/80' : 'text-zinc-500 dark:text-zinc-400'}`}>
                        {preview.description}
                    </div>
                )}
            </div>
        </a>
    );
}
