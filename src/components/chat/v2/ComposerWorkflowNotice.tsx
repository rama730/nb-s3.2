'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ComposerWorkflowNoticeProps {
    workflowNotice: {
        tone: 'success' | 'danger' | 'warning' | 'neutral' | 'info' | 'brand';
        icon: ReactNode;
        badge: string;
        title: string;
        description: string;
        actionLabel?: string | null;
    };
    isPopup: boolean;
    requestLoading: boolean;
    onConnectionAction: () => void;
}

const toneStyles = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100',
    danger: 'border-red-200 bg-red-50 text-red-950 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100',
    warning: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100',
    neutral: 'border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100',
    info: 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100',
    brand: 'border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-100',
    default: 'border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100',
} as const;

export function ComposerWorkflowNotice({
    workflowNotice,
    isPopup,
    requestLoading,
    onConnectionAction,
}: ComposerWorkflowNoticeProps) {
    return (
        <div className={cn(
            'mb-3 rounded-2xl border',
            toneStyles[workflowNotice.tone] || toneStyles.default,
            isPopup ? 'px-3 py-2.5' : 'px-3.5 py-3',
        )}>
            <div className={`flex items-start gap-3 ${isPopup ? 'flex-col' : 'flex-row'}`}>
                <div className="flex min-w-0 items-start gap-2.5">
                    <div className="mt-0.5 shrink-0">
                        {workflowNotice.icon}
                    </div>
                    <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-wide opacity-80">
                            {workflowNotice.badge}
                        </div>
                        <div className="mt-1 text-sm font-medium">{workflowNotice.title}</div>
                        <div className="mt-1 text-xs opacity-80">{workflowNotice.description}</div>
                    </div>
                </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
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
