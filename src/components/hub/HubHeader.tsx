'use client';

import { memo, useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Filter } from 'lucide-react';
import { FILTER_VIEWS, FilterView, ViewMode } from '@/constants/hub';
import { HubFilters } from '@/types/hub';
import { useReducedMotionPreference } from '@/components/providers/theme-provider';

interface HubHeaderProps {
    filterView: FilterView;
    onApplyFilters: (filters: { status: string; type: string; sort: string; tech: string[]; hideOpened?: boolean }) => void;
    onCreateProject: () => void;
    onPreloadModal: () => void;
    filters: HubFilters;
    viewMode: ViewMode;
    onViewModeChange: (mode: ViewMode) => void;
}

const HubHeader = memo(function HubHeader({
    filterView,
    onApplyFilters,
    onCreateProject,
    onPreloadModal,
    filters,
}: HubHeaderProps) {
    const reduceMotion = useReducedMotionPreference();
    const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
    const filterDropdownRef = useRef<HTMLDivElement>(null);
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
        onApplyFilters({ status: 'all', type: 'all', sort: 'newest', tech: [], hideOpened: false });
        setIsFilterDropdownOpen(false);
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

    return (
        <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                    {getTitle()}
                </h1>
            </div>

            <div className="flex items-center gap-2">
                {/* Main Filter Dropdown Toggle */}
                <div className="relative" ref={filterDropdownRef}>
                    <button
                        type="button"
                        onClick={() => setIsFilterDropdownOpen((prev) => !prev)}
                        aria-label={isFilterDropdownOpen ? "Close filters" : "Open filters"}
                        aria-expanded={isFilterDropdownOpen}
                        aria-haspopup="menu"
                        className={`p-2 rounded-lg transition-colors ${isFilterDropdownOpen
                                ? 'app-selected-surface'
                                : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                            }`}
                        title="Filters"
                    >
                        <Filter className="w-5 h-5" />
                    </button>

                    {/* Filter Dropdown Menu */}
                    <AnimatePresence initial={!reduceMotion}>
                        {isFilterDropdownOpen && (
                            <motion.div
                                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: -10 }}
                                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: -10 }}
                                transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
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
                                            type="button"
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
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none    dark: ${
                                                filters.hideOpened ? 'bg-primary' : 'bg-zinc-200 dark:bg-zinc-700'
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
                                        type="button"
                                        onClick={handleResetOpen}
                                        className="w-full py-2.5 px-3 rounded-xl text-sm font-medium flex items-center justify-center transition-all bg-zinc-100 hover:bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-300"
                                    >
                                        Reset view
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Create Project Button */}
                <button
                    type="button"
                    onClick={onCreateProject}
                    onMouseEnter={onPreloadModal}
                    className="flex items-center gap-2 px-4 py-2 app-accent-solid hover:bg-primary/90 rounded-xl font-medium transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">New Project</span>
                </button>
            </div>
        </div>
    );
});

export default HubHeader;
