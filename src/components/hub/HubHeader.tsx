'use client';

import { memo, useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Grid3X3, List, CheckSquare, Filter } from 'lucide-react';
import { FILTER_VIEWS, VIEW_MODES, FilterView, ViewMode } from '@/constants/hub';
import { HubFilters } from '@/types/hub';

interface HubHeaderProps {
    filterView: FilterView;
    selectionMode: boolean;
    onToggleSelectionMode: () => void;
    onApplyFilters: (filters: { status: string; type: string; sort: string; tech: string[]; hideOpened?: boolean }) => void;
    onCreateProject: () => void;
    onPreloadModal: () => void;
    filters: HubFilters;
    viewMode: ViewMode;
    onViewModeChange: (mode: ViewMode) => void;
}

const HubHeader = memo(function HubHeader({
    filterView,
    selectionMode,
    onToggleSelectionMode,
    onApplyFilters,
    onCreateProject,
    onPreloadModal,
    filters,
    viewMode,
    onViewModeChange,
}: HubHeaderProps) {
    const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [isDoneResetting, setIsDoneResetting] = useState(false);
    const filterDropdownRef = useRef<HTMLDivElement>(null);
    const resetTimeoutRef = useRef<number | null>(null);
    const doneTimeoutRef = useRef<number | null>(null);
    const isMountedRef = useRef(true);
    const getTitle = () => {
        switch (filterView) {
            case FILTER_VIEWS.TRENDING:
                return 'Trending Projects';
            case FILTER_VIEWS.RECOMMENDATIONS:
                return 'Recommended For You';
            case FILTER_VIEWS.MY_PROJECTS:
                return 'My Projects';
            case 'following':
                return 'Following';
            default:
                return 'Discover Projects';
        }
    };

    const handleResetOpen = () => {
        if (resetTimeoutRef.current !== null) {
            window.clearTimeout(resetTimeoutRef.current);
            resetTimeoutRef.current = null;
        }
        if (doneTimeoutRef.current !== null) {
            window.clearTimeout(doneTimeoutRef.current);
            doneTimeoutRef.current = null;
        }
        setIsResetting(true);
        setIsDoneResetting(false);
        resetTimeoutRef.current = window.setTimeout(() => {
            resetTimeoutRef.current = null;
            if (!isMountedRef.current) return;
            setIsResetting(false);
            setIsDoneResetting(true);
            onApplyFilters({ status: 'all', type: 'all', sort: 'newest', tech: [], hideOpened: false });
            doneTimeoutRef.current = window.setTimeout(() => {
                doneTimeoutRef.current = null;
                if (!isMountedRef.current) return;
                setIsDoneResetting(false);
                setIsFilterDropdownOpen(false);
            }, 1000);
        }, 800);
    };

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
                setIsFilterDropdownOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            if (resetTimeoutRef.current !== null) {
                window.clearTimeout(resetTimeoutRef.current);
                resetTimeoutRef.current = null;
            }
            if (doneTimeoutRef.current !== null) {
                window.clearTimeout(doneTimeoutRef.current);
                doneTimeoutRef.current = null;
            }
        };
    }, []);

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

                {/* Main Filter Dropdown Toggle */}
                <div className="relative" ref={filterDropdownRef}>
                    <button
                        onClick={() => setIsFilterDropdownOpen((prev) => !prev)}
                        className={`p-2 rounded-lg transition-colors ${isFilterDropdownOpen
                                ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600'
                                : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                        title="Filters"
                    >
                        <Filter className="w-5 h-5" />
                    </button>

                    {/* Filter Dropdown Menu */}
                    <AnimatePresence>
                        {isFilterDropdownOpen && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                                transition={{ duration: 0.15 }}
                                className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 z-50 overflow-hidden"
                            >
                                <div className="p-4 flex flex-col gap-4">
                                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 px-1">
                                        View Settings
                                    </h3>
                                    
                                    <div className="flex items-center justify-between p-3 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                Hide Opened Section
                                            </span>
                                        </div>
                                        <button
                                            role="switch"
                                            aria-checked={filters.hideOpened ?? false}
                                            onClick={() => {
                                                const newValue = !(filters.hideOpened ?? false);
                                                onApplyFilters({ 
                                                    status: filters.status, 
                                                    type: filters.type, 
                                                    sort: filters.sort, 
                                                    tech: filters.tech,
                                                    hideOpened: newValue 
                                                });
                                            }}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900 ${
                                                filters.hideOpened ? 'bg-indigo-600' : 'bg-zinc-200 dark:bg-zinc-700'
                                            }`}
                                        >
                                            <span
                                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                                    filters.hideOpened ? 'translate-x-6' : 'translate-x-1'
                                                }`}
                                            />
                                        </button>
                                    </div>
                                    
                                    <div className="h-px bg-zinc-200 dark:bg-zinc-800" />
                                    
                                    <button
                                        onClick={handleResetOpen}
                                        disabled={isResetting || isDoneResetting}
                                        className={`w-full py-2.5 px-3 rounded-xl text-sm font-medium flex items-center justify-center transition-all ${
                                            isDoneResetting 
                                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
                                            : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-300'
                                        }`}
                                    >
                                        {isResetting ? (
                                            <span className="flex items-center gap-2">
                                                <div className="w-4 h-4 rounded-full border-2 border-zinc-400 border-t-zinc-600 animate-spin" />
                                                Resetting...
                                            </span>
                                        ) : isDoneResetting ? (
                                            <span className="flex items-center gap-2">
                                                ✓ Done
                                            </span>
                                        ) : (
                                            'Reset Open'
                                        )}
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

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
