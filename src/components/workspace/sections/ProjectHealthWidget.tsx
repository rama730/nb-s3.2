'use client';

import { memo, useMemo } from 'react';
import Link from 'next/link';
import { HeartPulse, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceProject } from '@/app/actions/workspace';
import type { WidgetCardSizeMode } from '@/components/workspace/dashboard/types';

interface ProjectHealthWidgetProps {
    projects: WorkspaceProject[];
    sizeMode?: WidgetCardSizeMode;
}

function ProjectHealthWidget({ projects, sizeMode = 'standard' }: ProjectHealthWidgetProps) {
    const isCompact = sizeMode === 'compact';
    const visibleLimit = sizeMode === 'compact' ? 3 : sizeMode === 'expanded' ? 8 : 5;

    const ranked = useMemo(() => {
        return [...projects]
            .filter((project) => project.totalTaskCount > 0 || project.openTaskCount > 0)
            .sort((a, b) => b.openTaskCount - a.openTaskCount);
    }, [projects]);

    return (
        <div className={cn(
            'h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col',
            isCompact ? 'p-3' : 'p-4'
        )}>
            <div className={cn('flex items-center justify-between shrink-0', isCompact ? 'mb-2' : 'mb-3')}>
                <div className="flex items-center gap-2">
                    <div className={cn('bg-emerald-50 dark:bg-emerald-900/20 rounded-lg', isCompact ? 'p-1' : 'p-1.5')}>
                        <HeartPulse className={cn('text-emerald-600 dark:text-emerald-400', isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                    </div>
                    <h3 className={cn('font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight', isCompact ? 'text-[13px]' : 'text-sm')}>
                        Project Health
                    </h3>
                </div>
            </div>

            {ranked.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-zinc-400">
                    <p className={cn(isCompact ? 'text-[12px]' : 'text-sm')}>No active project metrics yet.</p>
                </div>
            ) : (
                <div className={cn('flex-1 min-h-0 overflow-y-auto', isCompact ? 'space-y-1' : 'space-y-1.5')}>
                    {ranked.slice(0, visibleLimit).map((project) => {
                        const projectPath = project.slug ?? project.id;
                        const completed = Math.max(0, project.totalTaskCount - project.openTaskCount);
                        const completion = project.totalTaskCount > 0
                            ? Math.round((completed / project.totalTaskCount) * 100)
                            : 100;
                        const highPressure = project.openTaskCount >= 10;
                        return (
                            <Link
                                key={project.id}
                                href={`/projects/${projectPath}`}
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
                                <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-500">
                                    {highPressure ? (
                                        <>
                                            <AlertTriangle className="w-3 h-3 text-rose-500" />
                                            <span>{project.openTaskCount} open tasks</span>
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                            <span>{project.openTaskCount} open tasks</span>
                                        </>
                                    )}
                                    {project.activeSprintTitle && (
                                        <span className="truncate max-w-[120px]">• {project.activeSprintTitle}</span>
                                    )}
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default memo(ProjectHealthWidget);
