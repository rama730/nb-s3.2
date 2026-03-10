'use client';

import { memo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { AtSign, Users, Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceMentionsRequestItem } from '@/app/actions/workspace';
import type { WidgetCardSizeMode } from '@/components/workspace/dashboard/types';

interface MentionsRequestsWidgetProps {
    items: WorkspaceMentionsRequestItem[];
    sizeMode?: WidgetCardSizeMode;
}

function MentionsRequestsWidget({ items, sizeMode = 'standard' }: MentionsRequestsWidgetProps) {
    const isCompact = sizeMode === 'compact';
    const visibleLimit = sizeMode === 'compact' ? 3 : sizeMode === 'expanded' ? 8 : 5;

    return (
        <div className={cn(
            'h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col',
            isCompact ? 'p-3' : 'p-4'
        )}>
            <div className={cn('flex items-center justify-between shrink-0', isCompact ? 'mb-2' : 'mb-3')}>
                <div className="flex items-center gap-2">
                    <div className={cn('bg-orange-50 dark:bg-orange-900/20 rounded-lg', isCompact ? 'p-1' : 'p-1.5')}>
                        <AtSign className={cn('text-orange-600 dark:text-orange-400', isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                    </div>
                    <h3 className={cn('font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight', isCompact ? 'text-[13px]' : 'text-sm')}>
                        Mentions & Requests
                    </h3>
                </div>
                {items.length > 0 && (
                    <span className={cn('px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300', isCompact ? 'text-[10px]' : 'text-xs')}>
                        {items.length}
                    </span>
                )}
            </div>

            {items.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-zinc-400">
                    <p className={cn(isCompact ? 'text-[12px]' : 'text-sm')}>No pending requests.</p>
                </div>
            ) : (
                <div className={cn('flex-1 min-h-0 overflow-y-auto', isCompact ? 'space-y-1' : 'space-y-1.5')}>
                    {items.slice(0, visibleLimit).map((item) => {
                        const Icon = item.type === 'connection_request' ? Users : Briefcase;
                        const displayName = item.title || 'Request';
                        return (
                            <Link
                                key={item.id}
                                href={item.route}
                                className={cn(
                                    'flex items-center gap-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-all duration-150 motion-safe:hover:-translate-y-0.5',
                                    isCompact ? 'p-2' : 'p-2.5'
                                )}
                            >
                                <div className="relative shrink-0">
                                    {item.avatarUrl ? (
                                        <Image
                                            src={item.avatarUrl}
                                            alt={displayName}
                                            width={isCompact ? 24 : 28}
                                            height={isCompact ? 24 : 28}
                                            unoptimized
                                            className={cn('rounded-full object-cover', isCompact ? 'w-6 h-6' : 'w-7 h-7')}
                                        />
                                    ) : (
                                        <div className={cn(
                                            'rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center',
                                            isCompact ? 'w-6 h-6' : 'w-7 h-7'
                                        )}>
                                            <Icon className={cn('text-zinc-500', isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
                                        </div>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className={cn('font-medium text-zinc-800 dark:text-zinc-200 truncate', isCompact ? 'text-[13px]' : 'text-sm')}>
                                        {item.title}
                                    </p>
                                    <p className={cn('text-zinc-500 truncate mt-0.5', isCompact ? 'text-[10px]' : 'text-xs')}>
                                        {item.subtitle}
                                    </p>
                                </div>
                                <span className={cn('text-zinc-400 shrink-0', isCompact ? 'text-[9px]' : 'text-[10px]')}>
                                    {formatRelativeTime(item.createdAt)}
                                </span>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function formatRelativeTime(value: Date | string) {
    const date = new Date(value);
    const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diffMinutes < 1) return 'now';
    if (diffMinutes < 60) return `${diffMinutes}m`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d`;
}

export default memo(MentionsRequestsWidget);
