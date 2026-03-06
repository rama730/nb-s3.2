import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

;(process.env as Record<string, string | undefined>).NODE_ENV = "test";
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let consumeRateLimit: typeof import("../../src/lib/security/rate-limit").consumeRateLimit;
let consumeRateLimitForRoute: typeof import("../../src/lib/security/rate-limit").consumeRateLimitForRoute;

describe("consumeRateLimit policy overrides", () => {
  before(async () => {
    const mod = await import("../../src/lib/security/rate-limit");
    consumeRateLimit = mod.consumeRateLimit;
    consumeRateLimitForRoute = mod.consumeRateLimitForRoute;
  });

  it("allows requests when fallback=allow even in distributed-only mode", async () => {
    const key = `policy-allow-${Date.now()}`;
    const result = await consumeRateLimit(key, 10, 60, {
      mode: "distributed-only",
      fallback: "allow",
    });
    assert.equal(result.allowed, true);
  });

  it("denies requests when fallback=deny in distributed-only mode", async () => {
    const key = `policy-deny-${Date.now()}`;
    const result = await consumeRateLimit(key, 10, 60, {
      mode: "distributed-only",
      fallback: "deny",
    });
    assert.equal(result.allowed, false);
  });

  it("uses health route policy to allow on Redis unavailability", async () => {
    const key = `policy-health-${Date.now()}`;
    const result = await consumeRateLimitForRoute("health", key, 10, 60);
    assert.equal(result.allowed, true);
  });
});

