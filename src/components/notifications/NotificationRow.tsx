"use client";

import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { BellOff, Clock, ExternalLink, EyeOff, MoreVertical } from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    buildNotificationMuteScopes,
    formatAbsoluteTimestamp,
    getAggregateLabel,
    getNotificationReasonLabel,
} from "@/lib/notifications/presentation";
import type { NotificationItem, NotificationMuteScope } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

function getInitial(label: string | null | undefined) {
    const value = (label || "").trim();
    return value ? value.charAt(0).toUpperCase() : "N";
}

function formatRelativeTimestamp(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return formatDistanceToNow(date, { addSuffix: true });
}

function snoozePresets() {
    const now = new Date();
    const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
    const tomorrowMorning = new Date(now);
    tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
    tomorrowMorning.setHours(9, 0, 0, 0);
    const nextMondayMorning = new Date(now);
    const daysUntilMonday = ((8 - nextMondayMorning.getDay()) % 7) || 7;
    nextMondayMorning.setDate(nextMondayMorning.getDate() + daysUntilMonday);
    nextMondayMorning.setHours(9, 0, 0, 0);
    return [
        { label: "Snooze 1 hour", until: inOneHour },
        { label: "Snooze until tomorrow", until: tomorrowMorning },
        { label: "Snooze until next week", until: nextMondayMorning },
    ];
}

export function NotificationRow(props: {
    item: NotificationItem;
    onOpen: (item: NotificationItem) => void | Promise<unknown>;
    onToggleRead: (item: NotificationItem) => void | Promise<unknown>;
    onDismiss: (item: NotificationItem) => void | Promise<unknown>;
    onMuteScope: (item: NotificationItem, scope: NotificationMuteScope) => void | Promise<unknown>;
    onSnooze?: (item: NotificationItem, snoozedUntil: string) => void | Promise<unknown>;
}) {
    const { item, onOpen, onToggleRead, onDismiss, onMuteScope, onSnooze } = props;
    const [destinationMissing, setDestinationMissing] = useState(false);
    const preview = item.preview;
    const actorName = preview?.actorName ?? "Notification";
    const relativeTime = formatRelativeTimestamp(item.updatedAt) ?? "Just now";
    const absoluteTime = formatAbsoluteTimestamp(item.updatedAt);
    const aggregateLabel = getAggregateLabel(item.kind, item.aggregateCount);
    const muteScopes = useMemo(() => buildNotificationMuteScopes(item), [item]);
    const reasonLabel = getNotificationReasonLabel(item.reason);
    const isUnread = !item.readAt;
    const isJ1 = item.importance === "important";

    const handleOpen = async () => {
        if (!item.href) {
            setDestinationMissing(true);
            return;
        }
        setDestinationMissing(false);
        const opened = await onOpen(item);
        if (opened === false) {
            setDestinationMissing(true);
        }
    };

    return (
        <div
            data-notification-row
            data-notification-id={item.id}
            className={cn(
                "group relative flex items-start gap-3 px-4 py-3 outline-none transition-colors focus-within:ring-2 focus-within:ring-blue-500/40",
                isUnread
                    ? "bg-blue-500/5 hover:bg-blue-500/10 dark:bg-blue-500/10 dark:hover:bg-blue-500/15"
                    : "bg-transparent hover:bg-zinc-50 dark:hover:bg-zinc-900/70",
            )}
        >
            {isUnread ? (
                <span
                    aria-hidden
                    className={cn(
                        "absolute left-0 top-0 h-full w-1",
                        isJ1 ? "bg-red-500" : "bg-blue-500",
                    )}
                />
            ) : null}
            <button
                type="button"
                onClick={() => void handleOpen()}
                aria-label={`${isUnread ? "Unread" : "Read"} ${reasonLabel}: ${item.title}${relativeTime ? `, ${relativeTime}` : ""}`}
                className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
                <div className="relative mt-0.5 shrink-0">
                    {preview?.actorAvatarUrl ? (
                        <img
                            src={preview.actorAvatarUrl}
                            alt={actorName}
                            className="h-10 w-10 rounded-full object-cover"
                        />
                    ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                            {getInitial(actorName)}
                        </div>
                    )}
                    {!item.readAt ? (
                        <span className="absolute -left-1 top-3 h-2.5 w-2.5 rounded-full bg-blue-500 ring-2 ring-white dark:ring-zinc-950" />
                    ) : null}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                                    {reasonLabel}
                                </span>
                                {preview?.contextLabel ? (
                                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                                        {preview.contextLabel}
                                    </span>
                                ) : null}
                            </div>
                            <p className="line-clamp-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                                {item.title}
                            </p>
                            {item.body ? (
                                <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                                    {item.body}
                                </p>
                            ) : null}
                            {destinationMissing ? (
                                <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                                    No destination available for this notification.
                                </p>
                            ) : null}
                        </div>
                        {preview?.thumbnailUrl ? (
                            <img
                                src={preview.thumbnailUrl}
                                alt=""
                                className="hidden h-12 w-20 rounded-md object-cover md:block"
                            />
                        ) : null}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {preview?.secondaryText ? <span>{preview.secondaryText}</span> : null}
                        <span title={absoluteTime ?? undefined}>{relativeTime}</span>
                        {aggregateLabel ? <span>{aggregateLabel}</span> : null}
                    </div>
                </div>
            </button>

            <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        className="rounded-md p-1.5 text-zinc-500 opacity-100 transition-opacity hover:bg-zinc-100 hover:text-zinc-700 md:opacity-0 md:group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        aria-label="Notification actions"
                    >
                        <MoreVertical className="h-4 w-4" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => void handleOpen()} disabled={!item.href}>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Open
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void onToggleRead(item)}>
                        {item.readAt ? "Mark as unread" : "Mark as read"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void onDismiss(item)}>
                        <EyeOff className="mr-2 h-4 w-4" />
                        Dismiss
                    </DropdownMenuItem>
                    {onSnooze ? (
                        <>
                            <DropdownMenuSeparator />
                            {snoozePresets().map((preset) => (
                                <DropdownMenuItem
                                    key={preset.label}
                                    onClick={() => void onSnooze(item, preset.until.toISOString())}
                                >
                                    <Clock className="mr-2 h-4 w-4" />
                                    {preset.label}
                                </DropdownMenuItem>
                            ))}
                        </>
                    ) : null}
                    <DropdownMenuSeparator />
                    {muteScopes.slice(0, 3).map((scope) => (
                        <DropdownMenuItem
                            key={`${scope.kind}:${scope.value}`}
                            onClick={() => void onMuteScope(item, scope)}
                        >
                            <BellOff className="mr-2 h-4 w-4" />
                            {scope.kind === "notification_type" ? `Turn off ${reasonLabel}` : `Mute ${scope.label ?? scope.kind}`}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
