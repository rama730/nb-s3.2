'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import { useChatStore, selectUnreadTotal } from '@/stores/chatStore';
import { setConversationArchived, setConversationMuted } from '@/app/actions/messaging';
import { MessageThread } from './MessageThread';
import { MessageInput } from './MessageInput';
import { ConversationList } from './ConversationList';
import { ApplicationList } from './ApplicationList';
import { ProjectGroupList } from './ProjectGroupList';
import { X, Minus, MessageSquare, ArrowLeft, MoreVertical, Archive, Bell, BellOff } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ============================================================================
// CHAT POPUP
// Floating chat window (bottom-right), similar to Instagram DM popup
// ============================================================================

export function ChatPopup() {
    const pathname = usePathname();

    // State for Inbox Zero Toggle (Must be at top level)
    const [activeTab, setActiveTab] = useState<'chats' | 'applications' | 'projects'>('chats');
    const [actionLoading, setActionLoading] = useState(false);

    // Select primitive values and stable references
    const isPopupOpen = useChatStore(state => state.isPopupOpen);
    const isPopupMinimized = useChatStore(state => state.isPopupMinimized);
    const activeConversationId = useChatStore(state => state.activeConversationId);
    const totalUnread = useChatStore(selectUnreadTotal);
    const conversations = useChatStore(state => state.conversations);
    const messagesByConversation = useChatStore(state => state.messagesByConversation);

    // Actions
    const closePopup = useChatStore(state => state.closePopup);
    const minimizePopup = useChatStore(state => state.minimizePopup);
    const maximizePopup = useChatStore(state => state.maximizePopup);
    const closeConversation = useChatStore(state => state.closeConversation);
    const openPopup = useChatStore(state => state.openPopup);

    // Derive values with useMemo to maintain stable references
    const activeConversation = useMemo(() => {
        if (!activeConversationId) return null;
        return conversations.find(c => c.id === activeConversationId) || null;
    }, [activeConversationId, conversations]);

    const messages = useMemo(() => {
        if (!activeConversationId) return [];
        return messagesByConversation[activeConversationId]?.messages || [];
    }, [activeConversationId, messagesByConversation]);

    // Hide popup on /messages page
    const isOnMessagesPage = pathname.startsWith('/messages');
    if (isOnMessagesPage) return null;

    // Show minimized bubble
    if (!isPopupOpen || isPopupMinimized) {
        return (
            <button
                onClick={() => isPopupOpen ? maximizePopup() : openPopup()}
                className="fixed bottom-6 right-6 z-50 flex items-center justify-center w-14 h-14 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105"
            >
                <MessageSquare className="w-6 h-6" />
                {totalUnread > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full">
                        {totalUnread > 9 ? '9+' : totalUnread}
                    </span>
                )}
            </button>
        );
    }

    // Get other participant for DM
    const otherParticipant = activeConversation?.participants[0];

    const handleToggleMuteConversation = async () => {
        if (!activeConversation) return;
        setActionLoading(true);
        try {
            const result = await setConversationMuted(activeConversation.id, !activeConversation.muted);
            if (!result.success) {
                toast.error(result.error || 'Failed to update mute state');
                return;
            }
            await useChatStore.getState().refreshConversations();
            await useChatStore.getState().openConversation(activeConversation.id);
        } finally {
            setActionLoading(false);
        }
    };

    const handleToggleArchiveConversation = async () => {
        if (!activeConversation) return;
        setActionLoading(true);
        try {
            const nextArchived = activeConversation.lifecycleState !== 'archived';
            const result = await setConversationArchived(activeConversation.id, nextArchived);
            if (!result.success) {
                toast.error(result.error || 'Failed to update conversation');
                return;
            }
            await useChatStore.getState().refreshConversations();
            if (nextArchived) {
                useChatStore.getState().closeConversation();
            } else {
                await useChatStore.getState().openConversation(activeConversation.id);
            }
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-50 w-96 h-[520px] bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex flex-col bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                <div className="flex items-center justify-between px-4 py-3">
                    {activeConversationId ? (
                        <div className="flex items-center gap-3">
                            <button
                                onClick={closeConversation}
                                className="p-1 hover:bg-white/20 rounded-lg transition-colors"
                            >
                                <ArrowLeft className="w-5 h-5" />
                            </button>
                            {otherParticipant && (
                                <>
                                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center overflow-hidden">
                                        {otherParticipant.avatarUrl ? (
                                            <Image
                                                src={otherParticipant.avatarUrl}
                                                alt={otherParticipant.fullName || ''}
                                                width={32}
                                                height={32}
                                                unoptimized
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <span className="text-sm font-medium">
                                                {(otherParticipant.fullName || otherParticipant.username || '?')[0].toUpperCase()}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="font-semibold text-sm">
                                            {otherParticipant.fullName || otherParticipant.username || 'Unknown'}
                                        </span>
                                        {otherParticipant.username && otherParticipant.fullName && (
                                            <span className="text-xs text-white/70">@{otherParticipant.username}</span>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <MessageSquare className="w-5 h-5" />
                            <span className="font-semibold">Messages</span>
                            {totalUnread > 0 && (
                                <span className="px-2 py-0.5 bg-white/20 rounded-full text-xs font-medium">
                                    {totalUnread}
                                </span>
                            )}
                        </div>
                    )}
                    <div className="flex items-center gap-1">
                        {activeConversationId && (
                            <DropdownMenu modal={false}>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        disabled={actionLoading}
                                        className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                                        aria-label="Conversation actions"
                                    >
                                        <MoreVertical className="w-4 h-4" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="end"
                                    className="data-[state=open]:animate-none data-[state=closed]:animate-none"
                                >
                                    <DropdownMenuItem
                                        onClick={handleToggleMuteConversation}
                                        disabled={actionLoading}
                                    >
                                        {activeConversation?.muted ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                                        {activeConversation?.muted ? 'Unmute conversation' : 'Mute conversation'}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={handleToggleArchiveConversation}
                                        disabled={actionLoading}
                                    >
                                        <Archive className="w-4 h-4" />
                                        {activeConversation?.lifecycleState === 'archived' ? 'Unarchive conversation' : 'Archive conversation'}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                        <button
                            onClick={minimizePopup}
                            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                        >
                            <Minus className="w-4 h-4" />
                        </button>
                        <button
                            onClick={closePopup}
                            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Inbox Zero Toggle (Only show on main list) */}
                {!activeConversationId && (
                    <div className="px-4 pb-3">
                        <div className="flex p-1 bg-black/20 rounded-lg">
                            <button
                                onClick={() => setActiveTab('chats')}
                                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                                    activeTab === 'chats'
                                        ? 'bg-white text-indigo-600 shadow-sm'
                                        : 'text-white/70 hover:text-white'
                                }`}
                            >
                                Chats
                            </button>
                            <button
                                onClick={() => setActiveTab('applications')}
                                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                                    activeTab === 'applications'
                                        ? 'bg-white text-indigo-600 shadow-sm'
                                        : 'text-white/70 hover:text-white'
                                }`}
                            >
                                Applications
                            </button>
                            <button
                                onClick={() => setActiveTab('projects')}
                                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                                    activeTab === 'projects'
                                        ? 'bg-white text-indigo-600 shadow-sm'
                                        : 'text-white/70 hover:text-white'
                                }`}
                            >
                                Projects
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {activeConversationId ? (
                    <>
                        <MessageThread
                            messages={messages}
                            conversationId={activeConversationId}
                        />
                        <MessageInput conversationId={activeConversationId} />
                    </>
                ) : activeTab === 'applications' ? (
                    <ApplicationList />
                ) : activeTab === 'projects' ? (
                    <ProjectGroupList />
                ) : (
                    <ConversationList />
                )}
            </div>
        </div>
    );
}
