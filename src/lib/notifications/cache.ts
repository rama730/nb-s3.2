import type { InfiniteData } from "@tanstack/react-query";

import type { NotificationFeedPage, NotificationItem } from "@/lib/notifications/types";

function compareNotifications(a: NotificationItem, b: NotificationItem) {
    if (a.updatedAt === b.updatedAt) {
        return a.id < b.id ? 1 : -1;
    }
    return a.updatedAt < b.updatedAt ? 1 : -1;
}

function partitionItems(
    items: NotificationItem[],
    pageSizes: number[],
    hasMoreFlags: boolean[],
) {
    const pages: NotificationFeedPage[] = [];
    let cursor = 0;
    for (let index = 0; index < pageSizes.length; index += 1) {
        const isLastLoadedPage = index === pageSizes.length - 1;
        const size = isLastLoadedPage && !hasMoreFlags[index]
            ? Math.max(items.length - cursor, 0)
            : pageSizes[index] ?? items.length;
        const pageItems = items.slice(cursor, cursor + size);
        cursor += size;
        pages.push({
            items: pageItems,
            nextCursor: null,
            hasMore: false,
            unreadCount: 0,
            unreadImportantCount: 0,
        });
    }
    if (pages.length === 0) {
        pages.push({
            items: [],
            nextCursor: null,
            hasMore: false,
            unreadCount: 0,
            unreadImportantCount: 0,
        });
    }
    return pages;
}

function rebuildInfiniteData(
    data: InfiniteData<NotificationFeedPage>,
    items: NotificationItem[],
    unreadCount: number,
    unreadImportantCount: number,
): InfiniteData<NotificationFeedPage> {
    const pageSizes = data.pages.map((page) => Math.max(page.items.length, 1));
    const nextCursors = data.pages.map((page) => page.nextCursor);
    const hasMoreFlags = data.pages.map((page) => page.hasMore);
    const pages = partitionItems(items, pageSizes, hasMoreFlags).map((page, index) => ({
        ...page,
        nextCursor: nextCursors[index] ?? null,
        hasMore: hasMoreFlags[index] ?? false,
        unreadCount,
        unreadImportantCount,
    }));
    return {
        pageParams: data.pageParams,
        pages,
    };
}

export function upsertNotificationInInfiniteData(
    data: InfiniteData<NotificationFeedPage> | undefined,
    item: NotificationItem,
    unreadCountOverride?: number,
) {
    if (!data) return data;
    if (item.dismissedAt) {
        return removeNotificationFromInfiniteData(data, item.id, unreadCountOverride);
    }
    const deduped = new Map<string, NotificationItem>();
    for (const existing of data.pages.flatMap((page) => page.items)) {
        deduped.set(existing.id, existing);
    }
    deduped.set(item.id, item);
    const items = Array.from(deduped.values()).sort(compareNotifications);
    const unreadItems = items.filter((entry) => !entry.readAt);
    const unreadCount = unreadCountOverride ?? unreadItems.length;
    const unreadImportantCount = unreadItems.filter((entry) => entry.importance === "important").length;
    return rebuildInfiniteData(data, items, unreadCount, unreadImportantCount);
}

export function removeNotificationFromInfiniteData(
    data: InfiniteData<NotificationFeedPage> | undefined,
    notificationId: string,
    unreadCountOverride?: number,
) {
    if (!data) return data;
    const items = data.pages
        .flatMap((page) => page.items)
        .filter((entry) => entry.id !== notificationId);
    const unreadItems = items.filter((entry) => !entry.readAt);
    const unreadCount = unreadCountOverride ?? unreadItems.length;
    const unreadImportantCount = unreadItems.filter((entry) => entry.importance === "important").length;
    return rebuildInfiniteData(data, items, unreadCount, unreadImportantCount);
}

export function patchNotificationReadStateInInfiniteData(
    data: InfiniteData<NotificationFeedPage> | undefined,
    item: NotificationItem,
) {
    if (!data) return data;
    return upsertNotificationInInfiniteData(data, item);
}

export function markAllNotificationsReadInInfiniteData(
    data: InfiniteData<NotificationFeedPage> | undefined,
    readAt: string,
) {
    if (!data) return data;
    const items = data.pages
        .flatMap((page) => page.items)
        .map((item) => {
            if (item.readAt) return item;
            return {
                ...item,
                readAt,
                seenAt: item.seenAt ?? readAt,
                updatedAt: item.updatedAt,
            };
        });
    return rebuildInfiniteData(data, items, 0, 0);
}
