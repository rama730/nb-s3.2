'use client';

import { memo } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceTask } from '@/app/actions/workspace';
import type { WidgetCardSizeMode } from '@/components/workspace/dashboard/types';

interface UrgentItemsProps {
    tasks: WorkspaceTask[];
    sizeMode?: WidgetCardSizeMode;
    onTaskClick?: (task: WorkspaceTask) => void;
}

const STATUS_BADGE: Record<string, string> = {
    todo: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    in_progress: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300',
};

function UrgentItems({ tasks, sizeMode = 'standard', onTaskClick }: UrgentItemsProps) {
    const isCompact = sizeMode === 'compact';
    const visibleLimit = sizeMode === 'compact' ? 3 : sizeMode === 'expanded' ? 7 : 5;

    return (
        <div className={cn(
            'h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col',
            isCompact ? 'p-3' : 'p-4'
        )}>
            <div className={cn('flex items-center justify-between shrink-0', isCompact ? 'mb-2' : 'mb-3')}>
                <div className="flex items-center gap-2">
                    <div className={cn('bg-rose-50 dark:bg-rose-900/20 rounded-lg', isCompact ? 'p-1' : 'p-1.5')}>
                        <AlertTriangle className={cn('text-rose-600 dark:text-rose-400', isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                    </div>
                    <h3 className={cn('font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight', isCompact ? 'text-[13px]' : 'text-sm')}>
                        Urgent Items
                    </h3>
                </div>
                {tasks.length > 0 && (
                    <span className={cn(
                        'text-rose-600 bg-rose-50 dark:bg-rose-900/30 dark:text-rose-400 px-2 py-0.5 rounded-full font-medium',
                        isCompact ? 'text-[10px]' : 'text-xs'
                    )}>
                        {tasks.length}
                    </span>
                )}
            </div>

            {tasks.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-zinc-400">
                    <div className="text-center">
                        <div className={cn(
                            'mx-auto bg-emerald-50 dark:bg-emerald-900/20 rounded-full flex items-center justify-center',
                            isCompact ? 'w-7 h-7 mb-1.5' : 'w-8 h-8 mb-2'
                        )}>
                            <Clock className={cn('text-emerald-500', isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                        </div>
                        <p className={cn('font-medium text-emerald-600 dark:text-emerald-400', isCompact ? 'text-[11px]' : 'text-xs')}>All clear</p>
                        <p className={cn('text-zinc-400 mt-0.5', isCompact ? 'text-[9px]' : 'text-[10px]')}>No urgent items.</p>
                    </div>
                </div>
            ) : (
                <div className={cn('flex-1 min-h-0 overflow-y-auto', isCompact ? 'space-y-1' : 'space-y-1.5')}>
                    {tasks.slice(0, visibleLimit).map((task) => {
                        const isOverdue = task.dueDate && new Date(task.dueDate) < new Date();
                        return (
                            <button
                                key={task.id}
                                onClick={() => onTaskClick?.(task)}
                                className={cn(
                                    'w-full text-left flex items-start rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-all duration-150 motion-safe:hover:-translate-y-0.5 group',
                                    isCompact ? 'gap-2 p-2' : 'gap-3 p-2.5'
                                )}
                            >
                                <div className={cn(
                                    'w-1.5 h-1.5 rounded-full shrink-0',
                                    isCompact ? 'mt-1.5' : 'mt-2',
                                    isOverdue ? 'bg-rose-500 animate-pulse' : 'bg-orange-500'
                                )} />
                                <div className="flex-1 min-w-0">
                                    <p className={cn(
                                        'font-medium text-zinc-800 dark:text-zinc-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1',
                                        isCompact ? 'text-[13px] leading-4' : 'text-sm'
                                    )}>
                                        {task.title}
                                    </p>
                                    <div className={cn('flex items-center mt-0.5', isCompact ? 'gap-1.5' : 'gap-2 mt-1')}>
                                        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                                            {task.projectKey ? `${task.projectKey}-${task.taskNumber}` : task.projectTitle}
                                        </span>
                                        {!isCompact && (
                                            <span className={cn(
                                                'text-[10px] font-medium px-1.5 py-0.5 rounded',
                                                STATUS_BADGE[task.status] || STATUS_BADGE.todo
                                            )}>
                                                {task.status === 'in_progress' ? 'In Progress' : 'To Do'}
                                            </span>
                                        )}
                                        {isOverdue && (
                                            <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400">
                                                Overdue
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default memo(UrgentItems);
