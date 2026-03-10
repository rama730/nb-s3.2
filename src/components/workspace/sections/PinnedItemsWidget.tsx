'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Pin, FolderKanban, CheckSquare, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspacePins } from '@/hooks/useWorkspacePins';
import type { WorkspaceTask } from '@/app/actions/workspace';
import type { WidgetCardSizeMode } from '@/components/workspace/dashboard/types';

interface PinnedItemsWidgetProps {
    sizeMode?: WidgetCardSizeMode;
    onTaskClick?: (task: WorkspaceTask) => void;
}

function PinnedItemsWidget({ sizeMode = 'standard', onTaskClick }: PinnedItemsWidgetProps) {
    const isCompact = sizeMode === 'compact';
    const visibleLimit = sizeMode === 'compact' ? 4 : sizeMode === 'expanded' ? 10 : 6;
    const { pins, removePin } = useWorkspacePins();

    return (
        <div className={cn(
            'h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col',
            isCompact ? 'p-3' : 'p-4'
        )}>
            <div className={cn('flex items-center justify-between shrink-0', isCompact ? 'mb-2' : 'mb-3')}>
                <div className="flex items-center gap-2">
                    <div className={cn('bg-fuchsia-50 dark:bg-fuchsia-900/20 rounded-lg', isCompact ? 'p-1' : 'p-1.5')}>
                        <Pin className={cn('text-fuchsia-600 dark:text-fuchsia-400', isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                    </div>
                    <h3 className={cn('font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight', isCompact ? 'text-[13px]' : 'text-sm')}>
                        Pinned Items
                    </h3>
                </div>
                {pins.length > 0 && (
                    <span className={cn('text-zinc-500 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full', isCompact ? 'text-[10px]' : 'text-xs')}>
                        {pins.length}
                    </span>
                )}
            </div>

            {pins.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-zinc-400">
                    <p className={cn(isCompact ? 'text-[12px]' : 'text-sm')}>No pinned items yet.</p>
                </div>
            ) : (
                <div className={cn('flex-1 min-h-0 overflow-y-auto', isCompact ? 'space-y-1' : 'space-y-1.5')}>
                    {pins.slice(0, visibleLimit).map((pin) => {
                        const isTask = pin.type === 'task';
                        const Icon = isTask ? CheckSquare : FolderKanban;
                        const projectPath = pin.projectSlug ?? pin.projectId;

                        const itemContent = (
                            <>
                                <div className={cn('rounded-md bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0', isCompact ? 'w-6 h-6' : 'w-7 h-7')}>
                                    <Icon className={cn('text-zinc-500', isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className={cn('font-medium text-zinc-800 dark:text-zinc-200 truncate', isCompact ? 'text-[13px]' : 'text-sm')}>
                                        {pin.title}
                                    </p>
                                    {(pin.projectKey || pin.taskNumber) && (
                                        <p className={cn('text-zinc-400 mt-0.5', isCompact ? 'text-[9px]' : 'text-[10px]')}>
                                            {pin.projectKey}{pin.taskNumber ? `-${pin.taskNumber}` : ''}
                                        </p>
                                    )}
                                </div>
                            </>
                        );

                        const rowClass = cn(
                            'w-full flex items-center gap-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-all duration-150 motion-safe:hover:-translate-y-0.5',
                            isCompact ? 'p-2' : 'p-2.5'
                        );

                        const actionButton = (
                            <button
                                onClick={() => removePin({ type: pin.type, id: pin.id })}
                                className="p-1 rounded-md text-zinc-400 hover:text-rose-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                                title="Unpin"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        );

                        if (isTask && pin.projectId && onTaskClick) {
                            return (
                                <div key={`${pin.type}:${pin.id}`} className="flex items-center gap-1">
                                    <button
                                        onClick={() => {
                                            onTaskClick({
                                                id: pin.id,
                                                title: pin.title,
                                                status: 'todo',
                                                priority: 'medium',
                                                dueDate: null,
                                                taskNumber: pin.taskNumber ?? null,
                                                projectId: pin.projectId!,
                                                projectTitle: '',
                                                projectSlug: pin.projectSlug ?? null,
                                                projectKey: pin.projectKey ?? null,
                                                createdAt: new Date(),
                                            });
                                        }}
                                        className={cn(rowClass, 'flex-1 text-left')}
                                    >
                                        {itemContent}
                                    </button>
                                    {actionButton}
                                </div>
                            );
                        }

                        if (projectPath) {
                            return (
                                <div key={`${pin.type}:${pin.id}`} className="flex items-center gap-1">
                                    <Link href={`/projects/${projectPath}`} className={cn(rowClass, 'flex-1')}>
                                        {itemContent}
                                    </Link>
                                    {actionButton}
                                </div>
                            );
                        }

                        return (
                            <div
                                key={`${pin.type}:${pin.id}`}
                                className="flex items-center gap-1"
                            >
                                <div className={cn(rowClass, 'flex-1')}>
                                    {itemContent}
                                </div>
                                {actionButton}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default memo(PinnedItemsWidget);
