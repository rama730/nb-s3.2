'use client';

import { useState, useMemo, memo, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Search, Sparkles, Filter, CheckSquare, X } from 'lucide-react';
import { useToast } from '@/components/ui-custom/Toast';
import { VirtuosoGrid } from 'react-virtuoso';
import { useQueryClient } from '@tanstack/react-query';

// Hooks
import { useRouter } from 'next/navigation';
import { useHubProjectsSimple } from '@/hooks/hub/useHubProjectsSimple';
import { useAuth } from '@/hooks/useAuth';
import { useHubSessionSeen } from '@/hooks/hub/useHubSessionSeen';
import { useUserFollowedProjects } from '@/hooks/hub/useUserInteractions';
import { useHubUrlFilters } from '@/hooks/hub/useHubUrlFilters';

// Components
import ProjectCard from '@/components/projects/ProjectCard';
import ProjectCardSkeleton from '@/components/projects/ProjectCardSkeleton';
import HubNavigation from '@/components/hub/HubNavigation';
import HubHeader from '@/components/hub/HubHeader';
import { HubErrorBoundary } from '@/components/hub/HubErrorBoundary';
import { AppScrollArea } from '@/components/ui/AppScrollArea';
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
const NotificationSettingsModal = dynamic(() => import('@/components/hub/NotificationSettingsModal'), { ssr: false });
// Optimization: Defer mobile sidebar code until interaction
const MobileSidebarDrawer = dynamic(() => import('@/components/hub/MobileSidebarDrawer'), { ssr: false });

import { toProjectCardViewModel, ProjectCardViewModel } from '@/lib/view-models/project-card';
import { queryKeys } from '@/lib/query-keys';

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
    const router = useRouter();

    // --- State ---
    // Essential UI State
    const [viewMode, setViewMode] = useState<ViewMode>(VIEW_MODES.GRID);
    const [isSticky, setIsSticky] = useState(false);
    const [showMobileSidebar, setShowMobileSidebar] = useState(false);

    // Selection & Modal State
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());

    // Dialog Visibility
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showNotificationSettings, setShowNotificationSettings] = useState(false);
    const [showComparisonModal, setShowComparisonModal] = useState(false);
    const [profileChecklistItems, setProfileChecklistItems] = useState<string[]>([]);
    const [showProfileChecklist, setShowProfileChecklist] = useState(false);
    const [isFeedScrolling, setIsFeedScrolling] = useState(false);
    const feedScrollingRef = useRef(false);
    const feedScrollStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- Derived Data ---
    const { urlFilters, updateUrlFilters } = useHubUrlFilters();
    const filterView = urlFilters.view;
    const statusFilter = urlFilters.status;
    const typeFilter = urlFilters.type;
    const sortBy = urlFilters.sort;
    const selectedTech = urlFilters.tech;
    const search = urlFilters.q || undefined;
    const hideOpened = urlFilters.hideOpened;

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

    const { data: myFollowedProjects } = useUserFollowedProjects(currentUser?.id);
    const { seenIds, setHideSeen, markSeen } = useHubSessionSeen();

    useEffect(() => {
        setHideSeen(hideOpened);
    }, [hideOpened, setHideSeen]);

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
            hideOpened,
        };
    }, [filterView, hideOpened, search, selectedTech, sortBy, statusFilter, typeFilter]);

    // --- Data Fetching ---
    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        error: projectsError,
    } = useHubProjectsSimple(currentFilters, filterView, initialProjectsPage);

    const allProjects = useMemo(() => {
        return data?.pages?.flatMap((p) => p.projects) || [];
    }, [data]);

    const visibleProjects = useMemo(() => {
        if (!hideOpened) return allProjects;
        return allProjects.filter((project) => !seenIds.has(project.id));
    }, [allProjects, hideOpened, seenIds]);

    useEffect(() => {
        if (!hideOpened) return;
        if (visibleProjects.length > 0) return;
        if (!hasNextPage || isFetchingNextPage) return;
        if (allProjects.length === 0) return;
        fetchNextPage();
    }, [hideOpened, visibleProjects.length, hasNextPage, isFetchingNextPage, allProjects.length, fetchNextPage]);

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
        setScrollContainer((prev) => (prev === node ? prev : node));
    }, []);

    useEffect(() => {
        if (!scrollContainer) return;

        let rafId: number | null = null;
        const updateSticky = () => {
            const nextSticky = scrollContainer.scrollTop > 10;
            setIsSticky((prev) => (prev === nextSticky ? prev : nextSticky));
        };

        const handleScroll = () => {
            if (rafId !== null) return;
            rafId = window.requestAnimationFrame(() => {
                rafId = null;
                updateSticky();
            });
        };

        scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
        updateSticky();

        return () => {
            scrollContainer.removeEventListener('scroll', handleScroll);
            if (rafId !== null) {
                window.cancelAnimationFrame(rafId);
            }
        };
    }, [scrollContainer]);

    // Creating Project
    const handleProjectCreated = useCallback((projectId?: string) => {
        setShowCreateModal(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.hub.projectsSimpleRoot() });
        showToast('Project created successfully!', 'success');
        if (projectId) {
            router.push(`/projects/${projectId}?tab=files`);
        }
    }, [queryClient, router, showToast]);

    // Clear Filters
    const handleClearFilters = useCallback(() => {
        updateUrlFilters({
            status: PROJECT_STATUS.ALL,
            type: PROJECT_TYPE.ALL,
            sort: SORT_OPTIONS.NEWEST,
            tech: [],
            hideOpened: false,
        });
    }, [updateUrlFilters]);

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

    // Sidebar Navigation
    const handleSelectView = (view: string) => {
        updateUrlFilters({ view: view as FilterView });
        setShowMobileSidebar(false);
    };

    const handleFeedScrollState = useCallback((isScrolling: boolean) => {
        if (isScrolling) {
            if (feedScrollStopTimerRef.current) {
                clearTimeout(feedScrollStopTimerRef.current);
                feedScrollStopTimerRef.current = null;
            }
            if (!feedScrollingRef.current) {
                feedScrollingRef.current = true;
                setIsFeedScrolling(true);
            }
            return;
        }

        if (feedScrollStopTimerRef.current) {
            clearTimeout(feedScrollStopTimerRef.current);
        }

        feedScrollStopTimerRef.current = setTimeout(() => {
            feedScrollStopTimerRef.current = null;
            feedScrollingRef.current = false;
            setIsFeedScrolling(false);
        }, 140);
    }, []);

    useEffect(() => {
        return () => {
            if (feedScrollStopTimerRef.current) {
                clearTimeout(feedScrollStopTimerRef.current);
            }
        };
    }, []);

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
                    <AppScrollArea axis="y" className="hidden lg:block w-64 flex-shrink-0 h-full py-8 pl-8 pr-8">
                        <HubNavigation
                            currentUser={currentUser}
                            activeView={filterView}
                            onSelectView={handleSelectView}
                        />
                    </AppScrollArea>

                    {/* Main Content */}
                    <div className="flex-1 min-w-0 h-full min-h-0 flex flex-col overflow-hidden">
                        <div data-testid="hub-header-shell" className="px-4 sm:px-6 lg:px-8 pt-8 pb-4 shrink-0">
                            <div className={`bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 transition-shadow duration-300 ${isSticky ? 'shadow-md' : 'shadow-sm'}`}>
                                <HubHeader
                                    filterView={filterView}
                                    selectionMode={selectionMode}
                                    onToggleSelectionMode={() => {
                                        setSelectionMode(!selectionMode);
                                        if (selectionMode) setSelectedProjectIds(new Set());
                                    }}
                                    onApplyFilters={(newFilters) => {
                                        updateUrlFilters({
                                            status: newFilters.status as ProjectStatus,
                                            type: newFilters.type as ProjectType,
                                            sort: newFilters.sort as SortOption,
                                            tech: newFilters.tech,
                                            hideOpened: newFilters.hideOpened ?? false,
                                        });
                                    }}
                                    onCreateProject={() => setShowCreateModal(true)}
                                    onPreloadModal={() => import('@/components/projects/create-wizard/CreateProjectWizard')}
                                    filters={currentFilters}
                                    viewMode={viewMode}
                                    onViewModeChange={setViewMode}
                                />
                            </div>
                        </div>

                        <AppScrollArea
                            axis="y"
                            dataScrollRoot
                            ref={scrollContainerRef}
                            id="hub-scroll-container"
                            data-testid="hub-feed-scroll"
                            className="flex-1 min-h-0 px-4 sm:px-6 lg:px-8 pb-8"
                        >
                            <div className="flex flex-col gap-6">

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

                            {/* Bulk Actions */}
                            {selectionMode && (
                                <BulkActionBar
                                    selectedCount={selectedProjectIds.size}
                                    totalCount={visibleProjects.length}
                                    onSelectAll={selectAll}
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
                                            computeItemKey={(_, project) => project.id}
                                            increaseViewportBy={{ top: 560, bottom: 1200 }}
                                            overscan={520}
                                            isScrolling={handleFeedScrollState}
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
                                                    project={project}
                                                    viewModel={projectViewModels[project.id]}
                                                    viewMode={viewMode}
                                                    selectionMode={selectionMode}
                                                    isSelected={selectedProjectIds.has(project.id)}
                                                    onToggleSelection={() => toggleSelection(project.id)}
                                                    onQuickView={setSelectedProject}
                                                    isFollowing={myFollowedProjects?.has(project.id)}
                                                    followersCount={project.followersCount ?? 0}
                                                    onOpenProject={markSeen}
                                                    disableHoverEffects={isFeedScrolling}
                                                />
                                            )}
                                        />
                                    )}
                                </div>
                            )}
                            </div>
                        </AppScrollArea>

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
                    <HubNavigation
                        currentUser={currentUser}
                        activeView={filterView}
                        onSelectView={handleSelectView}
                    />
                </MobileSidebarDrawer>
            </div>
        </HubErrorBoundary>
    );
});

export default SimpleHubClient;
