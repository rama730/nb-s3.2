import assert from "node:assert/strict";
import test from "node:test";
import { consumeRouteClassLoadShedding } from "@/lib/routing/load-shedding";

test("route load shedding returns a consistent shape when disabled", async () => {
  const originalFlag = process.env.LOAD_SHEDDING_ENABLED;
  process.env.LOAD_SHEDDING_ENABLED = "false";

  try {
    const result = await consumeRouteClassLoadShedding("public_cached");

    assert.deepEqual(result, {
      enabled: false,
      allowed: true,
      degraded: false,
      resetAt: null,
      remaining: null,
      policy: {
        routeClass: "public_cached",
        burst: result.policy.burst,
        refillRate: result.policy.refillRate,
        failMode: "stale_or_shed",
      },
    });
    assert.equal(typeof result.policy.burst, "number");
    assert.equal(typeof result.policy.refillRate, "number");
  } finally {
    if (originalFlag === undefined) {
      delete process.env.LOAD_SHEDDING_ENABLED;
    } else {
      process.env.LOAD_SHEDDING_ENABLED = originalFlag;
    }
  }
});

test("route load shedding returns the same shape when enabled", async () => {
  const originalFlag = process.env.LOAD_SHEDDING_ENABLED;
  process.env.LOAD_SHEDDING_ENABLED = "true";

  try {
    const result = await consumeRouteClassLoadShedding("public_cached");

    assert.equal(result.enabled, true);
    assert.equal(typeof result.allowed, "boolean");
    assert.equal(typeof result.degraded, "boolean");
    assert.equal(typeof result.resetAt, "number");
    assert.equal(typeof result.remaining, "number");
    assert.equal(result.policy.routeClass, "public_cached");
  } finally {
    if (originalFlag === undefined) {
      delete process.env.LOAD_SHEDDING_ENABLED;
    } else {
      process.env.LOAD_SHEDDING_ENABLED = originalFlag;
    }
  }
});
