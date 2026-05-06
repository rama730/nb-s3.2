'use client';

import { useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { MoreVertical, ArrowLeft, Archive, Bell, BellOff, Ban, Send } from 'lucide-react';
import type { TypingUser } from '@/hooks/useTypingChannel';
import type { InboxConversationV2 } from '@/hooks/useMessagesV2';
import { useOnlineUsers } from '@/hooks/useOnlineUsers';
import { OnlineIndicator } from '@/components/ui/OnlineIndicator';
import { getTypingStatusText } from '@/lib/chat/typing-display';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ConversationHeaderV2Props {
    conversation: InboxConversationV2;
    surface?: 'page' | 'popup';
    compact?: boolean;
    actionLoading?: boolean;
    typingUsers?: TypingUser[];
    onBack?: () => void;
    onToggleMute: () => void;
    onToggleArchive: () => void;
    onToggleBlock?: () => void;
    onViewProfile?: () => void;
}

export function ConversationHeaderV2({
    conversation,
    surface = 'page',
    compact = false,
    actionLoading = false,
    typingUsers,
    onBack,
    onToggleMute,
    onToggleArchive,
    onToggleBlock,
    onViewProfile,
}: ConversationHeaderV2Props) {
    const otherParticipant = conversation.participants[0];
    const isDirectMessage = conversation.type === 'dm';
    const canInvite = isDirectMessage && conversation.capability.canInvite && otherParticipant?.username;
    const isPopup = surface === 'popup';

    // Wave 2 — Presence & online dot. Only observe the DM counterpart; group /
    // project_group headers don't expose a single-user online state.
    const observedUserIds = useMemo(
        () => (isDirectMessage && otherParticipant?.id ? [otherParticipant.id] : []),
        [isDirectMessage, otherParticipant?.id],
    );
    const onlineMap = useOnlineUsers(observedUserIds);
    const peerOnline = otherParticipant?.id ? onlineMap[otherParticipant.id] === true : false;
    const statusLine = (() => {
        if (typingUsers && typingUsers.length > 0) {
            return <span className="text-primary">{getTypingStatusText(typingUsers) || 'typing...'}</span>;
        }
        if (conversation.capability.blocked) return 'Blocked';
        if (peerOnline && conversation.capability.canSend) {
            return <span className="text-emerald-600 dark:text-emerald-400">Online</span>;
        }
        if (conversation.capability.canSend) return 'Ready to message';
        if (conversation.capability.status === 'pending_received') return 'Incoming request';
        if (conversation.capability.status === 'pending_sent') return 'Request pending';
        return 'Messaging restricted';
    })();

    return (
        <div className={`flex shrink-0 items-center justify-between border-b border-border/60 bg-card ${
            isPopup ? 'h-14 px-3' : 'h-16 px-5'
        }`}>
            <div className="flex min-w-0 items-center gap-3">
                {compact && onBack && (
                    <button
                        type="button"
                        onClick={onBack}
                        className={`rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 ${
                            isPopup ? 'p-1.5' : 'p-2'
                        }`}
                        aria-label="Back"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                )}
                {isDirectMessage && otherParticipant ? (
                    onViewProfile ? (
                        <button type="button" onClick={onViewProfile} className="flex min-w-0 items-center gap-3 hover:opacity-80 transition-opacity">
                            <div className="relative">
                                <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full app-accent-gradient ${
                                    isPopup ? 'h-9 w-9' : 'h-10 w-10'
                                }`}>
                                    {otherParticipant.avatarUrl ? (
                                        <Image
                                            src={otherParticipant.avatarUrl}
                                            alt={otherParticipant.fullName || ''}
                                            width={isPopup ? 36 : 40}
                                            height={isPopup ? 36 : 40}
                                            unoptimized
                                            className="h-full w-full object-cover"
                                        />
                                    ) : (
                                        <span className="text-sm font-semibold text-white">
                                            {(otherParticipant.fullName || otherParticipant.username || '?')[0].toUpperCase()}
                                        </span>
                                    )}
                                </div>
                                <OnlineIndicator online={peerOnline} size="md" />
                            </div>
                            <div className="min-w-0 text-left">
                                <div className={`truncate font-semibold text-zinc-900 dark:text-zinc-100 ${
                                    isPopup ? 'text-[13px]' : 'text-sm'
                                }`}>
                                    {otherParticipant.fullName || otherParticipant.username || 'Unknown'}
                                </div>
                                <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                                    {statusLine}
                                </div>
                            </div>
                        </button>
                    ) : (
                        <>
                            <div className="relative">
                                <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full app-accent-gradient ${
                                    isPopup ? 'h-9 w-9' : 'h-10 w-10'
                                }`}>
                                    {otherParticipant.avatarUrl ? (
                                        <Image
                                            src={otherParticipant.avatarUrl}
                                            alt={otherParticipant.fullName || ''}
                                            width={isPopup ? 36 : 40}
                                            height={isPopup ? 36 : 40}
                                            unoptimized
                                            className="h-full w-full object-cover"
                                        />
                                    ) : (
                                        <span className="text-sm font-semibold text-white">
                                            {(otherParticipant.fullName || otherParticipant.username || '?')[0].toUpperCase()}
                                        </span>
                                    )}
                                </div>
                                <OnlineIndicator online={peerOnline} size="md" />
                            </div>
                            <div className="min-w-0">
                                <div className={`truncate font-semibold text-zinc-900 dark:text-zinc-100 ${
                                    isPopup ? 'text-[13px]' : 'text-sm'
                                }`}>
                                    {otherParticipant.fullName || otherParticipant.username || 'Unknown'}
                                </div>
                                <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                                    {statusLine}
                                </div>
                            </div>
                        </>
                    )
                ) : (
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {conversation.type === 'project_group' ? 'Project group' : 'Conversation'}
                        </div>
                        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {conversation.type === 'project_group' ? 'Shared team thread' : 'Shared conversation'}
                        </div>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-2">
                {canInvite && (
                    <Link
                        href={`/u/${otherParticipant!.username}#collaboration`}
                        className={`inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 ${
                            isPopup ? 'px-2.5 py-1.5' : 'px-3 py-2'
                        }`}
                    >
                        <Send className="h-3.5 w-3.5" />
                        Invite
                    </Link>
                )}
                <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            disabled={actionLoading}
                            className={`rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 ${
                                isPopup ? 'p-1.5' : 'p-2'
                            }`}
                            aria-label="Conversation actions"
                        >
                            <MoreVertical className="h-4 w-4" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={onToggleMute}>
                            {conversation.muted ? <Bell className="mr-2 h-4 w-4" /> : <BellOff className="mr-2 h-4 w-4" />}
                            {conversation.muted ? 'Unmute' : 'Mute'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onToggleArchive}>
                            <Archive className="mr-2 h-4 w-4" />
                            {conversation.lifecycleState === 'archived' ? 'Unarchive' : 'Archive'}
                        </DropdownMenuItem>
                        {onToggleBlock && conversation.type === 'dm' && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={onToggleBlock} className="text-red-600 dark:text-red-400">
                                    <Ban className="mr-2 h-4 w-4" />
                                    {conversation.capability.blocked ? 'Unblock' : 'Block'}
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}
