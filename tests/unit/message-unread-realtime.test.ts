import assert from "node:assert/strict";
import test from "node:test";

import { shouldRefreshInboxSummary, shouldRefreshUnreadSummary } from "../../src/lib/messages/unread-realtime";

const participant = (eventType: "INSERT" | "UPDATE" | "DELETE", unread: number, oldUnread = unread) => ({
    kind: "conversation_participant" as const,
    payload: {
        eventType,
        new: eventType === "DELETE" ? {} : { conversation_id: "conversation-1", unread_count: unread, archived_at: null },
        old: eventType === "INSERT" ? {} : { conversation_id: "conversation-1", unread_count: oldUnread, archived_at: null },
    },
});

test("unread refresh ignores participant metadata updates but keeps unread changes", () => {
    const states = new Map<string, string>();

    assert.equal(shouldRefreshUnreadSummary(participant("UPDATE", 2, 2), states), false);
    assert.equal(shouldRefreshUnreadSummary(participant("UPDATE", 3, 2), states), true);
    assert.equal(shouldRefreshUnreadSummary(participant("UPDATE", 3, 3), states), false);
    assert.equal(shouldRefreshUnreadSummary({ kind: "message_visibility", payload: { new: {}, old: {} } }, states), true);
});

test("inbox refresh reacts to a new preview once, not every participant write", () => {
    const states = new Map<string, string>();
    const event = participant("UPDATE", 2, 2);
    event.payload.new.last_message_id = "message-2";
    event.payload.new.last_message_at = "2026-08-13T01:34:00.000Z";
    event.payload.new.last_message_preview = "hello";
    event.payload.new.last_message_type = "text";
    event.payload.new.last_message_sender_id = "sender-1";

    assert.equal(shouldRefreshInboxSummary(event, states), true);
    assert.equal(shouldRefreshInboxSummary(event, states), false);
});

test("inbox refresh ignores a read-only participant update", () => {
    const states = new Map<string, string>();
    const initial = participant("UPDATE", 2, 2);
    initial.payload.new.last_message_id = "message-2";
    initial.payload.new.last_message_at = "2026-08-13T01:34:00.000Z";
    initial.payload.new.last_message_preview = "hello";
    initial.payload.new.last_message_type = "text";
    initial.payload.new.last_message_sender_id = "sender-1";

    const readOnly = participant("UPDATE", 0, 2);
    Object.assign(readOnly.payload.new, initial.payload.new, { unread_count: 0 });

    assert.equal(shouldRefreshInboxSummary(initial, states), true);
    assert.equal(shouldRefreshInboxSummary(readOnly, states), false);
});
