import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateTaskTimeHealth } from "@/lib/projects/task-presentation";

describe("task time health", () => {
  it("keeps a completed task overdue when completion follows its due day in an active sprint", () => {
    const health = calculateTaskTimeHealth(
      {
        status: "done",
        dueDate: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-12T09:00:00.000Z",
      },
      {
        status: "active",
        endDate: "2026-08-20T00:00:00.000Z",
      },
    );

    assert.equal(health.state, "overdue");
    assert.equal(health.label, "Overdue");
    assert.equal(health.daysLate, 3);
  });
});
