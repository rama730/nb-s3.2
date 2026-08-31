'use client';

import { useCallback, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { acceptConnectionRequest, cancelConnectionRequest, sendConnectionRequest } from '@/app/actions/connections';
import type { MessageWithSender, UploadedAttachment } from '@/app/actions/messaging';
import type { ConversationCapabilityV2 } from '@/app/actions/messaging/v2';
import { canSendFromCapability } from '@/lib/chat/composer-workflow';
import { formatDraftWithCodeSnippet } from '@/lib/messages/code-snippets';
import { upsertThreadConversation } from '@/lib/messages/v2-cache';
import { recordMessagesDraftLifecycle } from '@/lib/messages/observability';
import { refreshConversationCache } from '@/lib/messages/v2-refresh';
import { useMessagesActions } from '@/hooks/useMessagesV2';
import { useMessagesV2OutboxStore } from '@/stores/messagesV2OutboxStore';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';
import type {
    PendingAttachment,
} from './message-composer-v2-shared';

interface UseMessageComposerActionsParams {
    conversationId: string;
    targetUserId?: string | null;
    capability: ConversationCapabilityV2 | null;
    replyTarget: MessageWithSender | null;
    draft: string;
    clearDraft: (conversationId: string) => void;
    attachments: PendingAttachment[];
    clearAttachments: (keepBackendUploads?: boolean) => void;
    onClearReply: () => void;
    inputRef: RefObject<HTMLTextAreaElement | null>;
    clearTypingIdleTimer: () => void;
    updateTypingState: (isTyping: boolean) => void;
    setSendAnimating: Dispatch<SetStateAction<boolean>>;
    onWillSend?: () => void;
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
    onClearReply,
    inputRef,
    clearTypingIdleTimer,
    updateTypingState,
    setSendAnimating,
    onWillSend,
}: UseMessageComposerActionsParams) {
    const queryClient = useQueryClient();
    const { sendConversationMessage } = useMessagesActions();
    const upsertOutboxItem = useMessagesV2OutboxStore((state) => state.upsertItem);
    const removeOutboxItem = useMessagesV2OutboxStore((state) => state.removeItem);
    const markOutboxItem = useMessagesV2OutboxStore((state) => state.markItem);
    const setSelectedConversationId = useMessagesV2UiStore((state) => state.setSelectedConversationId);
    const [isSending, setIsSending] = useState(false);
    const [requestLoading, setRequestLoading] = useState(false);

    const queueOutgoingMessage = useCallback((params: {
        clientMessageId: string;
        content: string;
        uploadedAttachments?: UploadedAttachment[];
        state: 'sending' | 'queued' | 'failed';
    }) => {
        upsertOutboxItem({
            clientMessageId: params.clientMessageId,
            conversationId,
            targetUserId: targetUserId ?? null,
            mode: 'plain',
            content: params.content,
            attachments: params.uploadedAttachments ?? [],
            replyToMessageId: replyTarget?.id || null,
            contextChips: [],
            structuredAction: null,
            createdAt: Date.now(),
            attempts: 0,
            nextRetryAt: Date.now(),
            state: params.state,
        });
    }, [conversationId, replyTarget?.id, targetUserId, upsertOutboxItem]);

    const refreshMessagingState = useCallback(async () => {
        await refreshConversationCache(queryClient, conversationId);
    }, [conversationId, queryClient]);

    const beginSendAnimation = useCallback(() => {
        onWillSend?.();
        setIsSending(true);
        setSendAnimating(true);
        setTimeout(() => setSendAnimating(false), 300);
        clearTypingIdleTimer();
        updateTypingState(false);
    }, [clearTypingIdleTimer, onWillSend, setSendAnimating, updateTypingState]);

    const handleSend = useCallback(async () => {
        const text = formatDraftWithCodeSnippet(draft);
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

        clearDraft(conversationId);
        onClearReply();
        clearAttachments(true);
        if (inputRef.current) inputRef.current.style.height = 'auto';

        queueOutgoingMessage({
            clientMessageId,
            content: text,
            uploadedAttachments,
            state: 'sending',
        });
        beginSendAnimation();

        try {
            const result = await sendConversationMessage.mutateAsync({
                conversationId,
                targetUserId: targetUserId ?? null,
                content: text,
                attachments: uploadedAttachments,
                clientMessageId,
                replyToMessageId: replyTarget?.id || null,
                contextChips: [],
            });

            removeOutboxItem(clientMessageId);
            if (result.conversation) {
                upsertThreadConversation(queryClient, result.conversation);
            }
            // Transition from draft to real conversation after first message send
            if (conversationId.startsWith('draft:') && result.conversationId && result.conversationId !== conversationId) {
                recordMessagesDraftLifecycle('first_message_sent');
                setSelectedConversationId(result.conversationId);
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
        queryClient,
        queueOutgoingMessage,
        removeOutboxItem,
        replyTarget?.id,
        sendConversationMessage,
        setSelectedConversationId,
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

    return {
        isSending,
        requestLoading,
        handleSend,
        handleConnectionAction,
    };
}
