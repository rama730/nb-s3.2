'use client';

import { useAuth } from '@/hooks/useAuth';
import type { MessageWithSender } from '@/app/actions/messaging';
import { format } from 'date-fns';
import { Badge } from "@/components/ui/badge";
import { Check, CheckCheck, Image as ImageIcon, File, Video, X } from 'lucide-react';
import { useState } from 'react';

// ============================================================================
// MESSAGE BUBBLE
// Individual message display with sent/received styling
// ============================================================================

interface MessageBubbleProps {
    message: MessageWithSender;
    showAvatar?: boolean;
}

export function MessageBubble({ message, showAvatar = true }: MessageBubbleProps) {
    const { user } = useAuth();
    const isOwn = message.senderId === user?.id;
    const isDeleted = !!message.deletedAt;
    const metadata = message.metadata as any;

    // Handle System Messages (Timeline Events)
    if (message.type === 'system') {
        return (
            <div className="flex justify-center my-4 w-full">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/50 px-3 py-1 rounded-full flex items-center gap-2 border border-zinc-200 dark:border-zinc-800">
                   {message.content} <span className="text-[10px] opacity-60">• {format(new Date(message.createdAt), 'p')}</span>
                </span>
            </div>
        );
    }

    // Handle deleted messages
    if (isDeleted) {
        return (
            <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                <div className="px-4 py-2 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 italic text-sm">
                    Message deleted
                </div>
            </div>
        );
    }

    return (
        <div className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
            {/* Avatar */}
            {!isOwn && showAvatar && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center overflow-hidden">
                    {message.sender?.avatarUrl ? (
                        <img
                            src={message.sender.avatarUrl}
                            alt={message.sender.fullName || ''}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <span className="text-white text-xs font-medium">
                            {(message.sender?.fullName || message.sender?.username || '?')[0].toUpperCase()}
                        </span>
                    )}
                </div>
            )}
            {!isOwn && !showAvatar && <div className="w-8" />}

            {/* Message content */}
            <div className={`max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
                {/* Attachments */}
                {message.attachments && message.attachments.length > 0 && (
                    <div className="mb-1 space-y-1">
                        {message.attachments.map(att => (
                            <AttachmentPreview key={att.id} attachment={att} />
                        ))}
                    </div>
                )}

                {/* Text content */}
                {message.content && (
                    <div
                        className={`px-4 py-2 rounded-2xl text-sm ${isOwn
                                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-br-md'
                                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-bl-md'
                            }`}
                    >
                        {/* Application Status (Simple Text) */}
                        {metadata?.isApplication && (
                            <div className={`mb-1 text-[10px] uppercase font-bold opacity-70 ${!isOwn ? 'text-zinc-500' : 'text-white'}`}>
                                Application Status: {
                                    metadata.status === 'accepted' ? 'Accepted' :
                                        metadata.status === 'rejected' ? 'Rejected' :
                                            metadata.status === 'project_deleted' ? 'Project Has Been Deleted' :
                                                'Pending'
                                }
                            </div>
                        )}
                        
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    </div>
                )}

                {/* Timestamp and status */}
                <div className={`flex items-center gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                    <span className="text-[10px] text-zinc-400">
                        {format(new Date(message.createdAt), 'h:mm a')}
                    </span>
                    {isOwn && (
                        <span className="text-blue-500">
                            {message.id.startsWith('temp-') ? (
                                <Check className="w-3 h-3" />
                            ) : (
                                <CheckCheck className="w-3 h-3" />
                            )}
                        </span>
                    )}
                    {message.editedAt && (
                        <span className="text-[10px] text-zinc-400">(edited)</span>
                    )}
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// ATTACHMENT PREVIEW
// ============================================================================

interface AttachmentPreviewProps {
    attachment: {
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
}

function AttachmentPreview({ attachment }: AttachmentPreviewProps) {
    if (attachment.type === 'image') {
        return (
            <a
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg overflow-hidden max-w-xs hover:opacity-90 transition-opacity"
            >
                <img
                    src={attachment.thumbnailUrl || attachment.url}
                    alt={attachment.filename}
                    className="w-full h-auto"
                    loading="lazy"
                />
            </a>
        );
    }

    if (attachment.type === 'video') {
        return (
            <div className="rounded-lg overflow-hidden max-w-xs">
                <video
                    src={attachment.url}
                    poster={attachment.thumbnailUrl || undefined}
                    controls
                    className="w-full h-auto"
                />
            </div>
        );
    }

    // File attachment
    return (
        <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        >
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                <File className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                    {attachment.filename}
                </p>
                {attachment.sizeBytes && (
                    <p className="text-xs text-zinc-500">
                        {formatFileSize(attachment.sizeBytes)}
                    </p>
                )}
            </div>
        </a>
    );
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
