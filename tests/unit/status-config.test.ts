import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProfileStatusSummary,
  getAvailabilityColor,
  getAvailabilityLabel,
  getExperienceLabel,
} from "@/lib/ui/status-config";

describe("status config", () => {
  it("returns canonical labels and colors", () => {
    assert.equal(getAvailabilityLabel("busy"), "Busy");
    assert.equal(getAvailabilityColor("busy"), "text-amber-500");
    assert.equal(getExperienceLabel("lead"), "Lead");
  });

  it("builds a shared status summary for profile surfaces", () => {
    assert.deepEqual(
      buildProfileStatusSummary({
        availabilityStatus: "available",
        experienceLevel: "senior",
        activeLabel: "Active 2m ago",
      }),
      {
        parts: ["Available", "Senior", "Active 2m ago"],
        availabilityColor: "text-emerald-500",
      },
    );
  });
});
