"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Share2, SendHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useReducedMotionPreference } from "@/components/providers/theme-provider";

import PeopleClient from "@/components/people/PeopleClient";
import ConnectionsClient from "@/components/people/ConnectionsClient";
import RequestsTab from "@/components/people/RequestsTab";
import { useConnectionStats, useConnectionsRealtimeInvalidation } from "@/hooks/useConnections";
import type { IncomingApplication, MyApplication } from "@/components/people/ProjectApplicationsSection";

type TabKey = "discover" | "network" | "requests";
const VALID_TABS: TabKey[] = ["discover", "network", "requests"];

interface PeopleHubClientProps {
    initialUser: { id?: string | null } | null;
    activeTabOverride?: TabKey;
    initialApplications?: { my: MyApplication[]; incoming: IncomingApplication[] };
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
    initialApplications,
}: PeopleHubClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const reduceMotion = useReducedMotionPreference();

    const isAuthed = !!initialUser?.id;
    const tabParam = (searchParams?.get("tab") || "").toLowerCase();
    const defaultTab: TabKey = "discover";

    const getInitialTab = (): TabKey => {
        if (activeTabOverride && VALID_TABS.includes(activeTabOverride)) {
            return activeTabOverride;
        }
        if (VALID_TABS.includes(tabParam as TabKey)) {
            return tabParam as TabKey;
        }
        return defaultTab;
    };

    const [activeTab, setActiveTab] = useState<TabKey>(getInitialTab);
    useConnectionsRealtimeInvalidation();

    useEffect(() => {
        if (VALID_TABS.includes(tabParam as TabKey)) {
            setActiveTab(tabParam as TabKey);
        } else if (activeTabOverride && VALID_TABS.includes(activeTabOverride)) {
            setActiveTab(activeTabOverride);
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
        <div className="bg-zinc-50 dark:bg-black h-full min-h-0">
            {/* Sticky Tabs Header — single card with buttons */}
            <div className="sticky top-0 z-30 pt-2 pb-3">
                <div className="flex justify-center">
                    <div className="inline-flex items-center p-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm">
                        {visibleTabs.map((t) => {
                            const Icon = t.icon;
                            const selected = activeTab === t.key;
                            const badgeCount = t.key === "requests" && totalPending > 0 ? totalPending : null;

                            return (
                                <button
                                    key={t.key}
                                    onClick={() => navigateTab(t.key)}
                                    className={cn(
                                        "relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 whitespace-nowrap",
                                        selected
                                            ? "text-zinc-900 dark:text-white"
                                            : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                    )}
                                    aria-current={selected ? "page" : undefined}
                                >
                                    {selected && (
                                        <motion.div
                                            layoutId="activePeopleTab"
                                            className="absolute inset-0 bg-white dark:bg-zinc-700 rounded-xl shadow-sm ring-1 ring-zinc-200/60 dark:ring-zinc-600/40"
                                            transition={reduceMotion ? { duration: 0 } : { type: "spring", bounce: 0.2, duration: 0.6 }}
                                        />
                                    )}
                                    <span className="relative z-10 flex items-center gap-2">
                                        <Icon className={cn("w-4 h-4", selected && "text-primary")} />
                                        <span>{t.label}</span>
                                        {badgeCount && (
                                            <span className="relative ml-1 flex h-5 items-center">
                                                <span className="absolute inline-flex h-full w-full motion-safe:animate-ping motion-reduce:animate-none rounded-full bg-red-400 opacity-40" />
                                                <span className="relative inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold bg-red-500 text-white rounded-full min-w-[20px]">
                                                    {badgeCount > 9 ? "9+" : badgeCount}
                                                </span>
                                            </span>
                                        )}
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
                    <PeopleClient embedded initialUser={initialUser} />
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
