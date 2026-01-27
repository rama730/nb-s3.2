'use client';

import { memo } from 'react';
import { Plus, Filter, Grid3X3, List, CheckSquare } from 'lucide-react';
import { FILTER_VIEWS, VIEW_MODES, FilterView, ViewMode } from '@/constants/hub';
import { HubFilters } from '@/types/hub';

interface HubHeaderProps {
    filterView: FilterView;
    selectedCollectionName: string | null;
    selectionMode: boolean;
    onToggleSelectionMode: () => void;
    onApplyFilters: (filters: { status: string; type: string; sort: string; tech: string[] }) => void;
    onCreateProject: () => void;
    onPreloadModal: () => void;
    filters: HubFilters;
    viewMode: ViewMode;
    onViewModeChange: (mode: ViewMode) => void;
}

const HubHeader = memo(function HubHeader({
    filterView,
    selectedCollectionName,
    selectionMode,
    onToggleSelectionMode,
    onCreateProject,
    onPreloadModal,
    viewMode,
    onViewModeChange,
}: HubHeaderProps) {
    const getTitle = () => {
        switch (filterView) {
            case FILTER_VIEWS.TRENDING:
                return 'Trending Projects';
            case FILTER_VIEWS.RECOMMENDATIONS:
                return 'Recommended For You';
            case FILTER_VIEWS.MY_PROJECTS:
                return 'My Projects';
            case FILTER_VIEWS.COLLECTION:
                return selectedCollectionName || 'Collection';
            default:
                return 'Discover Projects';
        }
    };

    return (
        <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                    {getTitle()}
                </h1>
            </div>

            <div className="flex items-center gap-2">
                {/* View Mode Toggle */}
                <div className="flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
                    <button
                        onClick={() => onViewModeChange(VIEW_MODES.GRID)}
                        className={`p-2 rounded-md transition-colors ${viewMode === VIEW_MODES.GRID
                                ? 'bg-white dark:bg-zinc-700 shadow-sm text-indigo-600'
                                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                    >
                        <Grid3X3 className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => onViewModeChange(VIEW_MODES.LIST)}
                        className={`p-2 rounded-md transition-colors ${viewMode === VIEW_MODES.LIST
                                ? 'bg-white dark:bg-zinc-700 shadow-sm text-indigo-600'
                                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                    >
                        <List className="w-4 h-4" />
                    </button>
                </div>

                {/* Selection Mode Toggle */}
                <button
                    onClick={onToggleSelectionMode}
                    className={`p-2 rounded-lg transition-colors ${selectionMode
                            ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600'
                            : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                        }`}
                    title="Selection mode"
                >
                    <CheckSquare className="w-5 h-5" />
                </button>

                {/* Create Project Button */}
                <button
                    onClick={onCreateProject}
                    onMouseEnter={onPreloadModal}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">New Project</span>
                </button>
            </div>
        </div>
    );
});

export default HubHeader;
