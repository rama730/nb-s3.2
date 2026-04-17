import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getTrustedHeadersIp, getTrustedRequestIp } from "@/lib/security/request-ip";

describe("trusted request ip", () => {
  it("ignores forwarded headers in production without a trusted proxy marker", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      Reflect.set(process.env, "NODE_ENV", "production");
      const request = new Request("https://example.com/api/test", {
        headers: {
          "x-forwarded-for": "203.0.113.10",
        },
      });

      assert.equal(getTrustedRequestIp(request), null);
    } finally {
      Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
    }
  });

  it("accepts forwarded headers in production when a trusted proxy marker is present", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      Reflect.set(process.env, "NODE_ENV", "production");
      const request = new Request("https://example.com/api/test", {
        headers: {
          "x-vercel-id": "iad1::abc123",
          "x-forwarded-for": "203.0.113.10, 198.51.100.5",
        },
      });

      assert.equal(getTrustedRequestIp(request), "203.0.113.10");
    } finally {
      Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
    }
  });

  it("accepts trusted forwarded headers from a header-only source", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      Reflect.set(process.env, "NODE_ENV", "production");
      const headers = new Headers({
        "cf-ray": "abc123",
        "x-real-ip": "198.51.100.9",
      });

      assert.equal(getTrustedHeadersIp(headers), "198.51.100.9");
    } finally {
      Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
    }
  });
});
