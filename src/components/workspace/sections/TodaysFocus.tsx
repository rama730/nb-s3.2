'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Target, ArrowRight, Circle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceTask, WorkspaceOverviewData } from '@/app/actions/workspace';
import { updateTaskStatusAction } from '@/app/actions/task';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { WidgetCardSizeMode } from '@/components/workspace/dashboard/types';

const PRIORITY_DOT: Record<string, string> = {
    urgent: 'bg-rose-500',
    high: 'bg-orange-500',
    medium: 'bg-amber-500',
    low: 'bg-zinc-400',
};

interface TodaysFocusProps {
    tasks: WorkspaceTask[];
    sizeMode?: WidgetCardSizeMode;
    onTaskClick?: (task: WorkspaceTask) => void;
}

function TodaysFocus({ tasks, sizeMode = 'standard', onTaskClick }: TodaysFocusProps) {
    const queryClient = useQueryClient();
    const isCompact = sizeMode === 'compact';
    const visibleLimit = sizeMode === 'compact' ? 4 : sizeMode === 'expanded' ? 10 : 8;

    const handleStatusToggle = async (task: WorkspaceTask) => {
        const nextStatus = task.status === 'todo' ? 'in_progress' : 'done';
        const label = nextStatus === 'in_progress' ? 'Task started' : 'Task marked as done';

        // Optimistic update
        queryClient.setQueryData<WorkspaceOverviewData | undefined>(
            ['workspace', 'overview'],
            (old) => {
                if (!old) return old;
                return {
                    ...old,
                    tasks: old.tasks.map(t =>
                        t.id === task.id ? { ...t, status: nextStatus } : t
                    ),
                };
            }
        );

        try {
            await updateTaskStatusAction(task.id, nextStatus, task.projectId);
            toast.success(label);
        } catch {
            toast.error('Failed to update task');
        }
        queryClient.invalidateQueries({ queryKey: ['workspace'] });
    };

    return (
        <div className={cn(
            'h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col',
            isCompact ? 'p-3' : 'p-4'
        )}>
            <div className={cn('flex items-center justify-between shrink-0', isCompact ? 'mb-2' : 'mb-3')}>
                <div className="flex items-center gap-2">
                    <div className={cn('bg-blue-50 dark:bg-blue-900/20 rounded-lg', isCompact ? 'p-1' : 'p-1.5')}>
                        <Target className={cn('text-blue-600 dark:text-blue-400', isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                    </div>
                    <h3 className={cn('font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight', isCompact ? 'text-[13px]' : 'text-sm')}>
                        Today&apos;s Focus
                    </h3>
                </div>
                <span className={cn(
                    'text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full',
                    isCompact ? 'text-[10px]' : 'text-xs'
                )}>
                    {tasks.length} active
                </span>
            </div>

            {tasks.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-zinc-400">
                    <div className="text-center">
                        <p className={cn(isCompact ? 'text-[12px]' : 'text-sm')}>No active tasks assigned to you.</p>
                        <p className={cn('mt-1', isCompact ? 'text-[10px]' : 'text-xs')}>Enjoy your focus time!</p>
                    </div>
                </div>
            ) : (
                <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
                    {tasks.slice(0, visibleLimit).map((task) => (
                        <div
                            key={task.id}
                            className={cn(
                                'group flex items-start rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-all duration-150 motion-safe:hover:-translate-y-0.5',
                                isCompact ? 'gap-2 p-2' : 'gap-3 p-2.5'
                            )}
                        >
                            <button
                                onClick={() => handleStatusToggle(task)}
                                className="mt-0.5 shrink-0 text-zinc-300 dark:text-zinc-600 hover:text-blue-500 transition-colors"
                            >
                                {task.status === 'in_progress' ? (
                                    <CheckCircle2 className="w-4.5 h-4.5 text-blue-500" />
                                ) : (
                                    <Circle className="w-4.5 h-4.5" />
                                )}
                            </button>
                            <div className="flex-1 min-w-0">
                                <button
                                    onClick={() => onTaskClick?.(task)}
                                    className={cn(
                                        'text-left font-medium text-zinc-800 dark:text-zinc-200 hover:text-blue-600 dark:hover:text-blue-400 transition-colors line-clamp-1 w-full',
                                        isCompact ? 'text-[13px] leading-4' : 'text-sm'
                                    )}
                                >
                                    {task.title}
                                </button>
                                <div className={cn('flex items-center mt-0.5', isCompact ? 'gap-1.5' : 'gap-2')}>
                                    <Link href={`/projects/${task.projectSlug}`} className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider hover:text-blue-500 transition-colors">
                                        {task.projectKey ? `${task.projectKey}-${task.taskNumber}` : task.projectTitle}
                                    </Link>
                                    <div className={cn('w-1.5 h-1.5 rounded-full', PRIORITY_DOT[task.priority] || PRIORITY_DOT.medium)} />
                                </div>
                            </div>
                            {task.dueDate && !isCompact && (
                                <span className={cn(
                                    'text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0',
                                    new Date(task.dueDate) < new Date()
                                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                                        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                                )}>
                                    {formatDueDate(task.dueDate)}
                                </span>
                            )}
                        </div>
                    ))}
                    {tasks.length > visibleLimit && (
                        <Link
                            href="/workspace?tab=tasks"
                            className={cn(
                                'flex items-center justify-center gap-1 text-blue-600 dark:text-blue-400 hover:underline py-1.5 shrink-0',
                                isCompact ? 'text-[11px]' : 'text-xs'
                            )}
                        >
                            View all {tasks.length} tasks {!isCompact && <ArrowRight className="w-3 h-3" />}
                        </Link>
                    )}
                </div>
            )}
        </div>
    );
}

function formatDueDate(date: Date | string): string {
    const d = new Date(date);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default memo(TodaysFocus);
