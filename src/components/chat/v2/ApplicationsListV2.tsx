'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, ArrowRight, Briefcase, Search, SortAsc } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import type { getApplicationsInboxPageV2 } from '@/app/actions/messaging/v2';
import { cn } from '@/lib/utils';
import { useApplicationsInbox } from '@/hooks/useMessagesV2';
import { InboxListSkeletonV2 } from './MessagesSurfaceSkeletons';

interface ApplicationsListV2Props {
    surface?: 'page' | 'popup';
    onSelectConversation: (conversationId: string) => void;
}

type ApplicationsInboxItem = NonNullable<
    Awaited<ReturnType<typeof getApplicationsInboxPageV2>>['applications']
>[number];

function StatusBadge({ status }: { status: string | null | undefined }) {
    const config: Record<string, { bg: string; text: string; label: string }> = {
        pending: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-300', label: 'Pending' },
        accepted: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300', label: 'Accepted' },
        rejected: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300', label: 'Rejected' },
        withdrawn: { bg: 'bg-zinc-100 dark:bg-zinc-800', text: 'text-zinc-600 dark:text-zinc-400', label: 'Withdrawn' },
        role_filled: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', label: 'Filled' },
    };
    const c = config[status || 'pending'] || config.pending;
    return (
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${c.bg} ${c.text}`}>{c.label}</span>
    );
}

export function ApplicationsListV2({
    surface = 'page',
    onSelectConversation,
}: ApplicationsListV2Props) {
    const isPopup = surface === 'popup';
    const query = useApplicationsInbox();
    const pages = query.data?.pages ?? [];
    const applications = pages.flatMap((page) => page.success ? page.applications : []);
    const hasMore = Boolean(pages[pages.length - 1]?.hasMore);

    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');
    const [sortBy, setSortBy] = useState<'newest' | 'status' | 'unread'>('newest');
    const [showSortMenu, setShowSortMenu] = useState(false);

    const filteredApplications = useMemo(() => {
        let result = applications;
        // Search filter
        const q = searchQuery.trim().toLowerCase();
        if (q) {
            result = result.filter((application: ApplicationsInboxItem) =>
                application.projectTitle?.toLowerCase().includes(q)
                || application.roleTitle?.toLowerCase().includes(q)
                || application.displayUser?.fullName?.toLowerCase().includes(q)
                || application.displayUser?.username?.toLowerCase().includes(q),
            );
        }
        // Status filter
        if (statusFilter !== 'all') {
            result = result.filter((application: ApplicationsInboxItem) => {
                const status = application.lifecycleStatus || application.status;
                return status === statusFilter;
            });
        }
        // Sort
        if (sortBy === 'status') {
            const statusOrder: Record<string, number> = { pending: 0, accepted: 1, rejected: 2, withdrawn: 3, role_filled: 4 };
            result = [...result].sort((left: ApplicationsInboxItem, right: ApplicationsInboxItem) => {
                const leftStatus = statusOrder[left.lifecycleStatus || left.status || 'pending'] ?? 5;
                const rightStatus = statusOrder[right.lifecycleStatus || right.status || 'pending'] ?? 5;
                return leftStatus - rightStatus;
            });
        } else if (sortBy === 'unread') {
            result = [...result].sort(
                (left: ApplicationsInboxItem, right: ApplicationsInboxItem) =>
                    (right.unreadCount ?? 0) - (left.unreadCount ?? 0),
            );
        }
        return result;
    }, [applications, searchQuery, statusFilter, sortBy]);

    if (query.isLoading && applications.length === 0) {
        return <InboxListSkeletonV2 surface={surface} showSearch={false} />;
    }

    if (applications.length === 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                    <Briefcase className="h-8 w-8 text-primary" />
                </div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">No applications</p>
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                    Your hiring and application history
                </p>
            </div>
        );
    }

    const sortLabels: Record<typeof sortBy, string> = {
        newest: 'Newest',
        status: 'Status',
        unread: 'Unread',
    };

    const filterOptions = [
        { key: 'all' as const, label: 'All' },
        { key: 'pending' as const, label: 'Pending' },
        { key: 'accepted' as const, label: 'Accepted' },
        { key: 'rejected' as const, label: 'Rejected' },
    ];

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-zinc-950">
            {/* Search + Sort header */}
            <div className={cn(
                'border-b border-zinc-100 dark:border-zinc-800',
                isPopup ? 'px-3 pb-3 pt-2' : 'px-4 pb-4 pt-3',
            )}>
                <div className="flex items-center gap-2">
                    <div className="relative min-w-0 flex-1 rounded-2xl border border-zinc-200/80 bg-white/95 p-1 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:border-zinc-800 dark:bg-zinc-950">
                        <div className="relative rounded-[18px] bg-zinc-50 dark:bg-zinc-900">
                            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                            <input
                                type="text"
                                aria-label="Search applications"
                                placeholder="Search applications..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="h-[44px] w-full rounded-[18px] border border-transparent bg-transparent pl-10 pr-4 text-sm text-zinc-700 outline-none transition-all placeholder:text-zinc-400 focus:border-primary/25 focus:bg-white focus:ring-2 focus:ring-primary/10 dark:text-zinc-200 dark:focus:bg-zinc-950"
                            />
                        </div>
                    </div>
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setShowSortMenu((v) => !v)}
                            className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl border border-zinc-200/80 bg-white/95 text-zinc-500 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900"
                            aria-label="Sort options"
                        >
                            <SortAsc className="h-4 w-4" />
                        </button>
                        {showSortMenu && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
                                <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                                    {(['newest', 'status', 'unread'] as const).map((option) => (
                                        <button
                                            key={option}
                                            type="button"
                                            onClick={() => { setSortBy(option); setShowSortMenu(false); }}
                                            className={cn(
                                                'w-full px-3 py-2 text-left text-xs transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800',
                                                sortBy === option
                                                    ? 'font-semibold text-primary'
                                                    : 'text-zinc-600 dark:text-zinc-400',
                                            )}
                                        >
                                            {sortLabels[option]}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Filter chips */}
            <div className={cn('flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800', isPopup ? 'px-3 py-2' : 'px-4 py-2')}>
                {filterOptions.map((filter) => (
                    <button
                        key={filter.key}
                        type="button"
                        onClick={() => setStatusFilter(filter.key)}
                        className={cn(
                            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                            statusFilter === filter.key
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
                        )}
                    >
                        {filter.label}
                    </button>
                ))}
            </div>

            {/* Empty filtered results */}
            {filteredApplications.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                        <Briefcase className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {searchQuery.trim() ? 'No applications match your search' : 'No applications in this category'}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {searchQuery.trim() ? 'Try a different name or keyword.' : 'Try selecting a different filter.'}
                    </p>
                </div>
            ) : (
                <div className="min-h-0 flex-1">
                    <Virtuoso
                        style={{ height: '100%' }}
                        data={filteredApplications}
                        computeItemKey={(_, application) => application.id}
                        increaseViewportBy={{ top: 220, bottom: 320 }}
                        endReached={() => {
                            if (hasMore && !query.isFetchingNextPage) {
                                void query.fetchNextPage();
                            }
                        }}
                        components={{
                            Footer: () =>
                                hasMore ? (
                                    <div className="py-3 text-center text-xs text-zinc-500">
                                        {query.isFetchingNextPage ? 'Loading...' : 'Scroll for more applications'}
                                    </div>
                                ) : null,
                        }}
                        itemContent={(_, application) => {
                            const status = application.lifecycleStatus || application.status;
                            const createdAt = application.createdAt ? new Date(application.createdAt) : null;
                            const createdAtLabel = createdAt && !Number.isNaN(createdAt.getTime())
                                ? formatDistanceToNow(createdAt, { addSuffix: false })
                                : '-';

                            return (
                                <div className="px-2 py-1">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!application.conversationId) return;
                                            onSelectConversation(application.conversationId);
                                        }}
                                        disabled={!application.conversationId}
                                        aria-disabled={!application.conversationId}
                                        className={cn(
                                            'w-full rounded-2xl border border-transparent text-left transition-colors app-density-list-row',
                                            isPopup ? 'min-h-[78px] px-4 py-3' : 'min-h-[84px] px-4 py-3.5',
                                            application.conversationId
                                                ? 'hover:border-zinc-200/80 hover:bg-zinc-50/80 dark:hover:border-zinc-800 dark:hover:bg-zinc-900'
                                                : 'cursor-default opacity-60',
                                        )}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="relative shrink-0">
                                                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full app-accent-gradient">
                                                    {application.displayUser.avatarUrl ? (
                                                        <Image
                                                            src={application.displayUser.avatarUrl}
                                                            alt={application.displayUser.fullName || ''}
                                                            width={40}
                                                            height={40}
                                                            unoptimized
                                                            className="h-full w-full object-cover"
                                                        />
                                                    ) : (
                                                        <span className="text-xs font-bold text-white">
                                                            {(application.displayUser.fullName || application.displayUser.username || '?')[0].toUpperCase()}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="absolute -bottom-1 -right-1 rounded-full bg-white p-0.5 dark:bg-zinc-900">
                                                    <div className={`flex h-4 w-4 items-center justify-center rounded-full ${
                                                        application.type === 'incoming'
                                                            ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400'
                                                            : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400'
                                                    }`}>
                                                        {application.type === 'incoming'
                                                            ? <ArrowLeft className="h-2.5 w-2.5 -rotate-45" />
                                                            : <ArrowRight className="h-2.5 w-2.5 -rotate-45" />}
                                                    </div>
                                                </div>
                                                {(application.unreadCount ?? 0) > 0 ? (
                                                    <div className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                                                        {(application.unreadCount ?? 0) > 9 ? '9+' : application.unreadCount}
                                                    </div>
                                                ) : null}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="mb-1 flex items-center justify-between gap-2">
                                                    <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                        {application.displayUser.fullName || application.displayUser.username || 'Unknown'}
                                                    </span>
                                                    <div className="ml-2 flex shrink-0 items-center gap-1.5">
                                                        <StatusBadge status={status} />
                                                        <span className="text-[11px] text-zinc-400">
                                                            {createdAtLabel}
                                                        </span>
                                                    </div>
                                                </div>

                                                <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                                                    <span
                                                        className={
                                                            status === 'accepted'
                                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                                : status === 'role_filled'
                                                                    ? 'text-blue-600 dark:text-blue-400'
                                                                    : status === 'rejected' || status === 'withdrawn'
                                                                        ? 'text-red-600 dark:text-red-400'
                                                                        : 'text-primary'
                                                        }
                                                    >
                                                        {application.type === 'incoming' ? 'Applying for ' : 'Applied for '}
                                                        {application.roleTitle}
                                                    </span>
                                                </p>
                                                <p className="mt-0.5 truncate text-[10px] text-zinc-400">
                                                    {application.projectTitle}
                                                </p>
                                                {application.coverLetter ? (
                                                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-zinc-400 dark:text-zinc-500">
                                                        {application.coverLetter}
                                                    </p>
                                                ) : null}
                                                {application.decisionReason === 'role_filled' ? (
                                                    <p className="text-[10px] text-blue-500 dark:text-blue-300">Role filled</p>
                                                ) : null}
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
