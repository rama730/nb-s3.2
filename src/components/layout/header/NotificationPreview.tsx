"use client";

import Link from "next/link";
import { Bell, Clock3, Settings } from "lucide-react";

import { NotificationList } from "@/components/notifications/NotificationList";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROUTES } from "@/constants/routes";
import type {
    NotificationItem,
    NotificationMuteScope,
    NotificationTrayFilter,
} from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

const FILTERS: Array<{ id: NotificationTrayFilter; label: string }> = [
    { id: "unread", label: "Unread" },
    { id: "all", label: "All" },
];

function pauseUntil(hours: number) {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

type NotificationPreviewProps = {
    unreadCount: number;
    unreadImportantCount: number;
    items: NotificationItem[];
    activeFilter: NotificationTrayFilter;
    isOpen: boolean;
    isLoading: boolean;
    hasMore: boolean;
    isLoadingMore: boolean;
    isRealtimeHealthy: boolean;
    onOpenChange: (open: boolean) => void;
    onFilterChange: (filter: NotificationTrayFilter) => void;
    onOpenItem: (item: NotificationItem) => Promise<unknown>;
    onMarkRead: (notificationId: string) => Promise<unknown>;
    onMarkUnread: (notificationId: string) => Promise<unknown>;
    onMarkAllRead: () => Promise<unknown>;
    onDismiss: (notificationId: string) => Promise<unknown>;
    onMuteScope: (scope: NotificationMuteScope) => Promise<unknown>;
    onPause: (pausedUntil: string | null) => Promise<unknown>;
    onSnooze: (notificationId: string, snoozedUntil: string) => Promise<unknown>;
    onLoadMore: () => Promise<unknown>;
};

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
        isRealtimeHealthy,
        onOpenChange,
        onFilterChange,
        onOpenItem,
        onMarkRead,
        onMarkUnread,
        onMarkAllRead,
        onDismiss,
        onMuteScope,
        onPause,
        onSnooze,
        onLoadMore,
    } = props;

    const label =
        unreadImportantCount > 0
            ? `Open notifications, ${unreadImportantCount} important, ${unreadCount} unread total`
            : unreadCount > 0
                ? `Open notifications, ${unreadCount} unread`
                : "Open notifications";

    const handleToggleRead = async (item: NotificationItem) => {
        if (item.readAt) {
            await onMarkUnread(item.id);
        } else {
            await onMarkRead(item.id);
        }
    };

    return (
        <DropdownMenu modal={false} open={isOpen} onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild>
                <button
                    aria-label={isRealtimeHealthy ? label : `${label} (realtime reconnecting)`}
                    className="relative rounded-lg p-2 transition-colors hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                >
                    <Bell className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
                    {unreadImportantCount > 0 ? (
                        <span className="absolute right-1 top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                            {unreadImportantCount > 9 ? "9+" : unreadImportantCount}
                        </span>
                    ) : unreadCount > 0 ? (
                        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                    ) : null}
                    {!isRealtimeHealthy ? (
                        <span
                            aria-hidden
                            title="Realtime reconnecting"
                            className="absolute bottom-1 right-1 h-2 w-2 animate-pulse rounded-full bg-amber-500 ring-2 ring-white dark:ring-zinc-900"
                        />
                    ) : null}
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                sideOffset={10}
                className="mr-2 flex h-[calc(100vh-var(--ui-topnav-height)-1rem)] w-[calc(100vw-1rem)] max-w-[30rem] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-0 shadow-2xl md:mr-0 md:h-auto md:max-h-[42rem] dark:border-zinc-800 dark:bg-zinc-950"
            >
                <div role="status" aria-live="polite" className="sr-only">
                    {unreadImportantCount > 0
                        ? `${unreadImportantCount} important, ${unreadCount} unread total`
                        : unreadCount > 0
                            ? `${unreadCount} unread`
                            : "No unread notifications"}
                </div>
                <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h3 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Notifications</h3>
                            {!isRealtimeHealthy ? (
                                <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                                    Realtime updates are reconnecting.
                                </p>
                            ) : null}
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void onMarkAllRead()}
                                disabled={unreadCount === 0}
                            >
                                Mark all read
                            </Button>
                            <DropdownMenu modal={false}>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        type="button"
                                        className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                                        aria-label="Pause notification delivery"
                                    >
                                        <Clock3 className="h-4 w-4" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                    <DropdownMenuItem onClick={() => void onPause(pauseUntil(1))}>
                                        Pause for 1 hour
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => void onPause(pauseUntil(8))}>
                                        Pause for 8 hours
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => void onPause(pauseUntil(24))}>
                                        Pause until tomorrow
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => void onPause(null)}>
                                        Resume notifications
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Link
                                href={`${ROUTES.SETTINGS}/notifications`}
                                className="rounded-md p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                                aria-label="Notification settings"
                            >
                                <Settings className="h-4 w-4" />
                            </Link>
                        </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900">
                        {FILTERS.map((filter) => (
                            <button
                                key={filter.id}
                                type="button"
                                aria-pressed={activeFilter === filter.id}
                                onClick={() => onFilterChange(filter.id)}
                                className={cn(
                                    "min-h-10 rounded-lg px-3 py-2 text-xs font-semibold transition-colors sm:min-h-0 sm:py-1.5",
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
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {isLoading ? (
                        <div className="space-y-3 px-4 py-6">
                            {[0, 1, 2].map((index) => (
                                <div key={index} className="flex gap-3">
                                    <div className="h-10 w-10 rounded-full bg-zinc-100 dark:bg-zinc-900" />
                                    <div className="flex-1 space-y-2">
                                        <div className="h-3 w-3/4 rounded bg-zinc-100 dark:bg-zinc-900" />
                                        <div className="h-3 w-1/2 rounded bg-zinc-100 dark:bg-zinc-900" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <NotificationList
                            items={items}
                            filter={activeFilter}
                            onOpen={onOpenItem}
                            onToggleRead={handleToggleRead}
                            onDismiss={(item) => onDismiss(item.id)}
                            onMuteScope={(_item, scope) => onMuteScope(scope)}
                            onSnooze={(item, snoozedUntil) => onSnooze(item.id, snoozedUntil)}
                            hasMore={hasMore}
                            isLoadingMore={isLoadingMore}
                            onLoadMore={onLoadMore}
                            emptyState={
                                activeFilter === "unread"
                                    ? "Nothing new needs you right now. Nice."
                                    : "No notifications yet."
                            }
                        />
                    )}
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
