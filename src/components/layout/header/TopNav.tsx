"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, Suspense, useMemo, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Menu, LayoutGrid, Users, Settings, MessageSquare } from "lucide-react";
import Logo from "./Logo";
import NavLink from "./NavLink";
import ThemeToggle from "./ThemeToggle";
// Dynamic Imports for heavy interactive components
import dynamic from "next/dynamic";
const MobileMenu = dynamic(() => import("./MobileMenu"), { ssr: false });
const CommandPalette = dynamic(() => import("./CommandPalette"), { ssr: false });

import GlobalSearch from "./GlobalSearch";
import WorkspaceIndicator from "./WorkspaceIndicator";
import NotificationPreview from "./NotificationPreview";
import { ProfileAvatar } from "./ProfileMenu";
import { useScrollShadow } from "@/hooks/useScrollShadow";

import { useAuth } from "@/lib/hooks/use-auth";
import { useNotifications } from "@/hooks/useNotifications";
import { useMessageNotifications } from "@/hooks/useMessageNotifications";
import { usePeopleNotifications } from "@/hooks/usePeopleNotifications";

import { ROUTES } from "@/constants/routes";
import MessageIndicator from "./MessageIndicator";

export default function TopNav() {
    const pathname = usePathname();
    const router = useRouter();
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);
    const { isAuthenticated: isSignedIn, isLoading: authLoading, profile } = useAuth();

    const { unreadCount: unreadNotifications } = useNotifications();
    const { hasUnread: hasUnreadMessages } = useMessageNotifications();
    const { totalPending } = usePeopleNotifications();

    // Hydration fix: ensures we only render auth-dependent UI after mount
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    const [showMobileMenu, setShowMobileMenu] = useState(false);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
    const [commandPaletteContext, setCommandPaletteContext] = useState("default");

    const hasScrolled = useScrollShadow();

    const isLoading = authLoading; // Profile loading is part of auth loading now

    // Global keyboard shortcut for command palette
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.isContentEditable
            ) {
                return;
            }

            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                if (showCommandPalette) {
                    setShowCommandPalette(false);
                    setCommandPaletteQuery("");
                    setCommandPaletteContext("default");
                } else {
                    setShowCommandPalette(true);
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [showCommandPalette]);

    // Listen for custom event to open command palette
    useEffect(() => {
        const handleOpenCommandPalette = (e: CustomEvent<{ query?: string; context?: string }>) => {
            if (e.detail?.query) {
                setCommandPaletteQuery(e.detail.query);
            }
            if (e.detail?.context) {
                setCommandPaletteContext(e.detail.context);
            }
            setShowCommandPalette(true);
        };

        window.addEventListener("open-command-palette", handleOpenCommandPalette as EventListener);
        return () => window.removeEventListener("open-command-palette", handleOpenCommandPalette as EventListener);
    }, []);

    const signOut = useCallback(async () => {
        try {
            await supabase.auth.signOut();
            router.push(ROUTES.LOGIN);
            router.refresh();
        } catch (error) {
            console.error("Error signing out", { error });
        }
    }, [supabase, router]);

    const navItems = useMemo(
        () => [
            { href: ROUTES.HUB, label: "Hub", icon: LayoutGrid },
            { href: ROUTES.PEOPLE, label: "Connections", icon: Users },
            { href: ROUTES.MESSAGES, label: "Messages", icon: MessageSquare },
            { href: ROUTES.SETTINGS, label: "Settings", icon: Settings },
        ],
        []
    );

    useEffect(() => {
        if (!mounted || !isSignedIn) return;
        const prefetchTargets = [ROUTES.HUB, ROUTES.PEOPLE, ROUTES.MESSAGES, ROUTES.WORKSPACE, ROUTES.SETTINGS];
        for (const target of prefetchTargets) {
            router.prefetch(target);
        }
    }, [mounted, isSignedIn, router]);

    useEffect(() => {
        document.documentElement.style.setProperty("--header-height", "var(--ui-topnav-height)");
    }, []);

    return (
        <header
            className={`sticky top-0 z-40 w-full border-b border-zinc-200/50 dark:border-zinc-800/50 bg-white dark:bg-zinc-900 dark:!bg-zinc-950 transition-all duration-300 ease-in-out ${hasScrolled ? "shadow-sm dark:shadow-zinc-900/20" : ""
                }`}
        >
            <div className="mx-auto max-w-7xl px-4 sm:px-6 flex items-center justify-between gap-4 h-[var(--ui-topnav-height)] transition-all duration-300">
                <div className="flex items-center gap-4">
                    <div className="transition-transform duration-300">
                        <Logo />
                    </div>

                    {mounted && isSignedIn && (
                        <>
                            <div className="hidden md:block h-6 w-px bg-gradient-to-b from-transparent via-zinc-200 dark:via-zinc-800 to-transparent" />
                            <WorkspaceIndicator />
                        </>
                    )}
                </div>

                <nav
                    className="hidden md:flex items-center gap-1 flex-1 justify-center max-w-2xl"
                    aria-label="Main navigation"
                >
                    {navItems.map((item) => {
                        const isActive =
                            (item.href as string) === ROUTES.HOME
                                ? pathname === ROUTES.HOME
                                : pathname?.startsWith(item.href);

                        let badge;
                        if (item.href === ROUTES.MESSAGES) {
                            badge = <MessageIndicator hasUnread={hasUnreadMessages} />;
                        } else if (item.href === ROUTES.PEOPLE && totalPending > 0) {
                            badge = (
                                <div className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-zinc-950" />
                            );
                        }

                        return (
                            <NavLink
                                key={item.href}
                                href={item.href}
                                icon={item.icon}
                                label={item.label}
                                isActive={!!isActive}
                                badge={badge}
                            />
                        );
                    })}
                </nav>

                <div className="flex items-center gap-2">
                    {mounted && isSignedIn && (
                        <Suspense fallback={<div className="hidden md:block w-9 h-9 bg-zinc-100 dark:bg-zinc-800 rounded-full animate-pulse" />}>
                            <GlobalSearch
                                condensed={false}
                                onOpenCommandPalette={(query, context) => {
                                    if (query) setCommandPaletteQuery(query);
                                    if (context) setCommandPaletteContext(context);
                                    setShowCommandPalette(true);
                                }}
                            />
                        </Suspense>
                    )}

                    {mounted && isSignedIn && <NotificationPreview />}

                    <ThemeToggle />

                    {mounted && isLoading ? (
                        <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                            <div className="hidden sm:block h-4 w-20 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                        </div>
                    ) : (
                        <div className="relative">
                            {mounted && isSignedIn ? (
                                <Link
                                    href={ROUTES.PROFILE}
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
                                    className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-900 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
                                >
                                    Sign in
                                </Link>
                            )}
                        </div>
                    )}

                    {mounted && isSignedIn && (
                        <button
                            onClick={() => setShowMobileMenu(true)}
                            className="md:hidden p-2 rounded-lg hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
                            aria-label="Open mobile menu"
                            aria-expanded={showMobileMenu}
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                    )}
                </div>

                {mounted && isSignedIn && (
                    <Suspense fallback={null}>
                        <MobileMenu
                            isOpen={showMobileMenu}
                            onClose={() => setShowMobileMenu(false)}
                            profile={profile}
                            unreadNotificationsCount={unreadNotifications}
                            onSignOut={signOut}
                        />
                    </Suspense>
                )}

                {mounted && isSignedIn && (
                    <CommandPalette
                        isOpen={showCommandPalette}
                        onClose={() => {
                            setShowCommandPalette(false);
                            setCommandPaletteQuery("");
                            setCommandPaletteContext("default");
                        }}
                        initialQuery={commandPaletteQuery}
                        context={commandPaletteContext}
                    />
                )}
            </div>
        </header>
    );
}
