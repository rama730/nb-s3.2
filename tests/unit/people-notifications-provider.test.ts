import test from "node:test";
import assert from "node:assert/strict";

import { getPeopleNotificationsRetryDelay } from "@/components/providers/PeopleNotificationsProvider";

test("people notifications backoff is exponential and bounded", () => {
  assert.equal(getPeopleNotificationsRetryDelay(1), 1_000);
  assert.equal(getPeopleNotificationsRetryDelay(2), 2_000);
  assert.equal(getPeopleNotificationsRetryDelay(3), 4_000);
  assert.equal(getPeopleNotificationsRetryDelay(10), 30_000);
});
