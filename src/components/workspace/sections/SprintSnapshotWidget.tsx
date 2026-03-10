'use client';

import { memo, useMemo } from 'react';
import Link from 'next/link';
import { Gauge, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceProject } from '@/app/actions/workspace';
import type { WidgetCardSizeMode } from '@/components/workspace/dashboard/types';

interface SprintSnapshotWidgetProps {
    projects: WorkspaceProject[];
    sizeMode?: WidgetCardSizeMode;
}

function SprintSnapshotWidget({ projects, sizeMode = 'standard' }: SprintSnapshotWidgetProps) {
    const isCompact = sizeMode === 'compact';
    const visibleLimit = sizeMode === 'compact' ? 3 : sizeMode === 'expanded' ? 8 : 5;

    const sprintProjects = useMemo(
        () => projects.filter((project) => Boolean(project.activeSprintTitle)),
        [projects],
    );

    return (
        <div className={cn(
            'h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col',
            isCompact ? 'p-3' : 'p-4'
        )}>
            <div className={cn('flex items-center justify-between shrink-0', isCompact ? 'mb-2' : 'mb-3')}>
                <div className="flex items-center gap-2">
                    <div className={cn('bg-sky-50 dark:bg-sky-900/20 rounded-lg', isCompact ? 'p-1' : 'p-1.5')}>
                        <Gauge className={cn('text-sky-600 dark:text-sky-400', isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                    </div>
                    <h3 className={cn('font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight', isCompact ? 'text-[13px]' : 'text-sm')}>
                        Sprint Snapshot
                    </h3>
                </div>
            </div>

            {sprintProjects.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-zinc-400">
                    <p className={cn(isCompact ? 'text-[12px]' : 'text-sm')}>No active sprint right now.</p>
                </div>
            ) : (
                <div className={cn('flex-1 min-h-0 overflow-y-auto', isCompact ? 'space-y-1' : 'space-y-1.5')}>
                    {sprintProjects.slice(0, visibleLimit).map((project) => {
                        const projectPath = project.slug ?? project.id;
                        const completed = Math.max(0, project.totalTaskCount - project.openTaskCount);
                        const completion = project.totalTaskCount > 0
                            ? Math.round((completed / project.totalTaskCount) * 100)
                            : 0;

                        return (
                            <Link
                                key={project.id}
                                href={`/projects/${projectPath}?tab=sprints`}
                                className={cn(
                                    'block rounded-lg border border-zinc-100 dark:border-zinc-800 hover:border-blue-200 dark:hover:border-blue-800/50 transition-all duration-150 motion-safe:hover:-translate-y-0.5',
                                    isCompact ? 'p-2' : 'p-2.5'
                                )}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <p className={cn('font-medium text-zinc-800 dark:text-zinc-200 truncate', isCompact ? 'text-[13px]' : 'text-sm')}>
                                        {project.title}
                                    </p>
                                    <span className="text-[10px] text-zinc-500 shrink-0">{completion}%</span>
                                </div>
                                <div className="flex items-center gap-1.5 mt-1 text-[10px] text-zinc-500">
                                    <Zap className="w-3 h-3 text-sky-500" />
                                    <span className="truncate">{project.activeSprintTitle}</span>
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default memo(SprintSnapshotWidget);
