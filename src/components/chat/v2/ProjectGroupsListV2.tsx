'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { formatDistanceToNow } from 'date-fns';
import { BellOff, Folder, Users } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { cn } from '@/lib/utils';
import { useProjectGroups } from '@/hooks/useMessagesV2';
import { buildIdentityPresentation } from '@/lib/ui/identity';
import { StackedAvatars } from '@/components/ui/StackedAvatars';
import { formatMessagePreview } from '@/lib/messages/preview';
import { InboxListSkeletonV2 } from './MessagesSurfaceSkeletons';

interface ProjectGroupsListV2Props {
    surface?: 'page' | 'popup';
    selectedConversationId?: string | null;
    onSelectConversation: (conversationId: string) => void;
}

export function ProjectGroupsListV2({
    surface = 'page',
    selectedConversationId,
    onSelectConversation,
}: ProjectGroupsListV2Props) {
    const isPopup = surface === 'popup';
    const [nowMinute, setNowMinute] = useState(() => Date.now());
    const query = useProjectGroups();
    const pages = query.data?.pages ?? [];
    const groups = pages.flatMap((page) => page.success ? (page.projectGroups ?? []) : []);
    const hasMore = Boolean(pages[pages.length - 1]?.hasMore);

    useEffect(() => {
        const timer = window.setInterval(() => setNowMinute(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    if (query.isLoading && groups.length === 0) {
        return <InboxListSkeletonV2 surface={surface} showSearch={false} />;
    }

    if (query.isError && groups.length === 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                    <Folder className="h-8 w-8 text-primary" />
                </div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Unable to load project groups</p>
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                    {query.error instanceof Error ? query.error.message : 'Check your connection and try again.'}
                </p>
                <button type="button" onClick={() => void query.refetch()} className="mt-3 rounded-lg border px-3 py-1.5 text-xs font-medium">
                    Retry
                </button>
            </div>
        );
    }



    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-zinc-950">
            {query.isError && groups.length > 0 ? (
                <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                    <span>Showing saved groups. Refresh failed.</span>
                    <button type="button" onClick={() => void query.refetch()} className="font-semibold underline">Retry</button>
                </div>
            ) : null}
            {groups.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                        <Folder className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">No project groups</p>
                    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">Create a project to start a team chat</p>
                </div>
            ) : (
            <div className="min-h-0 flex-1">
                <Virtuoso
                    style={{ height: '100%' }}
                    data={groups}
                    computeItemKey={(_, group) => group.id}
                    increaseViewportBy={{ top: 160, bottom: 200 }}
                    endReached={() => {
                        if (hasMore && !query.isFetchingNextPage) {
                            void query.fetchNextPage();
                        }
                    }}
                    components={{
                        Footer: () =>
                            query.isFetchNextPageError ? (
                                <button
                                    type="button"
                                    onClick={() => void query.fetchNextPage()}
                                    className="w-full py-3 text-center text-xs font-medium text-red-600 dark:text-red-400"
                                >
                                    Couldn&apos;t load more. Retry
                                </button>
                            ) : query.isFetchingNextPage ? (
                                <div className="py-3 text-center text-xs text-zinc-500">
                                    Loading…
                                </div>
                            ) : null,
                    }}
                    itemContent={(_, group) => {
                        const memberAvatars = (group.members ?? []).map((member) => {
                            const identity = buildIdentityPresentation(member);
                            return {
                                url: identity.avatarUrl,
                                name: identity.displayName,
                                initials: identity.initials,
                            };
                        });

                        return (
                            <div className="px-2 py-1">
                                <button
                                    key={group.id}
                                    type="button"
                                    onClick={() => onSelectConversation(group.id)}
                                    aria-current={selectedConversationId === group.id ? 'true' : undefined}
                                    className={cn(
                                        'w-full rounded-2xl border border-transparent text-left transition-colors app-density-list-row hover:border-zinc-200/80 hover:bg-zinc-50/80 dark:hover:border-zinc-800 dark:hover:bg-zinc-900',
                                        isPopup ? 'min-h-[78px] px-4 py-3' : 'min-h-[84px] px-4 py-3.5',
                                        selectedConversationId === group.id ? 'border-primary/40 bg-primary/5' : '',
                                    )}
                                >
                                    <div className="flex items-center gap-3">
                                        {/* Project cover image */}
                                        <div className="relative shrink-0">
                                            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl app-accent-gradient">
                                                {group.projectCoverImage ? (
                                                    <Image
                                                        src={group.projectCoverImage}
                                                        alt={group.projectTitle}
                                                        width={48}
                                                        height={48}
                                                        unoptimized
                                                        className="h-full w-full object-cover"
                                                    />
                                                ) : (
                                                    <Folder className="h-5 w-5 text-white" />
                                                )}
                                            </div>
                                        </div>

                                        {/* Center: name, last message, members */}
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex min-w-0 items-center gap-1.5">
                                                    <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                        {group.projectTitle}
                                                    </span>
                                                {group.muted ? (
                                                    <BellOff className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                                                ) : null}
                                                {group.unreadCount > 0 ? (
                                                    <span
                                                        className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary"
                                                        aria-label={`${group.unreadCount} new message${group.unreadCount === 1 ? '' : 's'}`}
                                                    >
                                                        New
                                                    </span>
                                                ) : null}
                                                </div>
                                                {group.lastMessage ? (
                                                    <span
                                                        className="ml-2 shrink-0 text-[11px] text-zinc-400"
                                                        title={new Date(group.lastMessage.createdAt).toLocaleString()}
                                                    >
                                                        {nowMinute
                                                            ? formatDistanceToNow(new Date(group.lastMessage.createdAt), { addSuffix: false })
                                                            : ''}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <p className="mt-0.5 truncate text-[12px] leading-5 text-zinc-500 dark:text-zinc-400">
                                                {formatMessagePreview(group.lastMessage)}
                                            </p>
                                            <div className="mt-1.5 flex items-center gap-2">
                                                {memberAvatars.length > 0 ? (
                                                    <StackedAvatars avatars={memberAvatars} max={3} size={20} />
                                                ) : null}
                                                <span className="flex items-center gap-1 text-xs text-zinc-400">
                                                    <Users className="h-3 w-3" />
                                                    {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            </div>
                        );
                    }}
                />
            </div>
            )}
        </div>
    );
}
