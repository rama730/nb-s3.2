import assert from "node:assert/strict";
import test from "node:test";
import { getInformationalRequestIp, getRequestUserAgent } from "@/lib/audit/request-metadata";

test("audit request metadata prefers runtime remote address hints", () => {
  const request = new Request("https://example.com", {
    headers: {
      "x-real-ip": "198.51.100.10",
      "x-forwarded-for": "203.0.113.5, 203.0.113.6",
    },
  });

  Object.defineProperty(request, "ip", {
    configurable: true,
    value: "10.0.0.8",
  });

  assert.equal(getInformationalRequestIp(request), "10.0.0.8");
});

test("audit request metadata falls back to x-real-ip before x-forwarded-for", () => {
  const request = new Request("https://example.com", {
    headers: {
      "x-real-ip": "198.51.100.10",
      "x-forwarded-for": "203.0.113.5, 203.0.113.6",
    },
  });

  assert.equal(getInformationalRequestIp(request), "198.51.100.10");
});

test("audit request metadata uses the first forwarded-for address when needed", () => {
  const request = new Request("https://example.com", {
    headers: {
      "x-forwarded-for": "203.0.113.5, 203.0.113.6",
      "user-agent": "UnitTestAgent/1.0",
    },
  });

  assert.equal(getInformationalRequestIp(request), "203.0.113.5");
  assert.equal(getRequestUserAgent(request), "UnitTestAgent/1.0");
});
