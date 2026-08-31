import assert from "node:assert/strict";
import test from "node:test";

import { getGuidanceCapacityState } from "@/lib/projects/guidance-capacity";

test("guidance capacity warns at ten active appointments and blocks at twelve", () => {
    assert.equal(getGuidanceCapacityState(9), "available");
    assert.equal(getGuidanceCapacityState(10), "warning");
    assert.equal(getGuidanceCapacityState(12), "blocked");
});
