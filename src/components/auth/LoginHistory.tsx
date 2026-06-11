"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Button from "@/components/ui-custom/Button";
import { Loader2, MapPin } from "lucide-react";
import { parseUserAgent } from "@/lib/utils/device";
import { queryKeys } from "@/lib/query-keys";
import type { LoginHistoryEntry } from "@/lib/types/settingsTypes";

interface LoginHistoryProps {
    initialHistory?: LoginHistoryEntry[];
}

const DEFAULT_VISIBLE_ITEMS = 5;

export default function LoginHistory({ initialHistory }: LoginHistoryProps) {
    const hasInitialHistory = Array.isArray(initialHistory);
    const { data: history = initialHistory ?? [], isLoading: historyLoading } = useQuery<LoginHistoryEntry[]>({
        queryKey: queryKeys.settings.loginHistory(),
        queryFn: async () => {
            const res = await fetch("/api/v1/auth/login-history");
            if (!res.ok) throw new Error("Failed to load login history");
            const json = await res.json();
            return json?.data?.history || [];
        },
        initialData: hasInitialHistory ? initialHistory : undefined,
    });

    const loading = !hasInitialHistory && historyLoading;
    const [showAll, setShowAll] = useState(false);

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading recent activity...
            </div>
        );
    }

    if (history.length === 0) {
        return (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No recent sign-in activity is available yet.</p>
        );
    }

    const visibleHistory = history.slice(0, showAll ? 10 : DEFAULT_VISIBLE_ITEMS);

    return (
        <div className="space-y-3">
            {visibleHistory.map((entry) => {
                const { browser, os, icon: Icon } = parseUserAgent(entry.user_agent);

                return (
                    <div
                        key={entry.id}
                        className="flex items-center justify-between rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                    >
                        <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
                                <Icon className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
                            </div>
                            <div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                        {browser} on {os}
                                    </div>
                                    {entry.aal === "aal2" ? (
                                        <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                            Protected by authenticator app
                                        </span>
                                    ) : null}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                                    <span>{entry.ip_address || "IP unavailable"}</span>
                                    {entry.location ? (
                                        <>
                                            <span>•</span>
                                            <MapPin className="h-3 w-3" />
                                            <span>{entry.location}</span>
                                        </>
                                    ) : null}
                                    <span>•</span>
                                    <span>{new Date(entry.created_at).toLocaleString()}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}

            {history.length > DEFAULT_VISIBLE_ITEMS ? (
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAll((value) => !value)}
                >
                    {showAll ? "Show less" : `Show ${Math.min(history.length, 10)} recent sign-ins`}
                </Button>
            ) : null}
        </div>
    );
}
