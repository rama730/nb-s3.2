'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Loader2, X, Paperclip, Pause, Play, RotateCcw, SendHorizonal } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';
import { useMessagesV2OutboxStore } from '@/stores/messagesV2OutboxStore';
import { useMessagesActions } from '@/hooks/useMessagesV2';
import {
    upsertThreadConversation,
} from '@/lib/messages/v2-cache';
import { refreshConversationCache } from '@/lib/messages/v2-refresh';
import { compressImage } from '@/lib/messages/image-compression';
import { uploadAttachment, cancelAttachmentUpload, type MessageWithSender, type UploadedAttachment } from '@/app/actions/messaging';
import {
    acceptApplicationAction,
    rejectApplicationAction,
    reopenApplicationAction,
    withdrawApplicationAction,
} from '@/app/actions/applications';
import { acceptConnectionRequest, cancelConnectionRequest, sendConnectionRequest } from '@/app/actions/connections';
import {
    type ConversationCapabilityV2,
} from '@/app/actions/messaging/v2';
import {
    canSendFromCapability,
    getComposerWorkflowNotice,
} from '@/lib/chat/composer-workflow';
import { MentionDropdown } from './MentionDropdown';

interface MessageComposerV2Props {
    conversationId: string;
    targetUserId?: string | null;
    capability: ConversationCapabilityV2 | null;
    replyTarget: MessageWithSender | null;
    surface?: 'page' | 'popup';
    sendTyping?: (isTyping: boolean) => Promise<void> | void;
    onClearReply: () => void;
    onAddFiles?: (register: (files: File[]) => void) => void;
    participants?: Array<{ id: string; username: string | null; fullName: string | null; avatarUrl: string | null }>;
}

type UploadStatus = 'queued' | 'uploading' | 'uploaded' | 'failed';
type ApplicationWorkflowAction = 'accept' | 'reject' | 'withdraw' | 'reopen';

interface PendingAttachment {
    id: string;
    file: File;
    preview?: string;
    status: UploadStatus;
    progress: number;
    attempts: number;
    uploaded?: UploadedAttachment;
    error?: string;
}

const MAX_ATTACHMENTS = 12;
const UPLOAD_CONCURRENCY = 3;
const MAX_UPLOAD_RETRIES = 3;
const TYPING_IDLE_MS = 1800;
const MAX_MESSAGE_LENGTH = 4000;

export function MessageComposerV2({
    conversationId,
    targetUserId,
    capability,
    replyTarget,
    surface = 'page',
    sendTyping,
    onClearReply,
    onAddFiles,
    participants,
}: MessageComposerV2Props) {
    const queryClient = useQueryClient();
    const draft = useMessagesV2UiStore((state) => state.draftsByConversation[conversationId] || '');
    const setDraft = useMessagesV2UiStore((state) => state.setDraft);
    const clearDraft = useMessagesV2UiStore((state) => state.clearDraft);
    const upsertOutboxItem = useMessagesV2OutboxStore((state) => state.upsertItem);
    const removeOutboxItem = useMessagesV2OutboxStore((state) => state.removeItem);
    const markOutboxItem = useMessagesV2OutboxStore((state) => state.markItem);
    const { sendConversationMessage } = useMessagesActions();
    const [isSending, setIsSending] = useState(false);
    const [sendAnimating, setSendAnimating] = useState(false);
    const [requestLoading, setRequestLoading] = useState(false);
    const [applicationActionLoading, setApplicationActionLoading] = useState<ApplicationWorkflowAction | null>(null);
    const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
    const [uploadsPaused, setUploadsPaused] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const attachmentsRef = useRef<PendingAttachment[]>([]);
    const uploadsPausedRef = useRef(uploadsPaused);
    const activeUploadIdsRef = useRef<Set<string>>(new Set());
    const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const typingActiveRef = useRef(false);
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);

    const addFiles = useCallback(async (files: File[]) => {
        const availableSlots = Math.max(0, MAX_ATTACHMENTS - attachmentsRef.current.length);
        const filesToAdd = files.slice(0, availableSlots);
        const processedFiles = await Promise.all(
            filesToAdd.map((file) => compressImage(file)),
        );
        const nextItems = processedFiles.map((file) => ({
            id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            file,
            preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
            status: 'queued' as const,
            progress: 0,
            attempts: 0,
        }));
        setAttachments((prev) => [...prev, ...nextItems]);
    }, []);

    useEffect(() => {
        onAddFiles?.(addFiles);
    }, [addFiles, onAddFiles]);

    useEffect(() => {
        attachmentsRef.current = attachments;
    }, [attachments]);

    useEffect(() => {
        uploadsPausedRef.current = uploadsPaused;
    }, [uploadsPaused]);

    useEffect(() => {
        return () => {
            attachmentsRef.current.forEach((attachment) => {
                if (attachment.preview) URL.revokeObjectURL(attachment.preview);
            });
        };
    }, []);

    const clearTypingIdleTimer = useCallback(() => {
        if (typingIdleTimerRef.current) {
            clearTimeout(typingIdleTimerRef.current);
            typingIdleTimerRef.current = null;
        }
    }, []);

    const updateTypingState = useCallback((isTyping: boolean) => {
        if (!sendTyping) return;
        if (typingActiveRef.current === isTyping) return;
        typingActiveRef.current = isTyping;
        void sendTyping(isTyping);
    }, [sendTyping]);

    const scheduleTypingStop = useCallback(() => {
        clearTypingIdleTimer();
        typingIdleTimerRef.current = setTimeout(() => {
            typingIdleTimerRef.current = null;
            updateTypingState(false);
        }, TYPING_IDLE_MS);
    }, [clearTypingIdleTimer, updateTypingState]);

    useEffect(() => {
        return () => {
            clearTypingIdleTimer();
            updateTypingState(false);
        };
    }, [clearTypingIdleTimer, updateTypingState]);

    useEffect(() => {
        // Don't auto-focus on mobile (would pop up keyboard unexpectedly)
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (isMobile) return;
        const timer = setTimeout(() => inputRef.current?.focus(), 100);
        return () => clearTimeout(timer);
    }, [conversationId]);

    const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const nextValue = event.target.value;
        setDraft(conversationId, nextValue);
        if (nextValue.length > 0) {
            updateTypingState(true);
            scheduleTypingStop();
        } else {
            clearTypingIdleTimer();
            updateTypingState(false);
        }

        // Detect @mention
        const textarea = event.target;
        const cursorPos = textarea.selectionStart;
        const textBeforeCursor = nextValue.slice(0, cursorPos);
        const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
        if (mentionMatch && participants && participants.length > 0) {
            setMentionQuery(mentionMatch[1]);
        } else {
            setMentionQuery(null);
        }

        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
        }
    }, [clearTypingIdleTimer, conversationId, participants, scheduleTypingStop, setDraft, updateTypingState]);

    const startQueuedUploads = useCallback(() => {
        if (uploadsPausedRef.current) return;
        const available = Math.max(0, UPLOAD_CONCURRENCY - activeUploadIdsRef.current.size);
        if (available === 0) return;

        attachmentsRef.current
            .filter((attachment) => attachment.status === 'queued')
            .slice(0, available)
            .forEach((attachment) => {
                activeUploadIdsRef.current.add(attachment.id);
                const formData = new FormData();
                formData.append('file', attachment.file);
                formData.append('clientUploadId', attachment.id);
                formData.append('conversationId', conversationId);

                setAttachments((prev) =>
                    prev.map((item) =>
                        item.id === attachment.id ? { ...item, status: 'uploading', progress: 20, error: undefined } : item,
                    ),
                );

                // Simulate progress since server actions don't support progress events
                setTimeout(() => {
                    setAttachments((prev) =>
                        prev.map((item) => item.id === attachment.id && item.status === 'uploading' ? { ...item, progress: 60 } : item),
                    );
                }, 500);

                void uploadAttachment(formData)
                    .then((result) => {
                        setAttachments((prev) =>
                            prev.map((item) => {
                                if (item.id !== attachment.id) return item;
                                if (!result.success || !result.attachment) {
                                    return {
                                        ...item,
                                        status: 'failed',
                                        progress: 0,
                                        attempts: item.attempts + 1,
                                        error: result.error || 'Upload failed',
                                    };
                                }
                                return {
                                    ...item,
                                    status: 'uploaded',
                                    progress: 100,
                                    uploaded: result.attachment,
                                    error: undefined,
                                };
                            }),
                        );
                    })
                    .catch(() => {
                        setAttachments((prev) =>
                            prev.map((item) =>
                                item.id === attachment.id
                                    ? { ...item, status: 'failed', progress: 0, attempts: item.attempts + 1, error: 'Upload failed' }
                                    : item,
                            ),
                        );
                    })
                    .finally(() => {
                        activeUploadIdsRef.current.delete(attachment.id);
                        startQueuedUploads();
                    });
            });
    }, [conversationId]);

    useEffect(() => {
        startQueuedUploads();
    }, [attachments, startQueuedUploads]);

    const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        if (files.length === 0) return;

        const availableSlots = Math.max(0, MAX_ATTACHMENTS - attachmentsRef.current.length);
        const filesToAdd = files.slice(0, availableSlots);

        const processedFiles = await Promise.all(
            filesToAdd.map((file) => compressImage(file)),
        );

        const nextItems = processedFiles.map((file) => ({
            id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            file,
            preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
            status: 'queued' as const,
            progress: 0,
            attempts: 0,
        }));

        setAttachments((prev) => [...prev, ...nextItems]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, []);

    const removeAttachment = useCallback((attachmentId: string) => {
        const target = attachmentsRef.current.find((attachment) => attachment.id === attachmentId);
        if (target?.preview) URL.revokeObjectURL(target.preview);
        activeUploadIdsRef.current.delete(attachmentId);
        setAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
        void cancelAttachmentUpload(attachmentId);
    }, []);

    const retryAttachment = useCallback((attachmentId: string) => {
        setAttachments((prev) =>
            prev.map((attachment) =>
                attachment.id === attachmentId && attachment.attempts < MAX_UPLOAD_RETRIES
                    ? { ...attachment, status: 'queued', error: undefined }
                    : attachment,
            ),
        );
    }, []);

    const handleMentionSelect = useCallback((participant: { username: string | null }) => {
        if (!participant.username || !inputRef.current) return;
        const textarea = inputRef.current;
        const cursorPos = textarea.selectionStart;
        const text = draft;
        const textBeforeCursor = text.slice(0, cursorPos);
        const mentionStart = textBeforeCursor.lastIndexOf('@');
        if (mentionStart === -1) return;
        const newText = text.slice(0, mentionStart) + `@${participant.username} ` + text.slice(cursorPos);
        setDraft(conversationId, newText);
        setMentionQuery(null);
        // Set cursor after inserted mention
        requestAnimationFrame(() => {
            const newPos = mentionStart + participant.username!.length + 2;
            textarea.setSelectionRange(newPos, newPos);
            textarea.focus();
        });
    }, [conversationId, draft, setDraft]);

    const insertQueuedMessage = useCallback((clientMessageId: string, content: string, uploadedAttachments: UploadedAttachment[], state: 'sending' | 'queued' | 'failed') => {
        upsertOutboxItem({
            clientMessageId,
            conversationId,
            targetUserId: targetUserId ?? null,
            content,
            attachments: uploadedAttachments,
            replyToMessageId: replyTarget?.id || null,
            createdAt: Date.now(),
            attempts: 0,
            nextRetryAt: Date.now(),
            state,
        });
    }, [conversationId, replyTarget?.id, targetUserId, upsertOutboxItem]);

    const refreshMessagingState = useCallback(async () => {
        await refreshConversationCache(queryClient, conversationId, { includeUnread: true });
    }, [conversationId, queryClient]);

    const handleSend = useCallback(async () => {
        const text = draft.trim();
        const uploadedAttachments = attachments
            .filter((attachment) => attachment.status === 'uploaded' && attachment.uploaded && !attachment.error)
            .map((attachment) => attachment.uploaded!);

        const hasStillUploading = attachments.some((attachment) => attachment.status === 'queued' || attachment.status === 'uploading');
        if (!text && uploadedAttachments.length === 0) {
            if (hasStillUploading) {
                toast.info('Please wait for attachments to finish uploading');
            }
            return;
        }
        if (isSending) return;

        const clientMessageId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        setIsSending(true);
        setSendAnimating(true);
        setTimeout(() => setSendAnimating(false), 300);
        clearTypingIdleTimer();
        updateTypingState(false);

        // Clear input immediately so the user sees their text move to the
        // optimistic message bubble — not sit in the composer during the send.
        clearDraft(conversationId);
        onClearReply();
        const sentAttachments = [...attachments];
        attachmentsRef.current.forEach((attachment) => {
            if (attachment.preview) URL.revokeObjectURL(attachment.preview);
        });
        attachmentsRef.current = [];
        setAttachments([]);
        if (inputRef.current) inputRef.current.style.height = 'auto';

        insertQueuedMessage(clientMessageId, text, uploadedAttachments, 'sending');

        try {
            const result = await sendConversationMessage.mutateAsync({
                conversationId,
                targetUserId: targetUserId ?? null,
                content: text,
                attachments: uploadedAttachments,
                clientMessageId,
                replyToMessageId: replyTarget?.id || null,
            });

            removeOutboxItem(clientMessageId);

            if (result.conversation) {
                upsertThreadConversation(queryClient, result.conversation);
            }
        } catch (error) {
            markOutboxItem(clientMessageId, {
                state: 'queued',
                attempts: 1,
                nextRetryAt: Date.now() + 3_000,
                error: error instanceof Error ? error.message : 'network_error',
            });
            // Don't restore draft — the message is in the outbox and will retry.
            toast.info('Message queued. It will retry automatically.');
        } finally {
            setIsSending(false);
            inputRef.current?.focus();
        }
    }, [attachments, clearDraft, clearTypingIdleTimer, conversationId, draft, insertQueuedMessage, isSending, markOutboxItem, onClearReply, queryClient, removeOutboxItem, replyTarget?.id, sendConversationMessage, targetUserId, updateTypingState]);

    const canSend = canSendFromCapability(capability);
    const isPopup = surface === 'popup';
    const hasUploadingAttachments = attachments.some((attachment) => attachment.status === 'queued' || attachment.status === 'uploading');
    const hasSendableContent = Boolean(
        draft.trim() || attachments.some((attachment) => attachment.status === 'uploaded' && attachment.uploaded && !attachment.error),
    );
    const canSubmit = canSend && !isSending && (hasSendableContent || Boolean(draft.trim())) && draft.length <= MAX_MESSAGE_LENGTH;

    const handleConnectionAction = useCallback(async () => {
        if (!capability || !targetUserId) return;
        setRequestLoading(true);
        try {
            if (capability.status === 'pending_received' && capability.connectionId) {
                const result = await acceptConnectionRequest(capability.connectionId);
                if (!result.success) throw new Error(result.error || 'Failed to accept request');
                toast.success('Connection accepted');
            } else if (capability.status === 'pending_sent' && capability.connectionId) {
                const result = await cancelConnectionRequest(capability.connectionId);
                if (!result.success) throw new Error(result.error || 'Failed to cancel request');
                toast.success('Request cancelled');
            } else if (!capability.canSend && !capability.blocked) {
                const idempotencyKey = typeof crypto !== 'undefined' && 'randomUUID' in crypto
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                const result = await sendConnectionRequest(targetUserId, idempotencyKey);
                if (!result.success) throw new Error(result.error || 'Failed to send request');
                toast.success('Connection request sent');
            }

            await refreshMessagingState();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update connection');
        } finally {
            setRequestLoading(false);
        }
    }, [capability, refreshMessagingState, targetUserId]);

    const handleApplicationAction = useCallback(async (action: ApplicationWorkflowAction) => {
        const applicationId = capability?.activeApplicationId;
        if (!applicationId) return;

        setApplicationActionLoading(action);
        try {
            const idempotencyKey = `chat-v2:composer:${action}:${applicationId}`;
            const result = action === 'accept'
                ? await acceptApplicationAction(applicationId, undefined, { idempotencyKey })
                : action === 'reject'
                    ? await rejectApplicationAction(applicationId, undefined, 'other', { idempotencyKey })
                    : action === 'withdraw'
                        ? await withdrawApplicationAction(applicationId, undefined, { idempotencyKey })
                        : await reopenApplicationAction(applicationId, undefined, { idempotencyKey });

            if (!result.success) {
                toast.error(result.error || `Failed to ${action} application`);
                return;
            }

            toast.success(
                action === 'withdraw'
                    ? 'Application withdrawn'
                    : action === 'reopen'
                        ? 'Application reopened'
                        : `Application ${action}ed`,
            );
            await refreshMessagingState();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update application');
        } finally {
            setApplicationActionLoading(null);
        }
    }, [capability?.activeApplicationId, refreshMessagingState]);

    const workflowNotice = useMemo(() => getComposerWorkflowNotice(capability), [capability]);

    return (
        <div className={`border-t border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${
            isPopup ? 'px-3 py-3' : 'px-5 py-4'
        }`}>
            {workflowNotice && (
                <div className={`mb-3 rounded-2xl border ${
                    workflowNotice.tone === 'success'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100'
                        : workflowNotice.tone === 'danger'
                            ? 'border-red-200 bg-red-50 text-red-950 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100'
                            : workflowNotice.tone === 'warning'
                                ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100'
                                : workflowNotice.tone === 'neutral'
                                    ? 'border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100'
                                    : 'border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-100'
                } ${isPopup ? 'px-3 py-2.5' : 'px-3.5 py-3'}`}>
                    <div className={`flex items-start justify-between gap-3 ${isPopup ? 'flex-col' : 'flex-row'}`}>
                        <div className="flex min-w-0 items-start gap-2.5">
                            <div className="mt-0.5 shrink-0">
                                {workflowNotice.icon}
                            </div>
                            <div className="min-w-0">
                                <div className="text-xs font-semibold uppercase tracking-wide opacity-80">
                                    {workflowNotice.badge}
                                    {workflowNotice.lastStatusLabel ? ` · ${workflowNotice.lastStatusLabel}` : ''}
                                </div>
                                <div className="mt-1 text-sm font-medium">{workflowNotice.title}</div>
                                <div className="mt-1 text-xs opacity-80">{workflowNotice.description}</div>
                            </div>
                        </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        {workflowNotice.canAccept ? (
                            <button
                                type="button"
                                onClick={() => void handleApplicationAction('accept')}
                                disabled={applicationActionLoading !== null}
                                className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                            >
                                {applicationActionLoading === 'accept' ? 'Accepting…' : 'Accept'}
                            </button>
                        ) : null}
                        {workflowNotice.canReject ? (
                            <button
                                type="button"
                                onClick={() => void handleApplicationAction('reject')}
                                disabled={applicationActionLoading !== null}
                                className="rounded-lg border border-indigo-300 px-2.5 py-1 text-xs font-medium hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-800 dark:hover:bg-indigo-900/40"
                            >
                                {applicationActionLoading === 'reject' ? 'Rejecting…' : 'Reject'}
                            </button>
                        ) : null}
                        {workflowNotice.canWithdraw ? (
                            <button
                                type="button"
                                onClick={() => void handleApplicationAction('withdraw')}
                                disabled={applicationActionLoading !== null}
                                className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            >
                                {applicationActionLoading === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
                            </button>
                        ) : null}
                        {workflowNotice.canReopen ? (
                            <button
                                type="button"
                                onClick={() => void handleApplicationAction('reopen')}
                                disabled={applicationActionLoading !== null}
                                className="rounded-lg border border-indigo-300 px-2.5 py-1 text-xs font-medium hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-800 dark:hover:bg-indigo-900/40"
                            >
                                {applicationActionLoading === 'reopen' ? 'Reopening…' : 'Reopen'}
                            </button>
                        ) : null}
                        {workflowNotice.canEditRequest && workflowNotice.requestHref ? (
                            <Link
                                href={workflowNotice.requestHref}
                                className="rounded-lg border border-indigo-300 px-2.5 py-1 text-xs font-medium hover:bg-indigo-100 dark:border-indigo-800 dark:hover:bg-indigo-900/40"
                            >
                                Edit request
                            </Link>
                        ) : null}
                        {workflowNotice.requestHref && !workflowNotice.canEditRequest ? (
                            <Link
                                href={workflowNotice.requestHref}
                                className="rounded-lg border border-indigo-300 px-2.5 py-1 text-xs font-medium hover:bg-indigo-100 dark:border-indigo-800 dark:hover:bg-indigo-900/40"
                            >
                                View request
                            </Link>
                        ) : null}
                        {workflowNotice.projectHref ? (
                            <Link
                                href={workflowNotice.projectHref}
                                className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                            >
                                Open project
                            </Link>
                        ) : null}
                        {workflowNotice.actionLabel ? (
                        <button
                            type="button"
                            onClick={handleConnectionAction}
                            disabled={requestLoading}
                            className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:hover:bg-amber-900/40"
                        >
                            {requestLoading ? 'Working...' : workflowNotice.actionLabel}
                        </button>
                        ) : null}
                    </div>
                </div>
            )}

            {replyTarget && (
                <div className="mb-2 flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
                    <div className="min-w-0">
                        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Replying to</div>
                        <div className="truncate text-sm text-zinc-900 dark:text-zinc-100">
                            {replyTarget.content || '[attachment]'}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClearReply}
                        className="rounded-full p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        aria-label="Clear reply target"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}

            {attachments.length > 0 && (
                <div className="mb-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Attachments</div>
                        <button
                            type="button"
                            onClick={() => setUploadsPaused((prev) => !prev)}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        >
                            {uploadsPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                            {uploadsPaused ? 'Resume uploads' : 'Pause uploads'}
                        </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {attachments.map((attachment) => {
                            const hasRetriesRemaining = attachment.attempts < MAX_UPLOAD_RETRIES;

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
                                            onClick={() => removeAttachment(attachment.id)}
                                            className="rounded-full p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                                            aria-label={`Remove ${attachment.file.name}`}
                                        >
                                            <X className="h-4 w-4" />
                                        </button>
                                    </div>
                                    {attachment.preview && (
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
                                    )}
                                    {attachment.status === 'uploading' && (
                                        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                                            <div
                                                className="h-full rounded-full bg-primary transition-[width] duration-150"
                                                style={{ width: `${attachment.progress || 0}%` }}
                                            />
                                        </div>
                                    )}
                                    {attachment.status === 'uploaded' && (
                                        <div className="mt-2 h-1 w-full rounded-full bg-emerald-500" />
                                    )}
                                    {attachment.status === 'failed' && (
                                        <div className="mt-2 flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => retryAttachment(attachment.id)}
                                                disabled={!hasRetriesRemaining}
                                                aria-disabled={!hasRetriesRemaining}
                                                className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                                            >
                                                <RotateCcw className="h-3.5 w-3.5" />
                                                Retry
                                            </button>
                                            {!hasRetriesRemaining && (
                                                <span className="text-xs text-amber-600 dark:text-amber-400">
                                                    Max retries exceeded
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="relative rounded-[28px] border border-zinc-200 bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-zinc-800 dark:bg-zinc-950">
            {mentionQuery !== null && participants && participants.length > 0 && (
                <MentionDropdown
                    query={mentionQuery}
                    participants={participants}
                    onSelect={handleMentionSelect}
                    onClose={() => setMentionQuery(null)}
                />
            )}
            <div className="flex items-end gap-2">
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                />
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!canSend}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    aria-label="Add attachment"
                >
                    <Paperclip className="h-4 w-4" />
                </button>
                <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={handleChange}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            void handleSend();
                        }
                    }}
                    onPaste={(event) => {
                        const items = Array.from(event.clipboardData?.items || []);
                        const imageItem = items.find((item) => item.type.startsWith('image/'));
                        if (!imageItem) return; // normal text paste
                        event.preventDefault();
                        const file = imageItem.getAsFile();
                        if (!file) return;
                        const timestamp = Date.now();
                        const extension = file.type.split('/')[1] || 'png';
                        const renamedFile = new File([file], `pasted-image-${timestamp}.${extension}`, { type: file.type });
                        const availableSlots = Math.max(0, MAX_ATTACHMENTS - attachmentsRef.current.length);
                        if (availableSlots === 0) {
                            toast.info('Maximum attachments reached');
                            return;
                        }
                        void compressImage(renamedFile).then((compressedFile) => {
                            const newAttachment: PendingAttachment = {
                                id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                                file: compressedFile,
                                preview: URL.createObjectURL(compressedFile),
                                status: 'queued',
                                progress: 0,
                                attempts: 0,
                            };
                            setAttachments((prev) => [...prev, newAttachment]);
                        });
                    }}
                    placeholder={!capability ? 'Checking messaging permissions…' : canSend ? 'Type a message…' : 'Messaging unavailable'}
                    disabled={!canSend}
                    rows={1}
                    className="max-h-[120px] min-h-[44px] flex-1 resize-none rounded-[22px] border border-transparent bg-zinc-50 px-4 py-3 text-sm outline-none transition-colors focus:border-primary/25 focus:bg-white focus:ring-2 focus:ring-primary/10 dark:bg-zinc-900 dark:focus:bg-zinc-950"
                />
                <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={!canSubmit}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full app-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Send message"
                >
                    <SendHorizonal
                        className="h-4 w-4"
                        style={sendAnimating ? { animation: 'send-fly 300ms ease-out forwards' } : undefined}
                    />
                </button>
            </div>
            {draft.length > MAX_MESSAGE_LENGTH * 0.8 && (
                <span className={`absolute bottom-1 right-14 text-[10px] ${
                    draft.length > MAX_MESSAGE_LENGTH ? 'font-semibold text-red-500' : draft.length > MAX_MESSAGE_LENGTH * 0.95 ? 'text-red-400' : 'text-zinc-400'
                }`}>
                    {draft.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}
                </span>
            )}
            </div>
        </div>
    );
}
