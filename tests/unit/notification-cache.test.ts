import assert from "node:assert/strict";
import test from "node:test";
import type { InfiniteData } from "@tanstack/react-query";

import {
  markAllNotificationsReadInInfiniteData,
  patchNotificationReadStateInInfiniteData,
  upsertNotificationInInfiniteData,
} from "@/lib/notifications/cache";
import type { NotificationFeedPage, NotificationItem } from "@/lib/notifications/types";

function item(overrides: Partial<NotificationItem> & Pick<NotificationItem, "id" | "updatedAt">): NotificationItem {
  const { id, updatedAt, ...rest } = overrides;
  return {
    id,
    userId: "user-1",
    actorUserId: "actor-1",
    kind: "message_burst",
    importance: "important",
    title: "New message",
    body: null,
    href: "/messages",
    entityRefs: { conversationId: "conversation-1" },
    preview: null,
    reason: "message",
    dedupeKey: `message-burst:${id}`,
    aggregateCount: 1,
    readAt: null,
    seenAt: null,
    dismissedAt: null,
    snoozedUntil: null,
    createdAt: updatedAt,
    updatedAt,
    ...rest,
  };
}

function page(items: NotificationItem[], unreadCount = items.filter((entry) => !entry.readAt).length): NotificationFeedPage {
  const unreadImportantCount = items.filter((entry) => !entry.readAt && entry.importance === "important").length;
  return {
    items,
    nextCursor: null,
    hasMore: false,
    unreadCount,
    unreadImportantCount,
  };
}

test("upsertNotificationInInfiniteData prepends newer realtime rows and derives unread count", () => {
  const data: InfiniteData<NotificationFeedPage> = {
    pageParams: [undefined],
    pages: [
      page([
        item({ id: "older", updatedAt: "2026-04-21T01:00:00.000Z", readAt: "2026-04-21T01:05:00.000Z" }),
      ], 0),
    ],
  };

  const next = upsertNotificationInInfiniteData(
    data,
    item({ id: "newer", updatedAt: "2026-04-21T02:00:00.000Z" }),
  );

  assert.deepEqual(next?.pages[0]?.items.map((entry) => entry.id), ["newer", "older"]);
  assert.equal(next?.pages[0]?.unreadCount, 1);
});

test("patchNotificationReadStateInInfiniteData updates rows in place without duplicating realtime echoes", () => {
  const unread = item({ id: "n-1", updatedAt: "2026-04-21T02:00:00.000Z" });
  const data: InfiniteData<NotificationFeedPage> = {
    pageParams: [undefined],
    pages: [page([unread], 1)],
  };

  const next = patchNotificationReadStateInInfiniteData(data, {
    ...unread,
    readAt: "2026-04-21T02:01:00.000Z",
    seenAt: "2026-04-21T02:01:00.000Z",
  });

  assert.equal(next?.pages[0]?.items.length, 1);
  assert.equal(next?.pages[0]?.items[0]?.readAt, "2026-04-21T02:01:00.000Z");
  assert.equal(next?.pages[0]?.unreadCount, 0);
});

test("markAllNotificationsReadInInfiniteData patches every unread row optimistically", () => {
  const readAt = "2026-04-21T03:00:00.000Z";
  const data: InfiniteData<NotificationFeedPage> = {
    pageParams: [undefined],
    pages: [
      page([
        item({ id: "n-1", updatedAt: "2026-04-21T02:00:00.000Z" }),
        item({ id: "n-2", updatedAt: "2026-04-21T01:00:00.000Z", readAt: "2026-04-21T01:05:00.000Z" }),
      ], 1),
    ],
  };

  const next = markAllNotificationsReadInInfiniteData(data, readAt);

  assert.equal(next?.pages[0]?.unreadCount, 0);
  assert.equal(next?.pages[0]?.unreadImportantCount, 0);
  assert.deepEqual(next?.pages[0]?.items.map((entry) => entry.readAt), [
    readAt,
    "2026-04-21T01:05:00.000Z",
  ]);
});

test("upsertNotificationInInfiniteData derives unreadImportantCount separately from total", () => {
  const data: InfiniteData<NotificationFeedPage> = {
    pageParams: [undefined],
    pages: [
      page([
        item({ id: "noisy-1", updatedAt: "2026-04-21T01:00:00.000Z", importance: "more" }),
      ]),
    ],
  };

  const withImportant = upsertNotificationInInfiniteData(
    data,
    item({ id: "urgent-1", updatedAt: "2026-04-21T02:00:00.000Z", importance: "important" }),
  );

  assert.equal(withImportant?.pages[0]?.unreadCount, 2);
  assert.equal(withImportant?.pages[0]?.unreadImportantCount, 1);

  const secondImportant = upsertNotificationInInfiniteData(
    withImportant,
    item({ id: "urgent-2", updatedAt: "2026-04-21T03:00:00.000Z", importance: "important" }),
  );

  assert.equal(secondImportant?.pages[0]?.unreadCount, 3);
  assert.equal(secondImportant?.pages[0]?.unreadImportantCount, 2);
});

test("patchNotificationReadStateInInfiniteData decrements unreadImportantCount when important row read", () => {
  const unread = item({ id: "n-1", updatedAt: "2026-04-21T02:00:00.000Z", importance: "important" });
  const data: InfiniteData<NotificationFeedPage> = {
    pageParams: [undefined],
    pages: [page([unread], 1)],
  };

  const next = patchNotificationReadStateInInfiniteData(data, {
    ...unread,
    readAt: "2026-04-21T02:01:00.000Z",
    seenAt: "2026-04-21T02:01:00.000Z",
  });

  assert.equal(next?.pages[0]?.unreadCount, 0);
  assert.equal(next?.pages[0]?.unreadImportantCount, 0);
});
