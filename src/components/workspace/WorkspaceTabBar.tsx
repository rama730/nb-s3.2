'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import {
    LayoutDashboard,
    CheckSquare,
    Inbox,
    FolderKanban,
    StickyNote,
    Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useReducedMotionPreference } from '@/components/providers/theme-provider';

export type WorkspaceTab = 'overview' | 'tasks' | 'inbox' | 'projects' | 'notes' | 'activity';

interface WorkspaceTabBarProps {
    activeTab: WorkspaceTab;
    onTabChange: (tab: WorkspaceTab) => void;
    badges?: Partial<Record<WorkspaceTab, number>>;
}

const TABS: Array<{ key: WorkspaceTab; label: string; icon: typeof LayoutDashboard }> = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'tasks', label: 'Tasks', icon: CheckSquare },
    { key: 'inbox', label: 'Inbox', icon: Inbox },
    { key: 'projects', label: 'Projects', icon: FolderKanban },
    { key: 'notes', label: 'Notes', icon: StickyNote },
    { key: 'activity', label: 'Activity', icon: Activity },
];

function WorkspaceTabBar({ activeTab, onTabChange, badges }: WorkspaceTabBarProps) {
    const reduceMotion = useReducedMotionPreference();

    return (
        <div className="flex gap-1 app-scroll app-scroll-x app-scroll-hidden -mb-px" role="tablist" aria-label="Workspace tabs">
            {TABS.map(({ key, label, icon: Icon }) => {
                const isActive = activeTab === key;
                const badgeCount = badges?.[key];
                return (
                    <button
                        key={key}
                        data-testid={`workspace-tab-${key}`}
                        role="tab"
                        aria-selected={isActive}
                        aria-controls={`workspace-tab-${key}`}
                        onClick={() => onTabChange(key)}
                        className={cn(
                            'relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap',
                            isActive
                                ? 'app-selected-surface'
                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                        )}
                    >
                        <Icon className="w-4 h-4" />
                        <span>{label}</span>
                        {badgeCount != null && badgeCount > 0 && (
                            <span
                                className="min-w-[18px] h-[18px] text-[10px] font-bold bg-rose-500 text-white rounded-full flex items-center justify-center leading-none"
                                aria-label={`${badgeCount} items need attention`}
                            >
                                {badgeCount > 9 ? '9+' : badgeCount}
                            </span>
                        )}
                        {isActive && (
                            <motion.span
                                layoutId="workspace-tab-indicator"
                                className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"
                                transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 30 }}
                            />
                        )}
                    </button>
                );
            })}
        </div>
    );
}

export default memo(WorkspaceTabBar);
