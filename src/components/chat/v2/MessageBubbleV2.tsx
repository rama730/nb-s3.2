'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
    AlertCircle,
    BriefcaseBusiness,
    ChevronDown,
    Clock3,
    Copy,
    CornerUpLeft,
    ExternalLink,
    Flag,
    Lock,
    MoreVertical,
    Pencil,
    Pin,
    PinOff,
    SendHorizonal,
    SmilePlus,
    Trash2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { deleteMessage, editMessage, type MessageWithSender } from '@/app/actions/messaging';
import { cn } from '@/lib/utils';
import { Message, MessageAvatar, MessageContent, MessageHeader, MessageFooter, Bubble } from '@/components/ui/message';
import {
    hideThreadMessageForViewer,
    patchConversationLastMessageFromMessage,
    patchThreadMessage,
} from '@/lib/messages/v2-cache';
import { refreshConversationCache } from '@/lib/messages/v2-refresh';
import {
    normalizeMessageReactionSummary,
} from '@/lib/messages/reactions';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    CodeSegmentV2,
    MESSAGE_TEXT_BASE_CLASS,
    renderTextWithMentions,
} from './message-rendering';
import {
    MessageAttachmentsV2,
    type ChatAttachmentV2,
} from './message-attachments';
import { ApplicationSystemCardV2 } from './ApplicationSystemCardV2';
import { parseMessageSegments, type MessageSegment } from '@/lib/messages/code-snippets';
import {
    getReplyPreviewBadge,
    getReplyPreviewText,
} from '@/lib/messages/reply-preview';
import {
    getMessageContextChipsFromMetadata,
    getStructuredMessageFromMetadata,
    type WorkflowResolutionAction,
} from '@/lib/messages/structured';
import { ReactionQuickBar } from './ReactionQuickBar';
import { ReactionPillRow } from './ReactionPillRow';
import { LinkPreviewCard } from './LinkPreviewCard';
import { useLinkPreview, extractFirstUrl, type LinkPreview } from '@/hooks/useLinkPreview';
import { MessageContextChipRowV2 } from './MessageContextChipRowV2';
import { StructuredMessageCardV2 } from './StructuredMessageCardV2';
import { buildIdentityPresentation } from '@/lib/ui/identity';
import type { MessageLinkedWorkSummary } from '@/lib/messages/linked-work';
import { useMessagesV2OutboxStore } from '@/stores/messagesV2OutboxStore';

interface MessageBubbleV2Props {
    message: MessageWithSender;
    linkedWork?: MessageLinkedWorkSummary[];
    surface?: 'page' | 'popup';
    onReply?: (message: MessageWithSender) => void;
    onTogglePin?: (messageId: string, pinned: boolean) => void;
    onFocusMessage?: (messageId: string) => void;
    onContentLoad?: () => void;
    isFocusedReplyTarget?: boolean;
    isConsecutiveFromPrev?: boolean;
    isConsecutiveToNext?: boolean;
    showTimestamp?: boolean;
    conversationType?: 'dm' | 'group' | 'project_group';
    isLatestMessage?: boolean;
    onTriggerDialog?: (message: MessageWithSender, type: 'report') => void;
    onToggleReaction?: (messageId: string, emoji: string) => Promise<unknown>;
    isReactionLoading?: boolean;
    onResolveWorkflow?: (workflowItemId: string, action: WorkflowResolutionAction) => Promise<unknown>;
    isWorkflowActionLoading?: boolean;
}

function createPendingLinkPreview(url: string): LinkPreview | null {
    try {
        return {
            title: null,
            description: null,
            image: null,
            domain: new URL(url).hostname,
            url,
        };
    } catch {
        return null;
    }
}

function isOnlyEmojis(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const emojiRegex = /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\u20e3\ufe0f\u200b\u200c\u200d]+$/u;
    const hasAlphanumeric = /[a-zA-Z0-9]/;
    return emojiRegex.test(trimmed) && !hasAlphanumeric.test(trimmed);
}


function getLinkedWorkDisplayLabel(link: MessageLinkedWorkSummary) {
    if (link.targetType !== 'follow_up') return link.label;
    const dueAt = typeof link.metadata?.dueAt === 'string' ? link.metadata.dueAt : null;
    if (!dueAt) return link.label;

    const dueDate = new Date(dueAt);
    if (Number.isNaN(dueDate.getTime())) return link.label;

    return `Follow-up ${format(dueDate, 'MMM d')}`;
}

export const MessageBubbleV2 = React.memo(function MessageBubbleV2({
    message,
    linkedWork = [],
    onReply,
    onTogglePin,
    onFocusMessage,
    onContentLoad,
    isFocusedReplyTarget = false,
    isConsecutiveFromPrev = false,
    isConsecutiveToNext = false,
    showTimestamp = false,
    conversationType = 'dm',
    isLatestMessage = false,
    onTriggerDialog,
    onToggleReaction,
    isReactionLoading = false,
    onResolveWorkflow,
    isWorkflowActionLoading = false,
}: MessageBubbleV2Props) {
    const queryClient = useQueryClient();
    const router = useRouter();
    const { user } = useAuth();
    const isOwn = message.senderId === user?.id;
    const isDeleted = Boolean(message.deletedAt);
    const metadata = useMemo(
        () => (message.metadata || {}) as Record<string, unknown>,
        [message.metadata],
    );
    const isPinned = Boolean(metadata.pinned);
    const structured = useMemo(() => getStructuredMessageFromMetadata(metadata), [metadata]);
    const isApplication = metadata.isApplication === true || structured?.kind === 'project_invite';
    const deliveryState = typeof metadata.deliveryState === 'string' ? metadata.deliveryState : undefined;
    const contextChips = useMemo(() => getMessageContextChipsFromMetadata(metadata), [metadata]);
    const [isEditing, setIsEditing] = useState(false);
    const [draftContent, setDraftContent] = useState(message.content || '');
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [hiddenForViewer, setHiddenForViewer] = useState(false);
    const [showReactionBar, setShowReactionBar] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const reactionTriggerRef = useRef<HTMLButtonElement | null>(null);
    const [linkedWorkExpanded, setLinkedWorkExpanded] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [swipeOffset, setSwipeOffset] = useState(0);
    const [isSwiping, setIsSwiping] = useState(false);
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const isSwipeActive = useRef(false);
    const swipeOffsetRef = useRef(0);
    const replySwipeDirection = isOwn ? 1 : -1;

    useEffect(() => {
        if (!showReactionBar && !menuOpen) return;
        // ponytail: capture catches the virtualized thread scroller without a shared scroll state.
        const dismissOverlays = () => {
            setShowReactionBar(false);
            setMenuOpen(false);
        };
        window.addEventListener('scroll', dismissOverlays, true);
        return () => window.removeEventListener('scroll', dismissOverlays, true);
    }, [menuOpen, showReactionBar]);

    const resetSwipe = () => {
        swipeOffsetRef.current = 0;
        setSwipeOffset(0);
        setIsSwiping(false);
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        if (!onReply || !canReply) return;
        const touch = e.touches[0];
        if (!touch) return;
        touchStartX.current = touch.clientX;
        touchStartY.current = touch.clientY;
        isSwipeActive.current = true;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!isSwipeActive.current) return;
        const touch = e.touches[0];
        if (!touch) return;

        const deltaX = touch.clientX - touchStartX.current;
        const deltaY = touch.clientY - touchStartY.current;

        if (Math.abs(deltaY) > Math.abs(deltaX)) {
            isSwipeActive.current = false;
            resetSwipe();
            return;
        }

        if (Math.abs(deltaX) > 5) {
            if (deltaX * replySwipeDirection <= 0) {
                resetSwipe();
                return;
            }
            if (e.cancelable) {
                e.preventDefault();
            }
            setIsSwiping(true);
            const offset = Math.max(-80, Math.min(80, deltaX));
            swipeOffsetRef.current = offset;
            setSwipeOffset(offset);
        }
    };

    const handleTouchEnd = () => {
        if (!isSwipeActive.current) return;
        isSwipeActive.current = false;
        setIsSwiping(false);

        if (swipeOffsetRef.current * replySwipeDirection >= 50) {
            onReply?.(message);
            if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
                window.navigator.vibrate(15);
            }
        }
        resetSwipe();
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!onReply || !canReply) return;
        if (e.button !== 0) return; // Only left click
        const target = e.target as HTMLElement;
        if (
            target.closest('a') ||
            target.closest('button') ||
            target.closest('select') ||
            target.closest('textarea') ||
            target.closest('input')
        ) {
            return;
        }
        touchStartX.current = e.clientX;
        touchStartY.current = e.clientY;
        isSwipeActive.current = true;
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isSwipeActive.current) return;
        const deltaX = e.clientX - touchStartX.current;
        const deltaY = e.clientY - touchStartY.current;

        if (Math.abs(deltaY) > Math.abs(deltaX)) {
            isSwipeActive.current = false;
            resetSwipe();
            return;
        }

        if (Math.abs(deltaX) > 5) {
            if (deltaX * replySwipeDirection <= 0) {
                resetSwipe();
                return;
            }
            e.preventDefault();
            setIsSwiping(true);
            const offset = Math.max(-80, Math.min(80, deltaX));
            swipeOffsetRef.current = offset;
            setSwipeOffset(offset);
        }
    };

    const handleMouseUp = () => {
        if (!isSwipeActive.current) return;
        isSwipeActive.current = false;
        setIsSwiping(false);

        if (swipeOffsetRef.current * replySwipeDirection >= 50) {
            onReply?.(message);
        }
        resetSwipe();
    };

    const handleMouseLeave = () => {
        if (!isSwipeActive.current) return;
        isSwipeActive.current = false;
        resetSwipe();
    };
    const reactionSummary = useMemo(
        () => normalizeMessageReactionSummary(metadata.reactionSummary),
        [metadata.reactionSummary],
    );
    const visibleLinkedWork = linkedWorkExpanded ? linkedWork : linkedWork.slice(0, 2);

    const firstUrl = extractFirstUrl(message.content);
    const linkPreviewQuery = useLinkPreview(isDeleted ? null : firstUrl);
    const linkPreview = linkPreviewQuery.data ?? null;
    const pendingLinkPreview = useMemo(
        () => (!linkPreview && firstUrl && linkPreviewQuery.isFetching ? createPendingLinkPreview(firstUrl) : null),
        [firstUrl, linkPreview, linkPreviewQuery.isFetching],
    );
    const renderedLinkPreview = linkPreview ?? pendingLinkPreview;

    const attachments = useMemo<ChatAttachmentV2[]>(
        () => (message.attachments || []) as ChatAttachmentV2[],
        [message.attachments],
    );
    const parsedSegments = useMemo(() => {
        if (!message.content) return [];
        return parseMessageSegments(message.content);
    }, [message.content]);

    const hasTextBubbleContent = useMemo(() => {
        return Boolean(
            message.content ||
            message.replyTo ||
            isPinned ||
            isApplication ||
            structured
        );
    }, [message.content, message.replyTo, isPinned, isApplication, structured]);

    const segmentsToRender = useMemo(() => {
        if (parsedSegments.length > 0) return parsedSegments;
        if (hasTextBubbleContent) {
            return [{ type: 'text', content: '', language: null } as MessageSegment];
        }
        return [];
    }, [parsedSegments, hasTextBubbleContent]);

    const hasInlineTimestamp = useMemo(() => {
        return false;
    }, []);

    const canEditMessage = isOwn && !isDeleted && Boolean(message.content);
    const canReply = !isDeleted;
    const replyPreviewBadge = message.replyTo ? getReplyPreviewBadge(message.replyTo) : null;
    const replyPreviewText = message.replyTo ? getReplyPreviewText(message.replyTo) : null;
    const hasRichContent = Boolean(
        structured
        || message.replyTo
        || isApplication
        || contextChips.length > 0
        || linkedWork.length > 0
        || renderedLinkPreview,
    );

    useEffect(() => {
        if (linkPreview) {
            onContentLoad?.();
        }
    }, [linkPreview, onContentLoad]);

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

    const handleResolveWorkflow = useCallback(async (
        action: WorkflowResolutionAction,
    ) => {
        const workflowItemId = structured?.workflowItemId;
        if (!workflowItemId || isWorkflowActionLoading) {
            return;
        }

        try {
            await onResolveWorkflow?.(workflowItemId, action);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update workflow');
        }
    }, [onResolveWorkflow, structured?.workflowItemId, isWorkflowActionLoading]);

    const handleReaction = useCallback(async (emoji: string) => {
        if (isDeleted || isReactionLoading) {
            return;
        }

        setShowReactionBar(false);

        try {
            const existingReaction = reactionSummary.find(r => r.viewerReacted && r.emoji !== emoji);
            if (existingReaction) {
                await onToggleReaction?.(message.id, existingReaction.emoji);
            }
            await onToggleReaction?.(message.id, emoji);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to react');
        }
    }, [
        isDeleted,
        isReactionLoading,
        message.id,
        onToggleReaction,
        reactionSummary,
    ]);

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
            const result = await editMessage(message.id, normalized);
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
            const result = await deleteMessage(message.id, 'me');
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
            const result = await deleteMessage(message.id, 'everyone');
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
            patchConversationLastMessageFromMessage(queryClient, message.conversationId, {
                id: message.id,
                content: null,
                senderId: message.senderId,
                createdAt: message.createdAt,
                type: message.type,
                metadata: message.metadata,
                replyToMessageId: message.replyTo?.id ?? null,
                deletedAt: new Date(),
            });
            setIsEditing(false);
            await syncAfterMessageAction();
        } finally {
            setIsActionLoading(false);
        }
    }, [
        message.conversationId,
        message.createdAt,
        message.id,
        message.metadata,
        message.replyTo?.id,
        message.senderId,
        message.type,
        queryClient,
        syncAfterMessageAction,
    ]);

    if (message.type === 'system' && !structured && !isApplication) {
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
            <div className={`flex mt-[1px] mb-[1px] w-full ${isOwn ? 'justify-end' : 'justify-start'}`}>
                <div className="rounded-2xl bg-zinc-100 px-4 py-2 text-sm italic text-zinc-400 dark:bg-zinc-800">
                    This message was deleted
                </div>
            </div>
        );
    }

    if (hiddenForViewer) {
        return null;
    }

    const isOptimistic = isOwn && (deliveryState === 'sending' || deliveryState === 'queued');

    const hasFooter = Boolean((showTimestamp && !hasInlineTimestamp) || (isOwn && (isLatestMessage || ['failed', 'sending', 'queued'].includes(deliveryState || ''))));
    const needsReactionSpacer = reactionSummary.length > 0 && !hasFooter;

    return (
        <>
        <Message
            align={isOwn ? 'end' : 'start'}
            className={cn(
                'relative',
                isOptimistic && 'animate-[message-appear_250ms_ease-out]'
            )}
        >
            <div
                className={`group flex w-full min-w-0 items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                style={{
                    transform: swipeOffset !== 0 ? `translateX(${swipeOffset}px)` : undefined,
                    transition: isSwiping ? 'none' : 'transform 200ms ease-out',
                    touchAction: 'pan-y',
                }}
            >
                {!isOwn && conversationType !== 'dm' && (
                    <MessageAvatar className="w-8 h-8 select-none">
                        {!isConsecutiveFromPrev && (() => {
                            const senderIdentity = buildIdentityPresentation(message.sender);
                            return senderIdentity.avatarUrl ? (
                                <Image
                                    src={senderIdentity.avatarUrl}
                                    alt={senderIdentity.alt}
                                    width={32}
                                    height={32}
                                    className="h-8 w-8 rounded-full object-cover"
                                />
                            ) : (
                                <div className={cn("h-8 w-8 rounded-full text-white flex items-center justify-center text-xs font-semibold", senderIdentity.gradientClass)}>
                                    {senderIdentity.initials}
                                </div>
                            );
                        })()}
                    </MessageAvatar>
                )}

                <MessageContent
                    className="transition-[background-color,box-shadow] duration-200"
                >
                        {!isOwn && conversationType !== 'dm' && !isConsecutiveFromPrev && (
                            <MessageHeader className="mb-0.5">
                                <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                                    {buildIdentityPresentation(message.sender).displayName}
                                </span>
                            </MessageHeader>
                        )}
                        {isApplication ? (
                            <ApplicationSystemCardV2
                                message={message}
                                conversationId={message.conversationId}
                            />
                        ) : isEditing ? (
                            <Bubble
                                variant={isOwn ? 'default' : 'muted'}
                                align={isOwn ? 'end' : 'start'}
                                className={cn(
                                    'my-1',
                                    isOwn
                                        ? cn(isConsecutiveToNext && 'rounded-br-sm', isConsecutiveFromPrev && 'rounded-tr-sm')
                                        : cn(isConsecutiveToNext && 'rounded-bl-sm', isConsecutiveFromPrev && 'rounded-tl-sm')
                                )}
                            >
                                <div className="rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900">
                                    <textarea
                                        value={draftContent}
                                        onChange={(event) => setDraftContent(event.target.value)}
                                        rows={3}
                                        maxLength={4000}
                                        className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:outline-none   dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
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
                            </Bubble>
                        ) : (
                            <div className={cn(
                                "relative w-fit max-w-full flex flex-col gap-1",
                                isOwn ? "items-end" : "items-start",
                            )}>
                                {segmentsToRender.map((segment, index, arr) => {
                                    const isFirst = index === 0;
                                    const isLast = index === arr.length - 1;

                                    const renderPrefix = () => (
                                        <>
                                            {message.replyTo ? (
                                                <button
                                                    type="button"
                                                    onClick={() => onFocusMessage?.(message.replyTo!.id)}
                                                    className={cn(
                                                        'mb-2 w-full rounded-lg border px-3 py-2 text-left text-xs transition-[background-color,border-color,transform] duration-150 active:translate-y-px',
                                                        isOwn
                                                            ? 'border-white/15 bg-black/10 text-primary-foreground/90 hover:bg-black/15'
                                                            : 'border-zinc-200/90 bg-zinc-50/80 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:bg-zinc-800',
                                                    )}
                                                    title={replyPreviewText || 'Open original message'}
                                                    aria-label="Jump to original replied message"
                                                >
                                                    <div className="flex items-start gap-2">
                                                        <div className={cn('mt-0.5 w-0.5 self-stretch rounded-full', isOwn ? 'bg-white/55' : 'bg-zinc-400 dark:bg-zinc-500')} />
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center gap-1.5">
                                                                <CornerUpLeft className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
                                                                <div className="truncate font-medium">
                                                                    {message.replyTo.senderName || 'Reply'}
                                                                </div>
                                                                {replyPreviewBadge ? (
                                                                    <span
                                                                        className={cn(
                                                                            'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                                                                            isOwn
                                                                                ? 'border-white/15 bg-white/10 text-white/80'
                                                                                : 'border-zinc-200 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
                                                                        )}
                                                                    >
                                                                        {replyPreviewBadge}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                            <div className="mt-1 line-clamp-2 break-words opacity-90">
                                                                {replyPreviewText}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </button>
                                            ) : null}

                                            {isPinned ? (
                                                <div className="mb-1 flex items-center gap-2">
                                                    <span className={`text-[10px] font-bold uppercase ${isOwn ? 'text-white/80' : 'text-amber-600 dark:text-amber-400'}`}>
                                                        Pinned
                                                    </span>
                                                </div>
                                            ) : null}
                                        </>
                                    );

                                    const renderSuffix = () => (
                                        <>
                                            {structured ? (
                                                <StructuredMessageCardV2
                                                    structured={structured}
                                                    isOwn={isOwn}
                                                    currentUserId={user?.id ?? null}
                                                    creatorId={message.senderId ?? null}
                                                    isActionLoading={isWorkflowActionLoading}
                                                    onResolveAction={structured.workflowItemId ? handleResolveWorkflow : undefined}
                                                />
                                            ) : null}
                                            {!structured && contextChips.length > 0 ? (
                                                <MessageContextChipRowV2
                                                    chips={contextChips}
                                                    tone={isOwn ? 'inverted' : 'default'}
                                                    compact
                                                />
                                            ) : null}
                                            {linkedWork.length > 0 ? (
                                                <div className="mb-2 flex min-w-0 max-w-full flex-wrap items-center gap-1.5 overflow-hidden">
                                                    {visibleLinkedWork.map((link) => {
                                                        const label = getLinkedWorkDisplayLabel(link);
                                                        return (
                                                            <button
                                                                key={link.id}
                                                                type="button"
                                                                disabled={!link.href || link.status === 'unavailable'}
                                                                onClick={() => {
                                                                    if (!link.href || link.status === 'unavailable') {
                                                                        toast.info('Linked destination is unavailable');
                                                                        return;
                                                                    }
                                                                    router.push(link.href);
                                                                }}
                                                                className={cn(
                                                                    'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors sm:max-w-[220px]',
                                                                    isOwn
                                                                        ? 'border-white/15 bg-white/10 text-white/90 hover:bg-white/15 disabled:text-white/45'
                                                                        : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-950/65 dark:disabled:border-zinc-800 dark:disabled:bg-zinc-900',
                                                                )}
                                                                title={link.subtitle ?? label}
                                                            >
                                                                {link.isPrivate ? <Lock className="h-3 w-3 shrink-0" /> : <BriefcaseBusiness className="h-3 w-3 shrink-0" />}
                                                                <span className="shrink-0 opacity-75">{link.badge}</span>
                                                                <span className="truncate">{label}</span>
                                                                {link.status !== 'active' && link.status !== 'pending' ? (
                                                                    <span className="shrink-0 rounded-full bg-current/10 px-1 uppercase opacity-80">
                                                                        {link.status}
                                                                    </span>
                                                                ) : null}
                                                                {link.href ? <ExternalLink className="h-3 w-3 shrink-0 opacity-60" /> : null}
                                                            </button>
                                                        );
                                                    })}
                                                    {linkedWork.length > 2 ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => setLinkedWorkExpanded((current) => !current)}
                                                            className={cn(
                                                                'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold',
                                                                isOwn ? 'bg-white/10 dark:bg-black/10 text-white/80 dark:text-black/80 hover:bg-white/15 dark:hover:bg-black/15' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700',
                                                            )}
                                                        >
                                                            {linkedWorkExpanded ? 'Show less' : `${linkedWork.length - 2} linked items`}
                                                            <ChevronDown className={cn('h-3 w-3 transition-transform', linkedWorkExpanded && 'rotate-180')} />
                                                        </button>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                            {renderedLinkPreview ? (
                                                <div className="mt-2 w-full">
                                                    <LinkPreviewCard
                                                        preview={renderedLinkPreview}
                                                        isOwn={isOwn}
                                                        loading={!linkPreview}
                                                        onContentLoad={onContentLoad}
                                                    />
                                                </div>
                                            ) : null}
                                        </>
                                    );

                                    if (segment.type === 'code') {
                                        return (
                                            <React.Fragment key={index}>
                                                {isFirst && (isFocusedReplyTarget || message.replyTo || isPinned) && (
                                                    <div className="msg-bubble-shell !bg-transparent !border-0 !shadow-none !p-0 my-1">
                                                        {renderPrefix()}
                                                    </div>
                                                )}
                                                <div className={cn(
                                                    "relative my-1.5 w-full",
                                                    isLast && attachments.length === 0 && needsReactionSpacer && "mb-4",
                                                )}>
                                                    <CodeSegmentV2
                                                        code={segment.content}
                                                        language={segment.language as string | null}
                                                        isOwn={isOwn}
                                                    />
                                                    {isLast && attachments.length === 0 && reactionSummary.length > 0 && (
                                                        <ReactionPillRow
                                                            reactions={reactionSummary}
                                                            align={isOwn ? 'end' : 'start'}
                                                            onToggleReaction={handleReaction}
                                                            onShowDetail={() => {}}
                                                        />
                                                    )}
                                                </div>
                                                {isLast && (structured || contextChips.length > 0 || linkedWork.length > 0) && (
                                                    <div className="msg-bubble-shell !bg-transparent !border-0 !shadow-none !p-0 my-1">
                                                        {renderSuffix()}
                                                    </div>
                                                )}
                                            </React.Fragment>
                                        );
                                    }

                                    // Text or empty segment
                                    const isEmojiOnly = segment.type === 'text' && segment.content && isOnlyEmojis(segment.content);

                                    const contentText = segment.content || '';
                                    const lineCount = contentText.split('\n').length;
                                    const isLongContent = contentText.length > 250 || lineCount > 6;

                                    return (
                                        <Bubble
                                            key={index}
                                            variant={isEmojiOnly ? 'ghost' : isOwn ? 'default' : 'muted'}
                                            align={isOwn ? 'end' : 'start'}
                                            data-pending={isOptimistic ? 'true' : undefined}
                                            data-rich={hasRichContent ? 'true' : undefined}
                                            className={cn(
                                                'mt-[1px] mb-[1px] max-w-full',
                                                isLast && attachments.length === 0 && needsReactionSpacer && 'mb-4',
                                                isOwn
                                                    ? cn((isLast && isConsecutiveToNext) && 'rounded-br-sm', isFirst && isConsecutiveFromPrev && 'rounded-tr-sm')
                                                    : cn((isLast && isConsecutiveToNext) && 'rounded-bl-sm', isFirst && isConsecutiveFromPrev && 'rounded-tl-sm'),
                                                'transition-[transform,box-shadow,ring-color] duration-300 ease-out',
                                                isFocusedReplyTarget && 'ring-2 ring-zinc-300/90 ring-offset-2 ring-offset-background dark:ring-zinc-600/90'
                                            )}
                                        >
                                            {isFirst && renderPrefix()}

                                            {segment.content ? (
                                                <div className="min-w-0 max-w-full break-words outline-none">
                                                    <div className={cn(
                                                        "relative overflow-hidden transition-all duration-300 ease-in-out",
                                                        isLongContent ? (isCollapsed ? "max-h-[220px]" : "max-h-[4000px]") : "",
                                                        isLongContent && isCollapsed ? "[mask-image:linear-gradient(to_bottom,black_60%,transparent_100%)]" : ""
                                                    )}>
                                                        <p className={cn(
                                                            isEmojiOnly
                                                                ? "text-[32px] sm:text-[40px] leading-tight select-none py-1"
                                                                : `${MESSAGE_TEXT_BASE_CLASS} whitespace-pre-wrap break-words inline-block`,
                                                            isOwn ? "text-primary-foreground" : "text-zinc-900 dark:text-zinc-100"
                                                        )}>
                                                            {renderTextWithMentions(segment.content, isOwn)}
                                                        </p>
                                                    </div>

                                                    {isLongContent && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setIsCollapsed(!isCollapsed)}
                                                            className={cn(
                                                                "group/button mt-1.5 inline-flex items-center gap-1 p-0 text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 rounded-sm",
                                                                isOwn ? "text-primary-foreground/80 hover:text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                                                            )}
                                                        >
                                                            {isCollapsed ? "Show more" : "Show less"}
                                                            <ChevronDown className={cn(
                                                                "h-4 w-4 transition-transform duration-200",
                                                                !isCollapsed && "rotate-180"
                                                            )} />
                                                        </button>
                                                    )}

                                                    {isLast && hasInlineTimestamp && showTimestamp && (
                                                        <span className={cn("float-right mt-1.5 ml-2 shrink-0 select-none text-[10px] flex items-center gap-0.5 font-medium", isOwn ? "text-primary-foreground/60" : "text-muted-foreground")}>
                                                            {format(new Date(message.createdAt), 'p')}
                                                            {message.editedAt ? <span className="opacity-75">(edited)</span> : null}
                                                             <DeliveryIndicator deliveryState={deliveryState} className={cn("h-3 w-3", isOwn ? "text-primary-foreground/70" : "text-muted-foreground")} />
                                                        </span>
                                                    )}
                                                </div>
                                            ) : null}

                                            {isLast && renderSuffix()}
                                            {isLast && attachments.length === 0 && reactionSummary.length > 0 && (
                                                <ReactionPillRow
                                                    reactions={reactionSummary}
                                                    align={isOwn ? 'end' : 'start'}
                                                    onToggleReaction={handleReaction}
                                                    onShowDetail={() => {}}
                                                />
                                            )}
                                </Bubble>
                            );
                        })}

                        {attachments.length > 0 && (
                            <div className={cn(
                                "relative mt-1",
                                attachments.length === 1 ? "w-fit max-w-full" : "w-full",
                                needsReactionSpacer && "mb-4",
                            )}>
                                <MessageAttachmentsV2
                                    attachments={attachments}
                                    onContentLoad={onContentLoad}
                                    isOwn={isOwn}
                                    hasReactions={reactionSummary.length > 0}
                                />
                                {reactionSummary.length > 0 && (
                                    <ReactionPillRow
                                        reactions={reactionSummary}
                                        align={isOwn ? 'end' : 'start'}
                                        onToggleReaction={handleReaction}
                                        onShowDetail={() => {}}
                                    />
                                )}
                            </div>
                        )}
                            </div>
                        )}

        {((showTimestamp && !hasInlineTimestamp) || (isOwn && (isLatestMessage || ['failed', 'sending', 'queued'].includes(deliveryState || '')))) && (
            <MessageFooter className={cn(isOwn ? 'justify-end' : 'justify-start', 'mt-0.5 flex items-center gap-1.5 font-normal')}>
                {showTimestamp && !hasInlineTimestamp && (
                    <span title={new Date(message.createdAt).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}>
                        {format(new Date(message.createdAt), 'p')}
                    </span>
                )}
                {isOwn && (isLatestMessage || ['failed', 'sending', 'queued'].includes(deliveryState || '')) ? (
                    deliveryState === 'failed' && message.clientMessageId ? (
                        <button
                            type="button"
                            onClick={() => {
                                const clientMessageId = message.clientMessageId;
                                if (!clientMessageId) return;
                                const { items, markItem } = useMessagesV2OutboxStore.getState();
                                const item = items.find((entry) => entry.clientMessageId === clientMessageId);
                                if (!item) return;
                                markItem(clientMessageId, {
                                    state: 'queued',
                                    attempts: 0,
                                    nextRetryAt: Date.now(),
                                    error: undefined,
                                });
                            }}
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-50 focus-visible:outline-none dark:hover:bg-red-950/40"
                            aria-label="Retry sending message"
                        >
                            <DeliveryIndicator deliveryState={deliveryState} />
                            <span>Retry</span>
                        </button>
                    ) : (
                        <>
                            <DeliveryIndicator deliveryState={deliveryState} />
                            {deliveryState && (
                                <span className="text-[10px] capitalize text-zinc-400 dark:text-zinc-500">{deliveryState}</span>
                            )}
                        </>
                    )
                ) : null}
                {message.editedAt && !hasInlineTimestamp ? <span className="text-[10px] text-zinc-400 dark:text-zinc-500">(edited)</span> : null}
            </MessageFooter>
        )}
    </MessageContent>

                <div
                    className={cn(
                        'flex items-center gap-1 transition-opacity duration-200 shrink-0 pb-1 z-20',
                        showReactionBar || menuOpen
                            ? 'pointer-events-auto opacity-100'
                            : 'pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100',
                    )}
                >
                    <div className="relative">
                        <button
                            ref={reactionTriggerRef}
                            type="button"
                            data-reaction-trigger={message.id}
                            onClick={(event) => {
                                event.stopPropagation();
                                setShowReactionBar((prev) => !prev);
                            }}
                            className="rounded-full bg-background/90 p-1 text-zinc-400 shadow-sm ring-1 ring-border/60 backdrop-blur transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:bg-zinc-950/90 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                            aria-label="Add reaction"
                        >
                            <SmilePlus className="h-4 w-4" />
                        </button>
                        {showReactionBar && (
                            <ReactionQuickBar
                                align={isOwn ? 'end' : 'start'}
                                anchor={reactionTriggerRef.current}
                                selectedReactions={reactionSummary.filter((r) => r.viewerReacted).map((r) => r.emoji)}
                                onReact={handleReaction}
                                onClose={() => setShowReactionBar(false)}
                            />
                        )}
                    </div>

                    <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="rounded-full bg-background/90 p-1 text-zinc-400 shadow-sm ring-1 ring-border/60 backdrop-blur transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:bg-zinc-950/90 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
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
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => void handleDeleteForMe()} disabled={isActionLoading}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete for me
                            </DropdownMenuItem>
                            {!isOwn && (
                                <DropdownMenuItem onClick={() => onTriggerDialog?.(message, 'report')} className="text-red-600 dark:text-red-400">
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
            </div>
            {swipeOffset !== 0 && (
                <div
                    className={cn(
                        'pointer-events-none absolute top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition-all duration-100 dark:bg-zinc-800',
                        isOwn ? 'left-3' : 'right-3',
                    )}
                    style={{
                        opacity: Math.min(1, Math.abs(swipeOffset) / 50),
                        transform: `translateY(-50%) scale(${Math.min(1.1, Math.abs(swipeOffset) / 50)})`,
                    }}
                >
                    <CornerUpLeft className={cn("h-4 w-4 transition-colors", Math.abs(swipeOffset) >= 50 && "text-primary")} />
                </div>
            )}
        </Message>
        </>
    );
}, function areMessageBubblePropsEqual(prev, next) {
    if (prev.message.id !== next.message.id) return false;
    if (prev.message.editedAt !== next.message.editedAt) return false;
    if (prev.message.content !== next.message.content) return false;
    if (prev.isFocusedReplyTarget !== next.isFocusedReplyTarget) return false;
    if (prev.isConsecutiveFromPrev !== next.isConsecutiveFromPrev) return false;
    if (prev.isConsecutiveToNext !== next.isConsecutiveToNext) return false;
    if (prev.showTimestamp !== next.showTimestamp) return false;
    if (prev.surface !== next.surface) return false;
    if (prev.isLatestMessage !== next.isLatestMessage) return false;
    if (prev.linkedWork !== next.linkedWork) return false;
    if (prev.message.metadata !== next.message.metadata) return false;
    return true;
});

export function DeliveryIndicator({ deliveryState, className }: { deliveryState?: string; className?: string }) {
    if (!deliveryState) return null;
    if (deliveryState === 'sending') {
        return (
            <SendHorizonal
                className={cn("h-3 w-3 text-zinc-400 animate-pulse", className)}
            />
        );
    }
    if (deliveryState === 'queued') {
        return <Clock3 className={cn("h-3 w-3 text-zinc-400", className)} />;
    }
    if (deliveryState === 'failed') {
        return <AlertCircle className={cn("h-3 w-3 text-red-500", className)} />;
    }
    return null;
}
