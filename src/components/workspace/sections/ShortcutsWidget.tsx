'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Zap, Plus, FolderPlus, Compass, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WidgetCardSizeMode } from '@/components/workspace/dashboard/types';

const SHORTCUTS = [
    { label: 'New Task', icon: Plus, href: '/workspace?tab=tasks', color: 'text-blue-500' },
    { label: 'New Project', icon: FolderPlus, href: '/hub', color: 'text-indigo-500' },
    { label: 'Explore Hub', icon: Compass, href: '/hub', color: 'text-emerald-500' },
    { label: 'Messages', icon: MessageSquare, href: '/messages', color: 'text-violet-500' },
];

function ShortcutsWidget({ sizeMode = 'standard' }: { sizeMode?: WidgetCardSizeMode }) {
    const isCompact = sizeMode === 'compact';
    const gridClass = sizeMode === 'expanded' ? 'grid-cols-4' : 'grid-cols-2';

    return (
        <div className={cn(
            'h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col',
            isCompact ? 'p-3' : 'p-4'
        )}>
            <div className={cn('flex items-center gap-2 shrink-0', isCompact ? 'mb-2' : 'mb-3')}>
                <div className={cn('bg-emerald-50 dark:bg-emerald-900/20 rounded-lg', isCompact ? 'p-1' : 'p-1.5')}>
                    <Zap className={cn('text-emerald-600 dark:text-emerald-400', isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                </div>
                <h3 className={cn('font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight', isCompact ? 'text-[13px]' : 'text-sm')}>
                    Workspace Quick Actions
                </h3>
            </div>

            <div className={cn('flex-1 grid content-start', gridClass, isCompact ? 'gap-1.5' : 'gap-2')}>
                {SHORTCUTS.map((shortcut) => {
                    const Icon = shortcut.icon;
                    return (
                        <Link
                            key={shortcut.label}
                            href={shortcut.href}
                            className={cn(
                                'flex items-center rounded-lg border border-zinc-100 dark:border-zinc-800 hover:border-blue-200 dark:hover:border-blue-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-all duration-150 motion-safe:hover:-translate-y-0.5 group',
                                isCompact ? 'gap-1.5 p-2' : 'gap-2 p-2.5'
                            )}
                        >
                            <Icon className={cn(shortcut.color, 'shrink-0', isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
                            <span className={cn(
                                'font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 transition-colors truncate',
                                isCompact ? 'text-[11px]' : 'text-xs'
                            )}>
                                {shortcut.label}
                            </span>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}

export default memo(ShortcutsWidget);
