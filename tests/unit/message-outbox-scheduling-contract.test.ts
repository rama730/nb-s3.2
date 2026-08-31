import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("the global message outbox only schedules work when an item is due", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/hooks/useMessagesV2OutboxSync.ts"),
    "utf8",
  );

  assert.match(source, /function nextFlushDelay/, "retry timing should be derived from queued outbox items");
  assert.match(source, /useMessagesV2OutboxStore\.subscribe/, "outbox changes should wake the scheduler immediately");
  assert.match(source, /window\.setTimeout\(\(\) =>/, "the next retry should use one timer");
  assert.doesNotMatch(source, /setInterval\(/, "the authenticated shell must not poll the outbox continuously");
});
