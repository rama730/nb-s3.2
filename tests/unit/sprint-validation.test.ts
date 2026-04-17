import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addDaysToSprintDateInput,
  buildSprintDeleteImpact,
  buildSprintEditorDraft,
  createSprintDraftSchema,
  getDefaultSprintDateRange,
  getSprintDurationSummary,
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

  it("builds a normalized sprint editor draft for new and existing sprints", () => {
    const draft = buildSprintEditorDraft({
      sprintCount: 2,
      referenceDate: new Date("2026-04-09T00:00:00.000Z"),
    });
    assert.deepEqual(draft, {
      name: "Sprint 3",
      goal: "",
      description: "",
      startDate: "2026-04-09",
      endDate: "2026-04-23",
    });

    const existing = buildSprintEditorDraft({
      sprint: {
        name: "Sprint 4",
        goal: "Finish the quieter header",
        description: "Carry the editor improvements through the sprint surface.",
        startDate: "2026-04-24T00:00:00.000Z",
        endDate: "2026-05-08T00:00:00.000Z",
      },
    });
    assert.deepEqual(existing, {
      name: "Sprint 4",
      goal: "Finish the quieter header",
      description: "Carry the editor improvements through the sprint surface.",
      startDate: "2026-04-24",
      endDate: "2026-05-08",
    });
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

  it("builds delete impact and duration summaries for the editor", () => {
    assert.deepEqual(
      buildSprintDeleteImpact({
        sprint: {
          id: "sprint-1",
          name: "Sprint 1",
          status: "completed",
        },
        affectedTaskCount: 3,
      }),
      {
        sprintId: "sprint-1",
        sprintName: "Sprint 1",
        sprintStatus: "completed",
        affectedTaskCount: 3,
        canDelete: true,
        reason: null,
      },
    );

    const blocked = buildSprintDeleteImpact({
      sprint: {
        id: "sprint-2",
        name: "Sprint 2",
        status: "active",
      },
      affectedTaskCount: 5,
    });
    assert.equal(blocked.canDelete, false);
    assert.match(blocked.reason ?? "", /completed before/i);

    assert.deepEqual(getSprintDurationSummary("2026-04-09", "2026-04-23"), {
      durationDays: 14,
      durationWeeks: 2,
      label: "14 days · 2 weeks",
    });

    assert.equal(getSprintDurationSummary("2026-04-23", "2026-04-09"), null);
  });
});
