'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Activity, UserPlus, MessageSquare, Link2, FileCheck, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RecentActivityItem } from '@/app/actions/workspace';
import type { WidgetCardSizeMode } from '@/components/workspace/dashboard/types';

const TYPE_CONFIG: Record<RecentActivityItem['type'], { icon: typeof UserPlus; color: string }> = {
    task_assigned: { icon: UserPlus, color: 'text-blue-500' },
    comment_added: { icon: MessageSquare, color: 'text-amber-500' },
    connection_accepted: { icon: Link2, color: 'text-emerald-500' },
    application_decided: { icon: FileCheck, color: 'text-violet-500' },
};

interface RecentActivityProps {
    items: RecentActivityItem[];
    sizeMode?: WidgetCardSizeMode;
}

function RecentActivity({ items, sizeMode = 'standard' }: RecentActivityProps) {
    const isCompact = sizeMode === 'compact';
    const visibleLimit = sizeMode === 'compact' ? 4 : sizeMode === 'expanded' ? 8 : 6;

    return (
        <div className={cn(
            'h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col',
            isCompact ? 'p-3' : 'p-4'
        )}>
            <div className={cn('flex items-center justify-between shrink-0', isCompact ? 'mb-2' : 'mb-3')}>
                <div className="flex items-center gap-2">
                    <div className={cn('bg-violet-50 dark:bg-violet-900/20 rounded-lg', isCompact ? 'p-1' : 'p-1.5')}>
                        <Activity className={cn('text-violet-600 dark:text-violet-400', isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                    </div>
                    <h3 className={cn('font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight', isCompact ? 'text-[13px]' : 'text-sm')}>
                        Recent Activity
                    </h3>
                </div>
                <span className={cn(
                    'text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full',
                    isCompact ? 'text-[10px]' : 'text-xs'
                )}>
                    {items.length} new
                </span>
            </div>

            {items.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-zinc-400">
                    <div className="text-center">
                        <p className={cn(isCompact ? 'text-[12px]' : 'text-sm')}>Nothing new right now.</p>
                        <p className={cn('mt-1', isCompact ? 'text-[10px]' : 'text-xs')}>Activity from others will appear here.</p>
                    </div>
                </div>
            ) : (
                <div className={cn('flex-1 min-h-0 overflow-y-auto', isCompact ? 'space-y-0.5' : 'space-y-1')}>
                    {items.slice(0, visibleLimit).map((item) => {
                        const config = TYPE_CONFIG[item.type];
                        const Icon = config.icon;
                        return (
                            <div
                                key={item.id}
                                className={cn(
                                    'flex items-start rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-all duration-150 motion-safe:hover:-translate-y-0.5',
                                    isCompact ? 'gap-2 p-1.5' : 'gap-2.5 p-2'
                                )}
                            >
                                <div className="mt-0.5 shrink-0">
                                    <Icon className={cn(config.color, isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={cn(
                                        'font-medium text-zinc-800 dark:text-zinc-200 line-clamp-1',
                                        isCompact ? 'text-[13px] leading-4' : 'text-sm'
                                    )}>
                                        {item.title}
                                    </p>
                                    <div className={cn('flex items-center mt-0.5', isCompact ? 'gap-1.5' : 'gap-2')}>
                                        <span className={cn('text-zinc-500 dark:text-zinc-400 truncate', isCompact ? 'text-[9px]' : 'text-[10px]')}>
                                            {item.subtitle}
                                        </span>
                                        {item.meta.projectSlug && (
                                            <Link
                                                href={`/projects/${item.meta.projectSlug}`}
                                                className="text-[10px] font-mono text-zinc-400 hover:text-blue-500 uppercase transition-colors shrink-0"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {item.meta.projectKey}{item.meta.taskNumber ? `-${item.meta.taskNumber}` : ''}
                                            </Link>
                                        )}
                                    </div>
                                </div>
                                <span className={cn(
                                    'text-zinc-400 shrink-0 mt-1',
                                    isCompact ? 'text-[8px]' : 'text-[9px]'
                                )}>
                                    {formatTimeAgo(item.timestamp)}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            {sizeMode !== 'compact' && (
                <Link
                    href="/workspace?tab=activity"
                    className="flex items-center justify-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline pt-2 mt-auto shrink-0"
                >
                    View all activity <ArrowRight className="w-3 h-3" />
                </Link>
            )}
        </div>
    );
}

function formatTimeAgo(date: Date | string): string {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default memo(RecentActivity);
