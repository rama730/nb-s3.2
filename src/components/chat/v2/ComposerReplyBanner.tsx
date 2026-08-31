'use client';

import { CornerUpLeft, X } from 'lucide-react';
import type { MessageWithSender } from '@/app/actions/messaging';
import { getReplyPreviewBadge, getReplyPreviewText } from '@/lib/messages/reply-preview';
import { buildIdentityPresentation } from '@/lib/ui/identity';
import { cn } from '@/lib/utils';

interface ComposerReplyBannerProps {
    replyTarget: MessageWithSender;
    surface: 'page' | 'popup';
    onClearReply: () => void;
}

export function ComposerReplyBanner({
    replyTarget,
    surface,
    onClearReply,
}: ComposerReplyBannerProps) {
    const replyTargetBadge = getReplyPreviewBadge(replyTarget);
    const replyTargetPreviewText = getReplyPreviewText(replyTarget);

    return (
        <div className="pointer-events-auto mb-2 flex items-start justify-between gap-3 rounded-xl border border-zinc-200/90 bg-white px-3 py-2.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    <CornerUpLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            Replying to
                        </div>
                        <div className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                            {buildIdentityPresentation(replyTarget.sender, { fallbackDisplayName: replyTarget.replyTo?.senderName ?? 'Message' }).displayName}
                        </div>
                        {replyTargetBadge ? (
                            <span className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
                                {replyTargetBadge}
                            </span>
                        ) : null}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-200">
                        {replyTargetPreviewText}
                    </div>
                </div>
            </div>
            <button
                type="button"
                onClick={onClearReply}
                className={cn(
                    'rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
                    surface === 'popup' && 'mt-0.5',
                )}
                aria-label="Clear reply target"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
