"use client";

import { useState, useEffect, useRef, type CSSProperties } from "react";
import Link from "next/link";
import {
    LayoutDashboard, ListTodo, FolderOpen, BookOpenText,
    Settings, Share2, ChevronLeft, Bell, Timer, BarChart3, Loader2, Newspaper
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/hub";
import { profileHref } from "@/lib/routing/identifiers";
import { useRouteWarmPrefetch } from "@/hooks/useRouteWarmPrefetch";
import ProjectStatsBar from "@/components/projects/ProjectStatsBar";
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
    onTabLeave?: (tabId: string) => void;
}

const TABS = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "readme", label: "Docs", icon: BookOpenText },
    { id: "updates", label: "Updates", icon: Newspaper },
    { id: "sprints", label: "Sprints", icon: Timer },
    { id: "tasks", label: "Tasks", icon: ListTodo },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "files", label: "Files", icon: FolderOpen },
    { id: "settings", label: "Settings", icon: Settings, ownerOnly: true },
];

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
    onTabLeave,
}: ProjectLayoutProps) {
    const prefetch = useRouteWarmPrefetch();
    const [isScrolled, setIsScrolled] = useState(false);
    const [projectTabsHeight, setProjectTabsHeight] = useState(0);
    const tabsRef = useRef<HTMLDivElement>(null);

    const isFilesTab = activeTab === "files";
    const isSettingsTab = activeTab === "settings";
    const isUpdatesTab = activeTab === "updates";
    const isDocEditWorkspaceTab = activeTab === "readme" && isDocEditing;
    const isContainedWorkspaceTab = isFilesTab || isDocEditWorkspaceTab;

    // Detect route scroll for sticky header state. Workspace tabs own their
    // own scroll chrome.
    useEffect(() => {
        if (isContainedWorkspaceTab) {
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
    }, [isContainedWorkspaceTab]);

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

    const normalizedPublicTabs = normalizeProjectPublicTabVisibility(publicTabVisibility ?? project.publicTabVisibility);
    const canSeeMemberTabs = isOwnerOrMember ?? isOwner;
    const owner = (project as any)?.owner;
    const ownerName = owner?.displayName || owner?.fullName || owner?.username || "Creator";
    const ownerHref = owner?.canOpenProfile ? profileHref({ id: owner?.id, username: owner?.username }) : null;
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
            <div
                className={cn(
                    "bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md shrink-0 overflow-hidden transition-[height,opacity,transform] duration-200 ease-in-out",
                    isContainedWorkspaceTab && isScrolled
                        ? "h-0 -translate-y-2 opacity-0 pointer-events-none"
                        : "h-14 translate-y-0 opacity-100",
                )}
            >
                <div className="max-w-7xl mx-auto">
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
                                <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                                    {project?.title}
                                </h1>
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
                                {project?.status === "active" && (
                                    <span className="hidden sm:inline-block w-2 h-2 rounded-full bg-emerald-500" title="Active Project" />
                                )}
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
                    <div className="flex items-center px-4 overflow-x-auto scrollbar-hide -mb-px">
                        {TABS.map((tab) => {
                            if (tab.ownerOnly && !(canManageSettings ?? isOwner)) return null;
                            if (!isProjectTabVisibleToViewer({
                                tabId: tab.id,
                                isOwnerOrMember: canSeeMemberTabs,
                                canManageSettings: canManageSettings ?? isOwner,
                                publicTabVisibility: normalizedPublicTabs,
                            })) return null;
                            // Ponytail: deleted hasPublishedReadme check for readme tab visibility
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    data-testid={`project-tab-${tab.id}`}
                                    data-active={isActive ? "true" : "false"}
                                    onClick={() => onTabChange(tab.id)}
                                    onMouseEnter={() => onTabHover?.(tab.id)}
                                    onMouseLeave={() => onTabLeave?.(tab.id)}
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
                aria-label="Project detail content"
                className={cn(
                    isContainedWorkspaceTab
                        ? "flex-1 min-h-0 w-full overflow-hidden flex flex-col"
                        : isSettingsTab
                            ? "w-full"
                            : isUpdatesTab
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
