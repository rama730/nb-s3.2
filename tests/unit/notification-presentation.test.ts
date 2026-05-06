import assert from "node:assert/strict";
import test from "node:test";

import {
  bundleNotifications,
  bundleUnreadCount,
  buildNotificationHref,
  filterNotifications,
  formatAbsoluteTimestamp,
  getAggregateLabel,
  getBundleSummary,
  getNarrowestNotificationMuteScope,
  getNotificationReason,
  groupNotificationsByTime,
  notificationMatchesMuteScope,
  shouldSuppressNotificationToast,
} from "@/lib/notifications/presentation";
import type { NotificationItem } from "@/lib/notifications/types";

function item(overrides: Partial<NotificationItem> & Pick<NotificationItem, "id" | "updatedAt">): NotificationItem {
  const { id, updatedAt, ...rest } = overrides;
  return {
    id,
    userId: "user-1",
    actorUserId: "actor-1",
    kind: "task_assigned",
    importance: "important",
    title: "Assigned",
    body: null,
    href: "/projects/p?tab=tasks",
    entityRefs: { projectId: "project-1", taskId: "task-1" },
    preview: null,
    reason: "assigned",
    dedupeKey: id,
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

test("getNotificationReason maps task attention status to blocked/done chips", () => {
  assert.equal(getNotificationReason("task_status_attention", { status: "blocked" }), "blocked");
  assert.equal(getNotificationReason("task_status_attention", { status: "done" }), "done");
  assert.equal(getNotificationReason("task_comment_mention", {}), "mention");
});

test("filterNotifications supports tray filters", () => {
  const unread = item({ id: "unread", updatedAt: "2026-04-21T08:00:00.000Z" });
  const read = item({ id: "read", updatedAt: "2026-04-21T07:00:00.000Z", readAt: "2026-04-21T07:01:00.000Z" });
  const more = item({ id: "more", updatedAt: "2026-04-21T06:00:00.000Z", importance: "more" });

  assert.deepEqual(filterNotifications([unread, read, more], "unread").map((entry) => entry.id), ["unread", "more"]);
  assert.equal(filterNotifications([unread, read, more], "all").length, 3);
});

test("groupNotificationsByTime keeps unseen unread rows in New", () => {
  const grouped = groupNotificationsByTime([
    item({ id: "new", updatedAt: "2026-04-21T08:00:00.000Z" }),
    item({ id: "today", updatedAt: "2026-04-21T07:00:00.000Z", seenAt: "2026-04-21T07:01:00.000Z" }),
    item({ id: "earlier", updatedAt: "2026-04-20T07:00:00.000Z", seenAt: "2026-04-20T07:01:00.000Z" }),
  ], new Date("2026-04-21T12:00:00.000Z"));

  assert.deepEqual(grouped.new.map((entry) => entry.id), ["new"]);
  assert.deepEqual(grouped.today.map((entry) => entry.id), ["today"]);
  assert.deepEqual(grouped.earlier.map((entry) => entry.id), ["earlier"]);
});

test("notificationMatchesMuteScope matches the narrow app scopes", () => {
  assert.equal(notificationMatchesMuteScope({
    kind: "message_burst",
    actorUserId: "actor-1",
    entityRefs: { conversationId: "conversation-1" },
  }, { kind: "conversation", value: "conversation-1" }), true);
  assert.equal(notificationMatchesMuteScope({
    kind: "task_assigned",
    actorUserId: "actor-1",
    entityRefs: { taskId: "task-1" },
  }, { kind: "notification_type", value: "message_burst" }), false);
});

test("buildNotificationHref only accepts in-app destinations", () => {
  assert.equal(buildNotificationHref(item({ id: "ok", updatedAt: "2026-04-21T08:00:00.000Z", href: "/projects/p" })), "/projects/p");
  assert.equal(buildNotificationHref(item({ id: "external", updatedAt: "2026-04-21T08:00:00.000Z", href: "https://example.com" })), null);
  assert.equal(buildNotificationHref(item({ id: "protocol", updatedAt: "2026-04-21T08:00:00.000Z", href: "//example.com" })), null);
  assert.equal(buildNotificationHref(item({ id: "missing", updatedAt: "2026-04-21T08:00:00.000Z", href: null })), null);
});

test("getNarrowestNotificationMuteScope prefers the most specific available scope", () => {
  assert.deepEqual(
    getNarrowestNotificationMuteScope(item({
      id: "task-scope",
      updatedAt: "2026-04-21T08:00:00.000Z",
      entityRefs: { projectId: "project-1", taskId: "task-1", conversationId: "conversation-1" },
    })),
    { kind: "task", value: "task-1", label: "Assigned", mutedAt: null },
  );

  assert.deepEqual(
    getNarrowestNotificationMuteScope(item({
      id: "conversation-scope",
      updatedAt: "2026-04-21T08:00:00.000Z",
      kind: "message_burst",
      reason: "message",
      entityRefs: { conversationId: "conversation-1" },
      preview: {
        actorName: "Ana",
        actorAvatarUrl: null,
        contextLabel: "Design chat",
        contextKind: "conversation",
        secondaryText: null,
        thumbnailUrl: null,
      },
    })),
    { kind: "conversation", value: "conversation-1", label: "Design chat", mutedAt: null },
  );
});

test("getAggregateLabel returns null for count <= 1 and plural noun otherwise", () => {
  assert.equal(getAggregateLabel("task_comment_reply", 0), null);
  assert.equal(getAggregateLabel("task_comment_reply", 1), null);
  assert.equal(getAggregateLabel("task_comment_reply", 3), "3 new replies");
  assert.equal(getAggregateLabel("task_comment_mention", 5), "5 new mentions");
  assert.equal(getAggregateLabel("message_burst", 2), "2 new messages");
  assert.equal(getAggregateLabel("task_file_version", 4), "4 new versions");
  assert.equal(getAggregateLabel("connection_request_received", 7), "7 new requests");
});

test("formatAbsoluteTimestamp returns null for invalid input and a string for valid", () => {
  assert.equal(formatAbsoluteTimestamp("not-a-date"), null);
  assert.equal(formatAbsoluteTimestamp(""), null);
  const out = formatAbsoluteTimestamp("2026-03-15T14:30:00Z");
  assert.equal(typeof out, "string");
  assert.ok((out ?? "").length > 0);
});

test("bundleNotifications collapses same-entity items within 1h and keeps singletons separate", () => {
  const a = item({
    id: "a",
    updatedAt: "2026-04-21T10:00:00.000Z",
    kind: "task_comment_mention",
    reason: "mention",
    entityRefs: { taskId: "task-1", projectId: "project-1" },
    preview: { actorName: "Ana", actorAvatarUrl: null, contextLabel: "Task 1", thumbnailUrl: null, secondaryText: null },
  });
  const b = item({
    id: "b",
    updatedAt: "2026-04-21T09:45:00.000Z",
    kind: "task_comment_mention",
    reason: "mention",
    entityRefs: { taskId: "task-1", projectId: "project-1" },
    preview: { actorName: "Ben", actorAvatarUrl: null, contextLabel: "Task 1", thumbnailUrl: null, secondaryText: null },
  });
  const c = item({
    id: "c",
    updatedAt: "2026-04-21T09:40:00.000Z",
    kind: "task_comment_mention",
    reason: "mention",
    entityRefs: { taskId: "task-1", projectId: "project-1" },
    preview: { actorName: "Cai", actorAvatarUrl: null, contextLabel: "Task 1", thumbnailUrl: null, secondaryText: null },
  });
  const farAway = item({
    id: "d",
    updatedAt: "2026-04-21T05:00:00.000Z",
    kind: "task_comment_mention",
    reason: "mention",
    entityRefs: { taskId: "task-1", projectId: "project-1" },
  });
  const otherEntity = item({
    id: "e",
    updatedAt: "2026-04-21T09:58:00.000Z",
    kind: "task_comment_mention",
    reason: "mention",
    entityRefs: { taskId: "task-9", projectId: "project-1" },
  });

  const bundles = bundleNotifications([a, b, c, otherEntity, farAway]);
  assert.equal(bundles.length, 3);
  assert.deepEqual(bundles[0]!.items.map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(bundles[1]!.items.map((x) => x.id), ["e"]);
  assert.deepEqual(bundles[2]!.items.map((x) => x.id), ["d"]);

  assert.equal(getBundleSummary(bundles[0]!), "Ana, Ben and Cai");
  assert.equal(bundleUnreadCount(bundles[0]!), 3);
});

test("shouldSuppressNotificationToast suppresses active destinations", () => {
  assert.equal(shouldSuppressNotificationToast({
    item: item({
      id: "comment",
      kind: "task_comment_reply",
      reason: "mention",
      updatedAt: "2026-04-21T08:00:00.000Z",
      entityRefs: { taskId: "task-1" },
    }),
    pathname: "/projects/network",
    search: "?drawerId=task-1&panelTab=comments",
    trayOpen: false,
  }), true);

  assert.equal(shouldSuppressNotificationToast({
    item: item({
      id: "popup-message",
      kind: "message_burst",
      reason: "message",
      updatedAt: "2026-04-21T08:00:00.000Z",
      href: "/messages?conversationId=conversation-1",
      entityRefs: { conversationId: "conversation-1" },
    }),
    pathname: "/hub",
    search: "",
    trayOpen: false,
    activeConversationId: "conversation-1",
  }), true);

  assert.equal(shouldSuppressNotificationToast({
    item: item({
      id: "active-href",
      kind: "task_status_attention",
      reason: "update",
      updatedAt: "2026-04-21T08:00:00.000Z",
      href: "/projects/network?drawerId=task-1",
    }),
    pathname: "/projects/network",
    search: "drawerId=task-1",
    trayOpen: false,
  }), true);
});
