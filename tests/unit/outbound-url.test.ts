import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UnsafeOutboundUrlError,
  assertPublicNetworkUrl,
  fetchPublicUrlWithRedirectValidation,
  isBlockedIpAddress,
} from "@/lib/security/outbound-url";

describe("outbound URL safeguards", () => {
  it("blocks private and loopback IP addresses", () => {
    assert.equal(isBlockedIpAddress("127.0.0.1"), true);
    assert.equal(isBlockedIpAddress("10.0.0.8"), true);
    assert.equal(isBlockedIpAddress("192.168.1.10"), true);
    assert.equal(isBlockedIpAddress("::1"), true);
    assert.equal(isBlockedIpAddress("fd00::1"), true);
    assert.equal(isBlockedIpAddress("2001::1"), true);
    assert.equal(isBlockedIpAddress("2002:c000:0204::"), true);
    assert.equal(isBlockedIpAddress("64:ff9b::808:808"), true);
    assert.equal(isBlockedIpAddress("100::1"), true);
    assert.equal(isBlockedIpAddress("::ffff:192.168.1.10"), true);
    assert.equal(isBlockedIpAddress("0:0:0:0:0:ffff:c0a8:010a"), true);
    assert.equal(isBlockedIpAddress("::ffff:8.8.8.8"), false);
    assert.equal(isBlockedIpAddress("0:0:0:0:0:ffff:0808:0808"), false);
    assert.equal(isBlockedIpAddress("8.8.8.8"), false);
    assert.equal(isBlockedIpAddress("2606:4700:4700::1111"), false);
  });

  it("rejects localhost-style hosts before fetch", async () => {
    await assert.rejects(
      assertPublicNetworkUrl("http://localhost:3000/test"),
      UnsafeOutboundUrlError,
    );
    await assert.rejects(
      assertPublicNetworkUrl("http://service.internal/test"),
      UnsafeOutboundUrlError,
    );
  });

  it("accepts public URLs when DNS resolves to public addresses", async () => {
    const url = await assertPublicNetworkUrl("https://example.com/path?q=1", {
      resolveAddresses: async () => ["93.184.216.34"],
    });

    assert.equal(url.hostname, "example.com");
    assert.equal(url.pathname, "/path");
  });

  it("rejects hosts that resolve to private addresses", async () => {
    await assert.rejects(
      assertPublicNetworkUrl("https://example.com/path", {
        resolveAddresses: async () => ["10.0.0.4"],
      }),
      UnsafeOutboundUrlError,
    );
  });

  it("respects a caller-provided abort signal while preserving timeout cleanup", async () => {
    const controller = new AbortController();

    await assert.rejects(
      fetchPublicUrlWithRedirectValidation({
        url: "https://example.com/path",
        init: {
          signal: controller.signal,
        },
        resolveAddresses: async () => ["93.184.216.34"],
        fetchImpl: async (_url, init) => {
          controller.abort();
          if (init?.signal?.aborted) {
            throw new DOMException("The operation was aborted.", "AbortError");
          }
          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("The operation was aborted.", "AbortError")),
              { once: true },
            );
          });
        },
      }),
      (error: unknown) =>
        error instanceof DOMException &&
        error.name === "AbortError",
    );
  });
});
