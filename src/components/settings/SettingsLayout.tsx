"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useIsFetching } from "@tanstack/react-query";
import {
  User,
  Lock,
  Bell,
  Palette,
  Shield,
  Plug,
  ChevronDown,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/lib/hooks/use-auth";
import { useToast } from "@/components/ui-custom/Toast";
import { cn } from "@/lib/utils";
import { useReducedMotionPreference } from "@/components/providers/theme-provider";
import { useRouteWarmPrefetch } from "@/hooks/useRouteWarmPrefetch";
import {
  usePrefetchSettings,
  useSettingsBootstrap,
} from "@/hooks/useSettingsQueries";
import { queryKeys } from "@/lib/query-keys";
import { logger } from "@/lib/logger";
import type { SettingsBootstrapData } from "@/lib/types/settingsTypes";
import AccountSettings from "@/components/settings/AccountSettings";
import SecuritySettings from "@/components/settings/SecuritySettings";
import PrivacySettings from "@/components/settings/PrivacySettings";
import NotificationsSettings from "@/components/settings/NotificationsSettings";
import AppearanceSettings from "@/components/settings/AppearanceSettings";
import IntegrationsSettings from "@/components/settings/IntegrationsSettings";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";

type SettingsTabId =
  | "account"
  | "security"
  | "privacy"
  | "notifications"
  | "appearance"
  | "integrations";

type SettingsItem = {
  id: SettingsTabId;
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  queryKey: readonly unknown[];
};

const settingsItems: SettingsItem[] = [
  {
    id: "account",
    title: "Account",
    href: "/settings/account",
    icon: User,
    description: "Signed-in email, local app data, and account actions",
    queryKey: queryKeys.settings.accountDeletion(),
  },
  {
    id: "security",
    title: "Security",
    href: "/settings/security",
    icon: Shield,
    description: "Sign-in methods, trusted devices, and recent activity",
    queryKey: queryKeys.settings.security(),
  },
  {
    id: "privacy",
    title: "Privacy",
    href: "/settings/privacy",
    icon: Lock,
    description: "Profile visibility, interactions, and blocked accounts",
    queryKey: queryKeys.settings.privacy(),
  },
  {
    id: "notifications",
    title: "Notifications",
    href: "/settings/notifications",
    icon: Bell,
    description: "Email and in-app preferences",
    queryKey: queryKeys.settings.notifications(),
  },
  {
    id: "appearance",
    title: "Appearance",
    href: "/settings/appearance",
    icon: Palette,
    description: "Theme, accent color, and density",
    queryKey: ["settings", "appearance-local"] as const,
  },
  {
    id: "integrations",
    title: "Integrations",
    href: "/settings/integrations",
    icon: Plug,
    description: "Account sign-in methods and connected services",
    queryKey: queryKeys.settings.integrations(),
  },
];

function resolveSettingsItem(pathname: string | null): SettingsItem {
  const normalized =
    pathname && pathname !== "/settings" ? pathname : "/settings/account";
  return (
    settingsItems.find((item) => item.href === normalized) ?? settingsItems[0]!
  );
}

function SettingsTabPanel({ activeId }: { activeId: SettingsTabId }) {
  switch (activeId) {
    case "account":
      return <AccountSettings />;
    case "security":
      return <SecuritySettings />;
    case "privacy":
      return <PrivacySettings />;
    case "notifications":
      return <NotificationsSettings />;
    case "appearance":
      return <AppearanceSettings />;
    case "integrations":
      return (
        <div className="space-y-6">
          <SettingsPageHeader
            title="Integrations"
            description="See how this account was created, which sign-in methods are attached, and which services are actively connected."
          />
          <IntegrationsSettings />
        </div>
      );
  }
}

type PendingTabMetric = {
  href: string;
  startedAt: number;
  visibleLogged: boolean;
  dataLogged: boolean;
};

export default function SettingsLayout({
  initialBootstrap,
}: {
  children: React.ReactNode;
  initialBootstrap?: SettingsBootstrapData | null;
}) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotionPreference();
  const warmPrefetchRoute = useRouteWarmPrefetch();
  const { prefetchAll, prefetchTab } = usePrefetchSettings();
  useSettingsBootstrap(initialBootstrap);
  const { signOut } = useAuth();
  const { showToast } = useToast();

  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  const [activeHref, setActiveHref] = useState(
    () => resolveSettingsItem(pathname).href,
  );
  const active = useMemo(
    () =>
      settingsItems.find((item) => item.href === activeHref) ??
      settingsItems[0]!,
    [activeHref],
  );
  const ActiveIcon = active.icon;
  const activeFetchCount = useIsFetching({ queryKey: active.queryKey });

  const [mobileOpen, setMobileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingTabMetricRef = useRef<PendingTabMetric | null>(null);

  useEffect(() => {
    const next = resolveSettingsItem(pathname);
    setActiveHref((current) => (current === next.href ? current : next.href));
  }, [pathname]);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout?: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | null = null;
    let timeoutId: number | null = null;

    const run = () => {
      prefetchAll();
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      idleId = idleWindow.requestIdleCallback(run, { timeout: 1400 });
    } else {
      timeoutId = window.setTimeout(run, 350);
    }

    return () => {
      if (
        idleId !== null &&
        typeof idleWindow.cancelIdleCallback === "function"
      ) {
        idleWindow.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [prefetchAll]);

  const warmTab = useCallback(
    (item: SettingsItem) => {
      warmPrefetchRoute(item.href);
      prefetchTab(item.id);
    },
    [prefetchTab, warmPrefetchRoute],
  );

  const activateTab = useCallback(
    (item: SettingsItem) => {
      warmTab(item);
      setActiveHref(item.href);
      setMobileOpen(false);
      pendingTabMetricRef.current = {
        href: item.href,
        startedAt: performance.now(),
        visibleLogged: false,
        dataLogged: false,
      };
      logger.metric("settings.tab.click", {
        routeId: item.href,
        path: item.href,
        action: "settings.tab.click",
      });
    },
    [warmTab],
  );

  useEffect(() => {
    const pending = pendingTabMetricRef.current;
    if (!pending || pending.href !== active.href || pending.visibleLogged)
      return;
    pending.visibleLogged = true;
    logger.metric("settings.tab.visible", {
      routeId: active.href,
      path: active.href,
      action: "settings.tab.visible",
      durationMs: Math.round(performance.now() - pending.startedAt),
    });
  }, [active.href]);

  useEffect(() => {
    const pending = pendingTabMetricRef.current;
    if (
      !pending ||
      pending.href !== active.href ||
      pending.dataLogged ||
      activeFetchCount > 0
    )
      return;
    pending.dataLogged = true;
    logger.metric("settings.tab.data_ready", {
      routeId: active.href,
      path: active.href,
      action: "settings.tab.data_ready",
      durationMs: Math.round(performance.now() - pending.startedAt),
    });
  }, [active.href, activeFetchCount]);

  // Close dropdown on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobileOpen) {
        setMobileOpen(false);
        triggerRef.current?.focus();
      }
    },
    [mobileOpen],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Focus trap for mobile dropdown
  useEffect(() => {
    if (mobileOpen && dropdownRef.current) {
      const focusableElements =
        dropdownRef.current.querySelectorAll<HTMLElement>(
          'a, button, [tabindex]:not([tabindex="-1"])',
        );
      if (focusableElements.length > 0) {
        focusableElements[0]?.focus();
      }
    }
  }, [mobileOpen]);

  return (
    <div className="h-full min-h-0 overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 h-full min-h-0">
        <div className="flex app-density-stack h-full min-h-0">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-72 flex-shrink-0 h-full app-scroll app-scroll-y">
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-950/60 backdrop-blur app-density-panel">
              <div className="px-2 py-2">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Settings
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Account & preferences
                </div>
              </div>

              <nav className="mt-2 space-y-1">
                {settingsItems.map((item) => {
                  const isActive = active.href === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onPointerEnter={() => warmTab(item)}
                      onFocus={() => warmTab(item)}
                      onClick={() => activateTab(item)}
                      className={cn(
                        "group flex items-start gap-3 rounded-xl transition-colors app-density-nav-item",
                        isActive
                          ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                          : "hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-900/50",
                      )}
                    >
                      <div
                        className={cn(
                          "mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg",
                          isActive
                            ? "bg-white/15 dark:bg-zinc-900/10"
                            : "bg-zinc-100 dark:bg-zinc-900",
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4",
                            isActive
                              ? "text-white dark:text-zinc-900"
                              : "text-zinc-600 dark:text-zinc-300",
                          )}
                        />
                      </div>

                      <div className="min-w-0">
                        <div
                          className={cn(
                            "text-sm font-medium leading-5",
                            isActive
                              ? "text-white dark:text-zinc-900"
                              : "text-zinc-900 dark:text-zinc-100",
                          )}
                        >
                          {item.title}
                        </div>
                        <div
                          className={cn(
                            "text-xs leading-4 mt-0.5",
                            isActive
                              ? "text-white/70 dark:text-zinc-600"
                              : "text-zinc-500 dark:text-zinc-400",
                          )}
                        >
                          {item.description}
                        </div>
                      </div>
                    </Link>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setShowSignOutConfirm(true)}
                  className="w-full text-left group flex items-start gap-3 rounded-xl transition-colors hover:bg-red-50 dark:hover:bg-red-950/20 app-density-nav-item mt-1"
                >
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-red-100/50 dark:bg-red-950/40">
                    <LogOut className="h-4 w-4 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-5 text-red-600 dark:text-red-400">
                      Sign out
                    </div>
                    <div className="text-xs leading-4 mt-0.5 text-red-500/80 dark:text-red-400/60">
                      Safely sign out of your account
                    </div>
                  </div>
                </button>
              </nav>
            </div>
          </aside>

          {/* Main content */}
          <div
            data-scroll-root="route"
            className="flex-1 min-w-0 h-full app-scroll app-scroll-y app-scroll-gutter"
          >
            {/* Mobile section picker */}
            <div className="lg:hidden mb-4">
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setMobileOpen((s) => !s)}
                aria-expanded={mobileOpen}
                aria-haspopup="listbox"
                className="w-full flex items-center justify-between rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 app-density-panel"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
                    <ActiveIcon className="h-4 w-4 text-zinc-700 dark:text-zinc-200" />
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {active.title}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {active.description}
                    </div>
                  </div>
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-zinc-500 transition-transform",
                    mobileOpen && "rotate-180",
                  )}
                />
              </button>

              <AnimatePresence>
                {mobileOpen && (
                  <motion.div
                    ref={dropdownRef}
                    role="listbox"
                    initial={reduceMotion ? false : { opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                    transition={
                      reduceMotion ? { duration: 0 } : { duration: 0.15 }
                    }
                    className="mt-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2"
                  >
                    {settingsItems.map((item) => {
                      const isActive = active.href === item.href;
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          role="option"
                          aria-selected={isActive}
                          onPointerEnter={() => warmTab(item)}
                          onFocus={() => warmTab(item)}
                          onClick={() => activateTab(item)}
                          className={cn(
                            "flex items-center gap-3 rounded-xl app-density-nav-item",
                            isActive
                              ? "bg-zinc-100 dark:bg-zinc-900"
                              : "hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-900/50",
                          )}
                        >
                          <div className="h-8 w-8 rounded-lg bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
                            <Icon className="h-4 w-4 text-zinc-700 dark:text-zinc-200" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              {item.title}
                            </div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                              {item.description}
                            </div>
                          </div>
                        </Link>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => {
                        setMobileOpen(false);
                        setShowSignOutConfirm(true);
                      }}
                      className="w-full text-left flex items-center gap-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/20 app-density-nav-item mt-1 animate-in fade-in slide-in-from-top-1 duration-150"
                    >
                      <div className="h-8 w-8 rounded-lg bg-red-100/50 dark:bg-red-950/40 flex items-center justify-center">
                        <LogOut className="h-4 w-4 text-red-600 dark:text-red-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-red-600 dark:text-red-400">
                          Sign out
                        </div>
                        <div className="text-xs text-red-500/80 dark:text-red-400/60 truncate">
                          Safely sign out of your account
                        </div>
                      </div>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.25, ease: "easeOut" }
              }
              className="space-y-6 pb-10"
            >
              <SettingsTabPanel activeId={active.id} />
            </motion.div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showSignOutConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSignOutConfirm(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="relative w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 shadow-xl"
            >
              <div className="flex gap-4">
                <div className="p-3 rounded-full bg-red-50 dark:bg-red-950/30 text-red-600 shrink-0 h-fit">
                  <LogOut className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                    Sign out of your account?
                  </h3>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    You will be signed out of your account on this device. Any unsaved offline modifications or local drafts might be lost. You will need to enter your credentials to log back in.
                  </p>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowSignOutConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 text-xs font-semibold transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setShowSignOutConfirm(false);
                    await signOut();
                    showToast("Signed out successfully", "info");
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors"
                >
                  Sign out
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
