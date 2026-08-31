"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { BellOff, ChevronDown, ChevronRight, ExternalLink, MoreVertical } from "lucide-react";

import { NotificationRow } from "@/components/notifications/NotificationRow";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    buildNotificationMuteScopes,
    bundleUnreadCount,
    formatAbsoluteTimestamp,
    getBundleSummary,
    getNotificationReasonLabel,
    type NotificationBundle,
} from "@/lib/notifications/presentation";
import type { NotificationItem, NotificationMuteScope } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

const QUALIFIED_VIEW_MS = 750;

function getInitial(label: string | null | undefined) {
    const value = (label || "").trim();
    return value ? value.charAt(0).toUpperCase() : "N";
}

function formatRelativeTimestamp(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return formatDistanceToNow(date, { addSuffix: true });
}

type Handlers = {
    onOpen: (item: NotificationItem) => void | Promise<unknown>;
    onViewed: (notificationIds: string[]) => void;
    onMarkUnread: (item: NotificationItem) => void | Promise<unknown>;
    onDismiss: (item: NotificationItem) => void | Promise<unknown>;
    onMuteScope: (item: NotificationItem, scope: NotificationMuteScope) => void | Promise<unknown>;
    onSnooze?: (item: NotificationItem, snoozedUntil: string) => void | Promise<unknown>;
};

export function NotificationBundleRow(props: { bundle: NotificationBundle } & Handlers) {
    const { bundle, onOpen, onViewed, onMarkUnread, onDismiss, onMuteScope, onSnooze } = props;
    const [expanded, setExpanded] = useState(false);
    const [avatarFailed, setAvatarFailed] = useState(false);
    const rowRef = useRef<HTMLDivElement | null>(null);
    const viewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lead = bundle.lead;
    const count = bundle.items.length;
    const newCount = bundleUnreadCount(bundle);
    const summary = useMemo(() => getBundleSummary(bundle), [bundle]);
    const reasonLabel = getNotificationReasonLabel(lead.reason);
    const relative = formatRelativeTimestamp(lead.activityAt) ?? "Just now";
    const absolute = formatAbsoluteTimestamp(lead.activityAt);
    const muteScopes = useMemo(() => buildNotificationMuteScopes(lead), [lead]);
    const actorName = lead.preview?.actorName ?? summary ?? "Notification";
    const markBundleViewed = () => {
        viewTimerRef.current = null;
        if (!lead.seenAt) onViewed([lead.id]);
    };

    useEffect(() => {
        if (lead.seenAt || !rowRef.current || typeof IntersectionObserver === "undefined") return;
        const element = rowRef.current;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry?.isIntersecting && entry.intersectionRatio >= 0.6 && !viewTimerRef.current) {
                viewTimerRef.current = setTimeout(markBundleViewed, QUALIFIED_VIEW_MS);
            } else if (viewTimerRef.current) {
                clearTimeout(viewTimerRef.current);
                viewTimerRef.current = null;
            }
        }, { threshold: [0, 0.6, 1] });
        observer.observe(element);
        return () => {
            observer.disconnect();
            if (viewTimerRef.current) clearTimeout(viewTimerRef.current);
            viewTimerRef.current = null;
        };
    // The current bundle is intentionally re-evaluated after every state patch.
    }, [lead.id, newCount]);

    const handleOpenLead = async () => {
        await onOpen(lead);
    };

    return (
        <div>
            <div
                ref={rowRef}
                data-notification-row
                data-notification-id={lead.id}
                tabIndex={-1}
                onFocus={() => {
                    if (!lead.seenAt && !viewTimerRef.current) viewTimerRef.current = setTimeout(markBundleViewed, 500);
                }}
                onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null) && viewTimerRef.current) {
                        clearTimeout(viewTimerRef.current);
                        viewTimerRef.current = null;
                    }
                }}
                className={cn(
                    "group relative flex min-h-[78px] items-start gap-1 rounded-xl px-3 py-3 outline-none transition-[background-color,box-shadow]",
                    newCount > 0 ? "bg-blue-500/[0.06] hover:bg-blue-500/[0.1] dark:bg-blue-400/[0.1] dark:hover:bg-blue-400/[0.14]" : "hover:bg-zinc-100/80 dark:hover:bg-zinc-900/80",
                )}
            >
                <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    aria-expanded={expanded}
                    aria-label={expanded ? "Collapse grouped notifications" : `Expand ${count} grouped notifications`}
                    className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 focus-visible:outline-none dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <button
                    type="button"
                    onClick={() => void handleOpenLead()}
                    className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none transition-transform active:scale-[0.99]"
                    aria-label={`${newCount > 0 ? `${newCount} new` : "Seen"} grouped ${reasonLabel}: ${lead.title}`}
                >
                    <div className="relative mt-0.5 shrink-0">
                        {lead.preview?.actorAvatarUrl && !avatarFailed ? (
                            <img src={lead.preview.actorAvatarUrl} alt={actorName} onError={() => setAvatarFailed(true)} className="h-9 w-9 rounded-full object-cover ring-1 ring-zinc-200 dark:ring-zinc-800" />
                        ) : (
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{getInitial(actorName)}</div>
                        )}
                        <span className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1 text-[10px] font-semibold text-white ring-2 ring-white dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-950">{count}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 text-sm font-semibold leading-5 text-zinc-900 dark:text-zinc-50">{summary || lead.title}</p>
                        {summary ? <p className="mt-0.5 line-clamp-1 text-sm leading-5 text-zinc-600 dark:text-zinc-400">{lead.title}</p> : null}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                            {lead.preview?.contextLabel ? <span>{lead.preview.contextLabel}</span> : null}
                            {lead.preview?.contextLabel ? <span aria-hidden="true">·</span> : null}
                            <span title={absolute ?? undefined}>{relative}</span>
                            <span aria-hidden="true">·</span>
                            <span>{count} updates</span>
                        </div>
                    </div>
                </button>
                <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                        <button type="button" className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 opacity-100 transition-[background-color,color,opacity] hover:bg-zinc-200/70 hover:text-zinc-900 focus-visible:outline-none md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-100" aria-label="Grouped notification actions">
                            <MoreVertical className="h-4 w-4" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onClick={() => void handleOpenLead()} disabled={!lead.href}>
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Open latest
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {muteScopes.slice(0, 3).map((scope) => (
                            <DropdownMenuItem key={`${scope.kind}:${scope.value}`} onClick={() => void onMuteScope(lead, scope)}>
                                <BellOff className="mr-2 h-4 w-4" />
                                {scope.kind === "notification_type" ? `Turn off ${reasonLabel}` : `Mute ${scope.label ?? scope.kind}`}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            {expanded ? (
                <div className="mt-1 space-y-1 border-l border-zinc-200 pl-4 dark:border-zinc-800 sm:ml-6">
                    {bundle.items.map((item) => (
                        <NotificationRow
                            key={item.id}
                            item={item}
                            onOpen={onOpen}
                            onViewed={onViewed}
                            onMarkUnread={onMarkUnread}
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
