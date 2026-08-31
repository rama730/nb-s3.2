import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatSprintTaskSummary,
  sprintTimelinePersonName,
} from "@/lib/projects/sprint-presentation";

describe("sprint presentation", () => {
  it("uses neutral attribution fallbacks", () => {
    assert.equal(sprintTimelinePersonName(null), "A project member");
    assert.equal(sprintTimelinePersonName({ fullName: "  Ramanaidu Ch  " }), "Ramanaidu Ch");
  });

  it("shows the current owner before the bold task name without reversing assignment grammar", () => {
    assert.equal(
      formatSprintTaskSummary({ assignee: { fullName: "Rama" }, title: "Update the related files" }),
      "Rama · Update the related files",
    );
    assert.equal(
      formatSprintTaskSummary({ assignee: null, title: "Unclaimed work" }),
      "Unassigned · Unclaimed work",
    );
  });
});
