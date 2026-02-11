"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, CheckCircle, XCircle, MapPin } from "lucide-react";
import { parseUserAgent } from "@/lib/utils/device";
import type { LoginHistoryEntry } from "@/lib/types/settingsTypes";

interface LoginHistoryProps {
    initialHistory?: LoginHistoryEntry[];
}

export default function LoginHistory({ initialHistory = [] }: LoginHistoryProps) {
    const [history, setHistory] = useState<LoginHistoryEntry[]>(initialHistory);
    const [loading, setLoading] = useState(!initialHistory.length);

    const loadHistory = useCallback(async () => {
        try {
            const res = await fetch("/api/v1/auth/login-history");
            const json = await res.json();
            if (json.success) {
                setHistory(json.data.history || []);
            }
        } catch (error) {
            console.error("Failed to load login history:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!initialHistory.length) {
            void loadHistory();
        }
    }, [initialHistory.length, loadHistory]);

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading login history...
            </div>
        );
    }

    if (history.length === 0) {
        return (
            <p className="text-sm text-zinc-500">No login history available.</p>
        );
    }

    return (
        <div className="space-y-2">
            {history.slice(0, 10).map((entry) => {
                const { browser, os, icon: Icon } = parseUserAgent(entry.user_agent);

                return (
                    <div
                        key={entry.id}
                        className="flex items-center justify-between p-3 rounded-lg border border-zinc-200 dark:border-zinc-800"
                    >
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                                <Icon className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">
                                        {browser} on {os}
                                    </span>
                                    {entry.success ? (
                                        <CheckCircle className="h-3 w-3 text-green-500" />
                                    ) : (
                                        <XCircle className="h-3 w-3 text-red-500" />
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-zinc-500">
                                    <span>{entry.ip_address}</span>
                                    {entry.location && (
                                        <>
                                            <MapPin className="h-3 w-3" />
                                            <span>{entry.location}</span>
                                        </>
                                    )}
                                    <span>•</span>
                                    <span>{new Date(entry.created_at).toLocaleString()}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
