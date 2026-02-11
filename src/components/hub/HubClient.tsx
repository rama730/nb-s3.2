'use client';

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Search, Sparkles, Filter } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ui-custom/Toast';
import { VirtuosoGrid } from 'react-virtuoso';
import { useHubProjectsQuery } from '@/hooks/hub/useHubProjectsQuery';
import { useHubTrendingQuery } from '@/hooks/hub/useHubTrendingQuery';
import { useUserBookmarks, useUserFollowedProjects } from '@/hooks/hub/useUserInteractions';
import { useDebounce } from '@/hooks/hub/useDebounce';
import { useHubPreferences } from '@/hooks/hub/useHubPreferences';
import { useCollectionProjects } from '@/hooks/hub/useCollectionProjects';
import { useUserProjectIds } from '@/hooks/hub/useUserProjectIds';
import { useAuth } from '@/hooks/useAuth';
import { useHubUrlFilters } from '@/hooks/hub/useHubUrlFilters';
import { useFilterPersistence } from '@/hooks/hub/useFilterPersistence';
import { Project, User } from '@/types/hub';
import {
    FILTER_VIEWS,
    PROJECT_STATUS,
    PROJECT_TYPE,
    SORT_OPTIONS,
    VIEW_MODES,
    FilterView,
    ViewMode,
    SortOption,
    ProjectStatus,
    ProjectType,
} from '@/constants/hub';
import ProjectCard from '@/components/projects/ProjectCard';
import ProjectCardSkeleton from '@/components/projects/ProjectCardSkeleton';
import ProjectQuickView from '@/components/projects/ProjectQuickView';
import CollectionsSidebar from '@/components/hub/CollectionsSidebar';
import NotificationSettingsModal from '@/components/hub/NotificationSettingsModal';
import HubHeader from '@/components/hub/HubHeader';
import BulkActionBar from '@/components/hub/BulkActionBar';
import MobileSidebarDrawer from '@/components/hub/MobileSidebarDrawer';
import { HubErrorBoundary } from '@/components/hub/HubErrorBoundary';

// Dynamic modals
const CreateProjectWizard = dynamic(() => import('@/components/projects/create-wizard/CreateProjectWizard'), { ssr: false });
const ProjectComparisonModal = dynamic(() => import('@/components/hub/ProjectComparisonModal'), { ssr: false });
const AddToCollectionModal = dynamic(() => import('@/components/hub/AddToCollectionModal'), { ssr: false });

import { toProjectCardViewModel, ProjectCardViewModel } from '@/lib/view-models/project-card';

interface HubClientProps {
    initialUser: User | null;
    totalCount?: number;
    initialPage?: number;
    initialLimit?: number;
}

import { useQueryClient } from '@tanstack/react-query';

// ...

const HubClient = memo(function HubClient({ initialUser }: HubClientProps) {
    const supabase = createClient();
    const queryClient = useQueryClient();
    const { showToast } = useToast();
    const { user, isSignedIn } = useAuth();

    // Current user - prefer from auth hook, fallback to initial
    const currentUser = useMemo(() => {
        if (user) {
            return {
                id: user.id,
                email: user.email,
                username: (user.user_metadata?.username as string) || undefined,
                full_name: (user.user_metadata?.full_name as string) || undefined,
                avatar_url: (user.user_metadata?.avatar_url as string) || undefined,
            } as User;
        }
        return initialUser;
    }, [user, initialUser]);

    // URL filters hook
    const { urlFilters, updateUrlFilters, clearFilters: clearUrlFilters, hasActiveFilters } = useHubUrlFilters();

    // State
    const [filterView, setFilterView] = useState<FilterView>(urlFilters.view);
    const [statusFilter, setStatusFilter] = useState<ProjectStatus>(urlFilters.status);
    const [typeFilter, setTypeFilter] = useState<ProjectType>(urlFilters.type);
    const [sortBy, setSortBy] = useState<SortOption>(urlFilters.sort);
    const [viewMode, setViewMode] = useState<ViewMode>(VIEW_MODES.GRID);
    const [selectedTech, setSelectedTech] = useState<string[]>(urlFilters.tech);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
    const [selectedCollectionName, setSelectedCollectionName] = useState<string | null>(null);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showNotificationSettings, setShowNotificationSettings] = useState(false);
    const [showComparisonModal, setShowComparisonModal] = useState(false);
    const [showAddToCollectionModal, setShowAddToCollectionModal] = useState(false);
    const [isSticky, setIsSticky] = useState(false);
    const [showMobileSidebar, setShowMobileSidebar] = useState(false);

    const filterRef = useRef<HTMLDivElement>(null);
    const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);

    const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
        if (node) {
            setScrollContainer(node);
        }
    }, []);

    // Debounce filter changes
    const debouncedStatusFilter = useDebounce(statusFilter, 300);
    const debouncedTypeFilter = useDebounce(typeFilter, 300);
    const debouncedSortBy = useDebounce(sortBy, 300);

    // Hooks - React Query
    const { data: trendingData } = useHubTrendingQuery();
    const trendingScores = trendingData || {};
    const { projectIds: userProjectIds } = useUserProjectIds(currentUser?.id ?? null);
    const { data: myBookmarks } = useUserBookmarks(currentUser?.id);
    const { data: myFollowed } = useUserFollowedProjects(currentUser?.id);
    const { projectIds: collectionProjectIds } = useCollectionProjects(selectedCollectionId);

    // Determine includedIds based on view
    const includedIds = useMemo(() => {
        if (filterView === FILTER_VIEWS.COLLECTION && selectedCollectionId) {
            return Array.from(collectionProjectIds);
        }
        if (filterView === FILTER_VIEWS.MY_PROJECTS && currentUser) {
            return Array.from(userProjectIds);
        }
        if (filterView === FILTER_VIEWS.TRENDING) {
            return Object.entries(trendingScores)
                .sort(([, scoreA], [, scoreB]) => (scoreB as number) - (scoreA as number))
                .map(([id]) => id);
        }
        return undefined;
    }, [filterView, selectedCollectionId, collectionProjectIds, currentUser, userProjectIds, trendingScores]);

    // Build filters object
    const currentFilters = useMemo(
        () => ({
            status: statusFilter,
            type: typeFilter,
            tech: selectedTech,
            sort: sortBy,
            search: urlFilters.q,
            includedIds: includedIds,
        }),
        [statusFilter, typeFilter, selectedTech, sortBy, urlFilters.q, includedIds]
    );

    // Main Data Query
    const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error: projectsError } = useHubProjectsQuery({
        filters: currentFilters,
        view: filterView,
    });

    const allProjects = useMemo(() => {
        return data?.pages?.flatMap((p) => p.projects) || [];
    }, [data]);

    const projectViewModels = useMemo(() => {
        return allProjects.reduce((acc, p) => {
            acc[p.id] = toProjectCardViewModel(p);
            return acc;
        }, {} as Record<string, ProjectCardViewModel>);
    }, [allProjects]);

    // Preferences
    const { preferences } = useHubPreferences(currentUser?.id ?? null, currentFilters, viewMode, sortBy);

    // Filter persistence
    const { persistedState } = useFilterPersistence({ view: filterView, filters: currentFilters, viewMode }, true);

    // Sticky header
    useEffect(() => {
        const handleScroll = () => {
            if (scrollContainer) {
                setIsSticky(scrollContainer.scrollTop > 10);
            }
        };

        if (scrollContainer) {
            scrollContainer.addEventListener('scroll', handleScroll);
            handleScroll();
        }
        return () => scrollContainer?.removeEventListener('scroll', handleScroll);
    }, [scrollContainer]);

    // Preload modals
    const preloadModal = useCallback(() => {
        import('@/components/projects/create-wizard/CreateProjectWizard');
    }, []);

    // Handlers
    const handleClearFilters = useCallback(() => {
        setStatusFilter(PROJECT_STATUS.ALL);
        setTypeFilter(PROJECT_TYPE.ALL);
        setSortBy(SORT_OPTIONS.NEWEST);
        setSelectedTech([]);
        clearUrlFilters();
    }, [clearUrlFilters]);

    const toggleSelection = useCallback((projectId: string) => {
        setSelectedProjectIds((prev) => {
            const next = new Set(prev);
            if (next.has(projectId)) {
                next.delete(projectId);
            } else {
                next.add(projectId);
            }
            return next;
        });
    }, []);

    const handleBulkBookmark = useCallback(async () => {
        if (!currentUser || selectedProjectIds.size === 0) return;
        showToast(`${selectedProjectIds.size} project(s) bookmarked`, 'success');
        setSelectionMode(false);
        setSelectedProjectIds(new Set());
    }, [currentUser, selectedProjectIds, showToast]);

    const selectAll = useCallback(() => {
        setSelectedProjectIds((prev) => {
            if (prev.size === allProjects.length && allProjects.length > 0) {
                return new Set();
            } else {
                return new Set(allProjects.map((p) => p.id));
            }
        });
    }, [allProjects]);

    const isGlobalLoading = isLoading;

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }

            if (e.key === 'Escape') {
                if (selectedProject) {
                    setSelectedProject(null);
                    e.preventDefault();
                }
                if (selectionMode) {
                    setSelectionMode(false);
                    setSelectedProjectIds(new Set());
                    e.preventDefault();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedProject, selectionMode]);

    return (
        <HubErrorBoundary>
            <div className="h-full min-h-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950">
                {projectsError && (
                    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-2 rounded-lg shadow-sm">
                        Error loading projects: {projectsError.message}
                    </div>
                )}

                <div className="max-w-[1600px] mx-auto flex h-full w-full min-h-0">
                    {/* Sidebar */}
                    <div className="hidden lg:block w-64 flex-shrink-0 h-full overflow-y-auto py-8 pl-8 pr-8">
                        <CollectionsSidebar
                            currentUser={currentUser}
                            onSelectCollection={(id, name) => {
                                setSelectedCollectionId(id);
                                setSelectedCollectionName(name || null);
                                setFilterView(FILTER_VIEWS.COLLECTION);
                                setShowMobileSidebar(false);
                            }}
                            selectedCollectionId={selectedCollectionId}
                            activeView={filterView}
                            onSelectView={(view) => {
                                setFilterView(view as FilterView);
                                setSelectedCollectionId(null);
                                setSelectedCollectionName(null);
                                setShowMobileSidebar(false);
                            }}
                        />
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 min-w-0 h-full overflow-y-auto" ref={scrollContainerRef} id="hub-scroll-container">
                        <div className="px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">
                            {/* Header */}
                            <div className={`sticky top-0 z-30 transition-all duration-300 ease-in-out ${isSticky ? '-mt-2 pt-2 pb-2' : ''}`} ref={filterRef}>
                                <div className={`bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 transition-shadow duration-300 ${isSticky ? 'shadow-md' : 'shadow-sm'}`}>
                                    <HubHeader
                                        filterView={filterView}
                                        selectedCollectionName={selectedCollectionName}
                                        selectionMode={selectionMode}
                                        onToggleSelectionMode={() => {
                                            setSelectionMode(!selectionMode);
                                            if (selectionMode) setSelectedProjectIds(new Set());
                                        }}
                                        onApplyFilters={(newFilters) => {
                                            setStatusFilter(newFilters.status as ProjectStatus);
                                            setTypeFilter(newFilters.type as ProjectType);
                                            setSortBy(newFilters.sort as SortOption);
                                            setSelectedTech(newFilters.tech);
                                        }}
                                        onCreateProject={() => setShowCreateModal(true)}
                                        onPreloadModal={preloadModal}
                                        filters={currentFilters}
                                        viewMode={viewMode}
                                        onViewModeChange={setViewMode}
                                    />
                                </div>
                            </div>

                            {/* Bulk Action Bar */}
                            <BulkActionBar
                                selectedCount={selectedProjectIds.size}
                                totalCount={allProjects.length}
                                onSelectAll={selectAll}
                                onAddToCollection={() => setShowAddToCollectionModal(true)}
                                onBookmark={handleBulkBookmark}
                                onCompare={() => setShowComparisonModal(true)}
                                onCancel={() => {
                                    setSelectionMode(false);
                                    setSelectedProjectIds(new Set());
                                }}
                                onShare={() => {
                                    const projectIds = Array.from(selectedProjectIds);
                                    const shareUrl = `${window.location.origin}/hub?projects=${projectIds.join(',')}`;
                                    navigator.clipboard.writeText(shareUrl);
                                    showToast('Share link copied to clipboard', 'success');
                                }}
                                onExport={() => {
                                    const projectIds = Array.from(selectedProjectIds);
                                    const exportData = { projects: projectIds, exportedAt: new Date().toISOString(), count: projectIds.length };
                                    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `projects-export-${new Date().toISOString().split('T')[0]}.json`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                    showToast(`Exported ${projectIds.length} projects`, 'success');
                                }}
                                canCompare={selectedProjectIds.size >= 2 && selectedProjectIds.size <= 4}
                            />

                            {/* Projects Grid */}
                            {isGlobalLoading && allProjects.length === 0 ? (
                                <div className={`grid gap-6 ${viewMode === VIEW_MODES.GRID ? 'md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
                                    {[1, 2, 3, 4, 5, 6].map((i) => (
                                        <ProjectCardSkeleton key={i} />
                                    ))}
                                </div>
                            ) : allProjects.length === 0 ? (
                                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-24 bg-white dark:bg-zinc-900 rounded-3xl border border-dashed border-slate-300 dark:border-zinc-800">
                                    <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-slate-50 dark:bg-zinc-800 flex items-center justify-center">
                                        <Search className="w-10 h-10 text-slate-300 dark:text-zinc-600" />
                                    </div>
                                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">No Projects Found</h3>
                                    <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-md mx-auto">
                                        We couldn&apos;t find any projects matching your filters. Try adjusting your search or create a new project.
                                    </p>
                                    <div className="flex items-center justify-center gap-3">
                                        {hasActiveFilters && (
                                            <button onClick={handleClearFilters} className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg font-medium transition-all">
                                                Clear Filters
                                            </button>
                                        )}
                                        <button onClick={() => setShowCreateModal(true)} className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition-all">
                                            <Sparkles className="w-5 h-5" />
                                            Start New Project
                                        </button>
                                    </div>
                                </motion.div>
                            ) : (
                                <div className="flex-1 w-full min-h-[600px]">
                                    {scrollContainer && (
                                        <VirtuosoGrid
                                            customScrollParent={scrollContainer}
                                            style={{ width: '100%' }}
                                            totalCount={allProjects.length}
                                            data={allProjects}
                                            endReached={() => {
                                                if (hasNextPage && !isFetchingNextPage) {
                                                    fetchNextPage();
                                                }
                                            }}
                                            components={{
                                                List: ({ children, ...props }) => (
                                                    <div {...props} className={`grid gap-6 ${viewMode === VIEW_MODES.GRID ? 'md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'} pb-24`}>
                                                        {children}
                                                    </div>
                                                ),
                                                Footer: () => (isFetchingNextPage ? <div className="col-span-full py-8 text-center text-zinc-500">Loading more...</div> : null),
                                            }}
                                            itemContent={(_, project) => (
                                                <ProjectCard
                                                    key={project.id}
                                                    project={project}
                                                    viewModel={projectViewModels[project.id]}
                                                    viewMode={viewMode}
                                                    selectionMode={selectionMode}
                                                    isSelected={selectedProjectIds.has(project.id)}
                                                    onToggleSelection={() => toggleSelection(project.id)}
                                                    onQuickView={setSelectedProject}
                                                    isBookmarked={myBookmarks?.has(project.id)}
                                                    isFollowing={myFollowed?.has(project.id)}
                                                    followersCount={project.followersCount ?? 0}
                                                />
                                            )}
                                        />
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Modals */}
                        <ProjectQuickView
                            project={selectedProject}
                            isOpen={!!selectedProject}
                            onClose={() => setSelectedProject(null)}
                            onNext={() => {
                                const idx = allProjects.findIndex((p) => p.id === selectedProject?.id);
                                if (idx >= 0 && idx < allProjects.length - 1) {
                                    setSelectedProject(allProjects[idx + 1]);
                                }
                            }}
                            onPrevious={() => {
                                const idx = allProjects.findIndex((p) => p.id === selectedProject?.id);
                                if (idx > 0) {
                                    setSelectedProject(allProjects[idx - 1]);
                                }
                            }}
                            hasNext={allProjects.findIndex((p) => p.id === selectedProject?.id) < allProjects.length - 1}
                            hasPrevious={allProjects.findIndex((p) => p.id === selectedProject?.id) > 0}
                        />

                        {showCreateModal && (
                            <CreateProjectWizard
                                onClose={() => setShowCreateModal(false)}
                                onSuccess={() => {
                                    setShowCreateModal(false);
                                    queryClient.invalidateQueries({ queryKey: ['hub-projects'] });
                                    queryClient.invalidateQueries({ queryKey: ['hub-trending'] });
                                    showToast('Project created successfully!', 'success');
                                }}
                            />
                        )}

                        <NotificationSettingsModal isOpen={showNotificationSettings} onClose={() => setShowNotificationSettings(false)} />

                        {showComparisonModal && selectedProjectIds.size >= 2 && (
                            <ProjectComparisonModal projects={allProjects.filter((p) => selectedProjectIds.has(p.id)).slice(0, 4)} onClose={() => setShowComparisonModal(false)} />
                        )}

                        {showAddToCollectionModal && <AddToCollectionModal projectIds={Array.from(selectedProjectIds)} onClose={() => setShowAddToCollectionModal(false)} currentUser={currentUser} />}
                    </div>
                </div>

                {/* Mobile Sidebar Toggle */}
                <button
                    onClick={() => setShowMobileSidebar(true)}
                    className="lg:hidden fixed bottom-6 right-6 z-30 p-4 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-colors"
                    aria-label="Open filters and collections"
                >
                    <Filter className="w-5 h-5" />
                </button>

                <MobileSidebarDrawer isOpen={showMobileSidebar} onClose={() => setShowMobileSidebar(false)}>
                    <CollectionsSidebar
                        currentUser={currentUser}
                        onSelectCollection={(id, name) => {
                            setSelectedCollectionId(id);
                            setSelectedCollectionName(name || null);
                            setFilterView(FILTER_VIEWS.COLLECTION);
                            setShowMobileSidebar(false);
                        }}
                        selectedCollectionId={selectedCollectionId}
                        activeView={filterView}
                        onSelectView={(view) => {
                            setFilterView(view as FilterView);
                            setSelectedCollectionId(null);
                            setSelectedCollectionName(null);
                            setShowMobileSidebar(false);
                        }}
                    />
                </MobileSidebarDrawer>
            </div>
        </HubErrorBoundary>
    );
});

export default HubClient;
