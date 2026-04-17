import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

;(process.env as Record<string, string | undefined>).NODE_ENV = "test";
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let consumeRateLimit: typeof import("../../src/lib/security/rate-limit").consumeRateLimit;
let consumeRateLimitForRoute: typeof import("../../src/lib/security/rate-limit").consumeRateLimitForRoute;
let resolveScopeFailMode: typeof import("../../src/lib/security/rate-limit").resolveScopeFailMode;

describe("consumeRateLimit policy overrides", () => {
  before(async () => {
    const mod = await import("../../src/lib/security/rate-limit");
    consumeRateLimit = mod.consumeRateLimit;
    consumeRateLimitForRoute = mod.consumeRateLimitForRoute;
    resolveScopeFailMode = mod.resolveScopeFailMode;
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

  it("resolves scope-based fail modes for credential surfaces", () => {
    assert.equal(resolveScopeFailMode("auth:login:ip:1.2.3.4"), "fail_closed");
    assert.equal(resolveScopeFailMode("login:user:abc"), "fail_closed");
    assert.equal(resolveScopeFailMode("password:change:user:abc"), "fail_closed");
    assert.equal(resolveScopeFailMode("mfa:totp:user:abc"), "fail_closed");
    assert.equal(resolveScopeFailMode("recovery:redeem:user:abc"), "fail_closed");
    assert.equal(resolveScopeFailMode("account:delete:user:abc"), "fail_closed");
    assert.equal(resolveScopeFailMode("onboarding:username-check:user:abc"), "fail_closed");
    assert.equal(resolveScopeFailMode("upload:avatar:user:abc"), "fail_closed");
    assert.equal(resolveScopeFailMode("admin-reserved-usernames:user:abc"), "fail_closed");
    assert.equal(resolveScopeFailMode("connections-send:user:abc"), "fail_closed");
  });

  it("resolves soft fail modes for non-sensitive hot paths", () => {
    assert.equal(resolveScopeFailMode("presence:user:abc"), "stale_or_shed");
    assert.equal(resolveScopeFailMode("typing:user:abc"), "stale_or_shed");
    assert.equal(resolveScopeFailMode("realtime:user:abc"), "stale_or_shed");
  });

  it("returns undefined for unknown scopes so default fail mode applies", () => {
    assert.equal(resolveScopeFailMode("task:user:abc"), undefined);
    assert.equal(resolveScopeFailMode("msg:user:abc"), undefined);
    assert.equal(resolveScopeFailMode("some-random-key"), undefined);
  });
});

