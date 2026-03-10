'use client';

import { memo } from 'react';
import Link from 'next/link';
import { FileClock, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceRecentFile } from '@/app/actions/workspace';
import type { WidgetCardSizeMode } from '@/components/workspace/dashboard/types';

interface RecentFilesWidgetProps {
    files: WorkspaceRecentFile[];
    sizeMode?: WidgetCardSizeMode;
}

function RecentFilesWidget({ files, sizeMode = 'standard' }: RecentFilesWidgetProps) {
    const isCompact = sizeMode === 'compact';
    const visibleLimit = sizeMode === 'compact' ? 4 : sizeMode === 'expanded' ? 10 : 6;

    return (
        <div className={cn(
            'h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col',
            isCompact ? 'p-3' : 'p-4'
        )}>
            <div className={cn('flex items-center justify-between shrink-0', isCompact ? 'mb-2' : 'mb-3')}>
                <div className="flex items-center gap-2">
                    <div className={cn('bg-cyan-50 dark:bg-cyan-900/20 rounded-lg', isCompact ? 'p-1' : 'p-1.5')}>
                        <FileClock className={cn('text-cyan-600 dark:text-cyan-400', isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                    </div>
                    <h3 className={cn('font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight', isCompact ? 'text-[13px]' : 'text-sm')}>
                        Recent Files
                    </h3>
                </div>
                {!isCompact && (
                    <Link href="/workspace" className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                        Files <ArrowRight className="w-3 h-3" />
                    </Link>
                )}
            </div>

            {files.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-zinc-400">
                    <p className={cn(isCompact ? 'text-[12px]' : 'text-sm')}>No recent files yet.</p>
                </div>
            ) : (
                <div className={cn('flex-1 min-h-0 overflow-y-auto', isCompact ? 'space-y-1' : 'space-y-1.5')}>
                    {files.slice(0, visibleLimit).map((file) => {
                        const projectPath = file.projectSlug ?? file.projectId;
                        const href = `/projects/${projectPath}?tab=files&path=${encodeURIComponent(file.path)}`;
                        return (
                            <Link
                                key={file.id}
                                href={href}
                                className={cn(
                                    'block rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-all duration-150 motion-safe:hover:-translate-y-0.5',
                                    isCompact ? 'p-2' : 'p-2.5'
                                )}
                                title={file.path}
                            >
                                <p className={cn('font-medium text-zinc-800 dark:text-zinc-200 truncate', isCompact ? 'text-[13px]' : 'text-sm')}>
                                    {file.name}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 truncate max-w-[160px]">
                                        {file.projectKey || file.projectTitle}
                                    </span>
                                    <span className="text-[10px] text-zinc-400 shrink-0">{formatRelativeTime(file.updatedAt)}</span>
                                </div>
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

export default memo(RecentFilesWidget);
