"use client";

import { RefreshCw, WifiOff } from "lucide-react";

import { useRealtime } from "@/components/providers/RealtimeProvider";
import { cn } from "@/lib/utils";

export function ConnectionStatusIndicator() {
    const { connectionHealth, retryRealtime } = useRealtime();

    if (connectionHealth === "healthy") return null;

    const isOffline = connectionHealth === "offline";
    const isUnavailable = connectionHealth === "unavailable";
    const label = isOffline
        ? "You are offline. Live updates will resume when the connection returns."
        : isUnavailable
            ? "Live updates are unavailable. Retry connection."
            : "Live updates are reconnecting. Retry connection.";

    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            disabled={isOffline}
            onClick={retryRealtime}
            className={cn(
                "inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed",
                isOffline || isUnavailable
                    ? "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                    : "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
        >
            {isOffline || isUnavailable ? (
                <WifiOff className="h-4 w-4" aria-hidden="true" />
            ) : (
                <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            )}
        </button>
    );
}
