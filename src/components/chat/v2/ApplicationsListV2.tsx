'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, ArrowRight, Briefcase, Filter, SortAsc } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { cn } from '@/lib/utils';
import { buildIdentityPresentation } from '@/lib/ui/identity';
import { useApplicationsInbox } from '@/hooks/useMessagesV2';
import { getMyPendingProjectInvitationsAction, resolveProjectInvitationAction } from '@/app/actions/project/guidance';
import { InboxListSkeletonV2 } from './MessagesSurfaceSkeletons';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ApplicationsListV2Props {
    surface?: 'page' | 'popup';
    selectedConversationId?: string | null;
    onSelectConversation: (conversationId: string) => void;
}

function StatusBadge({ status }: { status: string | null | undefined }) {
    const config: Record<string, { bg: string; text: string; label: string }> = {
        pending: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-300', label: 'Pending' },
        accepted: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300', label: 'Accepted' },
        rejected: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300', label: 'Rejected' },
        withdrawn: { bg: 'bg-zinc-100 dark:bg-zinc-800', text: 'text-zinc-600 dark:text-zinc-400', label: 'Withdrawn' },
        role_filled: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', label: 'Filled' },
        proposed: { bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-700 dark:text-violet-300', label: 'Proposed' },
        project_deleted: { bg: 'bg-zinc-100 dark:bg-zinc-800', text: 'text-zinc-600 dark:text-zinc-400', label: 'Project deleted' },
    };
    const c = config[status || ''] ?? {
        bg: 'bg-zinc-100 dark:bg-zinc-800',
        text: 'text-zinc-600 dark:text-zinc-400',
        label: 'Status unavailable',
    };
    return (
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${c.bg} ${c.text}`}>{c.label}</span>
    );
}

export function ApplicationsListV2({
    surface = 'page',
    selectedConversationId,
    onSelectConversation,
}: ApplicationsListV2Props) {
    const isPopup = surface === 'popup';
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');
    const [sortBy, setSortBy] = useState<'newest' | 'status' | 'unread'>('newest');
    const [nowMinute, setNowMinute] = useState(() => Date.now());
    const [durableInvitations, setDurableInvitations] = useState<Array<{
        id: string;
        projectTitle: string;
        kind: 'ordinary_role' | 'guidance_appointment';
        roleTitle: string | null;
        guidanceLabel: string | null;
        note: string | null;
        reviewAt: Date | null;
        expiresAt: Date;
        inviterName: string | null;
        inviterUsername: string | null;
    }>>([]);
    const [resolvingInvitationId, setResolvingInvitationId] = useState<string | null>(null);
    const query = useApplicationsInbox(20, statusFilter, sortBy);
    const pages = query.data?.pages ?? [];
    const applications = pages.flatMap((page) => page.success ? page.applications : []);
    const hasMore = Boolean(pages[pages.length - 1]?.hasMore);

    useEffect(() => {
        const timer = window.setInterval(() => setNowMinute(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void getMyPendingProjectInvitationsAction().then((result) => {
            if (!cancelled && result.success) setDurableInvitations(result.invitations);
        });
        return () => { cancelled = true; };
    }, []);

    const resolveDurableInvitation = async (invitationId: string, action: 'accept' | 'decline') => {
        setResolvingInvitationId(invitationId);
        try {
            const result = await resolveProjectInvitationAction({ invitationId, action });
            if (!result.success) throw new Error(result.error || 'Unable to resolve invitation');
            setDurableInvitations((items) => items.filter((item) => item.id !== invitationId));
        } catch {
            // Keep the invitation visible; the next inbox read rechecks its durable state.
        } finally {
            setResolvingInvitationId(null);
        }
    };

    if (query.isLoading && applications.length === 0) {
        return <InboxListSkeletonV2 surface={surface} showSearch={false} />;
    }

    if (query.isError && applications.length === 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                    <Briefcase className="h-8 w-8 text-primary" />
                </div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Unable to load applications</p>
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                    {query.error instanceof Error ? query.error.message : 'Check your connection and try again.'}
                </p>
                <button type="button" onClick={() => void query.refetch()} className="mt-3 rounded-lg border px-3 py-1.5 text-xs font-medium">
                    Retry
                </button>
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
            {/* Clean applications tab header */}
            <div className={cn(
                'border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between',
                isPopup ? 'px-3 py-3' : 'px-4 py-4',
            )}>
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    Applications
                </h2>
                <div className="flex items-center gap-1.5">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className={cn(
                                    "flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900",
                                    statusFilter !== 'all' && "border-primary bg-primary/5 text-primary dark:border-primary dark:text-primary",
                                )}
                                aria-label="Filter applications by status"
                            >
                                <Filter className="h-4 w-4" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuRadioGroup
                                value={statusFilter}
                                onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}
                            >
                                {filterOptions.map((filter) => (
                                    <DropdownMenuRadioItem key={filter.key} value={filter.key}>
                                        {filter.label}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900"
                                aria-label={`Sort applications by ${sortLabels[sortBy].toLowerCase()}`}
                            >
                                <SortAsc className="h-4 w-4" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuRadioGroup
                                value={sortBy}
                                onValueChange={(value) => setSortBy(value as typeof sortBy)}
                            >
                                {(['newest', 'status', 'unread'] as const).map((option) => (
                                    <DropdownMenuRadioItem key={option} value={option}>
                                        {sortLabels[option]}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Empty filtered results */}
            {query.isError && applications.length > 0 ? (
                <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                    <span>Showing saved applications. Refresh failed.</span>
                    <button type="button" onClick={() => void query.refetch()} className="font-semibold underline">Retry</button>
                </div>
            ) : null}
            {durableInvitations.length > 0 ? (
                <div className="border-b border-zinc-100 px-3 py-3 dark:border-zinc-800">
                    <p className="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Project invitations</p>
                    <div className="space-y-2">
                        {durableInvitations.map((invitation) => {
                            const label = invitation.kind === 'guidance_appointment'
                                ? invitation.guidanceLabel || 'Guide'
                                : invitation.roleTitle || 'Collaborator';
                            const inviter = invitation.inviterName || invitation.inviterUsername || 'Project Lead';
                            const busy = resolvingInvitationId === invitation.id;
                            return (
                                <div key={invitation.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
                                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{invitation.projectTitle}</p>
                                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{inviter} invited you as {label}</p>
                                    {invitation.note ? <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">{invitation.note}</p> : null}
                                    <div className="mt-3 flex gap-2">
                                        <button type="button" disabled={busy} onClick={() => void resolveDurableInvitation(invitation.id, 'decline')} className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300">Decline</button>
                                        <button type="button" disabled={busy} onClick={() => void resolveDurableInvitation(invitation.id, 'accept')} className="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{busy ? 'Saving…' : 'Accept'}</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}
            {applications.length === 0 && durableInvitations.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                        <Briefcase className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        No applications in this category
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Try selecting a different filter.
                    </p>
                </div>
            ) : (
                <div className="min-h-0 flex-1">
                    <Virtuoso
                        style={{ height: '100%' }}
                        data={applications}
                        computeItemKey={(_, application) => application.id}
                        increaseViewportBy={{ top: 220, bottom: 320 }}
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
                        itemContent={(_, application) => {
                            const status = application.lifecycleStatus || application.status;
                            const createdAt = application.createdAt ? new Date(application.createdAt) : null;
                            const createdAtLabel = nowMinute && createdAt && !Number.isNaN(createdAt.getTime())
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
                                        aria-current={selectedConversationId === application.conversationId ? 'true' : undefined}
                                        title={!application.conversationId
                                            ? 'Messaging is unavailable for this application. Open the application details for its current status.'
                                            : undefined}
                                        className={cn(
                                            'w-full rounded-2xl border border-transparent text-left transition-colors app-density-list-row',
                                            isPopup ? 'min-h-[78px] px-4 py-3' : 'min-h-[84px] px-4 py-3.5',
                                            application.conversationId
                                                ? selectedConversationId === application.conversationId
                                                    ? 'border-primary/40 bg-primary/5'
                                                    : 'hover:border-zinc-200/80 hover:bg-zinc-50/80 dark:hover:border-zinc-800 dark:hover:bg-zinc-900'
                                                : 'cursor-default opacity-60',
                                        )}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="relative shrink-0">
                                                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full app-accent-gradient">
                                                    {(() => {
                                                        const appUserIdentity = buildIdentityPresentation(application.displayUser);
                                                        return appUserIdentity.avatarUrl ? (
                                                            <Image
                                                                src={appUserIdentity.avatarUrl}
                                                                alt={appUserIdentity.alt}
                                                                width={40}
                                                                height={40}
                                                                unoptimized
                                                                className="h-full w-full object-cover"
                                                            />
                                                        ) : (
                                                            <span className={cn("text-xs font-bold text-white", appUserIdentity.gradientClass)}>
                                                                {appUserIdentity.initials}
                                                            </span>
                                                        );
                                                    })()}
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
                                                    <span
                                                        className="absolute -right-2 -top-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary"
                                                        aria-label={`${application.unreadCount} new message${application.unreadCount === 1 ? '' : 's'}`}
                                                    >
                                                        New
                                                    </span>
                                                ) : null}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="mb-1 flex items-center justify-between gap-2">
                                                    <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                                        {buildIdentityPresentation(application.displayUser).displayName}
                                                    </span>
                                                    <div className="ml-2 flex shrink-0 items-center gap-1.5">
                                                        <StatusBadge status={status} />
                                                        <span
                                                            className="text-[11px] text-zinc-400"
                                                            title={createdAt?.toLocaleString()}
                                                        >
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
                                                        {application.isWorkflowItem ? (
                                                            application.type === 'incoming' ? 'Invited you as ' : 'Invited as '
                                                        ) : (
                                                            application.type === 'incoming' ? 'Applying for ' : 'Applied for '
                                                        )}
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
