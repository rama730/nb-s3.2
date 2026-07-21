"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Share2, SendHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeSearchQuery } from "@/lib/search/query";

import PeopleClient from "@/components/people/PeopleClient";
import ConnectionsClient from "@/components/people/ConnectionsClient";
import RequestsTab from "@/components/people/RequestsTab";
import { ComponentErrorBoundary } from "@/components/ui/ComponentErrorBoundary";
import type { IncomingApplication, MyApplication } from "@/components/people/ProjectApplicationsSection";

type TabKey = "discover" | "network" | "requests";

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

    return (
        <div className="bg-zinc-50 dark:bg-black h-full min-h-0">
            {/* Sticky Tabs Header — single card with buttons */}
            <div className="sticky top-0 z-30 pt-2 pb-3">
                <div className="flex justify-center">
                    <div className="inline-flex items-center p-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm" role="tablist" aria-label="People sections">
                        {visibleTabs.map((t) => {
                            const Icon = t.icon;
                            const selected = activeTab === t.key;

                            return (
                                <button
                                    key={t.key}
                                    type="button"
                                    onClick={() => navigateTab(t.key)}
                                    role="tab"
                                    aria-selected={selected}
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
                                        <Icon className={cn("w-4 h-4", selected && "text-primary")} />
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
