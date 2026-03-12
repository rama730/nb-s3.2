'use client';

import { useEffect, memo, useCallback } from 'react';
import Image from 'next/image';
import { useChatStore } from '@/stores/chatStore';
import type { ProjectGroupConversation } from '@/app/actions/messaging';
import { formatDistanceToNow } from 'date-fns';
import { Folder, Loader2, Users } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';

// ============================================================================
// PROJECT GROUP LIST
// Displays project group conversations in the chat popup
// OPTIMIZED: Uses selectors and memoization for 1M+ user performance
// ============================================================================

// OPTIMIZATION: Memoized list item to prevent unnecessary re-renders
const ProjectGroupItem = memo(function ProjectGroupItem({
    group,
    onOpen
}: {
    group: ProjectGroupConversation;
    onOpen: (id: string) => void;
}) {
    return (
        <button
            onClick={() => onOpen(group.id)}
            className="w-full flex items-start gap-3 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors text-left group"
        >
            {/* Project Cover / Avatar */}
            <div className="relative flex-shrink-0">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center overflow-hidden ring-2 ring-white dark:ring-zinc-900">
                    {group.projectCoverImage ? (
                        <Image
                            src={group.projectCoverImage}
                            alt={group.projectTitle}
                            width={48}
                            height={48}
                            unoptimized
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <Folder className="w-5 h-5 text-white" />
                    )}
                </div>
                {/* Unread Badge */}
                {group.unreadCount > 0 && (
                    <div className="absolute -top-1 -right-1 min-w-5 h-5 px-1.5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                        {group.unreadCount > 9 ? '9+' : group.unreadCount}
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">
                        {group.projectTitle}
                    </span>
                    {group.lastMessage && (
                        <span className="text-xs text-zinc-400 dark:text-zinc-500 flex-shrink-0">
                            {formatDistanceToNow(new Date(group.lastMessage.createdAt), { addSuffix: false })}
                        </span>
                    )}
                </div>

                {/* Last Message Preview */}
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                    {formatProjectPreview(group.lastMessage)}
                </p>

                {/* Member Count */}
                <div className="flex items-center gap-1 mt-1.5">
                    <Users className="w-3 h-3 text-zinc-400" />
                    <span className="text-xs text-zinc-400">
                        {group.memberCount} member{group.memberCount !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>
        </button>
    );
});

export function ProjectGroupList() {
    // OPTIMIZATION: Select specific slices to prevent unnecessary re-renders
    const projectGroups = useChatStore(state => state.projectGroups);
    const projectGroupsLoading = useChatStore(state => state.projectGroupsLoading);
    const fetchProjectGroups = useChatStore(state => state.fetchProjectGroups);
    const openConversation = useChatStore(state => state.openConversation);

    // Fetch project groups on mount (store handles caching)
    useEffect(() => {
        fetchProjectGroups();
    }, [fetchProjectGroups]);

    // OPTIMIZATION: Stable callback reference
    const handleOpenConversation = useCallback((id: string) => {
        openConversation(id);
    }, [openConversation]);

    if (projectGroupsLoading && projectGroups.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            </div>
        );
    }

    if (projectGroups.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center mb-4">
                    <Folder className="w-8 h-8 text-indigo-400" />
                </div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    No project groups
                </p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                    Create a project to start a team chat
                </p>
            </div>
        );
    }

    return (
        <Virtuoso
            style={{ height: '100%' }}
            data={projectGroups}
            computeItemKey={(_, group) => group.id}
            increaseViewportBy={{ top: 160, bottom: 200 }}
            itemContent={(_, group) => (
                <ProjectGroupItem
                    key={group.id}
                    group={group}
                    onOpen={handleOpenConversation}
                />
            )}
        />
    );
}

function formatProjectPreview(
    lastMessage: ProjectGroupConversation['lastMessage'] | null | undefined
): string {
    if (!lastMessage) return 'No messages yet';
    const text = (lastMessage.content || '').trim();
    if (text.length > 0) {
        if (text.includes('```')) return 'Code snippet';
        return text;
    }
    switch (lastMessage.type) {
        case 'image':
            return 'Photo';
        case 'video':
            return 'Video';
        case 'file':
            return 'Attachment';
        case 'system':
            return 'System update';
        default:
            return 'Message';
    }
}
