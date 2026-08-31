import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toPrivacySafeRouteMetric } from "../../src/lib/routing/route-metric";

describe("toPrivacySafeRouteMetric", () => {
  it("keeps known route structure", () => {
    assert.equal(
      toPrivacySafeRouteMetric("/api/v1/messages/attachments"),
      "/api/v1/messages/attachments",
    );
  });

  it("redacts usernames, slugs, and identifiers", () => {
    assert.equal(toPrivacySafeRouteMetric("/u/alice-private"), "/u/:dynamic");
    assert.equal(
      toPrivacySafeRouteMetric("/projects/private-project/settings"),
      "/projects/:dynamic/settings",
    );
    assert.equal(
      toPrivacySafeRouteMetric("/projects/0190da2b-6fa1-733a-9abc-112233445566/files"),
      "/projects/:id/files",
    );
  });

  it("drops query strings and bounds label depth", () => {
    assert.equal(
      toPrivacySafeRouteMetric("/api/v1/projects/123/files/456/preview?token=secret"),
      "/api/v1/projects/:id/files/:id",
    );
  });
});
