'use client';

import { MoreVertical, ArrowLeft, Archive, Bell, BellOff, Ban, Maximize2, ChevronDown } from 'lucide-react';
import { useMessagesV2UiStore } from '@/stores/messagesV2UiStore';
import type { InboxConversationV2 } from '@/hooks/useMessagesV2';
import { useOnlineUsers } from '@/hooks/useOnlineUsers';
import { OnlineIndicator } from '@/components/ui/OnlineIndicator';
import { UserAvatar } from '@/components/ui/UserAvatar';
import type { ApplicationBannerStatus } from '@/lib/chat/application-events';
import { buildIdentityPresentation } from '@/lib/ui/identity';
import { buildConversationDisplay } from '@/lib/messages/conversation-display';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ConversationHeaderV2Props {
    conversation: InboxConversationV2;
    latestApplicationStatus?: ApplicationBannerStatus | null;
    surface?: 'page' | 'popup';
    compact?: boolean;
    actionLoading?: boolean;
    onBack?: () => void;
    onToggleMute: () => void;
    onToggleArchive: () => void;
    onToggleBlock?: () => void;
    onViewProfile?: () => void;
    onOpenFullScreen?: () => void;
}

export function ConversationHeaderV2({
    conversation,
    latestApplicationStatus,
    surface = 'page',
    compact = false,
    actionLoading = false,
    onBack,
    onToggleMute,
    onToggleArchive,
    onToggleBlock,
    onViewProfile,
    onOpenFullScreen,
}: ConversationHeaderV2Props) {
    const otherParticipant = conversation.participants[0];
    const isDirectMessage = conversation.type === 'dm';
    const isPopup = surface === 'popup';
    const display = buildConversationDisplay({
        type: conversation.type,
        participants: conversation.participants,
        configuredTitle: conversation.displayTitle,
        configuredAvatarUrl: conversation.displayAvatarUrl,
        projectTitle: conversation.type === 'project_group' ? conversation.displayTitle : null,
    });

    // Wave 2 — Presence & online dot. Only observe the DM counterpart; group /
    // project_group headers don't expose a single-user online state.
    const observedUserIds = isDirectMessage && otherParticipant?.id ? [otherParticipant.id] : [];
    const onlineMap = useOnlineUsers(observedUserIds);
    const peerOnline = otherParticipant?.id ? onlineMap[otherParticipant.id] === true : false;

    return (
        <div className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between ${
            isPopup ? 'h-14 px-3' : 'h-16 px-5'
        }`}>
            <div className="pointer-events-auto flex min-w-0 items-center gap-3">
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
                                <UserAvatar
                                    identity={otherParticipant}
                                    className={isPopup ? 'h-9 w-9' : 'h-10 w-10'}
                                    fallbackClassName="text-sm font-semibold text-white"
                                    sizes={isPopup ? '36px' : '40px'}
                                />
                                <OnlineIndicator online={peerOnline} size="sm" />
                            </div>
                            <div className="min-w-0 text-left">
                                <div className={`flex items-center gap-2 truncate font-semibold text-zinc-900 dark:text-zinc-100 ${
                                    isPopup ? 'text-[13px]' : 'text-sm'
                                }`}>
                                    <span className="truncate">{buildIdentityPresentation(otherParticipant).displayName}</span>
                                    {latestApplicationStatus === 'pending' && (
                                        <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
                                            Pending Request
                                        </span>
                                    )}
                                </div>
                            </div>
                        </button>
                    ) : (
                        <>
                            <div className="relative">
                                <UserAvatar
                                    identity={otherParticipant}
                                    className={isPopup ? 'h-9 w-9' : 'h-10 w-10'}
                                    fallbackClassName="text-sm font-semibold text-white"
                                    sizes={isPopup ? '36px' : '40px'}
                                />
                                <OnlineIndicator online={peerOnline} size="sm" />
                            </div>
                            <div className="min-w-0">
                                <div className={`flex items-center gap-2 truncate font-semibold text-zinc-900 dark:text-zinc-100 ${
                                    isPopup ? 'text-[13px]' : 'text-sm'
                                }`}>
                                    <span className="truncate">{buildIdentityPresentation(otherParticipant).displayName}</span>
                                    {latestApplicationStatus === 'pending' && (
                                        <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400">
                                            Pending Request
                                        </span>
                                    )}
                                </div>
                            </div>
                        </>
                    )
                ) : (
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {display.title}
                        </div>
                    </div>
                )}
            </div>

            <div className="pointer-events-auto flex items-center gap-2">
                {isPopup && (
                    <>
                        <button
                            type="button"
                            onClick={onOpenFullScreen}
                            className="rounded-full bg-zinc-100 text-zinc-700 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 p-1.5"
                            aria-label="Open in fullscreen"
                        >
                            <Maximize2 className="h-4 w-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => useMessagesV2UiStore.getState().setPopupState('minimized')}
                            className="rounded-full bg-zinc-100 text-zinc-700 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 p-1.5"
                            aria-label="Collapse messages"
                        >
                            <ChevronDown className="h-4 w-4" />
                        </button>
                    </>
                )}
                <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            disabled={actionLoading}
                            className={`rounded-full bg-zinc-100 text-zinc-700 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 ${
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
