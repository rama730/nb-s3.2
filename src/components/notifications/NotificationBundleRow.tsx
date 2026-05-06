"use client";

import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { BellOff, ChevronDown, ChevronRight, ExternalLink, EyeOff, MoreVertical } from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationRow } from "@/components/notifications/NotificationRow";
import {
    bundleUnreadCount,
    buildNotificationMuteScopes,
    formatAbsoluteTimestamp,
    getBundleSummary,
    getNotificationReasonLabel,
    type NotificationBundle,
} from "@/lib/notifications/presentation";
import type { NotificationItem, NotificationMuteScope } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

function formatRelativeTimestamp(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return formatDistanceToNow(date, { addSuffix: true });
}

function getInitial(label: string | null | undefined) {
    const value = (label || "").trim();
    return value ? value.charAt(0).toUpperCase() : "N";
}

type Handlers = {
    onOpen: (item: NotificationItem) => void | Promise<unknown>;
    onToggleRead: (item: NotificationItem) => void | Promise<unknown>;
    onDismiss: (item: NotificationItem) => void | Promise<unknown>;
    onMuteScope: (item: NotificationItem, scope: NotificationMuteScope) => void | Promise<unknown>;
    onSnooze?: (item: NotificationItem, snoozedUntil: string) => void | Promise<unknown>;
};

export function NotificationBundleRow(props: { bundle: NotificationBundle } & Handlers) {
    const { bundle, onOpen, onToggleRead, onDismiss, onMuteScope, onSnooze } = props;
    const [expanded, setExpanded] = useState(false);
    const lead = bundle.lead;
    const count = bundle.items.length;
    const unread = bundleUnreadCount(bundle);
    const summary = useMemo(() => getBundleSummary(bundle), [bundle]);
    const reasonLabel = getNotificationReasonLabel(lead.reason);
    const contextLabel = lead.preview?.contextLabel;
    const relative = formatRelativeTimestamp(lead.updatedAt) ?? "Just now";
    const absolute = formatAbsoluteTimestamp(lead.updatedAt);
    const muteScopes = useMemo(() => buildNotificationMuteScopes(lead), [lead]);
    const isImportant = lead.importance === "important";

    const handleOpenLead = async () => {
        if (!lead.href) return;
        await onOpen(lead);
    };

    const handleDismissAll = async () => {
        for (const item of bundle.items) {
            await onDismiss(item);
        }
    };

    const handleMarkAllRead = async () => {
        for (const item of bundle.items) {
            if (!item.readAt) await onToggleRead(item);
        }
    };

    const actorName = lead.preview?.actorName ?? summary ?? "Notification";

    return (
        <div>
            <div
                data-notification-row
                data-notification-id={lead.id}
                className={cn(
                    "group relative flex items-start gap-3 px-4 py-3 outline-none transition-colors focus-within:ring-2 focus-within:ring-blue-500/40",
                    unread > 0
                        ? "bg-blue-500/5 hover:bg-blue-500/10 dark:bg-blue-500/10 dark:hover:bg-blue-500/15"
                        : "bg-transparent hover:bg-zinc-50 dark:hover:bg-zinc-900/70",
                )}
            >
                {unread > 0 ? (
                    <span
                        aria-hidden
                        className={cn(
                            "absolute left-0 top-0 h-full w-1",
                            isImportant ? "bg-red-500" : "bg-blue-500",
                        )}
                    />
                ) : null}

                <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    aria-expanded={expanded}
                    aria-label={expanded ? "Collapse bundle" : `Expand bundle of ${count} notifications`}
                    className="mt-1 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>

                <button
                    type="button"
                    onClick={() => void handleOpenLead()}
                    disabled={!lead.href}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-default"
                >
                    <div className="relative mt-0.5 shrink-0">
                        {lead.preview?.actorAvatarUrl ? (
                            <img
                                src={lead.preview.actorAvatarUrl}
                                alt={actorName}
                                className="h-10 w-10 rounded-full object-cover"
                            />
                        ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                {getInitial(actorName)}
                            </div>
                        )}
                        <span className="absolute -bottom-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-zinc-900 px-1.5 text-[10px] font-semibold text-white ring-2 ring-white dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-950">
                            {count}
                        </span>
                    </div>

                    <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                                {reasonLabel}
                            </span>
                            {contextLabel ? (
                                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                                    {contextLabel}
                                </span>
                            ) : null}
                            {unread > 0 ? (
                                <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                                    {unread} unread
                                </span>
                            ) : null}
                        </div>
                        <p className="line-clamp-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                            {summary || lead.title}
                        </p>
                        {summary && lead.title ? (
                            <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                                {lead.title}
                            </p>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                            <span title={absolute ?? undefined}>{relative}</span>
                            <span>· {count} updates</span>
                        </div>
                    </div>
                </button>

                <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="rounded-md p-1.5 text-zinc-500 opacity-100 transition-opacity hover:bg-zinc-100 hover:text-zinc-700 md:opacity-0 md:group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                            aria-label="Bundle actions"
                        >
                            <MoreVertical className="h-4 w-4" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onClick={() => void handleOpenLead()} disabled={!lead.href}>
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Open latest
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void handleMarkAllRead()} disabled={unread === 0}>
                            Mark all as read
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void handleDismissAll()}>
                            <EyeOff className="mr-2 h-4 w-4" />
                            Dismiss all
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {muteScopes.slice(0, 3).map((scope) => (
                            <DropdownMenuItem
                                key={`${scope.kind}:${scope.value}`}
                                onClick={() => void onMuteScope(lead, scope)}
                            >
                                <BellOff className="mr-2 h-4 w-4" />
                                {scope.kind === "notification_type" ? `Turn off ${reasonLabel}` : `Mute ${scope.label ?? scope.kind}`}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {expanded ? (
                <div className="border-t border-zinc-100 bg-zinc-50/60 pl-4 dark:border-zinc-900 dark:bg-zinc-900/40 sm:pl-8">
                    {bundle.items.map((item) => (
                        <NotificationRow
                            key={item.id}
                            item={item}
                            onOpen={onOpen}
                            onToggleRead={onToggleRead}
                            onDismiss={onDismiss}
                            onMuteScope={onMuteScope}
                            onSnooze={onSnooze}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}
