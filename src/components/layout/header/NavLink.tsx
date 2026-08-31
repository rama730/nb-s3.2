"use client";

import Link from "next/link";
import { LucideIcon } from "lucide-react";
import { useRouteWarmPrefetch } from "@/hooks/useRouteWarmPrefetch";
import { cn } from "@/lib/utils";
import type { RealtimeHealthState } from "@/components/providers/RealtimeProvider";

interface NavLinkProps extends React.ComponentProps<typeof Link> {
    href: string;
    icon: LucideIcon;
    label: string;
    isActive: boolean;
    alertState?: boolean;
    alertCount?: number;
    connectionHealth?: RealtimeHealthState;
}

export default function NavLink({ href, icon: Icon, label, isActive, alertState, alertCount, connectionHealth, ...props }: NavLinkProps) {
    const warmPrefetchRoute = useRouteWarmPrefetch();
    const { onPointerEnter, onFocus, ...restProps } = props;

    // Use a visually hidden span for screen readers when alert state is active.
    const healthLabel = connectionHealth === "offline"
        ? "offline"
        : connectionHealth === "unavailable"
            ? "live updates unavailable"
            : connectionHealth === "reconnecting"
                ? "live updates reconnecting"
                : null;
    const ariaLabel = props["aria-label"] || `${label}${alertState
        ? `${alertCount ? ` (${alertCount} unread messages)` : " (Unread)"}`
        : ""}${healthLabel ? ` (${healthLabel})` : ""}`;

    return (
        <Link
            href={href}
            prefetch={false}
            aria-current={isActive ? "page" : undefined}
            aria-label={ariaLabel}
            onPointerEnter={(event) => {
                warmPrefetchRoute(href);
                onPointerEnter?.(event);
            }}
            onFocus={(event) => {
                warmPrefetchRoute(href);
                onFocus?.(event);
            }}
            className={`
                relative flex items-center gap-2 rounded-lg text-sm font-medium app-density-nav-item
                transition-all duration-200
                ${isActive
                    ? 'app-selected-surface'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800'
                }
            `}
            {...restProps}
        >
            <Icon
                className={cn(
                    "w-4 h-4 transition-all duration-300",
                    connectionHealth === "offline" || connectionHealth === "unavailable"
                        ? "text-rose-500 dark:text-rose-400"
                        : connectionHealth === "reconnecting"
                            ? "text-amber-500 dark:text-amber-400"
                            : alertState && !isActive
                                ? "text-rose-500 dark:text-rose-400 drop-shadow-[0_0_3px_rgba(244,63,94,0.3)]"
                                : ""
                )}
                strokeWidth={2}
            />
            <span>{label}</span>
            {alertState && isActive ? (
                <span
                    aria-hidden="true"
                    className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-rose-500 ring-2 ring-background"
                />
            ) : null}
        </Link>
    );
}
