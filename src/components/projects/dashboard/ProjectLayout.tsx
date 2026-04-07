"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
    LayoutDashboard, ListTodo, FolderOpen,
    Settings, Share2, ChevronLeft, Bell, Timer, BarChart3, Edit, Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/hub";
import { profileHref } from "@/lib/routing/identifiers";
import ProjectStatsBar from "@/components/projects/ProjectStatsBar";

interface ProjectLayoutProps {
    children: React.ReactNode;
    project: Project;
    isOwner: boolean;
    activeTab: string;
    onTabChange: (tabId: string) => void;
    followersCount?: number;
    viewCount?: number;

    onEdit?: () => void;
    isFollowing?: boolean;
    onFollow?: () => void;
    followLoading?: boolean;
    onShare?: () => void;
    onTabHover?: (tabId: string) => void;
    onTabLeave?: (tabId: string) => void;
}

const TABS = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "sprints", label: "Sprints", icon: Timer },
    { id: "tasks", label: "Tasks", icon: ListTodo },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "files", label: "Files", icon: FolderOpen },
    { id: "settings", label: "Settings", icon: Settings, ownerOnly: true },
];

export default function ProjectLayout({
    children, project, isOwner, activeTab, onTabChange,
    followersCount,
    viewCount,

    onEdit,
    isFollowing, onFollow, followLoading, onShare,
    onTabHover,
    onTabLeave,
}: ProjectLayoutProps) {
    const [isScrolled, setIsScrolled] = useState(false);
    const [tabsReady, setTabsReady] = useState(false);

    // Detect route scroll for sticky header shadow - throttled with rAF for performance
    useEffect(() => {
        const routeRoot = document.querySelector<HTMLElement>('[data-scroll-root="route"]');
        const scrollTarget: HTMLElement | Window = routeRoot ?? window;
        let rafId = 0;

        const handleScroll = () => {
            // Skip if already scheduled
            if (rafId) return;

            rafId = requestAnimationFrame(() => {
                const scrollY = routeRoot ? routeRoot.scrollTop : window.scrollY;
                // Only update state if threshold crossed
                const shouldBeScrolled = scrollY > 10;
                setIsScrolled((prev) => (prev === shouldBeScrolled ? prev : shouldBeScrolled));
                rafId = 0;
            });
        };

        scrollTarget.addEventListener("scroll", handleScroll as EventListener, { passive: true });
        handleScroll();

        return () => {
            scrollTarget.removeEventListener("scroll", handleScroll as EventListener);
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, []);

    useEffect(() => {
        setTabsReady(true);
    }, []);

    const isFilesTab = activeTab === "files";

    return (
        <div className={cn(
            "bg-zinc-50 dark:bg-zinc-950",
            isFilesTab ? "h-screen overflow-hidden flex flex-col" : "min-h-screen"
        )}>
            {/* Top Row: Context & Actions (NOT sticky; scrolls away) */}
            <div className="bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md shrink-0">
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
                                    {(project as any)?.owner?.canOpenProfile ? (
                                        <Link
                                            href={profileHref({ id: (project as any)?.owner?.id, username: (project as any)?.owner?.username })}
                                            className="font-medium text-primary hover:underline truncate max-w-[180px]"
                                            title={(project as any)?.owner?.displayName || (project as any)?.owner?.fullName || (project as any)?.owner?.username || "Creator"}
                                        >
                                            {(project as any)?.owner?.displayName || (project as any)?.owner?.fullName || (project as any)?.owner?.username || "Creator"}
                                        </Link>
                                    ) : (
                                        <span
                                            className="truncate max-w-[180px] font-medium text-zinc-700 dark:text-zinc-300"
                                            title={(project as any)?.owner?.displayName || "Private creator"}
                                        >
                                            {(project as any)?.owner?.displayName || "Private creator"}
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
                            {/* Edit (Owner) */}
                            {isOwner && onEdit && (
                                <button
                                    type="button"
                                    onClick={onEdit}
                                    className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-md app-accent-solid hover:bg-primary/90 transition-[background-color,box-shadow] text-sm font-medium shadow-sm"
                                    title="Edit Project"
                                >
                                    <Edit className="w-4 h-4" />
                                    Edit
                                </button>
                            )}

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
            <div className={cn(
                "z-30 bg-white dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 transition-shadow duration-300 ease-in-out shrink-0",
                isFilesTab ? "relative" : "sticky",
                isScrolled && !isFilesTab && "shadow-sm"
            )}
                style={isFilesTab ? undefined : { top: 0 }}
            >
                <div className="max-w-7xl mx-auto">
                    <div className="flex items-center px-4 overflow-x-auto scrollbar-hide -mb-px">
                        {TABS.map((tab) => {
                            if (tab.ownerOnly && !isOwner) return null;
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
                                    disabled={!tabsReady}
                                    className={cn(
                                        "relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed",
                                        isActive
                                            ? "text-primary"
                                            : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                                    )}
                                >
                                    <tab.icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-zinc-400")} />
                                    {tab.label}
                                    {isActive && (
                                        <motion.div
                                            layoutId="activeProjectTab"
                                            className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                                            transition={{ type: "spring", stiffness: 380, damping: 30 }}
                                        />
                                    )}
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
                isFilesTab 
                    ? "flex-1 w-full h-full overflow-hidden flex flex-col" 
                    : "max-w-7xl mx-auto p-4 sm:p-6 lg:p-8"
            )}
            >
                {children}
            </section>
        </div>
    );
}
