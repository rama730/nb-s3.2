'use client';

import { FileText, Film, RotateCcw, X } from 'lucide-react';
import type { PendingAttachment } from './message-composer-v2-shared';
import { cn } from '@/lib/utils';

interface ComposerAttachmentsPanelProps {
    attachments: PendingAttachment[];
    maxUploadRetries: number;
    onRemoveAttachment: (attachmentId: string) => void;
    onRetryAttachment: (attachmentId: string) => void;
}

export function ComposerAttachmentsPanel({
    attachments,
    maxUploadRetries,
    onRemoveAttachment,
    onRetryAttachment,
}: ComposerAttachmentsPanelProps) {
    if (attachments.length === 0) {
        return null;
    }

    return (
        <div className="mb-3 space-y-2 pointer-events-auto">
            <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Attachments</div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
                {attachments.map((attachment) => {
                    const hasRetriesRemaining = attachment.attempts < maxUploadRetries;
                    const isVideo = attachment.file.type.startsWith('video/');

                    return (
                        <div
                            key={attachment.id}
                            className="group relative flex-none h-16 w-16 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 transition-all select-none"
                            title={attachment.file.name}
                        >
                            {/* PREVIEW */}
                            {attachment.preview ? (
                                isVideo ? (
                                    <div className="h-full w-full relative bg-black">
                                        <video
                                            src={attachment.preview}
                                            className="h-full w-full object-cover opacity-75"
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <Film className="h-4 w-4 text-white/80 drop-shadow-md" />
                                        </div>
                                    </div>
                                ) : (
                                    /* eslint-disable-next-line @next/next/no-img-element */
                                    <img
                                        src={attachment.preview}
                                        alt=""
                                        className="h-full w-full object-cover"
                                    />
                                )
                            ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                    <FileText className="h-6 w-6 text-zinc-400" />
                                </div>
                            )}

                            {/* UPLOADING STATE (Circular Progress overlay) */}
                            {attachment.status === 'uploading' && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
                                    <div className="relative flex h-8 w-8 items-center justify-center">
                                        <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
                                            <circle cx="18" cy="18" r="16" fill="none" className="stroke-white/20" strokeWidth="3" />
                                            <circle
                                                cx="18" cy="18" r="16"
                                                fill="none"
                                                className="stroke-white transition-all duration-150"
                                                strokeWidth="3"
                                                strokeDasharray="100"
                                                strokeDashoffset={100 - (attachment.progress || 0)}
                                                strokeLinecap="round"
                                            />
                                        </svg>
                                    </div>
                                </div>
                            )}

                            {/* FAILED STATE */}
                            {attachment.status === 'failed' && (
                                <div className="absolute inset-0 flex items-center justify-center bg-red-500/80 backdrop-blur-[1px]">
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); onRetryAttachment(attachment.id); }}
                                        disabled={!hasRetriesRemaining}
                                        className="rounded-full bg-white/20 p-1.5 text-white hover:bg-white/30 transition-colors"
                                        aria-label="Retry upload"
                                    >
                                        <RotateCcw className="h-4 w-4" />
                                    </button>
                                </div>
                            )}

                            {/* REMOVE BUTTON (Hover) */}
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onRemoveAttachment(attachment.id); }}
                                className={cn(
                                    "absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white shadow-sm ring-1 ring-white/20 backdrop-blur-sm transition-all hover:bg-black/80",
                                    "opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100",
                                    (attachment.status === 'uploading' || attachment.status === 'failed') && "opacity-100 scale-100" // Always show X if uploading/failed so they can cancel
                                )}
                                aria-label="Remove attachment"
                            >
                                <X className="h-2.5 w-2.5" />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
