'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ComposerWorkflowNoticeProps {
    workflowNotice: {
        tone: 'success' | 'danger' | 'warning' | 'neutral' | 'info' | 'brand';
        icon: ReactNode;
        badge: string;
        lastStatusLabel?: string | null;
        title: string;
        description: string;
        canAccept?: boolean;
        canReject?: boolean;
        canWithdraw?: boolean;
        canReopen?: boolean;
        canEditRequest?: boolean;
        requestHref?: string | null;
        projectHref?: string | null;
        actionLabel?: string | null;
    };
    isPopup: boolean;
    requestLoading: boolean;
    applicationActionLoading: 'accept' | 'reject' | 'withdraw' | 'reopen' | null;
    onConnectionAction: () => void;
    onApplicationAction: (action: 'accept' | 'reject' | 'withdraw' | 'reopen') => void;
}

export function ComposerWorkflowNotice({
    workflowNotice,
    isPopup,
    requestLoading,
    applicationActionLoading,
    onConnectionAction,
    onApplicationAction,
}: ComposerWorkflowNoticeProps) {
    return (
        <div className={`mb-3 rounded-2xl border ${
            workflowNotice.tone === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100'
                : workflowNotice.tone === 'danger'
                    ? 'border-red-200 bg-red-50 text-red-950 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100'
                    : workflowNotice.tone === 'warning'
                        ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100'
                        : workflowNotice.tone === 'neutral'
                            ? 'border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100'
                            : 'border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-100'
        } ${isPopup ? 'px-3 py-2.5' : 'px-3.5 py-3'}`}>
            <div className={`flex items-start justify-between gap-3 ${isPopup ? 'flex-col' : 'flex-row'}`}>
                <div className="flex min-w-0 items-start gap-2.5">
                    <div className="mt-0.5 shrink-0">
                        {workflowNotice.icon}
                    </div>
                    <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-wide opacity-80">
                            {workflowNotice.badge}
                            {workflowNotice.lastStatusLabel ? ` · ${workflowNotice.lastStatusLabel}` : ''}
                        </div>
                        <div className="mt-1 text-sm font-medium">{workflowNotice.title}</div>
                        <div className="mt-1 text-xs opacity-80">{workflowNotice.description}</div>
                    </div>
                </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                {workflowNotice.canAccept ? (
                    <button
                        type="button"
                        onClick={() => onApplicationAction('accept')}
                        disabled={applicationActionLoading !== null}
                        className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                    >
                        {applicationActionLoading === 'accept' ? 'Accepting…' : 'Accept'}
                    </button>
                ) : null}
                {workflowNotice.canReject ? (
                    <button
                        type="button"
                        onClick={() => onApplicationAction('reject')}
                        disabled={applicationActionLoading !== null}
                        className="rounded-lg border border-indigo-300 px-2.5 py-1 text-xs font-medium hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-800 dark:hover:bg-indigo-900/40"
                    >
                        {applicationActionLoading === 'reject' ? 'Rejecting…' : 'Reject'}
                    </button>
                ) : null}
                {workflowNotice.canWithdraw ? (
                    <button
                        type="button"
                        onClick={() => onApplicationAction('withdraw')}
                        disabled={applicationActionLoading !== null}
                        className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                        {applicationActionLoading === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
                    </button>
                ) : null}
                {workflowNotice.canReopen ? (
                    <button
                        type="button"
                        onClick={() => onApplicationAction('reopen')}
                        disabled={applicationActionLoading !== null}
                        className="rounded-lg border border-indigo-300 px-2.5 py-1 text-xs font-medium hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-800 dark:hover:bg-indigo-900/40"
                    >
                        {applicationActionLoading === 'reopen' ? 'Reopening…' : 'Reopen'}
                    </button>
                ) : null}
                {workflowNotice.canEditRequest && workflowNotice.requestHref ? (
                    <Link
                        href={workflowNotice.requestHref}
                        className="rounded-lg border border-indigo-300 px-2.5 py-1 text-xs font-medium hover:bg-indigo-100 dark:border-indigo-800 dark:hover:bg-indigo-900/40"
                    >
                        Edit request
                    </Link>
                ) : null}
                {workflowNotice.requestHref && !workflowNotice.canEditRequest ? (
                    <Link
                        href={workflowNotice.requestHref}
                        className="rounded-lg border border-indigo-300 px-2.5 py-1 text-xs font-medium hover:bg-indigo-100 dark:border-indigo-800 dark:hover:bg-indigo-900/40"
                    >
                        View request
                    </Link>
                ) : null}
                {workflowNotice.projectHref ? (
                    <Link
                        href={workflowNotice.projectHref}
                        className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                    >
                        Open project
                    </Link>
                ) : null}
                {workflowNotice.actionLabel ? (
                    <button
                        type="button"
                        onClick={onConnectionAction}
                        disabled={requestLoading}
                        className={cn(
                            'rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium hover:bg-amber-100 disabled:opacity-60',
                            'dark:border-amber-800 dark:hover:bg-amber-900/40',
                        )}
                    >
                        {requestLoading ? 'Working...' : workflowNotice.actionLabel}
                    </button>
                ) : null}
            </div>
        </div>
    );
}
