'use client';

import { memo } from 'react';
import Link from 'next/link';
import { FolderKanban, ArrowRight, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceProject } from '@/app/actions/workspace';
import type { WidgetCardSizeMode } from '@/components/workspace/dashboard/types';

interface MyProjectsGridProps {
    projects: WorkspaceProject[];
    sizeMode?: WidgetCardSizeMode;
}

const STATUS_COLOR: Record<string, string> = {
    active: 'bg-emerald-500',
    draft: 'bg-zinc-400',
    completed: 'bg-blue-500',
    archived: 'bg-zinc-300',
};

const STATUS_LABEL: Record<string, string> = {
    active: 'Active',
    draft: 'Draft',
    completed: 'Completed',
    archived: 'Archived',
};

function MyProjectsGrid({ projects, sizeMode = 'standard' }: MyProjectsGridProps) {
    const isCompact = sizeMode === 'compact';
    const isExpanded = sizeMode === 'expanded';
    const maxItems = isCompact ? 4 : isExpanded ? 8 : 6;
    const visibleProjects = projects.slice(0, maxItems);

    return (
        <div className={cn(
            'h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col',
            isCompact ? 'p-3' : 'p-4'
        )}>
            <div className={cn('flex items-center justify-between shrink-0', isCompact ? 'mb-2' : 'mb-3')}>
                <div className="flex items-center gap-2">
                    <div className={cn(
                        'bg-indigo-50 dark:bg-indigo-900/20 rounded-lg',
                        isCompact ? 'p-1' : 'p-1.5'
                    )}>
                        <FolderKanban className={cn('text-indigo-600 dark:text-indigo-400', isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                    </div>
                    <h3 className={cn('font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight', isCompact ? 'text-[13px]' : 'text-sm')}>
                        My Projects
                    </h3>
                </div>
                <Link
                    href="/workspace?tab=projects"
                    className={cn(
                        'text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1',
                        isCompact ? 'text-[11px]' : 'text-xs'
                    )}
                >
                    View all <ArrowRight className="w-3 h-3" />
                </Link>
            </div>

            {projects.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-zinc-400">
                    <div className="text-center">
                        <p className="text-sm">No projects yet.</p>
                        <Link href="/hub" className="text-xs text-blue-600 hover:underline mt-1 inline-block">
                            Discover projects on the Hub
                        </Link>
                    </div>
                </div>
            ) : (
                <div className={cn(
                    'flex-1 min-h-0 overflow-y-auto content-start',
                    isCompact ? 'space-y-2' : 'grid gap-2 auto-rows-min',
                    isCompact ? '' : isExpanded ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'
                )}>
                    {visibleProjects.map((project) => {
                        const completedPercent = project.totalTaskCount > 0
                            ? Math.round(((project.totalTaskCount - project.openTaskCount) / project.totalTaskCount) * 100)
                            : 0;
                        const projectHref = `/projects/${project.slug ?? project.id}`;

                        if (isCompact) {
                            return (
                                <Link
                                    key={project.id}
                                    href={projectHref}
                                    className="group flex items-center justify-between gap-2 p-2 rounded-lg border border-zinc-100 dark:border-zinc-800 hover:border-blue-200 dark:hover:border-blue-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-all duration-150 motion-safe:hover:-translate-y-0.5"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <div className={cn('w-2 h-2 rounded-full', STATUS_COLOR[project.status ?? 'draft'])} />
                                            <p className="text-[13px] leading-4 font-semibold text-zinc-800 dark:text-zinc-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                                {project.title}
                                            </p>
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                                            {project.key && (
                                                <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono uppercase">
                                                    {project.key}
                                                </span>
                                            )}
                                            <span>{project.openTaskCount} open</span>
                                        </div>
                                    </div>
                                    <span className="text-[10px] font-medium text-zinc-400">{completedPercent}%</span>
                                </Link>
                            );
                        }

                        return (
                            <Link
                                key={project.id}
                                href={projectHref}
                                className="group flex flex-col p-3.5 rounded-lg border border-zinc-100 dark:border-zinc-800 hover:border-blue-200 dark:hover:border-blue-800/50 hover:shadow-sm transition-all"
                            >
                                <div className="flex items-start justify-between gap-2 mb-1.5">
                                    <div className="flex items-start gap-2 min-w-0">
                                        <div className={cn('w-2 h-2 rounded-full mt-1 shrink-0', STATUS_COLOR[project.status ?? 'draft'])} />
                                        <h4 className={cn(
                                            'font-semibold text-zinc-800 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors',
                                            isExpanded ? 'text-sm line-clamp-2' : 'text-sm line-clamp-1'
                                        )}>
                                            {project.title}
                                        </h4>
                                    </div>
                                    {project.key && (
                                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 shrink-0">
                                            {project.key}
                                        </span>
                                    )}
                                </div>

                                {isExpanded && (
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 mb-2">
                                        {project.shortDescription || 'Project in active development.'}
                                    </p>
                                )}

                                <div className="flex items-center flex-wrap gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                                    <span>
                                        <span className="font-semibold text-zinc-700 dark:text-zinc-200">{project.openTaskCount}</span> open
                                    </span>
                                    <span>{project.totalTaskCount} total</span>
                                    <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">
                                        {STATUS_LABEL[project.status ?? 'draft'] || project.status}
                                    </span>
                                    {project.activeSprintTitle && (
                                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                            <Zap className="w-3 h-3" />
                                            <span className="truncate max-w-[120px]">{project.activeSprintTitle}</span>
                                        </span>
                                    )}
                                </div>

                                {project.totalTaskCount > 0 && (
                                    <div className="mt-2">
                                        <div className="h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-emerald-500 rounded-full transition-all duration-200"
                                                style={{ width: `${completedPercent}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </Link>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default memo(MyProjectsGrid);
