"use client";

import { useState, useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent } from "react";
import Link from "next/link";
import {
    LayoutDashboard, ListTodo, FolderOpen, BookOpenText,
    Settings, Share2, ChevronLeft, Bell, IterationCcw, BarChart3, Loader2, Newspaper
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/hub";
import { profileHref } from "@/lib/routing/identifiers";
import { useRouteWarmPrefetch } from "@/hooks/useRouteWarmPrefetch";
import ProjectStatsBar from "@/components/projects/ProjectStatsBar";
import { ProjectLinkCluster } from "@/components/projects/dashboard/ProjectSocialLinksCard";
import {
    isProjectTabVisibleToViewer,
    normalizeProjectPublicTabVisibility,
    type ProjectPublicTabVisibility,
} from "@/lib/projects/settings-policies";

interface ProjectLayoutProps {
    children: React.ReactNode;
    project: Project;
    isOwner: boolean;
    isOwnerOrMember?: boolean;
    canManageSettings?: boolean;
    publicTabVisibility?: ProjectPublicTabVisibility | null;
    activeTab: string;
    isDocEditing?: boolean;
    onTabChange: (tabId: string) => void;
    followersCount?: number;
    viewCount?: number;

    isFollowing?: boolean;
    onFollow?: () => void;
    followLoading?: boolean;
    onShare?: () => void;
    onTabHover?: (tabId: string) => void;
}

const TABS = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "readme", label: "Docs", icon: BookOpenText },
    { id: "updates", label: "Updates", icon: Newspaper },
    { id: "sprints", label: "Sprints", icon: IterationCcw },
    { id: "tasks", label: "Tasks", icon: ListTodo },
    { id: "files", label: "Files", icon: FolderOpen },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "settings", label: "Settings", icon: Settings, ownerOnly: true },
];

const FILES_WORKSPACE_SCROLL_EVENT = "project:files-workspace-scroll";

type FilesWorkspaceScrollDetail = {
    projectId: string;
    scrollTop: number;
};

export default function ProjectLayout({
    children, project, isOwner, activeTab, onTabChange,
    isDocEditing = false,
    isOwnerOrMember,
    canManageSettings,
    publicTabVisibility,
    followersCount,
    viewCount,

    isFollowing, onFollow, followLoading, onShare,
    onTabHover,
}: ProjectLayoutProps) {
    const prefetch = useRouteWarmPrefetch();
    const [isScrolled, setIsScrolled] = useState(false);
    const [projectTabsHeight, setProjectTabsHeight] = useState(0);
    const tabsRef = useRef<HTMLDivElement>(null);

    const isFilesTab = activeTab === "files";
    const isSettingsTab = activeTab === "settings";
    const isUpdatesTab = activeTab === "updates";
    const isTasksTab = activeTab === "tasks";
    const isDocEditWorkspaceTab = activeTab === "readme" && isDocEditing;
    const isContainedWorkspaceTab = isFilesTab || isDocEditWorkspaceTab;

    // Detect the active tab's scroll surface for sticky header state. Files
    // owns independent sidebar and content scrollers, so FilesTabRoot emits a
    // single event from either pane rather than making the workspace itself
    // page-scrollable.
    useEffect(() => {
        if (isFilesTab) {
            let rafId = 0;
            let latestScrollTop = 0;

            const scheduleScrollState = () => {
                if (rafId) return;

                rafId = requestAnimationFrame(() => {
                    const shouldBeScrolled = latestScrollTop > 10;
                    setIsScrolled((prev) => (prev === shouldBeScrolled ? prev : shouldBeScrolled));
                    rafId = 0;
                });
            };
            const handleFilesWorkspaceScroll = (event: Event) => {
                const detail = (event as CustomEvent<FilesWorkspaceScrollDetail>).detail;
                if (!detail || detail.projectId !== project.id) return;
                latestScrollTop = detail.scrollTop;
                scheduleScrollState();
            };

            window.addEventListener(FILES_WORKSPACE_SCROLL_EVENT, handleFilesWorkspaceScroll);
            setIsScrolled(false);

            return () => {
                window.removeEventListener(FILES_WORKSPACE_SCROLL_EVENT, handleFilesWorkspaceScroll);
                if (rafId) cancelAnimationFrame(rafId);
            };
        }

        if (isDocEditWorkspaceTab) {
            setIsScrolled(false);
            return;
        }

        const routeRoot = document.querySelector<HTMLElement>('[data-scroll-root="route"]');
        const scrollTarget: HTMLElement | Window = routeRoot ?? window;
        let rafId = 0;

        const scheduleScrollState = () => {
            if (rafId) return;

            rafId = requestAnimationFrame(() => {
                const scrollY = routeRoot ? routeRoot.scrollTop : window.scrollY;
                const shouldBeScrolled = scrollY > 10;
                setIsScrolled((prev) => (prev === shouldBeScrolled ? prev : shouldBeScrolled));
                rafId = 0;
            });
        };

        scrollTarget.addEventListener("scroll", scheduleScrollState as EventListener, { passive: true });
        scheduleScrollState();

        return () => {
            scrollTarget.removeEventListener("scroll", scheduleScrollState as EventListener);
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [isDocEditWorkspaceTab, isFilesTab, project.id]);

    useEffect(() => {
        const updateProjectLayoutMetrics = () => {
            const nextTabsHeight = Math.ceil(tabsRef.current?.getBoundingClientRect().height ?? 0);
            setProjectTabsHeight((current) => current === nextTabsHeight ? current : nextTabsHeight);
        };

        updateProjectLayoutMetrics();
        const observer = typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(updateProjectLayoutMetrics)
            : null;
        if (tabsRef.current) observer?.observe(tabsRef.current);
        window.addEventListener("resize", updateProjectLayoutMetrics);

        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", updateProjectLayoutMetrics);
        };
    }, [activeTab, isContainedWorkspaceTab]);

    const normalizedPublicTabs = useMemo(
        () => normalizeProjectPublicTabVisibility(publicTabVisibility ?? project.publicTabVisibility),
        [project.publicTabVisibility, publicTabVisibility],
    );
    const canSeeMemberTabs = isOwnerOrMember ?? isOwner;
    const visibleTabs = useMemo(
        () => TABS.filter((tab) => {
            if (tab.ownerOnly && !(canManageSettings ?? isOwner)) return false;
            return isProjectTabVisibleToViewer({
                tabId: tab.id,
                isOwnerOrMember: canSeeMemberTabs,
                canManageSettings: canManageSettings ?? isOwner,
                publicTabVisibility: normalizedPublicTabs,
            });
        }),
        [canManageSettings, canSeeMemberTabs, isOwner, normalizedPublicTabs],
    );
    const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        let nextIndex: number | null = null;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % visibleTabs.length;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + visibleTabs.length) % visibleTabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = visibleTabs.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        const nextTab = visibleTabs[nextIndex];
        if (!nextTab) return;
        onTabChange(nextTab.id);
        requestAnimationFrame(() => {
            tabsRef.current?.querySelector<HTMLButtonElement>(`[data-testid="project-tab-${nextTab.id}"]`)?.focus();
        });
    };
    const owner = (project as any)?.owner;
    const guidance = (project as any)?.guidance as {
        label?: string | null;
        fullName?: string | null;
        username?: string | null;
        guideUserId?: string | null;
    } | null;
    const ownerName = owner?.displayName || owner?.fullName || owner?.username || "Creator";
    const ownerHref = owner?.canOpenProfile ? profileHref({ id: owner?.id, username: owner?.username }) : null;
    const guidanceName = guidance?.fullName || guidance?.username || "";
    const guidanceHref = guidance?.guideUserId
        ? profileHref({ id: guidance.guideUserId, username: guidance.username })
        : null;
    const layoutStyle = {
        "--project-tabs-height": `${projectTabsHeight}px`,
    } as CSSProperties;

    return (
        <div className={cn(
            "bg-zinc-50 dark:bg-zinc-950",
            isContainedWorkspaceTab ? "h-full min-h-0 overflow-hidden flex flex-col" : "min-h-screen"
        )}
            data-project-layout-owned-workspace={isContainedWorkspaceTab ? "true" : undefined}
            data-project-readme-edit-workspace={isDocEditWorkspaceTab ? "true" : undefined}
            style={layoutStyle}
        >
            {/* Top Row: Context & Actions (NOT sticky; scrolls away) */}
            <div className={cn(
                "bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md shrink-0 overflow-hidden transition-[height,opacity,transform] duration-200 ease-in-out",
                isContainedWorkspaceTab && isScrolled
                    ? "h-0 -translate-y-2 opacity-0 pointer-events-none"
                    : "h-14 translate-y-0 opacity-100",
            )}>
                <div className="max-w-7xl mx-auto w-full">
                    <div className="flex items-center justify-between px-4 h-14">
                        {/* Left: Project Identity */}
                        <div className="flex items-center gap-4 min-w-0">
                            <Link
                                href="/hub"
                                className="group flex items-center gap-1 text-zinc-500 hover:text-zinc-900 dark:text-zinc-50 dark:hover:text-zinc-100 transition-colors text-sm font-medium pr-4 border-r border-zinc-200 dark:border-zinc-800"
                            >
                                <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
                                Hub
                            </Link>

                            <div className="flex items-center gap-3 min-w-0">
                                <h1 className="min-w-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                    {project?.title}
                                </h1>
                                <ProjectLinkCluster
                                    projectId={project.id}
                                    links={project.externalLinks ?? (project as any).external_links}
                                    githubRepoUrl={project.githubRepoUrl ?? (project as any).github_repo_url}
                                    health={project.externalLinkMetadata ?? (project as any).external_link_metadata}
                                    projectType={project.category}
                                    canManage={canManageSettings ?? isOwner}
                                />
                                {guidanceName ? (
                                    <div className="hidden md:flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 min-w-0">
                                        <span className="shrink-0">{guidance?.label === "Guide" ? "Guided by" : `${guidance?.label || "Guide"}:`}</span>
                                        {guidanceHref ? (
                                            <Link href={guidanceHref} onMouseEnter={() => prefetch(guidanceHref)} onFocus={() => prefetch(guidanceHref)} className="font-medium text-primary hover:underline truncate max-w-[180px]" title={guidanceName}>
                                                {guidanceName}
                                            </Link>
                                        ) : <span className="truncate max-w-[180px] font-medium text-zinc-700 dark:text-zinc-300">{guidanceName}</span>}
                                    </div>
                                ) : null}
                                {/* Created by */}
                                <div className="hidden md:flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 min-w-0">
                                    <span className="shrink-0">Created by</span>
                                    {ownerHref ? (
                                        <Link
                                            href={ownerHref}
                                            onMouseEnter={() => prefetch(ownerHref)}
                                            onFocus={() => prefetch(ownerHref)}
                                            className="font-medium text-primary hover:underline truncate max-w-[180px]"
                                            title={ownerName}
                                        >
                                            {ownerName}
                                        </Link>
                                    ) : (
                                        <span
                                            className="truncate max-w-[180px] font-medium text-zinc-700 dark:text-zinc-300"
                                            title={owner?.displayName || "Private creator"}
                                        >
                                            {owner?.displayName || "Private creator"}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Inline project meta */}
                            <div className="hidden lg:flex items-center min-w-0">
                                <ProjectStatsBar
                                    viewCount={viewCount ?? (project as any)?.viewCount ?? 0}
                                    followersCount={followersCount ?? (project as any)?.followersCount ?? 0}

                                />
                            </div>
                        </div>

                        {/* Right: Actions */}
                        <div className="flex items-center gap-2">
                            {/* Follow */}
                            <button
                                type="button"
                                onClick={onFollow}
                                className={cn(
                                    "p-2 rounded-md transition-all flex items-center gap-1.5 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed",
                                    isFollowing
                                        ? "text-primary bg-primary/10"
                                        : "text-zinc-500 hover:text-primary hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                                )}
                                title={isFollowing ? "Unfollow Project" : "Follow Project"}
                                data-testid="project-follow-toggle"
                                disabled={followLoading}
                                aria-busy={followLoading}
                            >
                                {followLoading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Bell className={cn("w-4 h-4", isFollowing && "fill-current")} />
                                )}
                                <span className="hidden sm:inline-block">{isFollowing ? "Following" : "Follow"}</span>
                            </button>

                            <div className="w-px h-4 bg-zinc-200 dark:border-zinc-800 mx-1" />

                            {/* Share */}
                            <button
                                type="button"
                                onClick={onShare}
                                className="p-2 text-zinc-400 hover:text-zinc-900 dark:text-zinc-50 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 rounded-md transition-colors"
                                title="Share Project"
                            >
                                <Share2 className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Row: Navigation Tabs (sticky) */}
            <div ref={tabsRef} className={cn(
                "z-30 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 transition-shadow duration-300 ease-in-out shrink-0",
                isContainedWorkspaceTab ? "relative" : "sticky",
                isScrolled && "shadow-sm"
            )}
                data-project-sticky-tabs={!isContainedWorkspaceTab ? "true" : undefined}
                style={isContainedWorkspaceTab ? undefined : { top: 0 }}
            >
                <div className="max-w-7xl mx-auto">
                    <div role="tablist" aria-label="Project sections" className="flex items-center px-4 overflow-x-auto app-scroll app-scroll-x -mb-px">
                        {visibleTabs.map((tab, index) => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    data-testid={`project-tab-${tab.id}`}
                                    data-active={isActive ? "true" : "false"}
                                    id={`project-tab-${tab.id}`}
                                    role="tab"
                                    aria-selected={isActive}
                                    aria-controls="project-active-tab-panel"
                                    tabIndex={isActive ? 0 : -1}
                                    onClick={() => onTabChange(tab.id)}
                                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                                    onMouseEnter={() => onTabHover?.(tab.id)}
                                    onFocus={() => onTabHover?.(tab.id)}
                                    className={cn(
                                        "relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all whitespace-nowrap",
                                        isActive
                                            ? "text-primary"
                                            : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                                    )}
                                >
                                    <tab.icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-zinc-400")} />
                                    {tab.label}
                                    {isActive ? <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" /> : null}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <section
                id="project-active-tab-panel"
                role="tabpanel"
                aria-labelledby={`project-tab-${activeTab}`}
                aria-label="Project detail content"
                className={cn(
                    isContainedWorkspaceTab
                        ? "flex-1 min-h-0 w-full overflow-hidden flex flex-col"
                        : isSettingsTab
                            ? "w-full"
                            : isUpdatesTab || isTasksTab
                                ? "w-full p-4 sm:p-6 lg:p-8"
                                : "max-w-7xl mx-auto p-4 sm:p-6 lg:p-8"
                )}
                data-project-content-root={isContainedWorkspaceTab ? "workspace" : "page"}
                data-project-workspace-tab={isContainedWorkspaceTab ? activeTab : undefined}
            >
                {children}
            </section>
        </div>
    );
}
