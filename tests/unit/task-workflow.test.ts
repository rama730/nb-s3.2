import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TASK_BOARD_COLUMNS,
  TASK_PRIORITY_VALUES,
  TASK_WORKFLOW_STATUSES,
  getTaskPriorityPresentation,
  getTaskStatusPresentation,
} from "@/lib/projects/task-workflow";

describe("task workflow config", () => {
  it("keeps board columns aligned with the canonical status order", () => {
    assert.deepEqual(
      TASK_BOARD_COLUMNS.map((column) => column.id),
      TASK_WORKFLOW_STATUSES,
    );
  });

  it("returns canonical status labels and tones", () => {
    const blocked = getTaskStatusPresentation("blocked");
    assert.equal(blocked.label, "Blocked");
    assert.match(blocked.badgeClassName, /rose/);
  });

  it("returns canonical priority labels and tones", () => {
    assert.deepEqual(TASK_PRIORITY_VALUES, ["low", "medium", "high", "urgent"]);
    assert.equal(getTaskPriorityPresentation("urgent").label, "Urgent");
  });
});
