'use client';

import { useState, useMemo, memo, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Search, Sparkles, Filter } from 'lucide-react';
import { useToast } from '@/components/ui-custom/Toast';
import { VirtuosoGrid } from 'react-virtuoso';
import { useQueryClient } from '@tanstack/react-query';

// Hooks
import { useSearchParams } from 'next/navigation';
import { useHubProjectsSimple } from '@/hooks/hub/useHubProjectsSimple';
import { useAuth } from '@/hooks/useAuth';

// Components
import ProjectCard from '@/components/projects/ProjectCard';
import ProjectCardSkeleton from '@/components/projects/ProjectCardSkeleton';
import ProjectQuickView from '@/components/projects/ProjectQuickView';
import CollectionsSidebar from '@/components/hub/CollectionsSidebar';
import HubHeader from '@/components/hub/HubHeader';
import BulkActionBar from '@/components/hub/BulkActionBar';
import MobileSidebarDrawer from '@/components/hub/MobileSidebarDrawer';
import { HubErrorBoundary } from '@/components/hub/HubErrorBoundary';

// Constants & Types
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
import { User, Project } from '@/types/hub';

// Dynamic Modals
const CreateProjectWizard = dynamic(() => import('@/components/projects/create-wizard/CreateProjectWizard'), { ssr: false });
const ProjectComparisonModal = dynamic(() => import('@/components/hub/ProjectComparisonModal'), { ssr: false });
const AddToCollectionModal = dynamic(() => import('@/components/hub/AddToCollectionModal'), { ssr: false });
const NotificationSettingsModal = dynamic(() => import('@/components/hub/NotificationSettingsModal'), { ssr: false });

interface SimpleHubClientProps {
    returnUserData: any; // Passed from server to avoid double fetch if possible, or we rely on useAuth
    initialProjectsPage?: any;
}

const SimpleHubClient = memo(function SimpleHubClient({ returnUserData, initialProjectsPage }: SimpleHubClientProps) {
    const queryClient = useQueryClient();
    const { showToast } = useToast();
    const { user } = useAuth();

    // --- State ---
    // Essential UI State
    const [viewMode, setViewMode] = useState<ViewMode>(VIEW_MODES.GRID);
    const [isSticky, setIsSticky] = useState(false);
    const [showMobileSidebar, setShowMobileSidebar] = useState(false);

    // Filter State
    // Filter State
    const [filterView, setFilterView] = useState<FilterView>(FILTER_VIEWS.ALL);
    const [statusFilter, setStatusFilter] = useState<ProjectStatus>(PROJECT_STATUS.ALL);
    const [typeFilter, setTypeFilter] = useState<ProjectType>(PROJECT_TYPE.ALL);
    const [sortBy, setSortBy] = useState<SortOption>(SORT_OPTIONS.NEWEST);
    const [selectedTech, setSelectedTech] = useState<string[]>([]);

    // Selection & Modal State
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
    const [selectedCollectionName, setSelectedCollectionName] = useState<string | null>(null);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());

    // Dialog Visibility
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showNotificationSettings, setShowNotificationSettings] = useState(false);
    const [showComparisonModal, setShowComparisonModal] = useState(false);
    const [showAddToCollectionModal, setShowAddToCollectionModal] = useState(false);

    // --- Derived Data ---
    const searchParams = useSearchParams();
    const search = searchParams?.get('q') || undefined;

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
        return returnUserData;
    }, [user, returnUserData]);

    // Construct Filters
    const currentFilters = useMemo(() => ({
        status: statusFilter,
        type: typeFilter,
        tech: selectedTech,
        sort: sortBy,
        search, // Connected Global Search
        // Simple logic: if 'My Projects', include user's ID
        includedIds: undefined, 
        // Note: Real "My Projects" logic should ideally filter by ownerId in the query, 
        // but for now we stick to the main feed. If strict "My Projects" needed, we pass ownerId.
    }), [statusFilter, typeFilter, selectedTech, sortBy, search]);

    // --- Data Fetching ---
    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        error: projectsError,
        refetch
    } = useHubProjectsSimple(currentFilters, initialProjectsPage);

    const allProjects = useMemo(() => {
        return data?.pages?.flatMap((p) => p.projects) || [];
    }, [data]);

    // --- Handlers ---

    // Scroll Handling
    const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
    const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
        if (node) setScrollContainer(node);
    }, []);

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

    // Creating Project
    const handleProjectCreated = useCallback(() => {
        setShowCreateModal(false);
        // FORCE REFRESH
        queryClient.invalidateQueries({ queryKey: ['hub-projects-simple'] });
        refetch();
        showToast('Project created successfully!', 'success');
    }, [queryClient, refetch, showToast]);

    // Clear Filters
    const handleClearFilters = useCallback(() => {
        setStatusFilter(PROJECT_STATUS.ALL);
        setTypeFilter(PROJECT_TYPE.ALL);
        setSortBy(SORT_OPTIONS.NEWEST);
        setSelectedTech([]);
    }, []);

    // Selection
    const toggleSelection = useCallback((projectId: string) => {
        setSelectedProjectIds((prev) => {
            const next = new Set(prev);
            if (next.has(projectId)) next.delete(projectId);
            else next.add(projectId);
            return next;
        });
    }, []);

    const selectAll = useCallback(() => {
        if (selectedProjectIds.size === allProjects.length && allProjects.length > 0) {
            setSelectedProjectIds(new Set());
        } else {
            setSelectedProjectIds(new Set(allProjects.map(p => p.id)));
        }
    }, [allProjects, selectedProjectIds]);

    const handleBulkBookmark = useCallback(() => {
        showToast(`${selectedProjectIds.size} project(s) bookmarked`, 'success');
        setSelectionMode(false);
        setSelectedProjectIds(new Set());
    }, [selectedProjectIds, showToast]);

    // Sidebar Navigation
    const handleSelectCollection = (id: string, name?: string) => {
        setSelectedCollectionId(id);
        setSelectedCollectionName(name || null);
        setFilterView(FILTER_VIEWS.COLLECTION);
        setShowMobileSidebar(false);
        // Note: For "Collection" view, we would typically filter by IDs.
        // For simplicity in this rebuild, we acknowledge the view switch 
        // but maybe keeping the main feed or TODO: implement collection filtering in simplified hook.
    };

    const handleSelectView = (view: string) => {
        setFilterView(view as FilterView);
        setSelectedCollectionId(null);
        setSelectedCollectionName(null);
        setShowMobileSidebar(false);
    };

    // --- Render ---

    return (
        <HubErrorBoundary>
            <div className="h-full overflow-hidden bg-zinc-50 dark:bg-zinc-950">
                {projectsError && (
                    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 px-4 py-2 rounded-lg shadow-sm">
                        Error loading projects: {projectsError.message}
                    </div>
                )}

                <div className="max-w-[1600px] mx-auto flex h-full w-full">
                    {/* Sidebar */}
                    <div className="hidden lg:block w-64 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-800 h-full overflow-y-auto py-8 pl-8 pr-8">
                        <CollectionsSidebar
                            currentUser={currentUser}
                            onSelectCollection={handleSelectCollection}
                            selectedCollectionId={selectedCollectionId}
                            activeView={filterView}
                            onSelectView={handleSelectView}
                        />
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 min-w-0 h-full overflow-y-auto" ref={scrollContainerRef}>
                        <div className="px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">

                            {/* Sticky Header */}
                            <div className={`sticky top-0 z-30 transition-all duration-300 ease-in-out ${isSticky ? '-mt-2 pt-2 pb-2' : ''}`}>
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
                                        onPreloadModal={() => import('@/components/projects/create-wizard/CreateProjectWizard')}
                                        filters={currentFilters}
                                        viewMode={viewMode}
                                        onViewModeChange={setViewMode}
                                    />
                                </div>
                            </div>

                            {/* Bulk Actions */}
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
                                    const ids = Array.from(selectedProjectIds).join(',');
                                    const shareUrl = `${window.location.origin}/hub?projects=${ids}`;
                                    navigator.clipboard.writeText(shareUrl);
                                    showToast('Share link copied', 'success');
                                }}
                                onExport={() => {
                                    showToast('Export functionality placeholder', 'success');
                                }}
                                canCompare={selectedProjectIds.size >= 2 && selectedProjectIds.size <= 4}
                            />

                            {/* Projects Grid */}
                            {isLoading && allProjects.length === 0 ? (
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
                                        Adjust your filters or create a new project.
                                    </p>
                                    <div className="flex items-center justify-center gap-3">
                                        <button onClick={handleClearFilters} className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg font-medium transition-all">
                                            Clear Filters
                                        </button>
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
                                                    viewMode={viewMode}
                                                    selectionMode={selectionMode}
                                                    isSelected={selectedProjectIds.has(project.id)}
                                                    onToggleSelection={() => toggleSelection(project.id)}
                                                    onQuickView={setSelectedProject}
                                                    // Note: We removed the complex interaction hooks for simplicity.
                                                    // Pass explicit props if "real" bookmark state is needed initially
                                                    isBookmarked={false}
                                                    isFollowing={false}
                                                    followersCount={0}
                                                />
                                            )}
                                        />
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Modals & Drawers */}
                        <ProjectQuickView
                            project={selectedProject}
                            isOpen={!!selectedProject}
                            onClose={() => setSelectedProject(null)}
                            onNext={() => {
                                const idx = allProjects.findIndex(p => p.id === selectedProject?.id);
                                if (idx >= 0 && idx < allProjects.length - 1) setSelectedProject(allProjects[idx + 1]);
                            }}
                            onPrevious={() => {
                                const idx = allProjects.findIndex(p => p.id === selectedProject?.id);
                                if (idx > 0) setSelectedProject(allProjects[idx - 1]);
                            }}
                            hasNext={allProjects.findIndex(p => p.id === selectedProject?.id) < allProjects.length - 1}
                            hasPrevious={allProjects.findIndex(p => p.id === selectedProject?.id) > 0}
                        />

                        {showCreateModal && (
                            <CreateProjectWizard
                                onClose={() => setShowCreateModal(false)}
                                onSuccess={handleProjectCreated}
                            />
                        )}

                        <NotificationSettingsModal isOpen={showNotificationSettings} onClose={() => setShowNotificationSettings(false)} />

                        {showComparisonModal && selectedProjectIds.size >= 2 && (
                            <ProjectComparisonModal projects={allProjects.filter(p => selectedProjectIds.has(p.id))} onClose={() => setShowComparisonModal(false)} />
                        )}

                        {showAddToCollectionModal && (
                            <AddToCollectionModal projectIds={Array.from(selectedProjectIds)} onClose={() => setShowAddToCollectionModal(false)} currentUser={currentUser} />
                        )}
                    </div>
                </div>

                {/* Mobile FAB */}
                <button
                    onClick={() => setShowMobileSidebar(true)}
                    className="lg:hidden fixed bottom-6 right-6 z-30 p-4 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-colors"
                    aria-label="Open filters"
                >
                    <Filter className="w-5 h-5" />
                </button>

                <MobileSidebarDrawer isOpen={showMobileSidebar} onClose={() => setShowMobileSidebar(false)}>
                    <CollectionsSidebar
                        currentUser={currentUser}
                        onSelectCollection={handleSelectCollection}
                        selectedCollectionId={selectedCollectionId}
                        activeView={filterView}
                        onSelectView={handleSelectView}
                    />
                </MobileSidebarDrawer>
            </div>
        </HubErrorBoundary>
    );
});

export default SimpleHubClient;
