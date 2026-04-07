'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { formatDistanceToNow } from 'date-fns';
import { BellOff, Folder, Search, Users } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { cn } from '@/lib/utils';
import { useProjectGroups } from '@/hooks/useMessagesV2';
import { StackedAvatars } from '@/components/ui/StackedAvatars';
import { formatMessagePreview } from './message-rendering';
import { InboxListSkeletonV2 } from './MessagesSurfaceSkeletons';

interface ProjectGroupsListV2Props {
    surface?: 'page' | 'popup';
    onSelectConversation: (conversationId: string) => void;
}

export function ProjectGroupsListV2({
    surface = 'page',
    onSelectConversation,
}: ProjectGroupsListV2Props) {
    const isPopup = surface === 'popup';
    const query = useProjectGroups();
    const pages = query.data?.pages ?? [];
    const groups = pages.flatMap((page) => page.success ? (page.projectGroups ?? []) : []);
    const hasMore = Boolean(pages[pages.length - 1]?.hasMore);

    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'recent' | 'alpha' | 'unread'>('recent');
    const sortedGroups = useMemo(() => {
        let result = groups;
        // Search filter
        const q = searchQuery.trim().toLowerCase();
        if (q) {
            result = result.filter((g: any) =>
                g.projectTitle?.toLowerCase().includes(q) ||
                g.name?.toLowerCase().includes(q) ||
                g.description?.toLowerCase().includes(q)
            );
        }
        // Sort
        if (sortBy === 'alpha') {
            result = [...result].sort((a: any, b: any) => (a.projectTitle || a.name || '').localeCompare(b.projectTitle || b.name || ''));
        } else if (sortBy === 'unread') {
            result = [...result].sort((a: any, b: any) => (b.unreadCount || 0) - (a.unreadCount || 0));
        }
        return result;
    }, [groups, searchQuery, sortBy]);

    if (query.isLoading && groups.length === 0) {
        return <InboxListSkeletonV2 surface={surface} showSearch={false} />;
    }

    if (groups.length === 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                    <Folder className="h-8 w-8 text-primary" />
                </div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">No project groups</p>
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                    Create a project to start a team chat
                </p>
            </div>
        );
    }

    const sortOptions: { key: typeof sortBy; label: string }[] = [
        { key: 'recent', label: 'Recent' },
        { key: 'alpha', label: 'A-Z' },
        { key: 'unread', label: 'Unread' },
    ];

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-zinc-950">
            {/* Search + Sort header */}
            <div className={cn(
                'border-b border-zinc-100 dark:border-zinc-800',
                isPopup ? 'px-3 pb-3 pt-2' : 'px-4 pb-4 pt-3',
            )}>
                <div className="relative min-w-0 rounded-2xl border border-zinc-200/80 bg-white/95 p-1 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-zinc-800 dark:bg-zinc-950">
                    <div className="relative rounded-[18px] bg-zinc-50 dark:bg-zinc-900">
                        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                        <input
                            type="text"
                            aria-label="Search project groups"
                            placeholder="Search groups..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-[44px] w-full rounded-[18px] border border-transparent bg-transparent pl-10 pr-4 text-sm text-zinc-700 outline-none transition-all placeholder:text-zinc-400 focus:border-primary/25 focus:bg-white focus:ring-2 focus:ring-primary/10 dark:text-zinc-200 dark:focus:bg-zinc-950"
                        />
                    </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                    {sortOptions.map((option) => (
                        <button
                            key={option.key}
                            type="button"
                            onClick={() => setSortBy(option.key)}
                            className={cn(
                                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                                sortBy === option.key
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
                            )}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Empty search results */}
            {sortedGroups.length === 0 && searchQuery.trim() ? (
                <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                        <Folder className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">No groups match your search</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Try a different keyword.</p>
                </div>
            ) : (
                <div className="min-h-0 flex-1">
                    <Virtuoso
                        style={{ height: '100%' }}
                        data={sortedGroups}
                        computeItemKey={(_, group) => group.id}
                        increaseViewportBy={{ top: 160, bottom: 200 }}
                        endReached={() => {
                            if (hasMore && !query.isFetchingNextPage) {
                                void query.fetchNextPage();
                            }
                        }}
                        components={{
                            Footer: () =>
                                hasMore ? (
                                    <div className="py-3 text-center text-xs text-zinc-500">
                                        {query.isFetchingNextPage ? 'Loading...' : 'Scroll for more project groups'}
                                    </div>
                                ) : null,
                        }}
                        itemContent={(_, group) => {
                            const memberAvatars = ((group as any).members ?? []).map((m: any) => ({
                                url: m.avatarUrl ?? null,
                                initials: ((m.fullName || m.username || '?')[0] || '?').toUpperCase(),
                            }));

                            return (
                                <div className="px-2 py-1">
                                    <button
                                        key={group.id}
                                        type="button"
                                        onClick={() => onSelectConversation(group.id)}
                                        className={cn(
                                            'w-full rounded-2xl border border-transparent text-left transition-colors app-density-list-row hover:border-zinc-200/80 hover:bg-zinc-50/80 dark:hover:border-zinc-800 dark:hover:bg-zinc-900',
                                            isPopup ? 'min-h-[78px] px-4 py-3' : 'min-h-[84px] px-4 py-3.5',
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
                                                {group.unreadCount > 0 ? (
                                                    <div className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
                                                        {group.unreadCount > 9 ? '9+' : group.unreadCount}
                                                    </div>
                                                ) : null}
                                            </div>

                                            {/* Center: name, last message, members */}
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex min-w-0 items-center gap-1.5">
                                                        <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                            {group.projectTitle}
                                                        </span>
                                                        {(group as any).muted ? (
                                                            <BellOff className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                                                        ) : null}
                                                    </div>
                                                    {group.lastMessage ? (
                                                        <span className="ml-2 shrink-0 text-[11px] text-zinc-400">
                                                            {formatDistanceToNow(new Date(group.lastMessage.createdAt), { addSuffix: false })}
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
