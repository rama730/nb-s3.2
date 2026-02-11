"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Share2, SendHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

import PeopleClient from "@/components/people/PeopleClient";
import ConnectionsClient from "@/components/people/ConnectionsClient";
import RequestsTab from "@/components/people/RequestsTab";
import { useConnectionStats, useConnectionsRealtimeInvalidation } from "@/hooks/useConnections";

type TabKey = "discover" | "network" | "requests";

interface PeopleHubClientProps {
    initialUser: any;
    activeTabOverride?: string;
    // Data props - Made optional/legacy
    initialProfiles?: any[];
    connectionStats?: any;
    initialApplications?: { my: any[], incoming: any[] };
}

const TAB_CONFIG: Array<{
    key: TabKey;
    label: string;
    hint: string;
    icon: typeof Sparkles;
    requiresAuth: boolean;
}> = [
        { key: "discover", label: "Discover", hint: "Find new people", icon: Sparkles, requiresAuth: false },
        { key: "network", label: "Network", hint: "Your connections", icon: Share2, requiresAuth: true },
        { key: "requests", label: "Requests", hint: "Pending actions", icon: SendHorizontal, requiresAuth: true },
    ];

export default function PeopleHubClient({
    initialUser,
    activeTabOverride,
    initialProfiles,
    initialApplications,
}: PeopleHubClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const isAuthed = !!initialUser?.id;
    const tabParam = (searchParams?.get("tab") || "").toLowerCase();
    const defaultTab: TabKey = "discover";

    const getInitialTab = (): TabKey => {
        if (activeTabOverride && ["discover", "network", "requests"].includes(activeTabOverride)) {
            return activeTabOverride as TabKey;
        }
        if (["discover", "network", "requests"].includes(tabParam)) {
            return tabParam as TabKey;
        }
        return defaultTab;
    };

    const [activeTab, setActiveTab] = useState<TabKey>(getInitialTab);
    useConnectionsRealtimeInvalidation();

    useEffect(() => {
        const validTabs: TabKey[] = ["discover", "network", "requests"];
        if (validTabs.includes(tabParam as TabKey)) {
            setActiveTab(tabParam as TabKey);
        } else if (activeTabOverride && validTabs.includes(activeTabOverride as TabKey)) {
            setActiveTab(activeTabOverride as TabKey);
        }
    }, [tabParam, activeTabOverride]);

    const { data: connectionStats } = useConnectionStats();
    const totalPending = Number(connectionStats?.pendingIncoming || 0);

    const visibleTabs = useMemo(
        () => TAB_CONFIG.filter((t) => (t.requiresAuth ? isAuthed : true)),
        [isAuthed]
    );

    function navigateTab(next: TabKey) {
        if (next === activeTab) return;
        const params = new URLSearchParams(searchParams?.toString() || "");
        params.set("tab", next);
        router.push(`/people?${params.toString()}`);
    }

    return (
        <div className="bg-zinc-50 dark:bg-black min-h-screen">
            {/* Sticky Tabs Bar - Minimal */}
            <div className="sticky top-16 z-30 bg-zinc-50 dark:bg-black border-b border-zinc-200 dark:border-zinc-800">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1.5">
                    <div className="inline-flex items-center p-0.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm">
                        {visibleTabs.map((t) => {
                            const Icon = t.icon;
                            const selected = activeTab === t.key;
                            const badgeCount = t.key === "requests" && totalPending > 0 ? totalPending : null;

                            return (
                                <button
                                    key={t.key}
                                    onClick={() => navigateTab(t.key)}
                                    className={cn(
                                        "relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 whitespace-nowrap group",
                                        selected
                                            ? "text-zinc-900 dark:text-white"
                                            : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                    )}
                                    aria-current={selected ? "page" : undefined}
                                >
                                    {selected && (
                                        <motion.div
                                            layoutId="activePeopleTab"
                                            className="absolute inset-0 bg-zinc-100 dark:bg-zinc-800 rounded-xl shadow-sm"
                                            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                                        />
                                    )}
                                    <span className="relative z-10 flex items-center gap-2">
                                        <Icon className="w-4 h-4" />
                                        <span>{t.label}</span>
                                        {badgeCount && (
                                            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-red-500 text-white rounded-full">
                                                {badgeCount > 9 ? "9+" : badgeCount}
                                            </span>
                                        )}
                                    </span>
                                    {selected && (
                                        <span className="relative z-10 text-xs text-zinc-500 dark:text-zinc-400 hidden sm:inline ml-1">
                                            {t.hint}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                {activeTab === "discover" && (
                    <PeopleClient embedded initialUser={initialUser} initialProfiles={initialProfiles} />
                )}

                {activeTab === "network" && (
                     <ConnectionsClient embedded initialUser={initialUser} />
                )}

                {activeTab === "requests" && (
                    <RequestsTab 
                        initialUser={initialUser} 
                        initialApplications={initialApplications}
                    />
                )}
            </div>
        </div>
    );
}
