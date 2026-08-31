"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useState, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Menu } from "lucide-react";
import Logo from "./Logo";
import NavLink from "./NavLink";
import ThemeToggle from "./ThemeToggle";
// Dynamic Imports for heavy interactive components
import dynamic from "next/dynamic";
const MobileMenu = dynamic(() => import("./MobileMenu"), { ssr: false });
const CommandPalette = dynamic(() => import("./CommandPalette"), { ssr: false });
const NotificationPreview = dynamic(() => import("./NotificationPreview"), { ssr: false });

import GlobalSearch from "./GlobalSearch";
import WorkspaceIndicator from "./WorkspaceIndicator";
import { ConnectionStatusIndicator } from "./ConnectionStatusIndicator";
import { ProfileAvatar } from "./ProfileAvatar";
import { useScrollShadow } from "@/hooks/useScrollShadow";

import { useAuth } from "@/lib/hooks/use-auth";
import { useNotifications } from "@/hooks/useNotifications";
import { usePeopleNotifications } from "@/hooks/usePeopleNotifications";
import { ROUTES } from "@/constants/routes";
import { resolveTopNavAuthUiState } from "./topnav-auth-state";
import { MAIN_NAV_ITEMS, isMainNavRouteActive } from "./nav-items";
import {
    resolveGlobalSearchContext,
    type GlobalSearchContext,
} from "./global-search";
import { useMessagesV2UiStore } from "@/stores/messagesV2UiStore";
import { useMessageAttention } from "@/components/providers/MessageAttentionProvider";
import { useUIStore } from "@/lib/stores/ui-store";
import { useRealtime } from "@/components/providers/RealtimeProvider";
import { getWorkspaceSummaryAction } from "@/app/actions/workspace";
import { queryKeys } from "@/lib/query-keys";

export default function TopNav() {
    const pathname = usePathname();
    const { user, isAuthenticated: isSignedIn, isLoading: authLoading, profile, signOut } = useAuth();

    const notifications = useNotifications();
    const peopleNotifications = usePeopleNotifications();
    const messageAttention = useMessageAttention();
    const { connectionHealth } = useRealtime();

    // Hydration fix: ensures we only render auth-dependent UI after mount
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    const [showMobileMenu, setShowMobileMenu] = useState(false);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
    const [commandPaletteContext, setCommandPaletteContext] = useState<GlobalSearchContext | undefined>();
    const setMessageSearchOpen = useMessagesV2UiStore((state) => state.setMessageSearchOpen);
    const openWorkspace = useUIStore((state) => state.openWorkspace);
    const workspaceSummary = useQuery({
        queryKey: queryKeys.workspace.summary(),
        queryFn: getWorkspaceSummaryAction,
        enabled: Boolean(isSignedIn),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    });
    const workspaceActionCount = workspaceSummary.data?.success
        ? workspaceSummary.data.taskCount + workspaceSummary.data.requestCount + peopleNotifications.pendingConnections
        : peopleNotifications.pendingConnections;

    const closeGlobalSearch = useCallback(() => {
        setShowCommandPalette(false);
        setCommandPaletteQuery("");
        setCommandPaletteContext(undefined);
    }, []);

    const openGlobalSearch = useCallback((query = "", requestedContext?: GlobalSearchContext) => {
        const nextContext = requestedContext ?? resolveGlobalSearchContext(pathname).context;
        if (nextContext === "messages") {
            closeGlobalSearch();
            setMessageSearchOpen(true);
            return;
        }
        setCommandPaletteQuery(query);
        setCommandPaletteContext(nextContext);
        setShowCommandPalette(true);
    }, [closeGlobalSearch, pathname, setMessageSearchOpen]);

    const hasScrolled = useScrollShadow();

    const authUiState = resolveTopNavAuthUiState({
        isAuthenticated: isSignedIn,
        isLoading: authLoading,
    });

    // Global keyboard shortcut for command palette
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                if ((e.target as HTMLElement | null)?.closest("[data-messages-surface]")) {
                    closeGlobalSearch();
                    setMessageSearchOpen(true);
                    return;
                }
                if (showCommandPalette) {
                    closeGlobalSearch();
                } else {
                    openGlobalSearch();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [closeGlobalSearch, openGlobalSearch, setMessageSearchOpen, showCommandPalette]);
    // Listen for custom event to open command palette
    useEffect(() => {
        const handleOpenCommandPalette = (e: CustomEvent<{ query?: string; context?: GlobalSearchContext }>) => {
            openGlobalSearch(e.detail?.query ?? "", e.detail?.context);
        };

        window.addEventListener("open-command-palette", handleOpenCommandPalette as EventListener);
        return () => window.removeEventListener("open-command-palette", handleOpenCommandPalette as EventListener);
    }, [openGlobalSearch]);

    return (
        <header
            className={`sticky top-0 z-40 w-full border-b border-zinc-200/50 dark:border-zinc-800/50 bg-white dark:bg-zinc-900 dark:!bg-zinc-950 transition-all duration-300 ease-in-out ${hasScrolled ? "shadow-sm dark:shadow-zinc-900/20" : ""
                }`}
        >
            <div className="mx-auto max-w-7xl px-4 sm:px-6 flex items-center justify-between gap-4 h-[var(--ui-topnav-height)] transition-all duration-300">
                <div className="flex items-center gap-4">
                    <div className="transition-transform duration-300">
                        <Logo href={authUiState === "signed-in" ? ROUTES.HUB : ROUTES.HOME} />
                    </div>

                    {authUiState === "signed-in" && (
                        <>
                            <div className="hidden md:block h-6 w-px bg-gradient-to-b from-transparent via-zinc-200 dark:via-zinc-800 to-transparent" />
                            <WorkspaceIndicator />
                        </>
                    )}
                </div>

                <div className="hidden min-w-0 flex-1 items-center justify-end gap-4 md:flex">
                    <nav
                        className="flex shrink-0 items-center gap-1"
                        aria-label="Main navigation"
                    >
                        {MAIN_NAV_ITEMS.map((item) => {
                            const isActive = isMainNavRouteActive(pathname, item.href);

                            let alertState = false;
                            let alertCount: number | undefined;

                            if (item.href === ROUTES.PEOPLE) {
                                alertState = peopleNotifications.totalPending > 0 && !isActive;
                            } else if (item.href === ROUTES.MESSAGES) {
                                alertState = messageAttention.hasUnreadMessages;
                                alertCount = messageAttention.unreadCount;
                            }

                            return (
                                <NavLink
                                    key={item.href}
                                    href={item.href}
                                    icon={item.icon}
                                    label={item.label}
                                    isActive={isActive}
                                    alertState={alertState}
                                    alertCount={alertCount}
                                    connectionHealth={item.href === ROUTES.PEOPLE ? connectionHealth : undefined}
                                />
                            );
                        })}
                    </nav>

                    {authUiState === "signed-in" && (
                        <Suspense fallback={<div className="h-10 w-60 shrink-0 rounded-xl bg-zinc-100 dark:bg-zinc-800" />}>
                            <GlobalSearch
                                condensed={false}
                                onOpenCommandPalette={openGlobalSearch}
                            />
                        </Suspense>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {authUiState === "signed-in" && <ConnectionStatusIndicator />}
                    {authUiState === "signed-in" && (
                        <NotificationPreview
                            unreadCount={notifications.unreadCount}
                            unreadImportantCount={notifications.unreadImportantCount}
                            items={notifications.items}
                            activeFilter={notifications.activeFilter}
                            isOpen={notifications.isTrayOpen}
                            isLoading={notifications.isLoading}
                            hasMore={notifications.hasMore}
                            isLoadingMore={notifications.isLoadingMore}
                            connectionHealth={connectionHealth}
                            onOpenChange={notifications.setTrayOpen}
                            onFilterChange={notifications.setActiveFilter}
                            onOpenItem={notifications.openItem}
                            onItemsViewed={notifications.stageViewedNotifications}
                            onMarkUnread={notifications.markUnread}
                            onDismiss={notifications.dismiss}
                            onMuteScope={notifications.muteScope}
                            onSnooze={notifications.snooze}
                            onLoadMore={notifications.loadMore}
                        />
                    )}

                    <ThemeToggle />

                    {authUiState === "loading" ? (
                        <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                            <div className="hidden sm:block h-4 w-20 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                        </div>
                    ) : (
                        <div className="relative">
                            {authUiState === "signed-in" ? (
                                <Link
                                    href={ROUTES.PROFILE}
                                    prefetch={false}
                                    className="flex items-center gap-2 rounded-lg px-2 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors group focus:outline-none app-density-nav-item"
                                    aria-label="Go to profile"
                                >
                                    <ProfileAvatar profile={profile} size={32} priority />
                                    <span className="hidden sm:inline text-sm font-medium truncate max-w-[120px] text-zinc-700 dark:text-zinc-200">
                                        {profile?.username || "User"}
                                    </span>
                                </Link>
                            ) : (
                                <Link
                                    href={ROUTES.LOGIN}
                                    className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-900 transition-colors focus:outline-none    dark:"
                                >
                                    Sign in
                                </Link>
                            )}
                        </div>
                    )}

                    {authUiState === "signed-in" && (
                        <button
                            onClick={() => setShowMobileMenu(true)}
                            className="md:hidden p-2 rounded-lg hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors focus:outline-none    dark:"
                            aria-label="Open mobile menu"
                            aria-expanded={showMobileMenu}
                            aria-controls="mobile-menu"
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                    )}
                </div>

                {mounted && authUiState === "signed-in" && (
                    <Suspense fallback={null}>
                        <MobileMenu
                            isOpen={showMobileMenu}
                            onClose={() => setShowMobileMenu(false)}
                            profile={profile}
                            onSignOut={signOut}
                            notificationUnreadCount={notifications.unreadImportantCount}
                            messageUnreadCount={messageAttention.unreadCount}
                            onOpenNotifications={() => {
                                setShowMobileMenu(false);
                                notifications.openTray();
                            }}
                            onOpenSearch={() => {
                                setShowMobileMenu(false);
                                openGlobalSearch();
                            }}
                            onOpenWorkspace={() => {
                                setShowMobileMenu(false);
                                openWorkspace("tasks");
                            }}
                            workspaceActionCount={workspaceActionCount}
                            connectionHealth={connectionHealth}
                        />
                    </Suspense>
                )}

                {mounted && authUiState === "signed-in" && showCommandPalette && (
                    <CommandPalette
                        isOpen={showCommandPalette}
                        onClose={closeGlobalSearch}
                        initialQuery={commandPaletteQuery}
                        context={commandPaletteContext}
                        recentSearchOwnerId={user?.id}
                    />
                )}
            </div>
        </header>
    );
}
