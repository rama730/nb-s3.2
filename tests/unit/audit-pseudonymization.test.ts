import assert from "node:assert/strict";
import test from "node:test";
import { buildPseudonymizedAuditRequestMetadata } from "@/lib/audit/request-metadata";

test("audit pseudonymization stores stable fingerprints instead of raw request identifiers", () => {
  const previousSecret = process.env.AUDIT_METADATA_HASH_SECRET;
  process.env.AUDIT_METADATA_HASH_SECRET = "unit-test-audit-secret";

  try {
    const request = new Request("https://example.com", {
      headers: {
        "x-real-ip": "198.51.100.10",
        "user-agent": "UnitTestBrowser/1.0 (Test OS)",
      },
    });

    const first = buildPseudonymizedAuditRequestMetadata(request);
    const second = buildPseudonymizedAuditRequestMetadata(request);

    assert.deepEqual(first, second);
    assert.match(first.networkFingerprint ?? "", /^network_[0-9a-f]{16}$/);
    assert.match(first.deviceFingerprint ?? "", /^device_[0-9a-f]{16}$/);
    assert.notEqual(first.networkFingerprint, "198.51.100.10");
    assert.notEqual(first.deviceFingerprint, "UnitTestBrowser/1.0 (Test OS)");
  } finally {
    if (previousSecret === undefined) {
      delete process.env.AUDIT_METADATA_HASH_SECRET;
    } else {
      process.env.AUDIT_METADATA_HASH_SECRET = previousSecret;
    }
  }
});

test("audit pseudonymization differentiates network and device inputs", () => {
  const previousSecret = process.env.AUDIT_METADATA_HASH_SECRET;
  process.env.AUDIT_METADATA_HASH_SECRET = "unit-test-audit-secret";

  try {
    const request = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "203.0.113.5",
        "user-agent": "DeviceA/1.0",
      },
    });
    const nextRequest = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "203.0.113.6",
        "user-agent": "DeviceB/1.0",
      },
    });

    const first = buildPseudonymizedAuditRequestMetadata(request);
    const second = buildPseudonymizedAuditRequestMetadata(nextRequest);

    assert.notEqual(first.networkFingerprint, second.networkFingerprint);
    assert.notEqual(first.deviceFingerprint, second.deviceFingerprint);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.AUDIT_METADATA_HASH_SECRET;
    } else {
      process.env.AUDIT_METADATA_HASH_SECRET = previousSecret;
    }
  }
});
