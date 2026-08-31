import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProjectSprintDetailHref,
  buildProjectSprintTabHref,
} from "@/lib/projects/sprint-detail";

describe("sprint canonical routes", () => {
  it("uses a stable human Sprint code instead of a mutable name or UUID", () => {
    assert.equal(
      buildProjectSprintDetailHref("network-for-builders", "sprint-uuid", { sprintCode: "SPR-12" }),
      "/projects/network-for-builders?tab=sprints&sprint=SPR-12",
    );
  });

  it("retains a legacy ID fallback while callers migrate to Sprint codes", () => {
    assert.equal(
      buildProjectSprintDetailHref("network-for-builders", "sprint-uuid"),
      "/projects/network-for-builders?tab=sprints&sprintId=sprint-uuid",
    );
  });

  it("encodes project slugs safely", () => {
    assert.equal(
      buildProjectSprintTabHref("network/builders & co"),
      "/projects/network%2Fbuilders%20%26%20co?tab=sprints",
    );
  });
});
