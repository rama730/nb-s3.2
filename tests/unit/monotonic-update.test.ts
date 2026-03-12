import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resetMonotonicEntity, runMonotonicUpdate } from "@/lib/state/monotonic";

describe("runMonotonicUpdate", () => {
  it("applies newer versions and rejects older stale updates", () => {
    const key = "test:entity:1";
    resetMonotonicEntity(key);

    const first = runMonotonicUpdate(key, 1, () => "v1");
    const stale = runMonotonicUpdate(key, 0, () => "v0");
    const newer = runMonotonicUpdate(key, 2, () => "v2");

    assert.equal(first, "v1");
    assert.equal(stale, null);
    assert.equal(newer, "v2");
  });

  it("allows equal versions for idempotent updates", () => {
    const key = "test:entity:2";
    resetMonotonicEntity(key);

    const first = runMonotonicUpdate(key, 10, () => 10);
    const equal = runMonotonicUpdate(key, 10, () => 11);

    assert.equal(first, 10);
    assert.equal(equal, 11);
  });
});

