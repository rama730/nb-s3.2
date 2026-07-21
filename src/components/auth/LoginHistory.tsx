"use client";

import { MapPin } from "lucide-react";
import { parseUserAgent } from "@/lib/utils/device";
import type { LoginHistoryEntry } from "@/lib/types/settingsTypes";
import { SecurityListRow } from "@/components/settings/ui/SecurityListRow";
import { formatDateTime } from "@/lib/ui/date-formatting";

interface LoginHistoryProps {
    initialHistory?: LoginHistoryEntry[];
}

export default function LoginHistory({ initialHistory = [] }: LoginHistoryProps) {
    const history = initialHistory.slice(0, 10);

    if (history.length === 0) {
        return (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No recent sign-in activity is available yet.</p>
        );
    }

    return (
        <div className="space-y-3">
            {history.map((entry) => {
                const { browser, os, icon: Icon } = parseUserAgent(entry.user_agent);

                return <SecurityListRow
                    key={entry.id}
                    icon={Icon}
                    title={`${browser} on ${os}`}
                    badges={entry.aal === "aal2" ? (
                                        <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                            Protected by authenticator app
                                        </span>
                                    ) : null}
                    details={<>
                        <span>{entry.ip_address || "IP unavailable"}</span>
                                    {entry.location ? (
                                        <>
                                            <span>•</span>
                                            <MapPin className="h-3 w-3" />
                                            <span>{entry.location}</span>
                                        </>
                                    ) : null}
                                    <span>•</span>
                        <span>{formatDateTime(entry.created_at)}</span>
                    </>}
                />;
            })}
        </div>
    );
}
