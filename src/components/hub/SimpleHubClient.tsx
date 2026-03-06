'use client';

import { useState, useMemo, memo, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Search, Sparkles, Filter, CheckSquare, X } from 'lucide-react';
import { useToast } from '@/components/ui-custom/Toast';
import { VirtuosoGrid } from 'react-virtuoso';
import { useQueryClient } from '@tanstack/react-query';

// Hooks
import { useSearchParams } from 'next/navigation';
import { useHubProjectsSimple } from '@/hooks/hub/useHubProjectsSimple';
import { useAuth } from '@/hooks/useAuth';
import { useHubSessionSeen } from '@/hooks/hub/useHubSessionSeen';
import { useUserBookmarks, useUserFollowedProjects } from '@/hooks/hub/useUserInteractions';

// Components
import ProjectCard from '@/components/projects/ProjectCard';
import ProjectCardSkeleton from '@/components/projects/ProjectCardSkeleton';
import CollectionsSidebar from '@/components/hub/CollectionsSidebar';
import HubHeader from '@/components/hub/HubHeader';
import { HubErrorBoundary } from '@/components/hub/HubErrorBoundary';
import { getCollectionProjectsAction } from '@/app/actions/collection';

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
const ProjectQuickView = dynamic(() => import('@/components/projects/ProjectQuickView'), { ssr: false });
const BulkActionBar = dynamic(() => import('@/components/hub/BulkActionBar'), { ssr: false });
const ProjectComparisonModal = dynamic(() => import('@/components/hub/ProjectComparisonModal'), { ssr: false });
const AddToCollectionModal = dynamic(() => import('@/components/hub/AddToCollectionModal'), { ssr: false });
const NotificationSettingsModal = dynamic(() => import('@/components/hub/NotificationSettingsModal'), { ssr: false });
// Optimization: Defer mobile sidebar code until interaction
const MobileSidebarDrawer = dynamic(() => import('@/components/hub/MobileSidebarDrawer'), { ssr: false });

import { toProjectCardViewModel, ProjectCardViewModel } from '@/lib/view-models/project-card';

interface SimpleHubClientProps {
    returnUserData: User | null;
    initialProjectsPage?: {
        projects?: Project[];
        nextCursor?: string;
        hasMore?: boolean;
    } | null;
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
    const [collectionProjectIds, setCollectionProjectIds] = useState<string[]>([]);
    const [profileChecklistItems, setProfileChecklistItems] = useState<string[]>([]);
    const [showProfileChecklist, setShowProfileChecklist] = useState(false);

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

    const { data: myBookmarks } = useUserBookmarks(currentUser?.id);
    const { data: myFollowedProjects } = useUserFollowedProjects(currentUser?.id);
    const { seenIds, hideSeen, setHideSeen, markSeen, clearSeen } = useHubSessionSeen();

    useEffect(() => {
        if (filterView === FILTER_VIEWS.COLLECTION && selectedCollectionId) {
            getCollectionProjectsAction(selectedCollectionId).then((res) => {
                if (res.success && res.projectIds) {
                    setCollectionProjectIds(res.projectIds);
                }
            });
        }
    }, [filterView, selectedCollectionId]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const raw = window.localStorage.getItem('onboarding:profile-strength:v1');
            if (!raw) return;
            const parsed = JSON.parse(raw) as { createdAt?: number; items?: string[] };
            if (!Array.isArray(parsed.items) || parsed.items.length === 0) return;
            setProfileChecklistItems(parsed.items.slice(0, 5));
            setShowProfileChecklist(true);
        } catch {
            // ignore invalid local data
        }
    }, []);

    // Construct Filters
    const currentFilters = useMemo(() => {
        const effectiveSort =
            filterView === FILTER_VIEWS.TRENDING
                ? SORT_OPTIONS.TRENDING
                : sortBy;

        return {
            status: statusFilter,
            type: typeFilter,
            tech: selectedTech,
            sort: effectiveSort,
            search, // Connected Global Search
            includedIds: filterView === FILTER_VIEWS.COLLECTION && selectedCollectionId ? collectionProjectIds : undefined,
        };
    }, [filterView, statusFilter, typeFilter, selectedTech, sortBy, search, selectedCollectionId, collectionProjectIds]);

    // --- Data Fetching ---
    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        error: projectsError,
        refetch
    } = useHubProjectsSimple(currentFilters, filterView, initialProjectsPage);

    const allProjects = useMemo(() => {
        return data?.pages?.flatMap((p) => p.projects) || [];
    }, [data]);

    const visibleProjects = useMemo(() => {
        if (!hideSeen) return allProjects;
        return allProjects.filter((project) => !seenIds.has(project.id));
    }, [allProjects, hideSeen, seenIds]);

    useEffect(() => {
        if (!hideSeen) return;
        if (visibleProjects.length > 0) return;
        if (!hasNextPage || isFetchingNextPage) return;
        if (allProjects.length === 0) return;
        fetchNextPage();
    }, [hideSeen, visibleProjects.length, hasNextPage, isFetchingNextPage, allProjects.length, fetchNextPage]);

    const projectViewModels = useMemo(() => {
        return visibleProjects.reduce((acc, p) => {
            acc[p.id] = toProjectCardViewModel(p);
            return acc;
        }, {} as Record<string, ProjectCardViewModel>);
    }, [visibleProjects]);

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
        if (selectedProjectIds.size === visibleProjects.length && visibleProjects.length > 0) {
            setSelectedProjectIds(new Set());
        } else {
            setSelectedProjectIds(new Set(visibleProjects.map(p => p.id)));
        }
    }, [visibleProjects, selectedProjectIds]);

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
                            onSelectCollection={handleSelectCollection}
                            selectedCollectionId={selectedCollectionId}
                            activeView={filterView}
                            onSelectView={handleSelectView}
                        />
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 min-w-0 h-full overflow-y-auto" ref={scrollContainerRef} id="hub-scroll-container">
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

                            {showProfileChecklist && profileChecklistItems.length > 0 && (
                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30 p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="space-y-2">
                                            <p className="text-sm font-semibold flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                                                <CheckSquare className="w-4 h-4" />
                                                Profile strength checklist
                                            </p>
                                            <ul className="text-sm text-emerald-900/90 dark:text-emerald-200/90 space-y-1">
                                                {profileChecklistItems.map((item) => (
                                                    <li key={item}>- {item}</li>
                                                ))}
                                            </ul>
                                            <Link
                                                href="/profile"
                                                className="inline-flex items-center rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
                                            >
                                                Complete profile details
                                            </Link>
                                        </div>
                                        <button
                                            type="button"
                                            className="rounded-md p-1 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900"
                                            aria-label="Dismiss profile checklist"
                                            onClick={() => {
                                                setShowProfileChecklist(false);
                                                if (typeof window !== 'undefined') {
                                                    window.localStorage.removeItem('onboarding:profile-strength:v1');
                                                }
                                            }}
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setHideSeen((prev) => !prev)}
                                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors ${hideSeen
                                        ? 'border-indigo-400/70 bg-indigo-50 text-indigo-700 dark:border-indigo-500/70 dark:bg-indigo-950/40 dark:text-indigo-300'
                                        : 'border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-500'
                                        }`}
                                >
                                    {hideSeen ? 'Showing unread only' : 'Hide opened this session'}
                                </button>
                                {seenIds.size > 0 && (
                                    <button
                                        type="button"
                                        onClick={clearSeen}
                                        className="inline-flex items-center rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-500"
                                    >
                                        Reset opened ({seenIds.size})
                                    </button>
                                )}
                            </div>

                            {/* Bulk Actions */}
                            {selectionMode && (
                                <BulkActionBar
                                    selectedCount={selectedProjectIds.size}
                                    totalCount={visibleProjects.length}
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
                            )}

                            {/* Projects Grid */}
                            {isLoading && visibleProjects.length === 0 ? (
                                <div className={`grid gap-6 ${viewMode === VIEW_MODES.GRID ? 'md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
                                    {[1, 2, 3, 4, 5, 6].map((i) => (
                                        <ProjectCardSkeleton key={i} />
                                    ))}
                                </div>
                            ) : visibleProjects.length === 0 ? (
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
                                            totalCount={visibleProjects.length}
                                            data={visibleProjects}
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
                                                    isFollowing={myFollowedProjects?.has(project.id)}
                                                    followersCount={project.followersCount ?? 0}
                                                    onOpenProject={markSeen}
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
                                const idx = visibleProjects.findIndex(p => p.id === selectedProject?.id);
                                if (idx >= 0 && idx < visibleProjects.length - 1) setSelectedProject(visibleProjects[idx + 1]);
                            }}
                            onPrevious={() => {
                                const idx = visibleProjects.findIndex(p => p.id === selectedProject?.id);
                                if (idx > 0) setSelectedProject(visibleProjects[idx - 1]);
                            }}
                            hasNext={visibleProjects.findIndex(p => p.id === selectedProject?.id) < visibleProjects.length - 1}
                            hasPrevious={visibleProjects.findIndex(p => p.id === selectedProject?.id) > 0}
                        />

                        {showCreateModal && (
                            <CreateProjectWizard
                                onClose={() => setShowCreateModal(false)}
                                onSuccess={handleProjectCreated}
                            />
                        )}

                        <NotificationSettingsModal isOpen={showNotificationSettings} onClose={() => setShowNotificationSettings(false)} />

                        {showComparisonModal && selectedProjectIds.size >= 2 && (
                            <ProjectComparisonModal projects={visibleProjects.filter(p => selectedProjectIds.has(p.id))} onClose={() => setShowComparisonModal(false)} />
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
