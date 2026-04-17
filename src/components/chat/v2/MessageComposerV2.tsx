'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Paperclip, SendHorizonal } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';
import { type MessageWithSender } from '@/app/actions/messaging';
import { type ConversationCapabilityV2 } from '@/app/actions/messaging/v2';
import type { MessagingStructuredCatalogV2 } from '@/app/actions/messaging/collaboration';
import { useMessagingStructuredCatalog } from '@/hooks/useMessagesV2';
import {
    canSendFromCapability,
    getComposerWorkflowNotice,
} from '@/lib/chat/composer-workflow';
import {
    isMessagingGuidedFirstContactEnabled,
    isMessagingStructuredActionsEnabled,
} from '@/lib/features/messages';
import { ComposerAttachmentsPanel } from './ComposerAttachmentsPanel';
import { ComposerContextPanel } from './ComposerContextPanel';
import { ComposerFirstContactGuidance } from './ComposerFirstContactGuidance';
import { ComposerReplyBanner } from './ComposerReplyBanner';
import { ComposerSlashMenu } from './ComposerSlashMenu';
import { ComposerWorkflowNotice } from './ComposerWorkflowNotice';
import { MentionDropdown } from './MentionDropdown';
import {
    GUIDED_FIRST_CONTACT_TEMPLATES,
    MAX_UPLOAD_RETRIES,
} from './message-composer-v2-shared';
import { useMessageComposerActions } from './useMessageComposerActions';
import { useMessageComposerAttachments } from './useMessageComposerAttachments';
import { useMessageComposerCommands } from './useMessageComposerCommands';

interface MessageComposerV2Props {
    conversationId: string;
    targetUserId?: string | null;
    capability: ConversationCapabilityV2 | null;
    replyTarget: MessageWithSender | null;
    messageCount?: number;
    surface?: 'page' | 'popup';
    sendTyping?: (isTyping: boolean) => Promise<void> | void;
    onWillSend?: () => void;
    onClearReply: () => void;
    onAddFiles?: (register: (files: File[]) => void) => void;
    participants?: Array<{ id: string; username: string | null; fullName: string | null; avatarUrl: string | null }>;
}

const TYPING_IDLE_MS = 1800;
const MAX_MESSAGE_LENGTH = 4000;

export function MessageComposerV2({
    conversationId,
    targetUserId,
    capability,
    replyTarget,
    messageCount = 0,
    surface = 'page',
    sendTyping,
    onWillSend,
    onClearReply,
    onAddFiles,
    participants,
}: MessageComposerV2Props) {
    const { user } = useAuth();
    const draft = useMessagesV2UiStore((state) => state.draftsByConversation[conversationId] || '');
    const setDraft = useMessagesV2UiStore((state) => state.setDraft);
    const clearDraft = useMessagesV2UiStore((state) => state.clearDraft);
    const [sendAnimating, setSendAnimating] = useState(false);
    const [catalogData, setCatalogData] = useState<MessagingStructuredCatalogV2 | undefined>(undefined);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const composerShellRef = useRef<HTMLDivElement>(null);
    const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const typingActiveRef = useRef(false);

    const structuredActionsEnabled = isMessagingStructuredActionsEnabled(user?.id ?? null);
    const guidedFirstContactEnabled = isMessagingGuidedFirstContactEnabled(user?.id ?? null);

    const commands = useMessageComposerCommands({
        conversationId,
        draft,
        setDraft,
        inputRef,
        participants,
        structuredActionsEnabled,
        structuredCatalogData: catalogData,
    });
    const {
        mentionQuery,
        setMentionQuery,
        pendingContextChips,
        setPendingContextChips,
        slashMenuOpen,
        slashSelectedIndex,
        setSlashSelectedIndex,
        structuredDraft,
        setStructuredDraft,
        slashItems,
        openSlashMenu,
        closeSlashMenu,
        returnToSlashList,
        clearStructuredDraft,
        handleSlashItemSelect,
        handleMentionSelect,
        applyGuidedTemplate,
        handleRemoveContextChip,
        buildStructuredDraftContextChips,
        syncCommandsFromInput,
        activeStructuredOption,
        structuredSubmitLabel,
        hasStructuredDraft,
        visibleContextChips,
    } = commands;

    const structuredCatalog = useMessagingStructuredCatalog(
        conversationId,
        targetUserId ?? null,
        structuredActionsEnabled
            && (
                slashMenuOpen
                || pendingContextChips.length > 0
                || Boolean(structuredDraft.kind)
            ),
    );

    useEffect(() => {
        setCatalogData(structuredCatalog.data);
    }, [structuredCatalog.data]);

    useEffect(() => {
        setCatalogData(undefined);
    }, [conversationId]);

    const attachments = useMessageComposerAttachments({
        conversationId,
        onAddFiles,
    });

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
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (isMobile) return;
        const timer = setTimeout(() => inputRef.current?.focus(), 100);
        return () => clearTimeout(timer);
    }, [conversationId]);

    useEffect(() => {
        if (!slashMenuOpen) return;
        const handlePointerDown = (event: MouseEvent) => {
            if (!composerShellRef.current?.contains(event.target as Node)) {
                closeSlashMenu();
            }
        };
        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [closeSlashMenu, slashMenuOpen]);

    const actions = useMessageComposerActions({
        conversationId,
        targetUserId,
        capability,
        replyTarget,
        draft,
        clearDraft,
        attachments: attachments.attachments,
        clearAttachments: attachments.clearAttachments,
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
        onWillSend,
    });
    const {
        isSending,
        requestLoading,
        applicationActionLoading,
        handleSendStructured,
        handleSend,
        handleConnectionAction,
        handleApplicationAction,
    } = actions;

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

        syncCommandsFromInput(nextValue, event.target.selectionStart);

        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
        }
    }, [
        clearTypingIdleTimer,
        conversationId,
        scheduleTypingStop,
        setDraft,
        syncCommandsFromInput,
        updateTypingState,
    ]);

    const handleComposerKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (slashMenuOpen && !structuredDraft.kind) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSlashSelectedIndex((current) =>
                    slashItems.length === 0 ? 0 : (current + 1) % slashItems.length,
                );
                return;
            }

            if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSlashSelectedIndex((current) =>
                    slashItems.length === 0
                        ? 0
                        : (current - 1 + slashItems.length) % slashItems.length,
                );
                return;
            }

            if (event.key === 'Enter' && !event.shiftKey) {
                const currentItem = slashItems[slashSelectedIndex];
                if (currentItem) {
                    event.preventDefault();
                    handleSlashItemSelect(currentItem);
                    return;
                }
            }
        }

        if (event.key === 'Escape' && slashMenuOpen) {
            event.preventDefault();
            closeSlashMenu();
            return;
        }

        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void handleSend();
        }
    }, [
        closeSlashMenu,
        handleSend,
        handleSlashItemSelect,
        setSlashSelectedIndex,
        slashItems,
        slashMenuOpen,
        slashSelectedIndex,
        structuredDraft.kind,
    ]);

    const canSend = canSendFromCapability(capability);
    const isPopup = surface === 'popup';
    const hasUploadingAttachments = attachments.attachments.some((attachment) =>
        attachment.status === 'queued' || attachment.status === 'uploading',
    );
    const hasSendableContent = Boolean(
        draft.trim() || attachments.attachments.some((attachment) => attachment.status === 'uploaded' && attachment.uploaded && !attachment.error),
    );
    const canSubmit = canSend
        && !isSending
        && !hasUploadingAttachments
        && (hasSendableContent || Boolean(draft.trim()))
        && draft.length <= MAX_MESSAGE_LENGTH;
    const canSendStructured = canSend && !isSending;

    const showFirstContactGuidance = guidedFirstContactEnabled
        && canSend
        && capability?.conversationType === 'dm'
        && !capability?.isConnected
        && messageCount === 0
        && !draft.trim()
        && pendingContextChips.length === 0
        && attachments.attachments.length === 0
        && !replyTarget
        && !slashMenuOpen
        && !structuredDraft.kind;

    const workflowNotice = useMemo(() => getComposerWorkflowNotice(capability), [capability]);

    return (
        <div className={`border-t border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${
            isPopup ? 'px-3 py-3' : 'px-5 py-4'
        }`}>
            {workflowNotice ? (
                <ComposerWorkflowNotice
                    workflowNotice={workflowNotice}
                    isPopup={isPopup}
                    requestLoading={requestLoading}
                    applicationActionLoading={applicationActionLoading}
                    onConnectionAction={handleConnectionAction}
                    onApplicationAction={(action) => void handleApplicationAction(action)}
                />
            ) : null}

            {replyTarget ? (
                <ComposerReplyBanner
                    replyTarget={replyTarget}
                    surface={surface}
                    onClearReply={onClearReply}
                />
            ) : null}

            {showFirstContactGuidance ? (
                <ComposerFirstContactGuidance
                    templates={GUIDED_FIRST_CONTACT_TEMPLATES}
                    onSelectTemplate={applyGuidedTemplate}
                />
            ) : null}

            <ComposerContextPanel
                chips={visibleContextChips}
                hasStructuredDraft={hasStructuredDraft}
                onClear={() => setPendingContextChips([])}
                onRemove={handleRemoveContextChip}
            />

            <ComposerAttachmentsPanel
                attachments={attachments.attachments}
                uploadsPaused={attachments.uploadsPaused}
                maxUploadRetries={MAX_UPLOAD_RETRIES}
                onTogglePaused={() => attachments.setUploadsPaused((prev) => !prev)}
                onRemoveAttachment={attachments.removeAttachment}
                onRetryAttachment={attachments.retryAttachment}
            />

            <div
                ref={composerShellRef}
                className="relative rounded-[28px] border border-zinc-200 bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-zinc-800 dark:bg-zinc-950"
            >
                <ComposerSlashMenu
                    slashMenuOpen={slashMenuOpen}
                    hasStructuredDraft={hasStructuredDraft}
                    activeStructuredOption={activeStructuredOption}
                    structuredDraft={structuredDraft}
                    structuredCatalog={catalogData}
                    structuredCatalogLoading={structuredCatalog.isLoading}
                    slashItems={slashItems}
                    slashSelectedIndex={slashSelectedIndex}
                    canSendStructured={canSendStructured}
                    structuredSubmitLabel={structuredSubmitLabel}
                    setStructuredDraft={setStructuredDraft}
                    setSlashSelectedIndex={setSlashSelectedIndex}
                    onClose={closeSlashMenu}
                    onReturnToList={returnToSlashList}
                    onSelectItem={handleSlashItemSelect}
                    onSendStructured={() => void handleSendStructured()}
                />

                {mentionQuery !== null && participants && participants.length > 0 ? (
                    <MentionDropdown
                        query={mentionQuery}
                        participants={participants}
                        onSelect={handleMentionSelect}
                        onClose={() => setMentionQuery(null)}
                    />
                ) : null}

                <div className="flex items-end gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={attachments.handleFileSelect}
                    />
                    <button
                        type="button"
                        onClick={() => {
                            if (slashMenuOpen) {
                                closeSlashMenu();
                            } else {
                                openSlashMenu();
                                inputRef.current?.focus();
                            }
                        }}
                        disabled={!structuredActionsEnabled || !canSend}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-sm font-semibold lowercase text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        aria-label="Open message actions"
                    >
                        /
                    </button>
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
                        onKeyDown={handleComposerKeyDown}
                        onPaste={(event) => {
                            const items = Array.from(event.clipboardData?.items || []);
                            const imageItem = items.find((item) => item.type.startsWith('image/'));
                            if (!imageItem) return;

                            event.preventDefault();
                            const file = imageItem.getAsFile();
                            if (!file) return;

                            const timestamp = Date.now();
                            const extension = file.type.split('/')[1] || 'png';
                            const renamedFile = new File([file], `pasted-image-${timestamp}.${extension}`, { type: file.type });
                            void attachments.enqueuePastedImage(renamedFile).then((added) => {
                                if (!added) {
                                    toast.info('Maximum attachments reached');
                                }
                            });
                        }}
                        placeholder={!capability ? 'Checking messaging permissions…' : canSend ? 'Type a message...' : 'Messaging unavailable'}
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
                {draft.length > MAX_MESSAGE_LENGTH * 0.8 ? (
                    <span className={`absolute bottom-1 right-14 text-[10px] ${
                        draft.length > MAX_MESSAGE_LENGTH
                            ? 'font-semibold text-red-500'
                            : draft.length > MAX_MESSAGE_LENGTH * 0.95
                                ? 'text-red-400'
                                : 'text-zinc-400'
                    }`}>
                        {draft.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}
                    </span>
                ) : null}
            </div>
        </div>
    );
}
