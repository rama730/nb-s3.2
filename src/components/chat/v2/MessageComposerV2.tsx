'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Loader2, Paperclip, SendHorizonal } from 'lucide-react';
import { toast } from 'sonner';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';
import { type MessageWithSender } from '@/app/actions/messaging';
import { type ConversationCapabilityV2 } from '@/app/actions/messaging/v2';
import {
    canSendFromCapability,
    getComposerWorkflowNotice,
} from '@/lib/chat/composer-workflow';
import {
    analyzeDraftCodeSnippet,
    formatDraftWithCodeSnippet,
    looksLikeCodeSnippet,
} from '@/lib/messages/code-snippets';
import { cn } from '@/lib/utils';
import { ComposerAttachmentsPanel } from './ComposerAttachmentsPanel';
import { ComposerReplyBanner } from './ComposerReplyBanner';
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
    surface?: 'page' | 'popup';
    sendTyping?: (isTyping: boolean) => Promise<void> | void;
    onWillSend?: () => void;
    onComposerEngagement?: () => void;
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
    surface = 'page',
    sendTyping,
    onWillSend,
    onComposerEngagement,
    onClearReply,
    onAddFiles,
    participants,
}: MessageComposerV2Props) {
    const draft = useMessagesV2UiStore((state) => state.draftsByConversation[conversationId] || '');
    const setDraft = useMessagesV2UiStore((state) => state.setDraft);
    const clearDraft = useMessagesV2UiStore((state) => state.clearDraft);
    const [sendAnimating, setSendAnimating] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const typingIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const typingActiveRef = useRef(false);
    const commands = useMessageComposerCommands({
        conversationId,
        draft,
        setDraft,
        inputRef,
        participants,
    });
    const {
        mentionQuery,
        setMentionQuery,
        handleMentionSelect,
        syncCommandsFromInput,
    } = commands;

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

    const actions = useMessageComposerActions({
        conversationId,
        targetUserId,
        capability,
        replyTarget,
        draft,
        clearDraft,
        attachments: attachments.attachments,
        clearAttachments: attachments.clearAttachments,
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
        handleSend,
        handleConnectionAction,
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
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void handleSend();
        }
    }, [handleSend]);

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
        <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 mx-auto w-full min-w-[320px] ${
            isPopup ? 'px-3 py-3 max-w-[95%]' : 'px-5 py-4 max-w-[50%]'
        }`}>
            {workflowNotice ? (
                <ComposerWorkflowNotice
                    workflowNotice={workflowNotice}
                    isPopup={isPopup}
                    requestLoading={requestLoading}
                    onConnectionAction={handleConnectionAction}
                />
            ) : null}

            {replyTarget ? (
                <ComposerReplyBanner
                    replyTarget={replyTarget}
                    surface={surface}
                    onClearReply={onClearReply}
                />
            ) : null}

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

            <div className="relative flex-1">

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
                        onBlur={() => {
                            clearTypingIdleTimer();
                            updateTypingState(false);
                        }}
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
                            "max-h-[160px] min-h-[44px] flex-1 resize-none overflow-hidden border border-zinc-200 focus:border-zinc-300 dark:border-zinc-850 dark:focus:border-zinc-750 bg-white/60 dark:bg-zinc-950/60 backdrop-blur-md px-4 py-3 text-sm outline-none transition-all duration-200 data-[overflowing=true]:overflow-y-auto rounded-2xl app-scroll shadow-sm"
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
