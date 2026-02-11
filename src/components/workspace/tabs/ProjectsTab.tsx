'use client';

import { memo } from 'react';
import Link from 'next/link';
import {
    FolderKanban,
    Zap,
    ExternalLink,
    Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkspaceProject } from '@/app/actions/workspace';

interface ProjectsTabProps {
    initialProjects: WorkspaceProject[];
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

const ROLE_BADGE: Record<string, string> = {
    owner: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
    admin: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
    member: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
    viewer: 'bg-zinc-50 text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-500',
};

function ProjectsTab({ initialProjects }: ProjectsTabProps) {
    if (initialProjects.length === 0) {
        return (
            <div className="text-center py-16 text-zinc-400">
                <FolderKanban className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="text-sm font-medium">No projects yet</p>
                <p className="text-xs mt-1 mb-4">Create a new project or discover existing ones on the Hub.</p>
                <Link
                    href="/hub"
                    className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    Explore Hub
                </Link>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {initialProjects.map((project) => (
                <Link
                    key={project.id}
                    href={`/projects/${project.slug ?? project.id}`}
                    className="group flex flex-col p-5 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-blue-200 dark:hover:border-blue-800/50 hover:shadow-md transition-all"
                >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                        <div className="flex items-start gap-2 min-w-0">
                            <div className={cn('w-2.5 h-2.5 rounded-full mt-1 shrink-0', STATUS_COLOR[project.status ?? 'draft'])} />
                            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2">
                                {project.title}
                            </h3>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {project.key && (
                                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                                    {project.key}
                                </span>
                            )}
                            <ExternalLink className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                    </div>

                    {project.shortDescription && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 mb-3">
                            {project.shortDescription}
                        </p>
                    )}

                    {/* Stats */}
                    <div className="flex items-center flex-wrap gap-2 mb-3 text-[11px]">
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            <span className="font-semibold text-zinc-700 dark:text-zinc-300">{project.openTaskCount}</span> open tasks
                        </span>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {project.totalTaskCount} total
                        </span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                            {STATUS_LABEL[project.status ?? 'draft'] || project.status}
                        </span>
                        {project.activeSprintTitle && (
                            <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                                <Zap className="w-3 h-3" />
                                <span className="truncate max-w-[130px]">{project.activeSprintTitle}</span>
                            </span>
                        )}
                    </div>

                    {/* Progress bar */}
                    {project.totalTaskCount > 0 && (
                        <div className="mb-3">
                            <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-emerald-500 rounded-full transition-all"
                                    style={{ width: `${((project.totalTaskCount - project.openTaskCount) / project.totalTaskCount) * 100}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Footer */}
                    <div className="mt-auto flex items-center justify-between pt-3 border-t border-zinc-100 dark:border-zinc-800">
                        <span className={cn(
                            'text-[10px] font-medium px-2 py-0.5 rounded capitalize',
                            ROLE_BADGE[project.role] || ROLE_BADGE.member
                        )}>
                            {project.role}
                        </span>
                        <span className="text-[10px] font-medium text-zinc-400">
                            {project.totalTaskCount > 0 ? Math.round(((project.totalTaskCount - project.openTaskCount) / project.totalTaskCount) * 100) : 0}% complete
                        </span>
                    </div>
                </Link>
            ))}
        </div>
    );
}

export default memo(ProjectsTab);
