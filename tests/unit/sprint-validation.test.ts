import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addDaysToSprintDateInput,
  createSprintDraftSchema,
  getDefaultSprintDateRange,
  parseSprintDateInput,
} from "@/lib/projects/sprints";

describe("sprint validation", () => {
  it("builds a valid default sprint date range", () => {
    const defaults = getDefaultSprintDateRange(new Date("2026-04-09T15:30:00.000Z"));

    assert.equal(defaults.startDate, "2026-04-09");
    assert.equal(defaults.endDate, "2026-04-23");
  });

  it("adds sprint duration days without drifting the date string", () => {
    assert.equal(addDaysToSprintDateInput("2026-04-09", 7), "2026-04-16");
    assert.equal(addDaysToSprintDateInput("2026-12-28", 14), "2027-01-11");
  });

  it("rejects invalid sprint date strings", () => {
    assert.throws(() => parseSprintDateInput(""), /format/i);
    assert.throws(() => parseSprintDateInput("2026-02-30"), /invalid/i);
  });

  it("requires valid sprint dates and a positive date range", () => {
    const missingDates = createSprintDraftSchema.safeParse({
      name: "Sprint 1",
      startDate: "",
      endDate: "",
    });
    assert.equal(missingDates.success, false);

    const reversedRange = createSprintDraftSchema.safeParse({
      name: "Sprint 1",
      startDate: "2026-04-10",
      endDate: "2026-04-10",
    });
    assert.equal(reversedRange.success, false);

    const valid = createSprintDraftSchema.safeParse({
      name: "Sprint 1",
      goal: "Ship the first milestone",
      description: "Keep the team focused on delivery.",
      startDate: "2026-04-10",
      endDate: "2026-04-24",
    });
    assert.equal(valid.success, true);
  });
});
