'use client';

import { useCallback, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
    acceptApplicationAction,
    rejectApplicationAction,
    reopenApplicationAction,
    withdrawApplicationAction,
} from '@/app/actions/applications';
import { acceptConnectionRequest, cancelConnectionRequest, sendConnectionRequest } from '@/app/actions/connections';
import type { MessageWithSender, UploadedAttachment } from '@/app/actions/messaging';
import type { ConversationCapabilityV2 } from '@/app/actions/messaging/v2';
import { canSendFromCapability } from '@/lib/chat/composer-workflow';
import { upsertThreadConversation } from '@/lib/messages/v2-cache';
import { refreshConversationCache } from '@/lib/messages/v2-refresh';
import { useMessagesActions } from '@/hooks/useMessagesV2';
import {
    type MessagesV2OutboxStructuredAction,
    useMessagesV2OutboxStore,
} from '@/stores/messagesV2OutboxStore';
import type { MessageContextChip } from '@/lib/messages/structured';
import type {
    ApplicationWorkflowAction,
    PendingAttachment,
    StructuredActionDraft,
} from './message-composer-v2-shared';

interface UseMessageComposerActionsParams {
    conversationId: string;
    targetUserId?: string | null;
    capability: ConversationCapabilityV2 | null;
    replyTarget: MessageWithSender | null;
    draft: string;
    clearDraft: (conversationId: string) => void;
    attachments: PendingAttachment[];
    clearAttachments: () => void;
    pendingContextChips: MessageContextChip[];
    setPendingContextChips: Dispatch<SetStateAction<MessageContextChip[]>>;
    structuredDraft: StructuredActionDraft;
    closeSlashMenu: () => void;
    clearStructuredDraft: () => void;
    buildStructuredDraftContextChips: (draftState: StructuredActionDraft) => MessageContextChip[];
    onClearReply: () => void;
    inputRef: RefObject<HTMLTextAreaElement | null>;
    clearTypingIdleTimer: () => void;
    updateTypingState: (isTyping: boolean) => void;
    setSendAnimating: Dispatch<SetStateAction<boolean>>;
}

function createClientMessageId() {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useMessageComposerActions({
    conversationId,
    targetUserId,
    capability,
    replyTarget,
    draft,
    clearDraft,
    attachments,
    clearAttachments,
    pendingContextChips,
    setPendingContextChips,
    structuredDraft,
    closeSlashMenu,
    clearStructuredDraft,
    buildStructuredDraftContextChips,
    onClearReply,
    inputRef,
    clearTypingIdleTimer,
    updateTypingState,
    setSendAnimating,
}: UseMessageComposerActionsParams) {
    const queryClient = useQueryClient();
    const { sendConversationMessage, sendStructuredMessage } = useMessagesActions();
    const upsertOutboxItem = useMessagesV2OutboxStore((state) => state.upsertItem);
    const removeOutboxItem = useMessagesV2OutboxStore((state) => state.removeItem);
    const markOutboxItem = useMessagesV2OutboxStore((state) => state.markItem);
    const [isSending, setIsSending] = useState(false);
    const [requestLoading, setRequestLoading] = useState(false);
    const [applicationActionLoading, setApplicationActionLoading] = useState<ApplicationWorkflowAction | null>(null);

    const queueOutgoingMessage = useCallback((params: {
        clientMessageId: string;
        content: string;
        uploadedAttachments?: UploadedAttachment[];
        state: 'sending' | 'queued' | 'failed';
        contextChips?: MessageContextChip[];
        structuredAction?: MessagesV2OutboxStructuredAction | null;
    }) => {
        upsertOutboxItem({
            clientMessageId: params.clientMessageId,
            conversationId,
            targetUserId: targetUserId ?? null,
            mode: params.structuredAction ? 'structured' : 'plain',
            content: params.content,
            attachments: params.uploadedAttachments ?? [],
            replyToMessageId: replyTarget?.id || null,
            contextChips: params.contextChips ?? [],
            structuredAction: params.structuredAction ?? null,
            createdAt: Date.now(),
            attempts: 0,
            nextRetryAt: Date.now(),
            state: params.state,
        });
    }, [conversationId, replyTarget?.id, targetUserId, upsertOutboxItem]);

    const refreshMessagingState = useCallback(async () => {
        await refreshConversationCache(queryClient, conversationId, { includeUnread: true });
    }, [conversationId, queryClient]);

    const beginSendAnimation = useCallback(() => {
        setIsSending(true);
        setSendAnimating(true);
        setTimeout(() => setSendAnimating(false), 300);
        clearTypingIdleTimer();
        updateTypingState(false);
    }, [clearTypingIdleTimer, setSendAnimating, updateTypingState]);

    const handleSendStructured = useCallback(async () => {
        if (!structuredDraft.kind || isSending || !canSendFromCapability(capability)) {
            return;
        }

        const summary = structuredDraft.summary.trim()
            || (
                structuredDraft.kind === 'project_invite'
                    ? 'Invitation to collaborate on a project.'
                    : structuredDraft.kind === 'availability_request'
                        ? 'Can you confirm your current availability?'
                        : structuredDraft.kind === 'task_approval'
                            ? 'Please review this task for approval.'
                            : structuredDraft.kind === 'rate_share'
                                ? `${structuredDraft.amount.trim()} / ${structuredDraft.unit.trim()}`
                                : structuredDraft.kind === 'handoff_summary'
                                    ? structuredDraft.next.trim() || structuredDraft.completed.trim() || structuredDraft.blocked.trim() || 'Handoff summary'
                                    : 'Requesting feedback on this work.'
            );

        if (structuredDraft.kind === 'rate_share' && (!structuredDraft.amount.trim() || !structuredDraft.unit.trim())) {
            toast.error('Enter both a rate amount and unit');
            return;
        }
        if (structuredDraft.kind === 'project_invite' && !structuredDraft.projectId) {
            toast.error('Select a project to invite into');
            return;
        }
        if (structuredDraft.kind === 'task_approval' && !structuredDraft.taskId) {
            toast.error('Select a task to approve');
            return;
        }

        const contextChips = buildStructuredDraftContextChips(structuredDraft);
        const clientMessageId = createClientMessageId();
        const optimisticStructuredAction: MessagesV2OutboxStructuredAction = {
            kind: structuredDraft.kind,
            title: structuredDraft.title.trim() || null,
            summary,
            note: structuredDraft.note.trim() || null,
            projectId: structuredDraft.projectId || null,
            taskId: structuredDraft.taskId || null,
            fileId: structuredDraft.fileId || null,
            profileId: structuredDraft.profileId || null,
            amount: structuredDraft.amount.trim() || null,
            unit: structuredDraft.unit.trim() || null,
            dueAt: structuredDraft.dueAt || null,
            completed: structuredDraft.completed.trim() || null,
            blocked: structuredDraft.blocked.trim() || null,
            next: structuredDraft.next.trim() || null,
        };

        beginSendAnimation();
        queueOutgoingMessage({
            clientMessageId,
            content: '',
            state: 'sending',
            contextChips,
            structuredAction: optimisticStructuredAction,
        });
        onClearReply();
        setPendingContextChips([]);
        clearStructuredDraft();
        closeSlashMenu();

        try {
            const result = await sendStructuredMessage.mutateAsync({
                conversationId,
                targetUserId: targetUserId ?? null,
                clientMessageId,
                kind: structuredDraft.kind,
                title: structuredDraft.title.trim() || null,
                summary,
                note: structuredDraft.note.trim() || null,
                projectId: structuredDraft.projectId || null,
                taskId: structuredDraft.taskId || null,
                fileId: structuredDraft.fileId || null,
                profileId: structuredDraft.profileId || null,
                amount: structuredDraft.amount.trim() || null,
                unit: structuredDraft.unit.trim() || null,
                dueAt: structuredDraft.dueAt || null,
                completed: structuredDraft.completed.trim() || null,
                blocked: structuredDraft.blocked.trim() || null,
                next: structuredDraft.next.trim() || null,
                contextChips,
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
            toast.info('Structured message queued. It will retry automatically.');
        } finally {
            setIsSending(false);
            inputRef.current?.focus();
        }
    }, [
        beginSendAnimation,
        buildStructuredDraftContextChips,
        capability,
        clearStructuredDraft,
        closeSlashMenu,
        conversationId,
        inputRef,
        isSending,
        markOutboxItem,
        onClearReply,
        queryClient,
        queueOutgoingMessage,
        removeOutboxItem,
        sendStructuredMessage,
        setPendingContextChips,
        structuredDraft,
        targetUserId,
    ]);

    const handleSend = useCallback(async () => {
        const text = draft.trim();
        const uploadedAttachments = attachments
            .filter((attachment) => attachment.status === 'uploaded' && attachment.uploaded && !attachment.error)
            .map((attachment) => attachment.uploaded!);

        const hasStillUploading = attachments.some((attachment) => attachment.status === 'queued' || attachment.status === 'uploading');
        if (hasStillUploading) {
            toast.info('Please wait for attachments to finish uploading');
            return;
        }
        if (!text && uploadedAttachments.length === 0) {
            return;
        }
        if (isSending) return;

        const clientMessageId = createClientMessageId();
        beginSendAnimation();
        const contextChips = pendingContextChips;

        clearDraft(conversationId);
        onClearReply();
        setPendingContextChips([]);
        clearAttachments();
        if (inputRef.current) inputRef.current.style.height = 'auto';

        queueOutgoingMessage({
            clientMessageId,
            content: text,
            uploadedAttachments,
            state: 'sending',
            contextChips,
        });

        try {
            const result = await sendConversationMessage.mutateAsync({
                conversationId,
                targetUserId: targetUserId ?? null,
                content: text,
                attachments: uploadedAttachments,
                clientMessageId,
                replyToMessageId: replyTarget?.id || null,
                contextChips,
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
            toast.info('Message queued. It will retry automatically.');
        } finally {
            setIsSending(false);
            inputRef.current?.focus();
        }
    }, [
        attachments,
        beginSendAnimation,
        clearAttachments,
        clearDraft,
        conversationId,
        draft,
        inputRef,
        isSending,
        markOutboxItem,
        onClearReply,
        pendingContextChips,
        queryClient,
        queueOutgoingMessage,
        removeOutboxItem,
        replyTarget?.id,
        sendConversationMessage,
        setPendingContextChips,
        targetUserId,
    ]);

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
                const idempotencyKey = createClientMessageId();
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

    return {
        isSending,
        requestLoading,
        applicationActionLoading,
        handleSendStructured,
        handleSend,
        handleConnectionAction,
        handleApplicationAction,
    };
}
