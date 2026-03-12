import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isE2EAuthFallbackEnabled } from "@/lib/e2e/auth-fallback";

describe("e2e auth fallback gating", () => {
  it("is disabled in production regardless of flags", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFlag = process.env.E2E_AUTH_FALLBACK;
    try {
      Reflect.set(process.env, "NODE_ENV", "production");
      process.env.E2E_AUTH_FALLBACK = "1";
      assert.equal(isE2EAuthFallbackEnabled(), false);
    } finally {
      Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
      process.env.E2E_AUTH_FALLBACK = previousFlag;
    }
  });

  it("requires test harness marker when fallback flag is enabled", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFlag = process.env.E2E_AUTH_FALLBACK;
    const previousPlaywright = process.env.PLAYWRIGHT_TEST;
    try {
      Reflect.set(process.env, "NODE_ENV", "development");
      process.env.E2E_AUTH_FALLBACK = "1";
      delete process.env.PLAYWRIGHT_TEST;
      assert.equal(isE2EAuthFallbackEnabled(), false);
      process.env.PLAYWRIGHT_TEST = "1";
      assert.equal(isE2EAuthFallbackEnabled(), true);
    } finally {
      Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
      process.env.E2E_AUTH_FALLBACK = previousFlag;
      process.env.PLAYWRIGHT_TEST = previousPlaywright;
    }
  });
});
