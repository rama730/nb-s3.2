"use client";

import Link from "next/link";
import { Bell, Settings } from "lucide-react";

import { NotificationList } from "@/components/notifications/NotificationList";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { settingsTabHref } from "@/constants/routes";
import type {
    NotificationItem,
    NotificationMuteScope,
    NotificationTrayFilter,
} from "@/lib/notifications/types";
import { cn } from "@/lib/utils";
import type { RealtimeHealthState } from "@/components/providers/RealtimeProvider";

const FILTERS: Array<{ id: NotificationTrayFilter; label: string }> = [
    { id: "unread", label: "New" },
    { id: "all", label: "All" },
];

type NotificationPreviewProps = {
    unreadCount: number;
    unreadImportantCount: number;
    items: NotificationItem[];
    activeFilter: NotificationTrayFilter;
    isOpen: boolean;
    isLoading: boolean;
    hasMore: boolean;
    isLoadingMore: boolean;
    connectionHealth: RealtimeHealthState;
    onOpenChange: (open: boolean) => void;
    onFilterChange: (filter: NotificationTrayFilter) => void;
    onOpenItem: (item: NotificationItem) => Promise<unknown>;
    onItemsViewed: (notificationIds: string[]) => void;
    onMarkUnread: (notificationId: string) => Promise<unknown>;
    onDismiss: (notificationId: string) => Promise<unknown>;
    onMuteScope: (scope: NotificationMuteScope) => Promise<unknown>;
    onSnooze: (notificationId: string, snoozedUntil: string) => Promise<unknown>;
    onLoadMore: () => Promise<unknown>;
};

function NotificationSkeleton() {
    return (
        <div className="space-y-1 px-2 py-2" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
                <div key={index} className="flex gap-3 rounded-xl px-3 py-3">
                    <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-zinc-200/80 motion-reduce:animate-none dark:bg-zinc-800" />
                    <div className="min-w-0 flex-1 space-y-2 pt-1">
                        <div className="h-3.5 w-4/5 animate-pulse rounded-full bg-zinc-200/80 motion-reduce:animate-none dark:bg-zinc-800" />
                        <div className="h-3 w-3/5 animate-pulse rounded-full bg-zinc-100 motion-reduce:animate-none dark:bg-zinc-900" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function NotificationPreview(props: NotificationPreviewProps) {
    const {
        unreadCount,
        unreadImportantCount,
        items,
        activeFilter,
        isOpen,
        isLoading,
        hasMore,
        isLoadingMore,
        connectionHealth,
        onOpenChange,
        onFilterChange,
        onOpenItem,
        onItemsViewed,
        onMarkUnread,
        onDismiss,
        onMuteScope,
        onSnooze,
        onLoadMore,
    } = props;

    const isRealtimeHealthy = connectionHealth === "healthy";
    const connectionNotice = connectionHealth === "offline"
        ? "You are offline. Live updates will resume when the connection returns."
        : connectionHealth === "unavailable"
            ? "Live updates are unavailable."
            : "Live updates are reconnecting.";
    const label = unreadImportantCount > 0
        ? `Open notifications, ${unreadImportantCount} need attention, ${unreadCount} new total`
        : unreadCount > 0
            ? `Open notifications, ${unreadCount} new`
            : "Open notifications";

    return (
        <DropdownMenu modal={false} open={isOpen} onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={isRealtimeHealthy ? label : `${label} (${connectionNotice})`}
                    className="group relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-zinc-600 transition-[background-color,border-color,color,transform,box-shadow] duration-150 hover:bg-zinc-100 hover:text-zinc-950 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 data-[state=open]:border-blue-500/25 data-[state=open]:bg-blue-500/10 data-[state=open]:text-blue-700 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100 dark:focus-visible:ring-offset-zinc-950 dark:data-[state=open]:border-blue-400/30 dark:data-[state=open]:bg-blue-400/15 dark:data-[state=open]:text-blue-300"
                >
                    <Bell className="h-5 w-5" aria-hidden="true" />
                    {unreadImportantCount > 0 ? (
                        <span className="absolute right-0.5 top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white ring-2 ring-white dark:ring-zinc-950">
                            {unreadImportantCount > 9 ? "9+" : unreadImportantCount}
                        </span>
                    ) : unreadCount > 0 ? (
                        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-white dark:ring-zinc-950" />
                    ) : null}
                    {!isRealtimeHealthy ? (
                        <span
                            aria-hidden
                            title={connectionNotice}
                            className={cn(
                                "absolute bottom-1 right-1 h-2 w-2 rounded-full ring-2 ring-white dark:ring-zinc-950",
                                connectionHealth === "reconnecting" ? "animate-pulse bg-amber-500" : "bg-rose-500",
                            )}
                        />
                    ) : null}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                sideOffset={10}
                className="mr-2 flex w-[min(26rem,calc(100vw-2rem))] max-w-[26rem] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-0 shadow-2xl shadow-zinc-950/15 md:mr-0 dark:border-zinc-800 dark:bg-zinc-950"
                style={{ maxHeight: "min(40rem, calc(100dvh - var(--ui-topnav-height) - 1rem))" }}
            >
                <div role="status" aria-live="polite" className="sr-only">
                    {unreadCount > 0 ? `${unreadCount} new notifications` : "No new notifications"}
                </div>
                <div className="shrink-0 border-b border-zinc-200 px-4 py-3.5 dark:border-zinc-800">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <div className="flex items-baseline gap-2">
                                <h3 className="text-base font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Notifications</h3>
                                {unreadCount > 0 ? (
                                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{unreadCount} new</span>
                                ) : null}
                            </div>
                            {!isRealtimeHealthy ? (
                                <p className={cn(
                                    "mt-1 text-xs",
                                    connectionHealth === "reconnecting" ? "text-amber-700 dark:text-amber-300" : "text-rose-700 dark:text-rose-300",
                                )}>{connectionNotice}</p>
                            ) : null}
                        </div>
                        <Link
                            href={settingsTabHref("notifications")}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                            aria-label="Notification settings"
                        >
                            <Settings className="h-4 w-4" />
                        </Link>
                    </div>
                    <div className="mt-3 grid grid-cols-2 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900" role="tablist" aria-label="Notification filter">
                        {FILTERS.map((filter) => (
                            <button
                                key={filter.id}
                                type="button"
                                role="tab"
                                id={`notifications-filter-${filter.id}`}
                                aria-selected={activeFilter === filter.id}
                                aria-controls="notifications-filter-panel"
                                onClick={() => onFilterChange(filter.id)}
                                className={cn(
                                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                                    activeFilter === filter.id
                                        ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                                        : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200",
                                )}
                            >
                                {filter.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div id="notifications-filter-panel" role="tabpanel" aria-labelledby={`notifications-filter-${activeFilter}`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {isLoading ? (
                        <NotificationSkeleton />
                    ) : (
                        <NotificationList
                            items={items}
                            filter={activeFilter}
                            onOpen={onOpenItem}
                            onViewed={onItemsViewed}
                            onMarkUnread={(item) => onMarkUnread(item.id)}
                            onDismiss={(item) => onDismiss(item.id)}
                            onMuteScope={(_item, scope) => onMuteScope(scope)}
                            onSnooze={(item, snoozedUntil) => onSnooze(item.id, snoozedUntil)}
                            hasMore={hasMore}
                            isLoadingMore={isLoadingMore}
                            onLoadMore={onLoadMore}
                            emptyState={activeFilter === "unread" ? "Nothing new needs you right now." : "No notifications yet."}
                        />
                    )}
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
