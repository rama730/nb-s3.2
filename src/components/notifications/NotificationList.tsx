"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { NotificationBundleRow } from "@/components/notifications/NotificationBundleRow";
import { NotificationRow } from "@/components/notifications/NotificationRow";
import {
    bundleNotifications,
    filterNotifications,
    groupNotificationsByTime,
} from "@/lib/notifications/presentation";
import type {
    NotificationItem,
    NotificationMuteScope,
    NotificationTrayFilter,
} from "@/lib/notifications/types";

const GROUP_LABELS = {
    new: "New",
    today: "Today",
    earlier: "Earlier",
} as const;

export function NotificationList(props: {
    items: NotificationItem[];
    filter: NotificationTrayFilter;
    onOpen: (item: NotificationItem) => void | Promise<unknown>;
    onToggleRead: (item: NotificationItem) => void | Promise<unknown>;
    onDismiss: (item: NotificationItem) => void | Promise<unknown>;
    onMuteScope: (item: NotificationItem, scope: NotificationMuteScope) => void | Promise<unknown>;
    onSnooze?: (item: NotificationItem, snoozedUntil: string) => void | Promise<unknown>;
    emptyState?: ReactNode;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    onLoadMore?: () => void | Promise<unknown>;
}) {
    const {
        items,
        filter,
        onOpen,
        onToggleRead,
        onDismiss,
        onMuteScope,
        onSnooze,
        emptyState,
        hasMore,
        isLoadingMore,
        onLoadMore,
    } = props;
    const filteredItems = filterNotifications(items, filter);
    const importantItems = filteredItems.filter((item) => item.importance === "important");
    const regularItems = filteredItems.filter((item) => item.importance !== "important");
    const grouped = groupNotificationsByTime(regularItems);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const first = containerRef.current?.querySelector<HTMLElement>("[data-notification-row]");
        if (first && containerRef.current && !containerRef.current.contains(document.activeElement)) {
            first.setAttribute("tabindex", "0");
        }
    }, [filteredItems.length]);

    const focusRow = (direction: 1 | -1) => {
        const root = containerRef.current;
        if (!root) return;
        const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-notification-row]"));
        if (rows.length === 0) return;
        const active = document.activeElement as HTMLElement | null;
        const currentIndex = rows.findIndex((row) => row === active || row.contains(active));
        const nextIndex = currentIndex === -1
            ? (direction === 1 ? 0 : rows.length - 1)
            : Math.max(0, Math.min(rows.length - 1, currentIndex + direction));
        const target = rows[nextIndex];
        if (!target) return;
        rows.forEach((row) => row.setAttribute("tabindex", "-1"));
        target.setAttribute("tabindex", "0");
        target.focus({ preventScroll: false });
    };

    const resolveFocusedItem = (): NotificationItem | null => {
        const active = document.activeElement as HTMLElement | null;
        const row = active?.closest<HTMLElement>("[data-notification-row]");
        const id = row?.dataset.notificationId;
        if (!id) return null;
        return filteredItems.find((item) => item.id === id) ?? null;
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
            return;
        }
        switch (event.key) {
            case "j":
            case "ArrowDown":
                event.preventDefault();
                focusRow(1);
                return;
            case "k":
            case "ArrowUp":
                event.preventDefault();
                focusRow(-1);
                return;
            case "Enter": {
                const item = resolveFocusedItem();
                if (!item) return;
                event.preventDefault();
                void onOpen(item);
                return;
            }
            case "e": {
                const item = resolveFocusedItem();
                if (!item) return;
                event.preventDefault();
                void onDismiss(item);
                return;
            }
            case "r": {
                const item = resolveFocusedItem();
                if (!item) return;
                event.preventDefault();
                void onToggleRead(item);
                return;
            }
            default:
                return;
        }
    };

    if (filteredItems.length === 0) {
        return (
            <div className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                {emptyState ?? "You're all caught up."}
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            onKeyDown={handleKeyDown}
            role="region"
            aria-label="Notifications list. Press J or down arrow to move down, K or up arrow to move up, Enter to open, E to dismiss, R to toggle read."
        >
            {importantItems.length > 0 ? (
                <section aria-label="Important notifications">
                    <div className="sticky top-0 z-10 border-b border-red-200 bg-red-50/95 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-red-700 backdrop-blur dark:border-red-950/70 dark:bg-red-950/30 dark:text-red-300">
                        Important
                    </div>
                    <div role="list" className="divide-y divide-zinc-100 dark:divide-zinc-900">
                        {bundleNotifications(importantItems).map((bundle) => (
                            <div role="listitem" key={bundle.key + ":" + bundle.lead.id}>
                                {bundle.items.length > 1 ? (
                                    <NotificationBundleRow
                                        bundle={bundle}
                                        onOpen={onOpen}
                                        onToggleRead={onToggleRead}
                                        onDismiss={onDismiss}
                                        onMuteScope={onMuteScope}
                                        onSnooze={onSnooze}
                                    />
                                ) : (
                                    <NotificationRow
                                        item={bundle.lead}
                                        onOpen={onOpen}
                                        onToggleRead={onToggleRead}
                                        onDismiss={onDismiss}
                                        onMuteScope={onMuteScope}
                                        onSnooze={onSnooze}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                </section>
            ) : null}
            {(["new", "today", "earlier"] as const).map((group) => {
                const groupItems = grouped[group];
                if (groupItems.length === 0) return null;
                return (
                    <section key={group} aria-label={`${GROUP_LABELS[group]} notifications`}>
                        <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white/95 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 dark:text-zinc-500">
                            {GROUP_LABELS[group]}
                        </div>
                        <div role="list" className="divide-y divide-zinc-100 dark:divide-zinc-900">
                            {bundleNotifications(groupItems).map((bundle) => (
                                <div role="listitem" key={bundle.key + ":" + bundle.lead.id}>
                                    {bundle.items.length > 1 ? (
                                        <NotificationBundleRow
                                            bundle={bundle}
                                            onOpen={onOpen}
                                            onToggleRead={onToggleRead}
                                            onDismiss={onDismiss}
                                            onMuteScope={onMuteScope}
                                            onSnooze={onSnooze}
                                        />
                                    ) : (
                                        <NotificationRow
                                            item={bundle.lead}
                                            onOpen={onOpen}
                                            onToggleRead={onToggleRead}
                                            onDismiss={onDismiss}
                                            onMuteScope={onMuteScope}
                                            onSnooze={onSnooze}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                );
            })}
            {hasMore ? (
                <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={isLoadingMore || !onLoadMore}
                        onClick={() => onLoadMore?.()}
                    >
                        {isLoadingMore ? "Loading earlier..." : "Load earlier"}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
