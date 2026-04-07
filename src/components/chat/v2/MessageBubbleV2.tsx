'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { format } from 'date-fns';
import {
    AlertCircle,
    Check,
    CheckCheck,
    Clock3,
    Copy,
    CornerUpLeft,
    Flag,
    MoreVertical,
    Pencil,
    Pin,
    PinOff,
    SendHorizonal,
    SmilePlus,
    Trash2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import type { MessageWithSender } from '@/app/actions/messaging';
import { deleteMessageV2, editMessageV2 } from '@/app/actions/messaging/v2';
import {
    hideThreadMessageForViewer,
    patchThreadMessage,
} from '@/lib/messages/v2-cache';
import { refreshConversationCache } from '@/lib/messages/v2-refresh';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    MessageAttachmentsV2,
    MessageTextContentV2,
    type ChatAttachmentV2,
} from './message-rendering';
import { ReactionQuickBar } from './ReactionQuickBar';
import { ReactionPillRow } from './ReactionPillRow';
import { LinkPreviewCard } from './LinkPreviewCard';
import { ReportMessageDialog } from './ReportMessageDialog';
import { useLinkPreview, extractFirstUrl } from '@/hooks/useLinkPreview';

interface MessageBubbleV2Props {
    message: MessageWithSender;
    showAvatar?: boolean;
    onReply?: (message: MessageWithSender) => void;
    onTogglePin?: (messageId: string, pinned: boolean) => void;
    onFocusMessage?: (messageId: string) => void;
}

function getApplicationStatusLabel(status: string | null) {
    if (status === 'accepted') return 'Accepted';
    if (status === 'rejected') return 'Rejected';
    if (status === 'project_deleted') return 'Project has been deleted';
    return 'Pending';
}

export const MessageBubbleV2 = React.memo(function MessageBubbleV2({
    message,
    showAvatar = true,
    onReply,
    onTogglePin,
    onFocusMessage,
}: MessageBubbleV2Props) {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const isOwn = message.senderId === user?.id;
    const isDeleted = Boolean(message.deletedAt);
    const metadata = (message.metadata || {}) as Record<string, unknown>;
    const isPinned = Boolean(metadata.pinned);
    const isApplication = metadata.isApplication === true;
    const applicationStatus = typeof metadata.status === 'string' ? metadata.status : null;
    const deliveryState = typeof metadata.deliveryState === 'string' ? metadata.deliveryState : undefined;
    const [isEditing, setIsEditing] = useState(false);
    const [draftContent, setDraftContent] = useState(message.content || '');
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [hiddenForViewer, setHiddenForViewer] = useState(false);
    const [showReactionBar, setShowReactionBar] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);
    const [localReactions, setLocalReactions] = useState<Array<{emoji: string; count: number; viewerReacted: boolean}>>([]);
    const [reactionsLoaded, setReactionsLoaded] = useState(false);

    // Load reactions from DB on mount (once)
    useEffect(() => {
        if (isDeleted) return;
        let cancelled = false;
        import('@/app/actions/messaging/features').then(({ getMessageReactions }) => {
            getMessageReactions([message.id]).then((result) => {
                if (cancelled) return;
                if (result.success && result.reactions?.[message.id]) {
                    setLocalReactions(result.reactions[message.id].map((r) => ({ emoji: r.emoji, count: r.count, viewerReacted: r.reacted })));
                }
                setReactionsLoaded(true);
            }).catch(() => {});
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [message.id, isDeleted]);

    const reactionSummary = localReactions;

    const firstUrl = extractFirstUrl(message.content);
    const { data: linkPreview } = useLinkPreview(isDeleted ? null : firstUrl);

    const attachments = useMemo<ChatAttachmentV2[]>(
        () => (message.attachments || []) as ChatAttachmentV2[],
        [message.attachments],
    );
    const canEditMessage = isOwn && !isDeleted && Boolean(message.content);
    const canReply = !isDeleted;

    useEffect(() => {
        if (!isEditing) {
            setDraftContent(message.content || '');
        }
    }, [isEditing, message.content]);

    useEffect(() => {
        setIsEditing(false);
        setIsActionLoading(false);
        setHiddenForViewer(false);
        setDraftContent(message.content || '');
    }, [message.content, message.id]);

    const syncAfterMessageAction = useCallback(async () => {
        await refreshConversationCache(queryClient, message.conversationId);
    }, [message.conversationId, queryClient]);

    const handleReaction = useCallback(async (emoji: string) => {
        setShowReactionBar(false);

        // Optimistic update
        setLocalReactions((prev) => {
            const existing = prev.find((r) => r.emoji === emoji);
            if (existing?.viewerReacted) {
                // Remove our reaction
                const newCount = existing.count - 1;
                if (newCount <= 0) return prev.filter((r) => r.emoji !== emoji);
                return prev.map((r) => r.emoji === emoji ? { ...r, count: newCount, viewerReacted: false } : r);
            }
            if (existing) {
                return prev.map((r) => r.emoji === emoji ? { ...r, count: r.count + 1, viewerReacted: true } : r);
            }
            return [...prev, { emoji, count: 1, viewerReacted: true }];
        });

        try {
            const { toggleReaction, getMessageReactions } = await import('@/app/actions/messaging/features');
            const result = await toggleReaction(message.id, emoji);
            if (!result.success) {
                toast.error(result.error || 'Failed to react');
            }
            // Sync with server truth
            const fresh = await getMessageReactions([message.id]);
            if (fresh.success && fresh.reactions?.[message.id]) {
                setLocalReactions(fresh.reactions[message.id].map((r) => ({ emoji: r.emoji, count: r.count, viewerReacted: r.reacted })));
            }
        } catch {
            toast.error('Failed to react');
        }
    }, [message.id]);

    const handleSaveEdit = useCallback(async () => {
        if (!canEditMessage) return;
        const normalized = draftContent.trim();
        if (!normalized) {
            toast.error('Message cannot be empty');
            return;
        }
        if (normalized === (message.content || '').trim()) {
            setIsEditing(false);
            return;
        }

        setIsActionLoading(true);
        try {
            const result = await editMessageV2(message.id, normalized);
            if (!result.success) {
                toast.error(result.error || 'Failed to edit message');
                return;
            }
            patchThreadMessage(queryClient, message.conversationId, message.id, (current) => ({
                ...current,
                content: normalized,
                editedAt: new Date(),
            }));
            setIsEditing(false);
            await syncAfterMessageAction();
        } finally {
            setIsActionLoading(false);
        }
    }, [canEditMessage, draftContent, message.content, message.conversationId, message.id, queryClient, syncAfterMessageAction]);

    const handleDeleteForMe = useCallback(async () => {
        setIsActionLoading(true);
        try {
            const result = await deleteMessageV2(message.id, 'me');
            if (!result.success) {
                toast.error(result.error || 'Failed to delete message');
                return;
            }
            setHiddenForViewer(true);
            hideThreadMessageForViewer(queryClient, message.conversationId, message.id);
            await syncAfterMessageAction();
        } finally {
            setIsActionLoading(false);
        }
    }, [message.conversationId, message.id, queryClient, syncAfterMessageAction]);

    const handleUnsendForEveryone = useCallback(async () => {
        setIsActionLoading(true);
        try {
            const result = await deleteMessageV2(message.id, 'everyone');
            if (!result.success) {
                toast.error(result.error || 'Failed to unsend message');
                return;
            }
            patchThreadMessage(queryClient, message.conversationId, message.id, (current) => ({
                ...current,
                content: null,
                deletedAt: new Date(),
                metadata: {
                    ...(current.metadata || {}),
                    deletionScope: 'everyone',
                },
            }));
            setIsEditing(false);
            await syncAfterMessageAction();
        } finally {
            setIsActionLoading(false);
        }
    }, [message.conversationId, message.id, queryClient, syncAfterMessageAction]);

    if (message.type === 'system') {
        return (
            <div className="my-4 flex w-full justify-center">
                <span className="flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-400">
                    {message.content}
                    <span className="text-[10px] opacity-60">• {format(new Date(message.createdAt), 'p')}</span>
                </span>
            </div>
        );
    }

    if (isDeleted) {
        return (
            <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                <div className="rounded-2xl bg-zinc-100 px-4 py-2 text-sm italic text-zinc-400 dark:bg-zinc-800">
                    Message deleted
                </div>
            </div>
        );
    }

    if (hiddenForViewer) {
        return null;
    }

    const isOptimistic = isOwn && (deliveryState === 'sending' || deliveryState === 'queued');

    return (
        <>
        <div
            className={`flex w-full ${isOwn ? 'justify-end' : 'justify-start'}`}
            style={isOptimistic ? { animation: 'message-appear 250ms ease-out' } : undefined}
        >
            <div className={`group flex max-w-full items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                {!isOwn && showAvatar ? (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full app-accent-gradient">
                        {message.sender?.avatarUrl ? (
                            <Image
                                src={message.sender.avatarUrl}
                                alt={message.sender.fullName || ''}
                                width={32}
                                height={32}
                                unoptimized
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <span className="text-xs font-medium text-white">
                                {(message.sender?.fullName || message.sender?.username || '?')[0].toUpperCase()}
                            </span>
                        )}
                    </div>
                ) : !isOwn && !showAvatar ? (
                    <div className="w-8 shrink-0" />
                ) : null}

                <div className={`flex min-w-0 max-w-[78%] flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                    <div className={`flex items-end gap-1 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                        <div
                            className={`relative min-w-0 rounded-2xl px-3 py-2 shadow-sm ${
                                isOwn
                                    ? 'rounded-br-md bg-primary text-primary-foreground'
                                    : 'rounded-bl-md border border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100'
                            }`}
                        >
                            {message.replyTo ? (
                                <button
                                    type="button"
                                    onClick={() => onFocusMessage?.(message.replyTo!.id)}
                                    className={`mb-2 w-full rounded-xl border px-2 py-1 text-left text-xs ${
                                        isOwn
                                            ? 'border-white/20 bg-white/10 text-primary-foreground/90'
                                            : 'border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300'
                                    }`}
                                >
                                    <div className="font-medium">{message.replyTo.senderName || 'Reply'}</div>
                                    <div className="truncate">{message.replyTo.content || '[attachment]'}</div>
                                </button>
                            ) : null}

                            {(isPinned || isApplication) ? (
                                <div className="mb-1 flex items-center gap-2">
                                    {isPinned ? (
                                        <span className={`text-[10px] font-bold uppercase ${isOwn ? 'text-white/80' : 'text-amber-600 dark:text-amber-400'}`}>
                                            Pinned
                                        </span>
                                    ) : null}
                                    {isApplication ? (
                                        <span className={`text-[10px] font-bold uppercase opacity-70 ${isOwn ? 'text-white' : 'text-zinc-500 dark:text-zinc-300'}`}>
                                            Application status: {getApplicationStatusLabel(applicationStatus)}
                                        </span>
                                    ) : null}
                                </div>
                            ) : null}

                            {isEditing ? (
                                <div className="rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
                                    <textarea
                                        value={draftContent}
                                        onChange={(event) => setDraftContent(event.target.value)}
                                        rows={3}
                                        maxLength={4000}
                                        className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-ring dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                                    />
                                    <div className="mt-2 flex items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
                                            onClick={() => {
                                                setDraftContent(message.content || '');
                                                setIsEditing(false);
                                            }}
                                            disabled={isActionLoading}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="button"
                                            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-60"
                                            onClick={() => void handleSaveEdit()}
                                            disabled={isActionLoading}
                                        >
                                            {isActionLoading ? 'Saving...' : 'Save'}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {message.content ? (
                                        <MessageTextContentV2
                                            content={message.content}
                                            isOwn={isOwn}
                                            isApplication={isApplication}
                                        />
                                    ) : null}
                                    {attachments.length > 0 ? <MessageAttachmentsV2 attachments={attachments} /> : null}
                                    {linkPreview && <LinkPreviewCard preview={linkPreview} isOwn={isOwn} />}
                                </>
                            )}

                            {showReactionBar && (
                                <ReactionQuickBar
                                    onReact={handleReaction}
                                    onClose={() => setShowReactionBar(false)}
                                />
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowReactionBar((prev) => !prev)}
                            className="rounded-full p-1 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                            aria-label="Add reaction"
                        >
                            <SmilePlus className="h-4 w-4" />
                        </button>

                        <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    className="rounded-full p-1 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                                    aria-label="Message actions"
                                    disabled={isActionLoading}
                                >
                                    <MoreVertical className="h-4 w-4" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align={isOwn ? 'end' : 'start'}>
                                {canEditMessage ? (
                                    <DropdownMenuItem onClick={() => setIsEditing(true)} disabled={isActionLoading}>
                                        <Pencil className="mr-2 h-4 w-4" />
                                        Edit
                                    </DropdownMenuItem>
                                ) : null}
                                {onReply && canReply ? (
                                    <DropdownMenuItem onClick={() => onReply(message)} disabled={isActionLoading}>
                                        <CornerUpLeft className="mr-2 h-4 w-4" />
                                        Reply
                                    </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuItem
                                    onClick={async () => {
                                        try {
                                            await navigator.clipboard.writeText(message.content || '');
                                            toast.success('Copied message');
                                        } catch (error) {
                                            console.error('[messages-v2] copy message failed', error);
                                            toast.error('Failed to copy message');
                                        }
                                    }}
                                >
                                    <Copy className="mr-2 h-4 w-4" />
                                    Copy
                                </DropdownMenuItem>
                                {onTogglePin ? (
                                    <DropdownMenuItem onClick={() => onTogglePin(message.id, !isPinned)} disabled={isActionLoading}>
                                        {isPinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
                                        {isPinned ? 'Unpin' : 'Pin'}
                                    </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuItem onClick={() => void handleDeleteForMe()} disabled={isActionLoading}>
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete for me
                                </DropdownMenuItem>
                                {!isOwn && (
                                    <DropdownMenuItem onClick={() => setReportOpen(true)} className="text-red-600 dark:text-red-400">
                                        <Flag className="mr-2 h-4 w-4" />
                                        Report
                                    </DropdownMenuItem>
                                )}
                                {isOwn ? (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                            onClick={() => void handleUnsendForEveryone()}
                                            disabled={isActionLoading}
                                            className="text-red-600 dark:text-red-400"
                                        >
                                            <Trash2 className="mr-2 h-4 w-4" />
                                            Unsend for everyone
                                        </DropdownMenuItem>
                                    </>
                                ) : null}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    {reactionSummary.length > 0 && (
                        <ReactionPillRow
                            reactions={reactionSummary}
                            onToggleReaction={handleReaction}
                            onShowDetail={() => {}}
                        />
                    )}

                    <div className={`mt-1 flex items-center gap-1 px-1 text-[11px] text-zinc-400 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                        <span title={new Date(message.createdAt).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}>
                            {format(new Date(message.createdAt), 'p')}
                        </span>
                        {isOwn ? <DeliveryIndicator deliveryState={deliveryState} /> : null}
                        {message.editedAt ? <span>(edited)</span> : null}
                    </div>
                </div>
            </div>
        </div>
        {reportOpen && <ReportMessageDialog messageId={message.id} isOpen={reportOpen} onClose={() => setReportOpen(false)} />}
        </>
    );
}, (prev, next) => {
    return (
        prev.message.id === next.message.id &&
        prev.message.content === next.message.content &&
        prev.message.editedAt === next.message.editedAt &&
        prev.message.deletedAt === next.message.deletedAt &&
        (prev.message.metadata as any)?.pinned === (next.message.metadata as any)?.pinned &&
        JSON.stringify((prev.message.metadata as any)?.reactionSummary) === JSON.stringify((next.message.metadata as any)?.reactionSummary) &&
        prev.showAvatar === next.showAvatar &&
        prev.onReply === next.onReply &&
        prev.onTogglePin === next.onTogglePin &&
        prev.onFocusMessage === next.onFocusMessage
    );
});

export function DeliveryIndicator({ deliveryState }: { deliveryState?: string }) {
    if (!deliveryState) return null;
    if (deliveryState === 'sending') {
        return (
            <SendHorizonal
                className="h-3.5 w-3.5 text-zinc-400"
                style={{ animation: 'delivery-pulse 1.5s ease-in-out infinite' }}
            />
        );
    }
    if (deliveryState === 'queued') {
        return <Clock3 className="h-3.5 w-3.5 text-zinc-400" />;
    }
    if (deliveryState === 'failed') {
        return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
    }
    if (deliveryState === 'read') {
        return <CheckCheck className="h-3.5 w-3.5 text-blue-500" />;
    }
    if (deliveryState === 'delivered') {
        return <CheckCheck className="h-3.5 w-3.5 text-zinc-400" />;
    }
    if (deliveryState === 'sent') {
        return <Check className="h-3.5 w-3.5 text-zinc-400" />;
    }
    return <Check className="h-3.5 w-3.5" />;
}
