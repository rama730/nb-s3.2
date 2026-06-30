'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Loader2, Paperclip, SendHorizonal } from 'lucide-react';
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
    isMessagingStructuredActionsEnabled,
} from '@/lib/features/messages';
import {
    analyzeDraftCodeSnippet,
    formatDraftWithCodeSnippet,
    looksLikeCodeSnippet,
} from '@/lib/messages/code-snippets';
import { cn } from '@/lib/utils';
import { ComposerAttachmentsPanel } from './ComposerAttachmentsPanel';
import { ComposerContextPanel } from './ComposerContextPanel';
import { ComposerReplyBanner } from './ComposerReplyBanner';
import { ComposerSlashMenu } from './ComposerSlashMenu';
import { ComposerWorkflowNotice } from './ComposerWorkflowNotice';
import { MentionDropdown } from './MentionDropdown';
import {
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
    onComposerEngagement?: () => void;
    onComposerHeightChange?: (height: number) => void;
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
    onComposerEngagement,
    onComposerHeightChange,
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
    const composerRootRef = useRef<HTMLDivElement>(null);
    const composerShellRef = useRef<HTMLDivElement>(null);
    const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const typingActiveRef = useRef(false);
    const composerHeightRef = useRef(0);
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // Height > 50px indicates multiple lines
                setIsExpanded(entry.contentRect.height > 50);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!onComposerHeightChange) return;
        const el = composerRootRef.current;
        if (!el) return;

        const publishHeight = () => {
            const nextHeight = Math.ceil(el.getBoundingClientRect().height);
            if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
            if (Math.abs(nextHeight - composerHeightRef.current) < 1) return;
            composerHeightRef.current = nextHeight;
            onComposerHeightChange(nextHeight);
        };

        publishHeight();
        window.addEventListener('resize', publishHeight);

        if (typeof ResizeObserver === 'undefined') {
            return () => window.removeEventListener('resize', publishHeight);
        }

        const observer = new ResizeObserver(publishHeight);
        observer.observe(el);

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', publishHeight);
        };
    }, [onComposerHeightChange]);

    const structuredActionsEnabled = isMessagingStructuredActionsEnabled(user?.id ?? null);

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
        const el = inputRef.current;
        if (!el) return;
        const supportsFieldSizing = typeof CSS !== 'undefined'
            && typeof CSS.supports === 'function'
            && CSS.supports('field-sizing', 'content');
        if (!supportsFieldSizing) {
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
        }
        el.dataset.overflowing = el.scrollHeight > 160 ? 'true' : 'false';
    }, [draft]);

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
            onComposerEngagement?.();
            updateTypingState(true);
            scheduleTypingStop();
        } else {
            clearTypingIdleTimer();
            updateTypingState(false);
        }

        syncCommandsFromInput(nextValue, event.target.selectionStart);

        const el = inputRef.current;
        if (el) {
            const supportsFieldSizing = typeof CSS !== 'undefined'
                && typeof CSS.supports === 'function'
                && CSS.supports('field-sizing', 'content');
            if (!supportsFieldSizing) {
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }
            el.dataset.overflowing = el.scrollHeight > 160 ? 'true' : 'false';
        }
    }, [
        clearTypingIdleTimer,
        conversationId,
        onComposerEngagement,
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

    const draftCodeAnalysis = useMemo(() => analyzeDraftCodeSnippet(draft), [draft]);
    const preparedDraftLength = draftCodeAnalysis.length;
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
        && preparedDraftLength <= MAX_MESSAGE_LENGTH;
    const canSendStructured = canSend && !isSending;

    const workflowNotice = useMemo(() => getComposerWorkflowNotice(capability), [capability]);
    const codeSnippetPreview = draftCodeAnalysis.preview;

    const insertComposerText = useCallback((text: string, selectionStart: number, selectionEnd: number) => {
        const nextDraft = `${draft.slice(0, selectionStart)}${text}${draft.slice(selectionEnd)}`;
        const nextCursor = selectionStart + text.length;
        setDraft(conversationId, nextDraft);
        requestAnimationFrame(() => {
            if (!inputRef.current) return;
            inputRef.current.selectionStart = nextCursor;
            inputRef.current.selectionEnd = nextCursor;
            inputRef.current.focus();
        });
    }, [conversationId, draft, setDraft]);

    return (
        <div ref={composerRootRef} className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 mx-auto w-full min-w-[320px] ${
            isPopup ? 'px-3 py-3 max-w-[95%]' : 'px-5 py-4 max-w-[50%]'
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

            <ComposerContextPanel
                chips={visibleContextChips}
                hasStructuredDraft={hasStructuredDraft}
                onClear={() => setPendingContextChips([])}
                onRemove={handleRemoveContextChip}
            />

            <ComposerAttachmentsPanel
                attachments={attachments.attachments}
                maxUploadRetries={MAX_UPLOAD_RETRIES}
                onRemoveAttachment={attachments.removeAttachment}
                onRetryAttachment={attachments.retryAttachment}
            />

            {codeSnippetPreview ? (
                <div className="pointer-events-auto mb-2 flex min-w-0 items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50/95 px-3 py-2 text-xs text-zinc-600 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95 dark:text-zinc-300">
                    <Code2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="min-w-0 truncate font-semibold">
                        {codeSnippetPreview.language || 'code'}
                    </span>
                    <span className="shrink-0 text-zinc-400">
                        {codeSnippetPreview.lineCount} line{codeSnippetPreview.lineCount === 1 ? '' : 's'}
                    </span>
                </div>
            ) : null}

            <div
                ref={composerShellRef}
                className="relative flex-1"
            >

                {mentionQuery !== null && participants && participants.length > 0 ? (
                    <MentionDropdown
                        query={mentionQuery}
                        participants={participants}
                        onSelect={handleMentionSelect}
                        onClose={() => setMentionQuery(null)}
                    />
                ) : null}

                <div className="pointer-events-auto flex items-end gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={attachments.handleFileSelect}
                    />
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!canSend}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100/80 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-800/80 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 mb-0.5"
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
	                            if (!imageItem) {
	                                const pastedText = event.clipboardData?.getData('text/plain') || '';
	                                if (!looksLikeCodeSnippet(pastedText)) return;

	                                event.preventDefault();
	                                const selectionStart = event.currentTarget.selectionStart;
	                                const selectionEnd = event.currentTarget.selectionEnd;
	                                const formattedSnippet = formatDraftWithCodeSnippet(pastedText);
	                                insertComposerText(formattedSnippet, selectionStart, selectionEnd);
	                                onComposerEngagement?.();
	                                updateTypingState(true);
	                                scheduleTypingStop();
	                                return;
	                            }

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
                        style={{ fieldSizing: 'content' } as React.CSSProperties}
                        className={cn(
                            "max-h-[160px] min-h-[44px] flex-1 resize-none overflow-hidden border border-transparent bg-zinc-50 px-4 py-3 text-sm outline-none transition-all duration-200 data-[overflowing=true]:overflow-y-auto dark:bg-zinc-900 app-scroll",
                            isExpanded ? "rounded-2xl" : "rounded-full"
                        )}
                    />
                    <button
                        type="button"
                        onClick={() => void handleSend()}
                        disabled={!canSubmit || isSending || hasUploadingAttachments}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full app-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={hasUploadingAttachments ? 'Uploading attachments' : 'Send message'}
                    >
                        {hasUploadingAttachments || isSending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <SendHorizonal
                                className="h-4 w-4"
                                style={sendAnimating ? { animation: 'send-fly 300ms ease-out forwards' } : undefined}
                            />
                        )}
                    </button>
                </div>
                {preparedDraftLength > MAX_MESSAGE_LENGTH * 0.8 ? (
                    <span className={`absolute bottom-1 right-14 text-[10px] ${
                        preparedDraftLength > MAX_MESSAGE_LENGTH
                            ? 'font-semibold text-red-500'
                            : preparedDraftLength > MAX_MESSAGE_LENGTH * 0.95
                                ? 'text-red-400'
                                : 'text-zinc-400'
                    }`}>
                        {preparedDraftLength.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}
                    </span>
                ) : null}
            </div>
        </div>
    );
}
