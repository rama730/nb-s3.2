'use client';

import { memo, useState, useEffect } from 'react';
import { LayoutGrid, TrendingUp, Sparkles, FolderKanban, Plus, X, Loader2, FolderOpen } from 'lucide-react';
import { useToast } from '@/components/ui-custom/Toast';
import { FILTER_VIEWS, FilterView } from '@/constants/hub';
import { User } from '@/types/hub';
import { getUserCollectionsAction, createCollectionAction } from '@/app/actions/collection';

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
    const { showToast } = useToast();
    const [collections, setCollections] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [newCollectionName, setNewCollectionName] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const loadCollections = async () => {
        setIsLoading(true);
        const res = await getUserCollectionsAction();
        if (res.success && res.collections) {
            setCollections(res.collections);
        }
        setIsLoading(false);
    };

    useEffect(() => {
        if (currentUser) {
            loadCollections();
        }
    }, [currentUser]);

    const handleCreateCollection = async () => {
        if (!newCollectionName.trim()) return;
        setIsSaving(true);
        const res = await createCollectionAction(newCollectionName.trim());
        setIsSaving(false);
        if (res.success) {
            setNewCollectionName('');
            setIsCreating(false);
            loadCollections();
            showToast('Your new collection was created.', 'success');
        } else {
            showToast(res.error || 'Failed to create collection', 'error');
        }
    };
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
                            onClick={() => setIsCreating(true)}
                            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded"
                            title="Create collection"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>

                    {isCreating && (
                        <div className="flex items-center gap-2 mb-2 px-3">
                            <input
                                type="text"
                                placeholder="Name..."
                                value={newCollectionName}
                                onChange={(e) => setNewCollectionName(e.target.value)}
                                className="flex-1 min-w-0 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md px-2 py-1 text-xs outline-none focus:border-indigo-500"
                                autoFocus
                            />
                            <button
                                onClick={handleCreateCollection}
                                disabled={isSaving || !newCollectionName.trim()}
                                className="p-1 text-indigo-600 dark:text-indigo-400 disabled:opacity-50"
                            >
                                {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                            </button>
                            <button
                                onClick={() => { setIsCreating(false); setNewCollectionName(''); }}
                                className="p-1 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    )}

                    <div className="space-y-1">
                        {isLoading ? (
                            <div className="flex justify-center py-4">
                                <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                            </div>
                        ) : collections.length === 0 ? (
                            <p className="px-3 py-2 text-sm text-zinc-400 dark:text-zinc-500 italic">
                                No collections yet
                            </p>
                        ) : (
                            collections.map((col) => {
                                const isActive = selectedCollectionId === col.id;
                                return (
                                    <button
                                        key={col.id}
                                        onClick={() => onSelectCollection(col.id, col.name)}
                                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-all ${isActive
                                            ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400'
                                            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3 truncate">
                                            <FolderOpen className="w-4 h-4 flex-shrink-0" />
                                            <span className="truncate">{col.name}</span>
                                        </div>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}`}>
                                            {col.projects?.length || 0}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </nav>
    );
});

export default CollectionsSidebar;
