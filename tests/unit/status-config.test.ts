import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProfileStatusSummary,
  getExperienceLabel,
} from "@/lib/ui/status-config";

describe("status config", () => {
  it("returns canonical durable profile labels", () => {
    assert.equal(getExperienceLabel("lead"), "Lead");
  });

  it("builds a shared status summary for profile surfaces", () => {
    assert.deepEqual(
      buildProfileStatusSummary({
        experienceLevel: "senior",
        activeLabel: "Active 2m ago",
      }),
      {
        parts: ["Senior", "Active 2m ago"],
      },
    );
  });
});
