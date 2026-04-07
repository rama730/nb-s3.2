'use client';

import { X } from 'lucide-react';
import type { MessageWithSender } from '@/app/actions/messaging';
import { getReplyPreviewBadge, getReplyPreviewText } from '@/lib/messages/reply-preview';
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
        <div className="mb-2 flex items-start justify-between gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex min-w-0 flex-1 items-start gap-2">
                <div className="mt-0.5 w-1 self-stretch rounded-full bg-primary/60" />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                            Replying to
                        </div>
                        <div className="truncate text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                            {replyTarget.sender?.fullName || replyTarget.sender?.username || replyTarget.replyTo?.senderName || 'Message'}
                        </div>
                        {replyTargetBadge ? (
                            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                {replyTargetBadge}
                            </span>
                        ) : null}
                    </div>
                    <div className="mt-1 line-clamp-2 text-sm text-zinc-900 dark:text-zinc-100">
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
