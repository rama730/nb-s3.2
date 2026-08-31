import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeNotificationCursor,
  encodeNotificationCursor,
  InvalidNotificationCursorError,
} from "@/lib/notifications/cursor";

test("notification cursor is exact and UUID-bound", () => {
  const cursor = {
    activityAt: "2026-08-16T00:00:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
  };
  assert.deepEqual(decodeNotificationCursor(encodeNotificationCursor(cursor)), cursor);
  assert.equal(decodeNotificationCursor(null), null);
  assert.throws(
    () => decodeNotificationCursor(Buffer.from(`${cursor.activityAt}:::not-a-uuid`).toString("base64")),
    InvalidNotificationCursorError,
  );
  assert.throws(() => decodeNotificationCursor("%%%"), InvalidNotificationCursorError);
});
