'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useAuth } from '@/hooks/useAuth';
import type { MessageWithSender } from '@/app/actions/messaging';
import { editMessage, deleteMessage } from '@/app/actions/messaging';
import { useChatStore } from '@/stores/chatStore';
import { format } from 'date-fns';
import {
    Check,
    CheckCheck,
    ChevronLeft,
    ChevronRight,
    Copy,
    CornerUpLeft,
    Download,
    EllipsisVertical,
    File,
    Pin,
    PinOff,
    Pencil,
    PlayCircle,
    Trash2,
    X,
} from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { normalizeSafeExternalUrl, parseSafeLinkToken } from '@/lib/messages/safe-links';

interface MessageBubbleProps {
    message: MessageWithSender;
    showAvatar?: boolean;
}

type ChatAttachment = {
    id: string;
    type: 'image' | 'video' | 'file';
    url: string;
    filename: string;
    sizeBytes: number | null;
    mimeType: string | null;
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
};

const LINK_OR_MENTION_REGEX = /((?<!\S)@[a-zA-Z0-9_]{2,32}\b|(?:https?:\/\/|www\.)[^\s]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?)/g;

export function MessageBubble({ message, showAvatar = true }: MessageBubbleProps) {
    const { user } = useAuth();
    const setReplyTarget = useChatStore((state) => state.setReplyTarget);
    const refreshMessages = useChatStore((state) => state.refreshMessages);
    const refreshConversations = useChatStore((state) => state.refreshConversations);
    const pinMessage = useChatStore((state) => state.pinMessage);
    const focusMessage = useChatStore((state) => state.focusMessage);
    const isOwn = message.senderId === user?.id;
    const isDeleted = !!message.deletedAt;
    const metadata = (message.metadata ?? null) as Record<string, unknown> | null;
    const isPinned = Boolean(metadata?.pinned);
    const isApplication = metadata?.isApplication === true;
    const applicationStatus = typeof metadata?.status === 'string' ? metadata.status : null;
    const [activeAttachmentId, setActiveAttachmentId] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [draftContent, setDraftContent] = useState(message.content || '');
    const [isActionLoading, setIsActionLoading] = useState(false);
    const [hiddenForViewer, setHiddenForViewer] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isHovered, setIsHovered] = useState(false);

    const attachments = useMemo(
        () => (message.attachments || []) as ChatAttachment[],
        [message.attachments]
    );
    const mediaAttachments = useMemo(
        () => attachments.filter((attachment) => attachment.type === 'image' || attachment.type === 'video'),
        [attachments]
    );
    const fileAttachments = useMemo(
        () => attachments.filter((attachment) => attachment.type === 'file'),
        [attachments]
    );
    const viewableAttachments = useMemo(() => {
        return attachments.filter((attachment) =>
            attachment.type === 'image' ||
            attachment.type === 'video' ||
            attachment.filename.toLowerCase().endsWith('.pdf')
        );
    }, [attachments]);
    const canEditMessage = isOwn && !isDeleted && Boolean(message.content);
    const canReply = !isDeleted;
    useEffect(() => {
        if (!isEditing) {
            setDraftContent(message.content || '');
        }
    }, [isEditing, message.content]);

    useEffect(() => {
        setIsMenuOpen(false);
        setIsEditing(false);
        setIsActionLoading(false);
        setHiddenForViewer(false);
        setDraftContent(message.content || '');
    }, [message.id, message.content]);

    const syncAfterMessageAction = useCallback(async () => {
        await refreshMessages(message.conversationId);
        await refreshConversations();
    }, [message.conversationId, refreshMessages, refreshConversations]);

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
            setIsEditing(false);
            await syncAfterMessageAction();
        } finally {
            setIsActionLoading(false);
        }
    }, [canEditMessage, draftContent, message.content, message.id, syncAfterMessageAction]);

    const handleDeleteForMe = useCallback(async () => {
        setIsActionLoading(true);
        try {
            const result = await deleteMessage(message.id, 'me');
            if (!result.success) {
                toast.error(result.error || 'Failed to delete message');
                return;
            }
            setHiddenForViewer(true);
            await syncAfterMessageAction();
        } finally {
            setIsActionLoading(false);
        }
    }, [message.id, syncAfterMessageAction]);

    const handleUnsendForEveryone = useCallback(async () => {
        setIsActionLoading(true);
        try {
            const result = await deleteMessage(message.id, 'everyone');
            if (!result.success) {
                toast.error(result.error || 'Failed to unsend message');
                return;
            }
            setIsEditing(false);
            await syncAfterMessageAction();
        } finally {
            setIsActionLoading(false);
        }
    }, [message.id, syncAfterMessageAction]);

    const handleReply = useCallback(() => {
        if (!canReply) return;
        setReplyTarget(message.conversationId, {
            id: message.id,
            content: message.content || null,
            senderId: message.senderId || null,
            senderName: message.sender?.fullName || message.sender?.username || null,
            type: message.type,
        });
    }, [canReply, message.conversationId, message.content, message.id, message.sender?.fullName, message.sender?.username, message.senderId, message.type, setReplyTarget]);

    const handleTogglePin = useCallback(async () => {
        setIsActionLoading(true);
        try {
            const ok = await pinMessage(message.id, message.conversationId, !isPinned);
            if (!ok) {
                toast.error(isPinned ? 'Failed to unpin message' : 'Failed to pin message');
            }
        } finally {
            setIsActionLoading(false);
        }
    }, [isPinned, message.conversationId, message.id, pinMessage]);

    const handleOpenRepliedMessage = useCallback(async () => {
        const repliedId = message.replyTo?.id;
        if (!repliedId) return;
        const result = await focusMessage(message.conversationId, repliedId);
        if (!result.found) {
            toast.info('Original message is not available in this conversation');
        }
    }, [focusMessage, message.conversationId, message.replyTo?.id]);

    if (message.type === 'system') {
        return (
            <div className="flex justify-center my-4 w-full">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 px-3 py-1 rounded-full flex items-center gap-2 border border-zinc-200 dark:border-zinc-800">
                    {message.content}
                    <span className="text-[10px] opacity-60">• {format(new Date(message.createdAt), 'p')}</span>
                </span>
            </div>
        );
    }

    if (isDeleted) {
        return (
            <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                <div className="px-4 py-2 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 italic text-sm">
                    Message deleted
                </div>
            </div>
        );
    }

    if (hiddenForViewer) {
        return null;
    }

    return (
        <div className={`w-full min-w-0 flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
            <div
                className={`group max-w-full flex items-end gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
            >
                {!isOwn && showAvatar && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full app-accent-gradient flex items-center justify-center overflow-hidden">
                        {message.sender?.avatarUrl ? (
                            <Image
                                src={message.sender.avatarUrl}
                                alt={message.sender.fullName || ''}
                                width={32}
                                height={32}
                                unoptimized
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <span className="text-white text-xs font-medium">
                                {(message.sender?.fullName || message.sender?.username || '?')[0].toUpperCase()}
                            </span>
                        )}
                    </div>
                )}
                {!isOwn && !showAvatar && <div className="w-8 flex-shrink-0" />}

                <div className={`min-w-0 max-w-[78%] flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
                    <div
                        className={`flex items-end gap-1 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}
                        onMouseEnter={() => setIsHovered(true)}
                        onMouseLeave={() => setIsHovered(false)}
                    >
                        <div className="max-w-full">
                            {mediaAttachments.length > 0 && (
                                <MediaAttachmentGrid
                                    attachments={mediaAttachments}
                                    onOpenMedia={(id) => setActiveAttachmentId(id)}
                                />
                            )}

                            {fileAttachments.length > 0 && (
                                <div className="mb-1 min-w-0 max-w-full overflow-hidden space-y-1">
                                    {fileAttachments.map((attachment) => (
                                        <FileAttachmentCard 
                                            key={attachment.id} 
                                            attachment={attachment} 
                                            onPreview={attachment.filename.toLowerCase().endsWith('.pdf') ? () => setActiveAttachmentId(attachment.id) : undefined}
                                        />
                                    ))}
                                </div>
                            )}

                            {isEditing ? (
                                <div className="mb-1 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2">
                                    <textarea
                                        value={draftContent}
                                        onChange={(event) => setDraftContent(event.target.value)}
                                        rows={3}
                                        maxLength={4000}
                                        className="w-full rounded-md bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-ring"
                                    />
                                    <div className="mt-2 flex items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            className="px-3 py-1.5 text-xs rounded-md border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300"
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
                                            className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground disabled:opacity-60"
                                            onClick={handleSaveEdit}
                                            disabled={isActionLoading}
                                        >
                                            {isActionLoading ? 'Saving...' : 'Save'}
                                        </button>
                                    </div>
                                </div>
                            ) : message.content && (
                                <div
                                    className={`px-4 py-2 rounded-2xl text-sm ${isOwn
                                        ? 'app-accent-solid rounded-br-md'
                                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-bl-md'
                                        }`}
                                >
                                    {message.replyTo && (
                                        <button
                                            type="button"
                                            className={`mb-2 w-full text-left rounded-lg border px-2 py-1 ${
                                                isOwn
                                                    ? 'border-white/30 bg-white/10 text-white/90'
                                                    : 'border-zinc-300 dark:border-zinc-700 bg-white/60 dark:bg-zinc-900/50 text-zinc-700 dark:text-zinc-200'
                                            }`}
                                            onClick={handleOpenRepliedMessage}
                                            title="Reply context"
                                        >
                                            <p className="text-[10px] font-semibold truncate">
                                                {message.replyTo.senderName || 'Message'}
                                            </p>
                                            <p className="text-[11px] truncate break-all opacity-90">
                                                {message.replyTo.content?.trim() || `[${message.replyTo.type || 'message'}]`}
                                            </p>
                                        </button>
                                    )}
                                    {(isPinned || isApplication) && (
                                        <div className="mb-1 flex items-center gap-2">
                                            {isPinned && (
                                                <span className={`text-[10px] uppercase font-bold ${isOwn ? 'text-white/80' : 'text-amber-600 dark:text-amber-400'}`}>
                                                    Pinned
                                                </span>
                                            )}
                                            {isApplication && (
                                                <span className={`text-[10px] uppercase font-bold opacity-70 ${!isOwn ? 'text-zinc-500' : 'text-white'}`}>
                                                    Application Status: {
                                                        applicationStatus === 'accepted' ? 'Accepted' :
                                                            applicationStatus === 'rejected' ? 'Rejected' :
                                                                applicationStatus === 'project_deleted' ? 'Project Has Been Deleted' :
                                                                    'Pending'
                                                    }
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    <MessageTextContent
                                        content={message.content}
                                        isOwn={isOwn}
                                        isApplication={isApplication}
                                    />
                                </div>
                            )}
                        </div>

                        <div className="w-6 h-6 mb-1 flex items-end justify-center flex-shrink-0">
                            <DropdownMenu
                                modal={false}
                                onOpenChange={(open) => {
                                    setIsMenuOpen(open);
                                    if (open) setIsHovered(true);
                                }}
                            >
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className={`p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-opacity duration-100 ${
                                            (isMenuOpen || isHovered)
                                                ? 'opacity-100 pointer-events-auto'
                                                : 'opacity-0 pointer-events-none'
                                        }`}
                                        aria-label="Message actions"
                                        disabled={isActionLoading}
                                    >
                                        <EllipsisVertical className="w-4 h-4" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align={isOwn ? 'end' : 'start'}
                                    className="data-[state=open]:animate-none data-[state=closed]:animate-none"
                                >
                                    {canEditMessage && (
                                        <DropdownMenuItem
                                            onClick={() => setIsEditing(true)}
                                            disabled={isActionLoading}
                                        >
                                            <Pencil className="w-4 h-4" />
                                            Edit
                                        </DropdownMenuItem>
                                    )}
                                    {canReply && (
                                        <DropdownMenuItem
                                            onClick={handleReply}
                                            disabled={isActionLoading}
                                        >
                                            <CornerUpLeft className="w-4 h-4" />
                                            Reply
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem
                                        onClick={handleTogglePin}
                                        disabled={isActionLoading}
                                    >
                                        {isPinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}
                                        {isPinned ? 'Unpin' : 'Pin'}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={handleDeleteForMe}
                                        disabled={isActionLoading}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        Delete for me
                                    </DropdownMenuItem>
                                    {isOwn && (
                                        <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                                onClick={handleUnsendForEveryone}
                                                disabled={isActionLoading}
                                                variant="destructive"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                                Unsend for everyone
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>

                    <div className={`flex items-center gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                        <span className="text-[10px] text-zinc-400">
                            {format(new Date(message.createdAt), 'h:mm a')}
                        </span>
                        {isOwn && (
                            <span className="text-primary">
                                {getDeliveryIcon(metadata?.deliveryState)}
                            </span>
                        )}
                        {message.editedAt && (
                            <span className="text-[10px] text-zinc-400">(edited)</span>
                        )}
                    </div>
                </div>
            </div>

            {activeAttachmentId && (
                <MediaViewerModal
                    attachments={viewableAttachments}
                    initialAttachmentId={activeAttachmentId}
                    onClose={() => setActiveAttachmentId(null)}
                />
            )}
        </div>
    );
}

function MessageTextContent({
    content,
    isOwn,
    isApplication,
}: {
    content: string | null;
    isOwn: boolean;
    isApplication?: boolean;
}) {
    if (!content) return null;
    if (isApplication) {
        const lines = content.split(/\r?\n/);
        return (
            <div className="space-y-1.5">
                {lines.map((line, index) => {
                    const trimmed = line.trim();
                    if (!trimmed) return <div key={`app-space-${index}`} className="h-2" />;
                    const match = trimmed.match(/^([A-Za-z][A-Za-z ]{1,24}):\s*(.+)$/);
                    if (!match) {
                        return (
                            <p key={`app-line-${index}`} className="whitespace-pre-wrap break-words leading-relaxed">
                                {renderTextWithMentions(trimmed, isOwn)}
                            </p>
                        );
                    }

                    const label = match[1].trim();
                    const value = match[2].trim();
                    const normalizedUrl = normalizeSafeExternalUrl(value);
                    return (
                        <p key={`app-meta-${index}`} className="whitespace-pre-wrap break-words leading-relaxed">
                            <span className="font-semibold">{label}: </span>
                            {normalizedUrl ? (
                                <a
                                    href={normalizedUrl}
                                    target="_blank"
                                    rel="noopener noreferrer nofollow ugc"
                                    className={isOwn ? "underline text-white break-all" : "underline text-primary break-all"}
                                >
                                    {value}
                                </a>
                            ) : (
                                renderTextWithMentions(value, isOwn)
                            )}
                        </p>
                    );
                })}
            </div>
        );
    }
    const segments = parseMessageSegments(content);
    return (
        <div className="space-y-2">
            {segments.map((segment, index) =>
                segment.type === 'code' ? (
                    <CodeSegment
                        key={`code-${index}`}
                        code={segment.content}
                        language={segment.language}
                        isOwn={isOwn}
                    />
                ) : (
                    <p key={`text-${index}`} className="whitespace-pre-wrap break-words leading-relaxed">
                        {renderTextWithMentions(segment.content, isOwn)}
                    </p>
                )
            )}
        </div>
    );
}

function renderTextWithMentions(text: string, isOwn: boolean) {
    const parts = text.split(LINK_OR_MENTION_REGEX);
    return parts.map((part, index) => {
        if (part.startsWith('@')) {
            const username = part.slice(1).toLowerCase();
            return (
                <a
                    key={`mention-${index}`}
                    href={`/u/${username}`}
                    className={`font-semibold underline underline-offset-2 ${
                        isOwn ? 'text-white' : 'text-primary'
                    }`}
                >
                    {part}
                </a>
            );
        }
        const safeLink = parseSafeLinkToken(part);
        if (safeLink) {
            return (
                <span key={`link-wrap-${index}`}>
                    <a
                        href={safeLink.href}
                        target="_blank"
                        rel="noopener noreferrer nofollow ugc"
                        className={`underline break-all ${
                            isOwn ? 'text-white' : 'text-primary'
                        }`}
                    >
                        {safeLink.display}
                    </a>
                    {safeLink.trailing}
                </span>
            );
        }

        return <span key={`txt-${index}`}>{part}</span>;
    });
}

function CodeSegment({
    code,
    language,
    isOwn,
}: {
    code: string;
    language: string | null;
    isOwn: boolean;
}) {
    const [copied, setCopied] = useState(false);
    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
        } catch {
            toast.error('Failed to copy code');
        }
    }, [code]);

    return (
        <div
            className={`rounded-lg border overflow-hidden ${
                isOwn
                    ? 'border-white/30 bg-black/25'
                    : 'border-zinc-300 dark:border-zinc-700 bg-zinc-900/90'
            }`}
        >
            <div className="px-2 py-1 flex items-center justify-between text-[10px] uppercase tracking-wide bg-black/30 text-zinc-300">
                <span>{language || 'code'}</span>
                <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 transition-colors"
                >
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
            </div>
            <pre className="px-3 py-2 overflow-x-auto text-[12px] leading-5 text-zinc-100">
                <code>{code}</code>
            </pre>
        </div>
    );
}

function parseMessageSegments(content: string): Array<{ type: 'text' | 'code'; content: string; language: string | null }> {
    const segments: Array<{ type: 'text' | 'code'; content: string; language: string | null }> = [];
    const codeRegex = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = codeRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
            const textChunk = content.slice(lastIndex, match.index);
            if (textChunk) segments.push({ type: 'text', content: textChunk, language: null });
        }
        segments.push({
            type: 'code',
            language: match[1] || null,
            content: (match[2] || '').trimEnd(),
        });
        lastIndex = codeRegex.lastIndex;
    }

    if (lastIndex < content.length) {
        const tail = content.slice(lastIndex);
        if (tail) segments.push({ type: 'text', content: tail, language: null });
    }

    if (segments.length === 0) {
        segments.push({ type: 'text', content, language: null });
    }

    return segments;
}

function MediaAttachmentGrid({
    attachments,
    onOpenMedia,
}: {
    attachments: ChatAttachment[];
    onOpenMedia: (id: string) => void;
}) {
    const visibleAttachments = attachments.slice(0, 4);
    const overflowCount = attachments.length - visibleAttachments.length;
    const isSingle = visibleAttachments.length === 1;
    const gridClassName = isSingle
        ? 'grid grid-cols-1'
        : 'grid grid-cols-2';

    return (
        <div className={`mb-1 ${gridClassName} gap-1 max-w-[360px]`}>
            {visibleAttachments.map((attachment, index) => (
                <MediaAttachmentTile
                    key={attachment.id}
                    attachment={attachment}
                    isSingle={isSingle}
                    overlayLabel={index === visibleAttachments.length - 1 && overflowCount > 0 ? `+${overflowCount}` : null}
                    onClick={() => onOpenMedia(attachment.id)}
                />
            ))}
        </div>
    );
}

function MediaAttachmentTile({
    attachment,
    isSingle,
    overlayLabel,
    onClick,
}: {
    attachment: ChatAttachment;
    isSingle: boolean;
    overlayLabel: string | null;
    onClick: () => void;
}) {
    const [loaded, setLoaded] = useState(false);
    const previewUrl = attachment.type === 'video'
        ? (attachment.thumbnailUrl || attachment.url)
        : (attachment.thumbnailUrl || attachment.url);

    return (
        <button
            type="button"
            onClick={onClick}
            className={`relative rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 ${isSingle ? 'h-auto' : 'h-36'} focus:outline-none focus:ring-2 focus:ring-ring/60`}
        >
            {!loaded && <div className="absolute inset-0 animate-pulse bg-zinc-200/80 dark:bg-zinc-700/70" />}
            <Image
                src={previewUrl}
                alt={attachment.filename}
                width={640}
                height={360}
                unoptimized
                onLoad={() => setLoaded(true)}
                className={`w-full ${isSingle ? 'max-h-80 object-contain bg-zinc-900/40' : 'h-36 object-cover'} ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
            />

            {attachment.type === 'video' && (
                <div className="absolute inset-0 bg-black/25 flex items-center justify-center">
                    <PlayCircle className="w-10 h-10 text-white/90" />
                </div>
            )}

            {overlayLabel && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <span className="text-white text-xl font-semibold">{overlayLabel}</span>
                </div>
            )}
        </button>
    );
}

function FileAttachmentCard({ attachment, onPreview }: { attachment: ChatAttachment, onPreview?: () => void }) {
    if (onPreview) {
        return (
            <button
                type="button"
                onClick={onPreview}
                className="w-full max-w-full min-w-0 overflow-hidden text-left flex items-center gap-3 p-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
                <div className="w-10 h-10 shrink-0 bg-primary/10 dark:bg-primary/15 rounded-lg flex items-center justify-center">
                    <File className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-white truncate break-all">{attachment.filename}</p>
                    {attachment.sizeBytes && (
                        <p className="text-xs text-zinc-500">{formatFileSize(attachment.sizeBytes)}</p>
                    )}
                </div>
            </button>
        );
    }
    return (
        <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            download={attachment.filename}
            className="w-full max-w-full min-w-0 overflow-hidden flex items-center gap-3 p-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
            <div className="w-10 h-10 shrink-0 bg-primary/10 dark:bg-primary/15 rounded-lg flex items-center justify-center">
                <File className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-white truncate break-all">{attachment.filename}</p>
                {attachment.sizeBytes && (
                    <p className="text-xs text-zinc-500">{formatFileSize(attachment.sizeBytes)}</p>
                )}
            </div>
        </a>
    );
}

function MediaViewerModal({
    attachments,
    initialAttachmentId,
    onClose,
}: {
    attachments: ChatAttachment[];
    initialAttachmentId: string;
    onClose: () => void;
}) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const initialIdx = useMemo(() => {
        const idx = attachments.findIndex((a) => a.id === initialAttachmentId);
        return idx !== -1 ? idx : 0;
    }, [attachments, initialAttachmentId]);
    const [currentIndex, setCurrentIndex] = useState(initialIdx);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [videoSpeed, setVideoSpeed] = useState(1);
    const currentAttachment = attachments[currentIndex];
    const hasMultiple = attachments.length > 1;

    useEffect(() => {
        setCurrentIndex(initialIdx);
        setZoomLevel(1);
    }, [initialIdx]);

    useEffect(() => {
        if (!videoRef.current) return;
        videoRef.current.playbackRate = videoSpeed;
    }, [videoSpeed, currentAttachment?.id]);

    const moveNext = useCallback(() => {
        setCurrentIndex((previous) => (previous + 1) % attachments.length);
    }, [attachments.length]);

    const movePrev = useCallback(() => {
        setCurrentIndex((previous) => (previous - 1 + attachments.length) % attachments.length);
    }, [attachments.length]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (!hasMultiple) return;
            if (event.key === 'ArrowRight') moveNext();
            if (event.key === 'ArrowLeft') movePrev();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [hasMultiple, moveNext, movePrev, onClose]);

    return (
        <div className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
            <button type="button" onClick={onClose} aria-label="Close media viewer" className="absolute inset-0" />

            <div className="relative z-10 w-full max-w-6xl max-h-[92vh] flex flex-col">
                <div className="w-full flex items-center justify-between mb-3 px-1 text-white">
                    <div className="min-w-0">
                        <p className="text-sm truncate">{currentAttachment.filename}</p>
                        {hasMultiple && (
                            <p className="text-xs text-white/70">
                                {currentIndex + 1} / {attachments.length}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <a
                            href={currentAttachment.url}
                            download={currentAttachment.filename}
                            className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                            aria-label="Download media"
                        >
                            <Download className="w-5 h-5" />
                        </a>
                        {currentAttachment.type === 'image' && (
                            <div className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1">
                                <button
                                    type="button"
                                    onClick={() => setZoomLevel((prev) => Math.max(1, prev - 0.25))}
                                    className="text-xs px-1 hover:text-white"
                                >
                                    -
                                </button>
                                <span className="text-xs w-10 text-center">{Math.round(zoomLevel * 100)}%</span>
                                <button
                                    type="button"
                                    onClick={() => setZoomLevel((prev) => Math.min(3, prev + 0.25))}
                                    className="text-xs px-1 hover:text-white"
                                >
                                    +
                                </button>
                            </div>
                        )}
                        {currentAttachment.type === 'video' && (
                            <select
                                value={videoSpeed}
                                onChange={(event) => setVideoSpeed(Number(event.target.value))}
                                className="text-xs bg-white/10 border border-white/20 rounded px-2 py-1 text-white"
                                aria-label="Playback speed"
                            >
                                <option value={0.75}>0.75x</option>
                                <option value={1}>1x</option>
                                <option value={1.25}>1.25x</option>
                                <option value={1.5}>1.5x</option>
                                <option value={2}>2x</option>
                            </select>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                            aria-label="Close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="relative w-full flex-1 flex items-center justify-center min-h-[60vh]">
                    {currentAttachment.type === 'video' ? (
                        <video
                            ref={videoRef}
                            key={currentAttachment.id}
                            src={currentAttachment.url}
                            controls
                            autoPlay
                            playsInline
                            preload="metadata"
                            className="max-h-[82vh] w-auto rounded-lg bg-black cursor-pointer"
                        />
                    ) : currentAttachment.filename.toLowerCase().endsWith('.pdf') ? (
                        <iframe
                            key={currentAttachment.id}
                            src={`${currentAttachment.url}#view=FitH`}
                            className="w-full h-[82vh] rounded-lg bg-white"
                            title={currentAttachment.filename}
                        />
                    ) : (
                        <Image
                            key={currentAttachment.id}
                            src={currentAttachment.url}
                            alt={currentAttachment.filename}
                            width={1200}
                            height={900}
                            unoptimized
                            className="max-h-[82vh] w-auto rounded-lg select-none"
                            style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}
                        />
                    )}

                    {hasMultiple && (
                        <>
                            <button
                                type="button"
                                onClick={movePrev}
                                className="absolute left-2 md:left-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                                aria-label="Previous media"
                            >
                                <ChevronLeft className="w-6 h-6" />
                            </button>
                            <button
                                type="button"
                                onClick={moveNext}
                                className="absolute right-2 md:right-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                                aria-label="Next media"
                            >
                                <ChevronRight className="w-6 h-6" />
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function getDeliveryIcon(deliveryState: unknown) {
    switch (deliveryState) {
        case 'sending':
            return <Check className="w-3 h-3 opacity-70" />;
        case 'queued':
            return <Check className="w-3 h-3 opacity-70" />;
        case 'failed':
            return <X className="w-3 h-3 text-red-400" />;
        case 'sent':
            return <Check className="w-3 h-3" />;
        case 'delivered':
            return <CheckCheck className="w-3 h-3 opacity-90" />;
        case 'read':
            return <CheckCheck className="w-3 h-3 text-emerald-400" />;
        default:
            return <CheckCheck className="w-3 h-3" />;
    }
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
