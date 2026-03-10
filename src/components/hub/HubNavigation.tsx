'use client';

import { memo } from 'react';
import { LayoutGrid, TrendingUp, Sparkles, FolderKanban, Users } from 'lucide-react';
import { FilterView } from '@/constants/hub';
import { User } from '@/types/hub';
import { useUserFollowedProjects } from '@/hooks/hub/useUserInteractions';

interface HubNavigationProps {
    currentUser: User | null;
    activeView: FilterView;
    onSelectView: (view: string) => void;
}

const HubNavigation = memo(function HubNavigation({
    currentUser,
    activeView,
    onSelectView,
}: HubNavigationProps) {
    const { data: myFollowedProjects } = useUserFollowedProjects(currentUser?.id);
    const hasFollowedProjects = myFollowedProjects && myFollowedProjects.size > 0;

    const navItems: Array<{ id: FilterView; label: string; icon: React.ElementType }> = [
        { id: 'all', label: 'All Projects', icon: LayoutGrid },
        { id: 'trending', label: 'Trending', icon: TrendingUp },
        { id: 'recommendations', label: 'For You', icon: Sparkles },
        { id: 'my_projects', label: 'My Projects', icon: FolderKanban },
    ];

    if (hasFollowedProjects) {
        navItems.push({ id: 'following', label: 'Following', icon: Users });
    }

    return (
        <nav className="space-y-6">
            <div className="space-y-1">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeView === item.id;

                    return (
                        <button
                            key={item.id}
                            onClick={() => onSelectView(item.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${isActive
                                    ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400'
                                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100'
                                }`}
                        >
                            <Icon className="w-5 h-5" />
                            {item.label}
                        </button>
                    );
                })}
            </div>
        </nav>
    );
});

export default HubNavigation;
