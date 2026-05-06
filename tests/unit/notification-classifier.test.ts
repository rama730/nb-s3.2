import assert from "node:assert/strict";
import test from "node:test";

import {
  J1_NOTIFICATION_KINDS,
  classifyNotificationKind,
  importanceForKind,
  isActionRequiredKind,
} from "@/lib/notifications/classifier";
import type { NotificationKind } from "@/lib/notifications/types";

const ALL_KINDS: readonly NotificationKind[] = [
  "message_burst",
  "workflow_assigned",
  "workflow_resolved",
  "application_received",
  "application_decision",
  "connection_request_received",
  "connection_request_accepted",
  "task_assigned",
  "task_status_attention",
  "task_comment_mention",
  "task_comment_reply",
  "task_file_version",
  "task_file_replaced",
  "task_file_needs_review",
];

test("J1 kind list is exactly the five action-required kinds from plan §293", () => {
  assert.deepEqual([...J1_NOTIFICATION_KINDS].sort(), [
    "connection_request_received",
    "task_assigned",
    "task_comment_mention",
    "task_file_needs_review",
    "workflow_assigned",
  ]);
});

test("classifyNotificationKind returns 'j1' for every J1 kind and 'j2' for the rest", () => {
  for (const kind of ALL_KINDS) {
    const expected = J1_NOTIFICATION_KINDS.includes(kind) ? "j1" : "j2";
    assert.equal(classifyNotificationKind(kind), expected, `expected ${kind} → ${expected}`);
  }
});

test("importanceForKind mirrors J1/J2 split — J1 kinds are 'important', J2 are 'more'", () => {
  assert.equal(importanceForKind("task_assigned"), "important");
  assert.equal(importanceForKind("task_comment_mention"), "important");
  assert.equal(importanceForKind("workflow_assigned"), "important");
  assert.equal(importanceForKind("task_file_needs_review"), "important");
  assert.equal(importanceForKind("connection_request_received"), "important");

  assert.equal(importanceForKind("message_burst"), "more");
  assert.equal(importanceForKind("workflow_resolved"), "more");
  assert.equal(importanceForKind("application_received"), "more");
  assert.equal(importanceForKind("application_decision"), "more");
  assert.equal(importanceForKind("connection_request_accepted"), "more");
  assert.equal(importanceForKind("task_status_attention"), "more");
  assert.equal(importanceForKind("task_comment_reply"), "more");
  assert.equal(importanceForKind("task_file_version"), "more");
  assert.equal(importanceForKind("task_file_replaced"), "more");
});

test("isActionRequiredKind is true only for J1", () => {
  const j1True = ALL_KINDS.filter((k) => isActionRequiredKind(k));
  assert.deepEqual(j1True.sort(), [...J1_NOTIFICATION_KINDS].sort());
});
