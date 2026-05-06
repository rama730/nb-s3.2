'use client';

import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
    AlertCircle,
    BriefcaseBusiness,
    Check,
    CheckCheck,
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
    PlusCircle,
    SendHorizonal,
    SmilePlus,
    Trash2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import type { MessageWithSender } from '@/app/actions/messaging';
import { deleteMessageV2, editMessageV2 } from '@/app/actions/messaging/v2';
import { isMessagingPrivateFollowUpsEnabled } from '@/lib/features/messages';
import { cn } from '@/lib/utils';
import {
    hideThreadMessageForViewer,
    patchThreadMessage,
} from '@/lib/messages/v2-cache';
import { refreshConversationCache } from '@/lib/messages/v2-refresh';
import {
    normalizeMessageReactionSummary,
    toggleMessageReactionSummary,
    withReactionSummaryMetadata,
} from '@/lib/messages/reactions';
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
import {
    getReplyFocusLabel,
    getReplyPreviewBadge,
    getReplyPreviewText,
} from '@/lib/messages/reply-preview';
import {
    getMessageContextChipsFromMetadata,
    getPrivateFollowUpFromMetadata,
    getStructuredMessageFromMetadata,
} from '@/lib/messages/structured';
import { areMessageDeliveryRenderStatesEqual } from '@/lib/messages/v2-render-state';
import { ReactionQuickBar } from './ReactionQuickBar';
import { ReactionPillRow } from './ReactionPillRow';
import { LinkPreviewCard } from './LinkPreviewCard';
import { ReportMessageDialog } from './ReportMessageDialog';
import { useLinkPreview, extractFirstUrl, type LinkPreview } from '@/hooks/useLinkPreview';
import { MessageContextChipRowV2 } from './MessageContextChipRowV2';
import { StructuredMessageCardV2 } from './StructuredMessageCardV2';
import { useMessagesActions, useMessagingStructuredCatalog } from '@/hooks/useMessagesV2';
import type { MessageLinkedWorkSummary } from '@/lib/messages/linked-work';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { useMessagesV2OutboxStore } from '@/stores/messagesV2OutboxStore';

interface MessageBubbleV2Props {
    message: MessageWithSender;
    linkedWork?: MessageLinkedWorkSummary[];
    showAvatar?: boolean;
    surface?: 'page' | 'popup';
    onReply?: (message: MessageWithSender) => void;
    onTogglePin?: (messageId: string, pinned: boolean) => void;
    onFocusMessage?: (messageId: string, source?: 'reply' | 'pin' | 'external') => void;
    onContentLoad?: () => void;
    isFocusedReplyTarget?: boolean;
    focusSource?: 'reply' | 'pin' | 'external' | null;
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

function getApplicationStatusLabel(status: string | null) {
    if (status === 'accepted') return 'Accepted';
    if (status === 'rejected') return 'Rejected';
    if (status === 'project_deleted') return 'Project has been deleted';
    return 'Pending';
}

function areReactionSummariesEqual(
    left: ReturnType<typeof normalizeMessageReactionSummary>,
    right: ReturnType<typeof normalizeMessageReactionSummary>,
) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
        const current = left[index];
        const next = right[index];
        if (
            current.emoji !== next.emoji
            || current.count !== next.count
            || current.viewerReacted !== next.viewerReacted
        ) {
            return false;
        }
    }
    return true;
}

function areContextChipsEqual(left: ReturnType<typeof getMessageContextChipsFromMetadata>, right: ReturnType<typeof getMessageContextChipsFromMetadata>) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
        const current = left[index];
        const next = right[index];
        if (
            current.kind !== next.kind
            || current.id !== next.id
            || current.label !== next.label
            || (current.subtitle ?? null) !== (next.subtitle ?? null)
        ) {
            return false;
        }
    }
    return true;
}

function areStructuredPayloadValuesEqual(left: unknown, right: unknown): boolean {
    if (left === right) return true;

    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }
        for (let index = 0; index < left.length; index += 1) {
            if (!areStructuredPayloadValuesEqual(left[index], right[index])) {
                return false;
            }
        }
        return true;
    }

    if (left && right && typeof left === 'object' && typeof right === 'object') {
        const leftEntries = Object.entries(left);
        const rightEntries = Object.entries(right);
        if (leftEntries.length !== rightEntries.length) return false;
        for (const [key, value] of leftEntries) {
            if (!Object.prototype.hasOwnProperty.call(right, key)) {
                return false;
            }
            if (!areStructuredPayloadValuesEqual(value, (right as Record<string, unknown>)[key])) {
                return false;
            }
        }
        return true;
    }

    return false;
}

function areStructuredMessagesEqual(
    left: ReturnType<typeof getStructuredMessageFromMetadata>,
    right: ReturnType<typeof getStructuredMessageFromMetadata>,
) {
    if (left === right) return true;
    if (!left || !right) return left === right;
    const leftState = left.stateSnapshot ?? null;
    const rightState = right.stateSnapshot ?? null;
    const leftRefs = left.entityRefs;
    const rightRefs = right.entityRefs;
    return (
        left.kind === right.kind
        && left.version === right.version
        && left.layout === right.layout
        && left.title === right.title
        && left.summary === right.summary
        && left.workflowItemId === right.workflowItemId
        && (leftState === rightState || (
            Boolean(leftState) === Boolean(rightState)
            && leftState?.status === rightState?.status
            && leftState?.label === rightState?.label
            && (leftState?.note ?? null) === (rightState?.note ?? null)
            && (leftState?.actorId ?? null) === (rightState?.actorId ?? null)
            && (leftState?.actorName ?? null) === (rightState?.actorName ?? null)
            && (leftState?.resolvedAt ?? null) === (rightState?.resolvedAt ?? null)
        ))
        && areContextChipsEqual(left.contextChips, right.contextChips)
        && leftRefs.projectId === rightRefs.projectId
        && leftRefs.taskId === rightRefs.taskId
        && leftRefs.fileId === rightRefs.fileId
        && leftRefs.profileId === rightRefs.profileId
        && leftRefs.messageId === rightRefs.messageId
        && leftRefs.applicationId === rightRefs.applicationId
        && areStructuredPayloadValuesEqual(left.payload ?? null, right.payload ?? null)
    );
}

function arePrivateFollowUpsEqual(
    left: ReturnType<typeof getPrivateFollowUpFromMetadata>,
    right: ReturnType<typeof getPrivateFollowUpFromMetadata>,
) {
    if (left === right) return true;
    if (!left || !right) return left === right;
    return (
        left.workflowItemId === right.workflowItemId
        && left.status === right.status
        && (left.note ?? null) === (right.note ?? null)
        && (left.dueAt ?? null) === (right.dueAt ?? null)
        && (left.preview ?? null) === (right.preview ?? null)
    );
}

function areLinkedWorkEqual(left: readonly MessageLinkedWorkSummary[] | undefined, right: readonly MessageLinkedWorkSummary[] | undefined) {
    const leftItems = left ?? [];
    const rightItems = right ?? [];
    if (leftItems.length !== rightItems.length) return false;
    for (let index = 0; index < leftItems.length; index += 1) {
        const current = leftItems[index];
        const next = rightItems[index];
        if (
            current.id !== next.id
            || current.label !== next.label
            || (current.subtitle ?? null) !== (next.subtitle ?? null)
            || current.href !== next.href
            || current.status !== next.status
            || current.visibility !== next.visibility
            || (current.isPrivate ?? null) !== (next.isPrivate ?? null)
            || (current.badge ?? null) !== (next.badge ?? null)
            || current.updatedAt !== next.updatedAt
        ) {
            return false;
        }
    }
    return true;
}

function getLinkedWorkDisplayLabel(link: MessageLinkedWorkSummary) {
    if (link.targetType !== 'follow_up') return link.label;
    const dueAt = typeof link.metadata?.dueAt === 'string' ? link.metadata.dueAt : null;
    if (!dueAt) return link.label;

    const dueDate = new Date(dueAt);
    if (Number.isNaN(dueDate.getTime())) return link.label;

    return `Follow-up ${format(dueDate, 'MMM d')}`;
}

function areAttachmentsEqual(left: ChatAttachmentV2[], right: ChatAttachmentV2[]) {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
        const current = left[index];
        const next = right[index];
        if (
            current.id !== next.id
            || current.type !== next.type
            || current.url !== next.url
            || current.filename !== next.filename
            || current.sizeBytes !== next.sizeBytes
            || current.mimeType !== next.mimeType
            || current.thumbnailUrl !== next.thumbnailUrl
            || current.width !== next.width
            || current.height !== next.height
        ) {
            return false;
        }
    }
    return true;
}

export const MessageBubbleV2 = React.memo(function MessageBubbleV2({
    message,
    linkedWork = [],
    showAvatar = true,
    surface = 'page',
    onReply,
    onTogglePin,
    onFocusMessage,
    onContentLoad,
    isFocusedReplyTarget = false,
    focusSource = null,
}: MessageBubbleV2Props) {
    const queryClient = useQueryClient();
    const router = useRouter();
    const { user } = useAuth();
    const { resolveWorkflow, convertMessageToTask, convertMessageToFollowUp } = useMessagesActions();
    const isOwn = message.senderId === user?.id;
    const privateFollowUpsEnabled = isMessagingPrivateFollowUpsEnabled(user?.id ?? null);
    const isDeleted = Boolean(message.deletedAt);
    const metadata = useMemo(
        () => (message.metadata || {}) as Record<string, unknown>,
        [message.metadata],
    );
    const isPinned = Boolean(metadata.pinned);
    const isApplication = metadata.isApplication === true;
    const applicationStatus = typeof metadata.status === 'string' ? metadata.status : null;
    const deliveryState = typeof metadata.deliveryState === 'string' ? metadata.deliveryState : undefined;
    const structured = useMemo(() => getStructuredMessageFromMetadata(metadata), [metadata]);
    const contextChips = useMemo(() => getMessageContextChipsFromMetadata(metadata), [metadata]);
    const privateFollowUp = useMemo(() => getPrivateFollowUpFromMetadata(metadata), [metadata]);
    const [isEditing, setIsEditing] = useState(false);
    const [draftContent, setDraftContent] = useState(message.content || '');
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [workflowActionLoading, setWorkflowActionLoading] = useState(false);
    const [hiddenForViewer, setHiddenForViewer] = useState(false);
    const [showReactionBar, setShowReactionBar] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);
    const [isReactionLoading, setIsReactionLoading] = useState(false);
    const [taskDialogOpen, setTaskDialogOpen] = useState(false);
    const [followUpDialogOpen, setFollowUpDialogOpen] = useState(false);
    const [linkedWorkExpanded, setLinkedWorkExpanded] = useState(false);
    const [taskTitle, setTaskTitle] = useState('');
    const [taskDescription, setTaskDescription] = useState('');
    const [taskProjectId, setTaskProjectId] = useState<string>('');
    const [taskAssigneeId, setTaskAssigneeId] = useState<string>('');
    const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
    const [taskDueDate, setTaskDueDate] = useState('');
    const [followUpNote, setFollowUpNote] = useState('');
    const [followUpDueAt, setFollowUpDueAt] = useState('');
    const fieldIdBase = useId();
    const taskProjectSelectId = `${fieldIdBase}-task-project`;
    const taskTitleInputId = `${fieldIdBase}-task-title`;
    const taskDescriptionInputId = `${fieldIdBase}-task-description`;
    const taskAssigneeSelectId = `${fieldIdBase}-task-assignee`;
    const taskPrioritySelectId = `${fieldIdBase}-task-priority`;
    const taskDueDateInputId = `${fieldIdBase}-task-due-date`;
    const followUpNoteInputId = `${fieldIdBase}-follow-up-note`;
    const followUpDueAtInputId = `${fieldIdBase}-follow-up-due-at`;
    const reactionSummary = useMemo(
        () => normalizeMessageReactionSummary(metadata.reactionSummary),
        [metadata.reactionSummary],
    );
    const catalogQuery = useMessagingStructuredCatalog(
        message.conversationId,
        undefined,
        taskDialogOpen || followUpDialogOpen,
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
    const canEditMessage = isOwn && !isDeleted && Boolean(message.content);
    const canReply = !isDeleted;
    const isPopup = surface === 'popup';
    const replyPreviewBadge = message.replyTo ? getReplyPreviewBadge(message.replyTo) : null;
    const replyPreviewText = message.replyTo ? getReplyPreviewText(message.replyTo) : null;
    const hasRichContent = Boolean(
        structured
        || message.replyTo
        || isApplication
        || privateFollowUp
        || contextChips.length > 0
        || linkedWork.length > 0
        || attachments.length > 0
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
        setWorkflowActionLoading(false);
        setHiddenForViewer(false);
        setDraftContent(message.content || '');
    }, [message.content, message.id]);

    useEffect(() => {
        if (!taskDialogOpen) return;
        setTaskTitle(
            structured?.title
            || message.content?.trim()
            || privateFollowUp?.preview
            || 'Follow-up task',
        );
        setTaskDescription(structured?.summary || message.content?.trim() || '');
        setTaskProjectId(catalogQuery.data?.linkedProjectId || catalogQuery.data?.projects?.[0]?.id || '');
        setTaskAssigneeId('');
        setTaskPriority('medium');
        setTaskDueDate('');
    }, [
        catalogQuery.data?.linkedProjectId,
        catalogQuery.data?.projects,
        message.content,
        privateFollowUp?.preview,
        structured?.summary,
        structured?.title,
        taskDialogOpen,
    ]);

    useEffect(() => {
        if (!followUpDialogOpen) return;
        setFollowUpNote(privateFollowUp?.note || structured?.summary || message.content?.trim() || '');
        setFollowUpDueAt(privateFollowUp?.dueAt ? privateFollowUp.dueAt.slice(0, 16) : '');
    }, [followUpDialogOpen, message.content, privateFollowUp?.dueAt, privateFollowUp?.note, structured?.summary]);

    const syncAfterMessageAction = useCallback(async () => {
        await refreshConversationCache(queryClient, message.conversationId, { includeUnread: true });
    }, [message.conversationId, queryClient]);

    const handleResolveWorkflow = useCallback(async (
        action: 'accept' | 'decline' | 'complete' | 'needs_changes' | 'available' | 'busy' | 'offline' | 'focusing',
    ) => {
        const workflowItemId = structured?.workflowItemId;
        if (!workflowItemId || workflowActionLoading) {
            return;
        }

        setWorkflowActionLoading(true);
        try {
            await resolveWorkflow.mutateAsync({
                workflowItemId,
                action,
            });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update workflow');
        } finally {
            setWorkflowActionLoading(false);
        }
    }, [resolveWorkflow, structured?.workflowItemId, workflowActionLoading]);

    const handleConvertToTask = useCallback(async () => {
        if (!taskProjectId) {
            toast.error('Select a project first');
            return;
        }

        try {
            await convertMessageToTask.mutateAsync({
                messageId: message.id,
                projectId: taskProjectId,
                title: taskTitle.trim() || null,
                description: taskDescription.trim() || null,
                priority: taskPriority,
                assigneeId: taskAssigneeId || null,
                dueDate: taskDueDate ? new Date(taskDueDate).toISOString() : null,
            });
            toast.success('Task created from message');
            setTaskDialogOpen(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to create task');
        }
    }, [convertMessageToTask, message.id, taskAssigneeId, taskDescription, taskDueDate, taskPriority, taskProjectId, taskTitle]);

    const handleAddFollowUp = useCallback(async () => {
        if (!privateFollowUpsEnabled) {
            toast.error('Private follow-ups are unavailable');
            return;
        }
        try {
            await convertMessageToFollowUp.mutateAsync({
                messageId: message.id,
                conversationId: message.conversationId,
                note: followUpNote.trim() || null,
                dueAt: followUpDueAt ? new Date(followUpDueAt).toISOString() : null,
            });
            toast.success('Follow-up saved');
            setFollowUpDialogOpen(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to save follow-up');
        }
    }, [convertMessageToFollowUp, followUpDueAt, followUpNote, message.conversationId, message.id, privateFollowUpsEnabled]);

    const handleReaction = useCallback(async (emoji: string) => {
        if (isDeleted || isReactionLoading) {
            return;
        }

        setShowReactionBar(false);
        setIsReactionLoading(true);

        const previousReactionSummary = reactionSummary;
        const optimisticReactionSummary = toggleMessageReactionSummary(previousReactionSummary, emoji);
        patchThreadMessage(queryClient, message.conversationId, message.id, (current) => ({
            ...current,
            metadata: withReactionSummaryMetadata(
                (current.metadata || {}) as Record<string, unknown>,
                optimisticReactionSummary,
            ),
        }));

        try {
            const { toggleReaction } = await import('@/app/actions/messaging/features');
            const result = await toggleReaction(message.id, emoji);
            if (!result.success) {
                patchThreadMessage(queryClient, message.conversationId, message.id, (current) => ({
                    ...current,
                    metadata: withReactionSummaryMetadata(
                        (current.metadata || {}) as Record<string, unknown>,
                        previousReactionSummary,
                    ),
                }));
                toast.error(result.error || 'Failed to react');
                return;
            }

            patchThreadMessage(queryClient, message.conversationId, message.id, (current) => ({
                ...current,
                metadata: withReactionSummaryMetadata(
                    (current.metadata || {}) as Record<string, unknown>,
                    result.reactionSummary || optimisticReactionSummary,
                ),
            }));
        } catch {
            patchThreadMessage(queryClient, message.conversationId, message.id, (current) => ({
                ...current,
                metadata: withReactionSummaryMetadata(
                    (current.metadata || {}) as Record<string, unknown>,
                    previousReactionSummary,
                ),
            }));
            toast.error('Failed to react');
        } finally {
            setIsReactionLoading(false);
        }
    }, [
        isDeleted,
        isReactionLoading,
        message.conversationId,
        message.id,
        queryClient,
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

    if (message.type === 'system' && !structured) {
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
            className={`msg-bubble-lane flex w-full ${isOwn ? 'justify-end' : 'justify-start'}`}
            style={isOptimistic ? { animation: 'message-appear 250ms ease-out' } : undefined}
        >
            <div className={`group/message flex w-full min-w-0 items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                {!isOwn && showAvatar ? (
                    <UserAvatar
                        identity={message.sender}
                        size={32}
                        unoptimized
                        className="shrink-0"
                        fallbackClassName="text-xs font-medium text-white"
                    />
                ) : !isOwn && !showAvatar ? (
                    <div className="w-8 shrink-0" />
                ) : null}

                <div
                    className={`msg-bubble-stack relative flex min-w-0 flex-col ${isOwn ? 'items-end' : 'items-start'}`}
                    data-surface={isPopup ? 'popup' : 'page'}
                    data-own={isOwn ? 'true' : 'false'}
                >
                        <div
                            data-pending={isOptimistic ? 'true' : undefined}
                            data-rich={hasRichContent ? 'true' : undefined}
                            className={cn(
                                'msg-bubble-shell',
                                isOwn ? 'msg-bubble-own' : 'msg-bubble-peer',
                                showAvatar && (isOwn ? 'rounded-br-[var(--msg-tail-radius)]' : 'rounded-bl-[var(--msg-tail-radius)]'),
                                !isOwn && 'border border-border/60',
                                'transition-[transform,box-shadow,ring-color] duration-300 ease-out',
                                isFocusedReplyTarget && (
                                    isOwn
                                        ? 'ring-2 ring-white/45 shadow-[0_16px_40px_-22px_rgba(59,130,246,0.9)]'
                                        : 'ring-2 ring-primary/45 shadow-[0_16px_40px_-22px_rgba(59,130,246,0.55)]'
                                ),
                            )}
                            style={{
                                boxShadow: isFocusedReplyTarget ? undefined : 'var(--msg-shadow)',
                                ...(isFocusedReplyTarget ? { animation: 'message-focus-pulse 1250ms cubic-bezier(0.22,1,0.36,1)' } : {}),
                            }}
                        >
                            {isFocusedReplyTarget ? (
                                <>
                                    <div
                                        className={cn(
                                            'absolute inset-y-3 w-1 rounded-full',
                                            isOwn ? '-right-2 bg-white/70' : '-left-2 bg-primary/70',
                                        )}
                                    />
                                    <div className="mb-2 flex items-center gap-2">
                                        <span
                                            className={cn(
                                                'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                                isOwn
                                                    ? 'border-white/20 bg-white/10 text-white/90'
                                                    : 'border-primary/20 bg-primary/5 text-primary',
                                            )}
                                        >
                                            {getReplyFocusLabel(focusSource || 'external')}
                                        </span>
                                    </div>
                                </>
                            ) : null}
                            {message.replyTo ? (
                                <button
                                    type="button"
                                    onClick={() => onFocusMessage?.(message.replyTo!.id, 'reply')}
                                    className={cn(
                                        'mb-2 w-full rounded-xl border px-2.5 py-2 text-left text-xs transition-colors duration-200',
                                        isOwn
                                            ? 'border-white/15 bg-white/10 text-primary-foreground/90 hover:bg-white/14'
                                            : 'border-zinc-200 bg-zinc-50/90 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:bg-zinc-800',
                                    )}
                                    title={replyPreviewText || 'Open original message'}
                                    aria-label="Jump to original replied message"
                                >
                                    <div className="flex items-start gap-2">
                                        <div className={cn('mt-0.5 w-1 self-stretch rounded-full', isOwn ? 'bg-white/55' : 'bg-primary/55')} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <div className="truncate font-semibold">
                                                    {message.replyTo.senderName || 'Reply'}
                                                </div>
                                                {replyPreviewBadge ? (
                                                    <span
                                                        className={cn(
                                                            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                                            isOwn
                                                                ? 'bg-white/10 text-white/80'
                                                                : 'bg-primary/10 text-primary',
                                                        )}
                                                    >
                                                        {replyPreviewBadge}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <div className="mt-0.5 line-clamp-2 break-words opacity-90">
                                                {replyPreviewText}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            ) : null}

                            {(isPinned || isApplication || privateFollowUp) ? (
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
                                    {privateFollowUp ? (
                                        <span className={`text-[10px] font-bold uppercase ${isOwn ? 'text-white/80' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                            Follow up{privateFollowUp.dueAt ? ` · ${format(new Date(privateFollowUp.dueAt), 'MMM d')}` : ''}
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
                                    {structured ? (
                                        <StructuredMessageCardV2
                                            structured={structured}
                                            isOwn={isOwn}
                                            currentUserId={user?.id ?? null}
                                            creatorId={message.senderId ?? null}
                                            isActionLoading={workflowActionLoading}
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
                                                        isOwn ? 'bg-white/10 text-white/80 hover:bg-white/15' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700',
                                                    )}
                                                >
                                                    {linkedWorkExpanded ? 'Show less' : `${linkedWork.length - 2} linked items`}
                                                    <ChevronDown className={cn('h-3 w-3 transition-transform', linkedWorkExpanded && 'rotate-180')} />
                                                </button>
                                            ) : null}
                                        </div>
                                    ) : null}
                                    {message.content ? (
                                        <MessageTextContentV2
                                            content={message.content}
                                            isOwn={isOwn}
                                            isApplication={isApplication}
                                        />
                                    ) : null}
                                    {attachments.length > 0 ? (
                                        <MessageAttachmentsV2
                                            attachments={attachments}
                                            onContentLoad={onContentLoad}
                                        />
                                    ) : null}
                                    {renderedLinkPreview ? (
                                        <LinkPreviewCard
                                            preview={renderedLinkPreview}
                                            isOwn={isOwn}
                                            loading={!linkPreview}
                                            onContentLoad={onContentLoad}
                                        />
                                    ) : null}
                                </>
                            )}

                        </div>

                    {showReactionBar && (
                        <ReactionQuickBar
                            align={isOwn ? 'end' : 'start'}
                            onReact={handleReaction}
                            onClose={() => setShowReactionBar(false)}
                        />
                    )}

                    {reactionSummary.length > 0 && (
                        <ReactionPillRow
                            reactions={reactionSummary}
                            align={isOwn ? 'end' : 'start'}
                            onToggleReaction={handleReaction}
                            onShowDetail={() => {}}
                        />
                    )}

                    <div className={`mt-1 flex items-center gap-1 px-1 text-[11px] text-zinc-400 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                        <span title={new Date(message.createdAt).toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}>
                            {format(new Date(message.createdAt), 'p')}
                        </span>
                        {isOwn ? (
                            deliveryState === 'failed' && message.clientMessageId ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        // Wave 4 Step 16: requeue the outbox item so the
                                        // sync loop retries immediately (nextRetryAt=now).
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
                                    className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-red-500 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:hover:bg-red-950/40"
                                    aria-label="Retry sending message"
                                >
                                    <DeliveryIndicator deliveryState={deliveryState} />
                                    <span>Retry</span>
                                </button>
                            ) : (
                                <DeliveryIndicator deliveryState={deliveryState} />
                            )
                        ) : null}
                        {message.editedAt ? <span>(edited)</span> : null}
                    </div>
                </div>
                <div
                    className={cn(
                        'msg-action-rail pointer-events-none relative z-10 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100',
                        isOwn ? 'flex-row-reverse justify-end' : 'justify-start',
                    )}
                >
                    <button
                        type="button"
                        onClick={() => setShowReactionBar((prev) => !prev)}
                        className="rounded-full bg-background/90 p-1 text-zinc-400 shadow-sm ring-1 ring-border/60 backdrop-blur transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:bg-zinc-950/90 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        aria-label="Add reaction"
                    >
                        <SmilePlus className="h-4 w-4" />
                    </button>

                    <DropdownMenu modal={false}>
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
                            <DropdownMenuItem disabled className="text-[11px] font-semibold uppercase tracking-wide opacity-60">
                                Create linked work
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setTaskDialogOpen(true)} disabled={isActionLoading}>
                                <PlusCircle className="mr-2 h-4 w-4" />
                                Task from message
                            </DropdownMenuItem>
                            {privateFollowUpsEnabled ? (
                                <DropdownMenuItem onClick={() => setFollowUpDialogOpen(true)} disabled={isActionLoading}>
                                    <Clock3 className="mr-2 h-4 w-4" />
                                    Private follow-up
                                </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuSeparator />
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
            </div>
        </div>
        <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Create linked task</DialogTitle>
                    <DialogDescription>
                        Create a task from this message. The message keeps a linked chip, and the task keeps the source context.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <label htmlFor={taskProjectSelectId} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Project</label>
                        <select
                            id={taskProjectSelectId}
                            value={taskProjectId}
                            onChange={(event) => setTaskProjectId(event.target.value)}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                        >
                            <option value="">Select project</option>
                            {(catalogQuery.data?.projects || []).map((project) => (
                                <option key={project.id} value={project.id}>
                                    {project.title}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="space-y-1.5">
                        <label htmlFor={taskTitleInputId} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Title</label>
                        <Input id={taskTitleInputId} value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} maxLength={120} />
                    </div>
                    <div className="space-y-1.5">
                        <label htmlFor={taskDescriptionInputId} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Description</label>
                        <textarea
                            id={taskDescriptionInputId}
                            value={taskDescription}
                            onChange={(event) => setTaskDescription(event.target.value)}
                            rows={4}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                        />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <label htmlFor={taskAssigneeSelectId} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Assignee</label>
                            <select
                                id={taskAssigneeSelectId}
                                value={taskAssigneeId}
                                onChange={(event) => setTaskAssigneeId(event.target.value)}
                                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                            >
                                <option value="">Unassigned</option>
                                {(catalogQuery.data?.profiles || []).map((profile) => (
                                    <option key={profile.id} value={profile.id}>
                                        {profile.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label htmlFor={taskPrioritySelectId} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Priority</label>
                            <select
                                id={taskPrioritySelectId}
                                value={taskPriority}
                                onChange={(event) => setTaskPriority(event.target.value as typeof taskPriority)}
                                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                            >
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                                <option value="urgent">Urgent</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <label htmlFor={taskDueDateInputId} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Due date</label>
                            <Input id={taskDueDateInputId} type="datetime-local" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} />
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <button
                        type="button"
                        onClick={() => setTaskDialogOpen(false)}
                        className="rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleConvertToTask()}
                        disabled={convertMessageToTask.isPending}
                        className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                    >
                        {convertMessageToTask.isPending ? 'Creating…' : 'Create task'}
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        <Dialog open={privateFollowUpsEnabled && followUpDialogOpen} onOpenChange={setFollowUpDialogOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Add follow-up</DialogTitle>
                    <DialogDescription>
                        Keep a private reminder on this message without posting a visible workflow card in the thread.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <label htmlFor={followUpNoteInputId} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Note</label>
                        <textarea
                            id={followUpNoteInputId}
                            value={followUpNote}
                            onChange={(event) => setFollowUpNote(event.target.value)}
                            rows={4}
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 dark:border-zinc-800 dark:bg-zinc-950"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label htmlFor={followUpDueAtInputId} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Remind me at</label>
                        <Input id={followUpDueAtInputId} type="datetime-local" value={followUpDueAt} onChange={(event) => setFollowUpDueAt(event.target.value)} />
                    </div>
                </div>
                <DialogFooter>
                    <button
                        type="button"
                        onClick={() => setFollowUpDialogOpen(false)}
                        className="rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleAddFollowUp()}
                        disabled={convertMessageToFollowUp.isPending}
                        className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                    >
                        {convertMessageToFollowUp.isPending ? 'Saving…' : 'Save follow-up'}
                    </button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        {reportOpen && <ReportMessageDialog messageId={message.id} isOpen={reportOpen} onClose={() => setReportOpen(false)} />}
        </>
    );
}, areMessageBubblePropsEqual);

export function areMessageBubblePropsEqual(
    prev: Readonly<MessageBubbleV2Props>,
    next: Readonly<MessageBubbleV2Props>,
) {
    const prevPinned = Boolean(prev.message.metadata?.pinned);
    const nextPinned = Boolean(next.message.metadata?.pinned);
    const prevReactionSummary = normalizeMessageReactionSummary(prev.message.metadata?.reactionSummary);
    const nextReactionSummary = normalizeMessageReactionSummary(next.message.metadata?.reactionSummary);
    const prevStructured = getStructuredMessageFromMetadata(prev.message.metadata || {});
    const nextStructured = getStructuredMessageFromMetadata(next.message.metadata || {});
    const prevContextChips = getMessageContextChipsFromMetadata(prev.message.metadata || {});
    const nextContextChips = getMessageContextChipsFromMetadata(next.message.metadata || {});
    const prevPrivateFollowUp = getPrivateFollowUpFromMetadata(prev.message.metadata || {});
    const nextPrivateFollowUp = getPrivateFollowUpFromMetadata(next.message.metadata || {});
    const prevAttachments = (prev.message.attachments || []) as ChatAttachmentV2[];
    const nextAttachments = (next.message.attachments || []) as ChatAttachmentV2[];

    return (
        areMessageDeliveryRenderStatesEqual(prev.message, next.message) &&
        prevPinned === nextPinned &&
        areReactionSummariesEqual(prevReactionSummary, nextReactionSummary) &&
        areStructuredMessagesEqual(prevStructured, nextStructured) &&
        areContextChipsEqual(prevContextChips, nextContextChips) &&
        arePrivateFollowUpsEqual(prevPrivateFollowUp, nextPrivateFollowUp) &&
        areLinkedWorkEqual(prev.linkedWork, next.linkedWork) &&
        areAttachmentsEqual(prevAttachments, nextAttachments) &&
        prev.showAvatar === next.showAvatar &&
        prev.surface === next.surface &&
        prev.onReply === next.onReply &&
        prev.onTogglePin === next.onTogglePin &&
        prev.onFocusMessage === next.onFocusMessage &&
        prev.onContentLoad === next.onContentLoad &&
        prev.isFocusedReplyTarget === next.isFocusedReplyTarget &&
        prev.focusSource === next.focusSource
    );
}

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
