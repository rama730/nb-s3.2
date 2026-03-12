'use client';

import { memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Activity, CheckCircle2, PlayCircle, Circle, UserPlus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getWorkspaceActivity, type WorkspaceActivityItem } from '@/app/actions/workspace';
import { queryKeys } from '@/lib/query-keys';

const TYPE_CONFIG: Record<WorkspaceActivityItem['type'], { icon: typeof CheckCircle2; color: string }> = {
    task_completed: { icon: CheckCircle2, color: 'text-emerald-500' },
    task_in_progress: { icon: PlayCircle, color: 'text-blue-500' },
    task_created: { icon: Circle, color: 'text-zinc-400' },
    connection_accepted: { icon: UserPlus, color: 'text-emerald-500' },
};

function ActivityTab() {
    const { data, isLoading } = useQuery({
        queryKey: queryKeys.workspace.activity(),
        queryFn: () => getWorkspaceActivity(),
        staleTime: 60_000,
    });

    const items = data?.items ?? [];

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-16 text-zinc-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">Loading activity...</span>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="text-center py-16 text-zinc-400">
                <Activity className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm font-medium">No recent activity</p>
                <p className="text-xs mt-1">Your task activity will appear here.</p>
            </div>
        );
    }

    return (
        <div className="space-y-1">
            <div className="flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-zinc-400" />
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    Recent Activity
                </span>
            </div>

            <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-[11px] top-3 bottom-3 w-px bg-zinc-200 dark:bg-zinc-800" />

                <div className="space-y-0.5">
                    {items.map((item) => {
                        const config = TYPE_CONFIG[item.type];
                        const Icon = config.icon;
                        return (
                            <div
                                key={item.id}
                                className="relative flex items-start gap-3 p-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                            >
                                <div className="relative z-10 shrink-0 mt-0.5">
                                    <Icon className={cn('w-[22px] h-[22px]', config.color)} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 line-clamp-1">
                                        {item.title}
                                    </p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                            {item.subtitle}
                                        </span>
                                        {item.meta.projectSlug && (
                                            <Link
                                                href={`/projects/${item.meta.projectSlug}`}
                                                className="text-[10px] font-mono text-zinc-400 hover:text-blue-500 uppercase transition-colors"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {item.meta.projectKey}{item.meta.taskNumber ? `-${item.meta.taskNumber}` : ''}
                                            </Link>
                                        )}
                                    </div>
                                </div>
                                <span className="text-[10px] text-zinc-400 shrink-0 mt-1">
                                    {formatTimeAgo(item.timestamp)}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function formatTimeAgo(date: Date | string): string {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default memo(ActivityTab);
