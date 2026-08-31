"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { projectUpdateDisplayText } from "@/lib/projects/updates";
import { cn } from "@/lib/utils";

const QUALIFIED_VIEW_MS = 750;
const FOCUS_VIEW_MS = 500;

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
    onViewed: (notificationIds: string[]) => void;
    onMarkUnread: (item: NotificationItem) => void | Promise<unknown>;
    onDismiss: (item: NotificationItem) => void | Promise<unknown>;
    onMuteScope: (item: NotificationItem, scope: NotificationMuteScope) => void | Promise<unknown>;
    onSnooze?: (item: NotificationItem, snoozedUntil: string) => void | Promise<unknown>;
}) {
    const { item, onOpen, onViewed, onMarkUnread, onDismiss, onMuteScope, onSnooze } = props;
    const [destinationMissing, setDestinationMissing] = useState(false);
    const [avatarFailed, setAvatarFailed] = useState(false);
    const rowRef = useRef<HTMLDivElement | null>(null);
    const viewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const preview = item.preview;
    const actorName = preview?.actorName ?? "Notification";
    const relativeTime = formatRelativeTimestamp(item.activityAt) ?? "Just now";
    const absoluteTime = formatAbsoluteTimestamp(item.activityAt);
    const aggregateLabel = getAggregateLabel(item.kind, item.aggregateCount);
    const muteScopes = useMemo(() => buildNotificationMuteScopes(item), [item]);
    const reasonLabel = getNotificationReasonLabel(item.reason);
    const isNew = !item.seenAt;
    const isImportant = item.importance === "important";
    const bodyText = item.body ? projectUpdateDisplayText(item.body) : null;
    const secondaryText = preview?.secondaryText ? projectUpdateDisplayText(preview.secondaryText) : null;
    const showSecondaryText = Boolean(
        secondaryText
        && secondaryText !== bodyText
        && secondaryText !== item.title
        && (!bodyText || !bodyText.toLowerCase().includes(secondaryText.toLowerCase())),
    );

    const clearViewTimers = () => {
        if (viewTimerRef.current) clearTimeout(viewTimerRef.current);
        if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
        viewTimerRef.current = null;
        focusTimerRef.current = null;
    };

    const markViewed = () => {
        viewTimerRef.current = null;
        focusTimerRef.current = null;
        if (isNew) onViewed([item.id]);
    };

    useEffect(() => {
        if (!isNew || !rowRef.current || typeof IntersectionObserver === "undefined") return;
        const element = rowRef.current;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry?.isIntersecting && entry.intersectionRatio >= 0.6 && !viewTimerRef.current) {
                viewTimerRef.current = setTimeout(markViewed, QUALIFIED_VIEW_MS);
            } else if (viewTimerRef.current) {
                clearTimeout(viewTimerRef.current);
                viewTimerRef.current = null;
            }
        }, { threshold: [0, 0.6, 1] });
        observer.observe(element);
        return () => {
            observer.disconnect();
            clearViewTimers();
        };
    // The item ID/seen state intentionally restarts the qualified-view timer.
    }, [item.id, isNew]);

    const handleOpen = async () => {
        setDestinationMissing(false);
        const opened = await onOpen(item);
        if (opened === false) setDestinationMissing(true);
    };

    const metadata = [
        preview?.contextLabel,
        showSecondaryText ? secondaryText : null,
        aggregateLabel,
        relativeTime,
    ].filter((value): value is string => Boolean(value));

    return (
        <div
            ref={rowRef}
            data-notification-row
            data-notification-id={item.id}
            tabIndex={-1}
            onFocus={() => {
                if (isNew && !focusTimerRef.current) focusTimerRef.current = setTimeout(markViewed, FOCUS_VIEW_MS);
            }}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearViewTimers();
            }}
            className={cn(
                "group relative flex min-h-[76px] items-start gap-2 rounded-xl px-3 py-3 outline-none transition-[background-color,box-shadow,transform] duration-150",
                isNew
                    ? "bg-blue-500/[0.06] hover:bg-blue-500/[0.1] dark:bg-blue-400/[0.1] dark:hover:bg-blue-400/[0.14]"
                    : "hover:bg-zinc-100/80 dark:hover:bg-zinc-900/80",
            )}
        >
            <button
                type="button"
                onClick={() => void handleOpen()}
                onFocus={() => {
                    if (isNew) focusTimerRef.current = setTimeout(markViewed, FOCUS_VIEW_MS);
                }}
                onBlur={clearViewTimers}
                aria-label={`${isNew ? "New" : "Seen"} ${reasonLabel}: ${item.title}${relativeTime ? `, ${relativeTime}` : ""}`}
                className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none transition-transform active:scale-[0.99]"
            >
                <div className="relative mt-0.5 shrink-0">
                    {preview?.actorAvatarUrl && !avatarFailed ? (
                        <img
                            src={preview.actorAvatarUrl}
                            alt={actorName}
                            onError={() => setAvatarFailed(true)}
                            className="h-9 w-9 rounded-full object-cover ring-1 ring-zinc-200 dark:ring-zinc-800"
                        />
                    ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700">
                            {getInitial(actorName)}
                        </div>
                    )}
                    {isNew ? (
                        <span
                            aria-label={isImportant ? "Needs attention" : "New"}
                            className={cn(
                                "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-zinc-950",
                                isImportant ? "bg-red-500" : "bg-blue-500",
                            )}
                        />
                    ) : null}
                </div>

                <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-semibold leading-5 text-zinc-900 dark:text-zinc-50">{item.title}</p>
                    {bodyText ? (
                        <p className="mt-0.5 line-clamp-1 text-sm leading-5 text-zinc-600 dark:text-zinc-400">{bodyText}</p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {metadata.map((value, index) => (
                            <span key={`${value}:${index}`} className="inline-flex items-center gap-1.5">
                                {index > 0 ? <span aria-hidden="true">·</span> : null}
                                <span title={value === relativeTime ? absoluteTime ?? undefined : undefined}>{value}</span>
                            </span>
                        ))}
                    </div>
                    {destinationMissing ? (
                        <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">This update no longer has an available destination.</p>
                    ) : null}
                </div>
            </button>

            <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 opacity-100 transition-[background-color,color,opacity,transform] hover:bg-zinc-200/70 hover:text-zinc-900 active:scale-95 focus-visible:outline-none md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
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
                    {item.seenAt ? (
                        <DropdownMenuItem onClick={() => void onMarkUnread(item)}>
                            Mark as new
                        </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onClick={() => void onDismiss(item)}>
                        <EyeOff className="mr-2 h-4 w-4" />
                        Dismiss
                    </DropdownMenuItem>
                    {onSnooze ? (
                        <>
                            <DropdownMenuSeparator />
                            {snoozePresets().map((preset) => (
                                <DropdownMenuItem key={preset.label} onClick={() => void onSnooze(item, preset.until.toISOString())}>
                                    <Clock className="mr-2 h-4 w-4" />
                                    {preset.label}
                                </DropdownMenuItem>
                            ))}
                        </>
                    ) : null}
                    <DropdownMenuSeparator />
                    {muteScopes.slice(0, 3).map((scope) => (
                        <DropdownMenuItem key={`${scope.kind}:${scope.value}`} onClick={() => void onMuteScope(item, scope)}>
                            <BellOff className="mr-2 h-4 w-4" />
                            {scope.kind === "notification_type" ? `Turn off ${reasonLabel}` : `Mute ${scope.label ?? scope.kind}`}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
