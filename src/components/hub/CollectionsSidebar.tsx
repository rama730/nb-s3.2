'use client';

import { memo } from 'react';
import { LayoutGrid, TrendingUp, Sparkles, FolderKanban, Plus } from 'lucide-react';
import { FILTER_VIEWS, FilterView } from '@/constants/hub';
import { User } from '@/types/hub';

interface CollectionsSidebarProps {
    currentUser: User | null;
    onSelectCollection: (id: string, name?: string) => void;
    selectedCollectionId: string | null;
    activeView: FilterView;
    onSelectView: (view: string) => void;
}

const navItems = [
    { id: FILTER_VIEWS.ALL, label: 'All Projects', icon: LayoutGrid },
    { id: FILTER_VIEWS.TRENDING, label: 'Trending', icon: TrendingUp },
    { id: FILTER_VIEWS.RECOMMENDATIONS, label: 'For You', icon: Sparkles },
    { id: FILTER_VIEWS.MY_PROJECTS, label: 'My Projects', icon: FolderKanban },
];

const CollectionsSidebar = memo(function CollectionsSidebar({
    currentUser,
    onSelectCollection,
    selectedCollectionId,
    activeView,
    onSelectView,
}: CollectionsSidebarProps) {
    return (
        <nav className="space-y-6">
            {/* Main Navigation */}
            <div className="space-y-1">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeView === item.id && !selectedCollectionId;

                    return (
                        <button
                            key={item.id}
                            onClick={() => onSelectView(item.id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${isActive
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

            {/* Collections Section */}
            {currentUser && (
                <div>
                    <div className="flex items-center justify-between px-3 mb-2">
                        <h3 className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                            Collections
                        </h3>
                        <button
                            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded"
                            title="Create collection"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="space-y-1">
                        <p className="px-3 py-2 text-sm text-zinc-400 dark:text-zinc-500 italic">
                            No collections yet
                        </p>
                    </div>
                </div>
            )}
        </nav>
    );
});

export default CollectionsSidebar;
