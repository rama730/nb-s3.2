"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Share2, SendHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeSearchQuery } from "@/lib/search/query";

import { ComponentErrorBoundary } from "@/components/ui/ComponentErrorBoundary";
import type { IncomingApplication, MyApplication } from "@/components/people/ProjectApplicationsSection";
import { usePeopleNotifications } from "@/hooks/usePeopleNotifications";

type TabKey = "discover" | "network" | "requests";

const TabLoading = () => <div className="min-h-[400px] animate-pulse rounded-2xl bg-zinc-200/50 dark:bg-zinc-800/50" />;
// ponytail: only compile and hydrate the selected People surface.
const loadPeopleClient = () => import("@/components/people/PeopleClient");
const loadConnectionsClient = () => import("@/components/people/ConnectionsClient");
const loadRequestsTab = () => import("@/components/people/RequestsTab");
const PeopleClient = dynamic(loadPeopleClient, { ssr: false, loading: TabLoading });
const ConnectionsClient = dynamic(loadConnectionsClient, { ssr: false, loading: TabLoading });
const RequestsTab = dynamic(loadRequestsTab, { ssr: false, loading: TabLoading });

const preloadTab = (tab: TabKey) => {
    if (tab === "discover") void loadPeopleClient();
    else if (tab === "network") void loadConnectionsClient();
    else void loadRequestsTab();
};

interface PeopleHubClientProps {
    initialUser: { id?: string | null } | null;
    initialApplications?: { my: MyApplication[]; incoming: IncomingApplication[] };
}

const TAB_CONFIG: Array<{
    key: TabKey;
    label: string;
    icon: typeof Sparkles;
    requiresAuth: boolean;
}> = [
        { key: "discover", label: "Discover", icon: Sparkles, requiresAuth: false },
        { key: "network", label: "Network", icon: Share2, requiresAuth: true },
        { key: "requests", label: "Requests", icon: SendHorizontal, requiresAuth: true },
    ];

export default function PeopleHubClient({
    initialUser,
    initialApplications,
}: PeopleHubClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { totalPending } = usePeopleNotifications();

    const isAuthed = !!initialUser?.id;
    const tabParam = (searchParams?.get("tab") || "").toLowerCase();
    const routeQuery = normalizeSearchQuery(searchParams?.get("q"));
    const defaultTab: TabKey = "discover";

    const getInitialTab = (): TabKey => {
        if (TAB_CONFIG.some((tab) => tab.key === tabParam)) {
            return tabParam as TabKey;
        }
        return defaultTab;
    };

    const activeTab = getInitialTab();

    const visibleTabs = useMemo(
        () => TAB_CONFIG.filter((t) => (t.requiresAuth ? isAuthed : true)),
        [isAuthed]
    );

    function navigateTab(next: TabKey) {
        if (next === activeTab) return;
        const params = new URLSearchParams(searchParams?.toString() || "");
        params.set("tab", next);
        if (next === "requests") {
            params.delete("q");
        }
        router.push(`/people?${params.toString()}`);
    }

    function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const nextIndex = event.key === "Home"
            ? 0
            : event.key === "End"
                ? visibleTabs.length - 1
                : (index + (event.key === "ArrowRight" ? 1 : -1) + visibleTabs.length) % visibleTabs.length;
        const next = visibleTabs[nextIndex];
        if (!next) return;
        preloadTab(next.key);
        navigateTab(next.key);
        document.getElementById(`people-tab-${next.key}`)?.focus();
    }

    return (
        <div className="bg-zinc-50 dark:bg-black h-full min-h-0">
            {/* Sticky Tabs Header — single card with buttons */}
            <div className="sticky top-0 z-30 pt-2 pb-3">
                <div className="flex justify-center">
                    <div className="inline-flex items-center p-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm" role="tablist" aria-label="People sections">
                        {visibleTabs.map((t, index) => {
                            const Icon = t.icon;
                            const selected = activeTab === t.key;
                            const isRequestsAlert = t.key === "requests" && totalPending > 0 && !selected;

                            return (
                                <button
                                    key={t.key}
                                    id={`people-tab-${t.key}`}
                                    type="button"
                                    onClick={() => navigateTab(t.key)}
                                    onMouseEnter={() => preloadTab(t.key)}
                                    onFocus={() => preloadTab(t.key)}
                                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                                    role="tab"
                                    aria-selected={selected}
                                    tabIndex={selected ? 0 : -1}
                                    className={cn(
                                        "relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 whitespace-nowrap",
                                        selected
                                            ? "text-zinc-900 dark:text-white"
                                            : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                    )}
                                    aria-current={selected ? "page" : undefined}
                                >
                                    {selected && (
                                        <span className="absolute inset-0 rounded-xl bg-white shadow-sm ring-1 ring-zinc-200/60 transition-colors dark:bg-zinc-700 dark:ring-zinc-600/40" />
                                    )}
                                    <span className="relative z-10 flex items-center gap-2">
                                        <Icon className={cn(
                                            "w-4 h-4 transition-colors duration-300",
                                            selected ? "text-primary" : "",
                                            isRequestsAlert ? "text-rose-500 dark:text-rose-400 drop-shadow-[0_0_3px_rgba(244,63,94,0.3)]" : ""
                                        )} />
                                        <span>{t.label}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                {activeTab === "discover" && (
                    <ComponentErrorBoundary fallbackMessage="Failed to load discover tab.">
                        <PeopleClient
                            initialUser={initialUser}
                            searchQuery={routeQuery}
                        />
                    </ComponentErrorBoundary>
                )}

                {activeTab === "network" && (
                    <ComponentErrorBoundary fallbackMessage="Failed to load network tab.">
                        <ConnectionsClient
                            searchQuery={routeQuery}
                        />
                    </ComponentErrorBoundary>
                )}

                {activeTab === "requests" && (
                    <ComponentErrorBoundary fallbackMessage="Failed to load requests tab.">
                        <RequestsTab
                            initialUser={initialUser}
                            initialApplications={initialApplications}
                        />
                    </ComponentErrorBoundary>
                )}
            </div>
        </div>
    );
}
