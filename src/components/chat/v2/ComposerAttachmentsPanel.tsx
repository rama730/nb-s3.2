'use client';

import Image from 'next/image';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
import type { PendingAttachment } from './message-composer-v2-shared';

interface ComposerAttachmentsPanelProps {
    attachments: PendingAttachment[];
    uploadsPaused: boolean;
    maxUploadRetries: number;
    onTogglePaused: () => void;
    onRemoveAttachment: (attachmentId: string) => void;
    onRetryAttachment: (attachmentId: string) => void;
}

export function ComposerAttachmentsPanel({
    attachments,
    uploadsPaused,
    maxUploadRetries,
    onTogglePaused,
    onRemoveAttachment,
    onRetryAttachment,
}: ComposerAttachmentsPanelProps) {
    if (attachments.length === 0) {
        return null;
    }

    return (
        <div className="mb-3 space-y-2">
            <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Attachments</div>
                <button
                    type="button"
                    onClick={onTogglePaused}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                    {uploadsPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                    {uploadsPaused ? 'Resume uploads' : 'Pause uploads'}
                </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
                {attachments.map((attachment) => {
                    const hasRetriesRemaining = attachment.attempts < maxUploadRetries;

                    return (
                        <div key={attachment.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-900">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                        {attachment.file.name}
                                    </div>
                                    <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                        {attachment.status === 'uploading'
                                            ? 'Uploading...'
                                            : attachment.status === 'uploaded'
                                                ? 'Ready'
                                                : attachment.error || 'Waiting'}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onRemoveAttachment(attachment.id)}
                                    className="rounded-full p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                                    aria-label={`Remove ${attachment.file.name}`}
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            {attachment.preview ? (
                                <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                                    <Image
                                        src={attachment.preview}
                                        alt={attachment.file.name}
                                        width={320}
                                        height={180}
                                        unoptimized
                                        className="h-32 w-full object-cover"
                                    />
                                </div>
                            ) : null}
                            {attachment.status === 'uploading' ? (
                                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                                    <div
                                        className="h-full rounded-full bg-primary transition-[width] duration-150"
                                        style={{ width: `${attachment.progress || 0}%` }}
                                    />
                                </div>
                            ) : null}
                            {attachment.status === 'uploaded' ? (
                                <div className="mt-2 h-1 w-full rounded-full bg-emerald-500" />
                            ) : null}
                            {attachment.status === 'failed' ? (
                                <div className="mt-2 flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => onRetryAttachment(attachment.id)}
                                        disabled={!hasRetriesRemaining}
                                        aria-disabled={!hasRetriesRemaining}
                                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                                    >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                        Retry
                                    </button>
                                    {!hasRetriesRemaining ? (
                                        <span className="text-xs text-amber-600 dark:text-amber-400">
                                            Max retries exceeded
                                        </span>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
