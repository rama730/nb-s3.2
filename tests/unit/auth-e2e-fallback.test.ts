import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { isE2EAuthFallbackEnabled, verifyE2EHmac } from "@/lib/e2e/auth-fallback";

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

describe("SEC-L10 e2e auth HMAC gate", () => {
  const previousSecret = process.env.E2E_AUTH_HMAC_SECRET;
  const secret = "test-secret-for-e2e-hmac-gate";

  const makeRequest = (headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/e2e/auth", {
      method: "POST",
      headers,
    });

  it("skips verification when secret is unset", () => {
    delete process.env.E2E_AUTH_HMAC_SECRET;
    const result = verifyE2EHmac(makeRequest(), "");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.skipped, true);
    process.env.E2E_AUTH_HMAC_SECRET = previousSecret;
  });

  it("rejects missing signature headers when secret is set", () => {
    process.env.E2E_AUTH_HMAC_SECRET = secret;
    try {
      const result = verifyE2EHmac(makeRequest(), "");
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "missing_signature_headers");
    } finally {
      process.env.E2E_AUTH_HMAC_SECRET = previousSecret;
    }
  });

  it("rejects signature from a different secret", () => {
    process.env.E2E_AUTH_HMAC_SECRET = secret;
    try {
      const timestamp = String(Date.now());
      const rawBody = JSON.stringify({ email: "a", password: "b" });
      const badSignature = createHmac("sha256", "other-secret")
        .update(`${timestamp}\n${rawBody}`)
        .digest("hex");
      const result = verifyE2EHmac(
        makeRequest({
          "x-e2e-timestamp": timestamp,
          "x-e2e-signature": badSignature,
        }),
        rawBody,
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "signature_mismatch");
    } finally {
      process.env.E2E_AUTH_HMAC_SECRET = previousSecret;
    }
  });

  it("rejects requests outside the 5-minute skew window", () => {
    process.env.E2E_AUTH_HMAC_SECRET = secret;
    try {
      const timestamp = String(Date.now() - 10 * 60 * 1000);
      const rawBody = "";
      const signature = createHmac("sha256", secret)
        .update(`${timestamp}\n${rawBody}`)
        .digest("hex");
      const result = verifyE2EHmac(
        makeRequest({
          "x-e2e-timestamp": timestamp,
          "x-e2e-signature": signature,
        }),
        rawBody,
      );
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, "timestamp_skewed");
    } finally {
      process.env.E2E_AUTH_HMAC_SECRET = previousSecret;
    }
  });

  it("accepts a valid signature within the skew window", () => {
    process.env.E2E_AUTH_HMAC_SECRET = secret;
    try {
      const timestamp = String(Date.now());
      const rawBody = JSON.stringify({ email: "a", password: "b" });
      const signature = createHmac("sha256", secret)
        .update(`${timestamp}\n${rawBody}`)
        .digest("hex");
      const result = verifyE2EHmac(
        makeRequest({
          "x-e2e-timestamp": timestamp,
          "x-e2e-signature": signature,
        }),
        rawBody,
      );
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.skipped, false);
    } finally {
      process.env.E2E_AUTH_HMAC_SECRET = previousSecret;
    }
  });
});
