import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { moveWidget, resizeWidget } from "../../src/components/workspace/dashboard/gridEngine";
import type { WorkspaceLayout } from "../../src/components/workspace/dashboard/types";
import { doWidgetsOverlap } from "../../src/components/workspace/dashboard/validation";

const baseLayout: WorkspaceLayout = {
  version: 1,
  widgets: [
    { widgetId: "quick_notes", col: 0, row: 0, colSpan: 2, rowSpan: 1 },
    { widgetId: "todays_focus", col: 0, row: 1, colSpan: 2, rowSpan: 1 },
    { widgetId: "recent_activity", col: 2, row: 0, colSpan: 2, rowSpan: 1 },
  ],
};

describe("workspace grid engine", () => {
  it("keeps layout collision-free after move compaction", () => {
    const moved = moveWidget(baseLayout, "recent_activity", 0, 0);
    assert.ok(moved);
    assert.equal(moved.widgets.length, 3);

    for (let i = 0; i < moved.widgets.length; i += 1) {
      for (let j = i + 1; j < moved.widgets.length; j += 1) {
        assert.equal(doWidgetsOverlap(moved.widgets[i], moved.widgets[j]), false);
      }
    }
  });

  it("rejects invalid resize that exceeds constraints", () => {
    const resized = resizeWidget(baseLayout, "quick_notes", 6, 3);
    assert.equal(resized, null);
  });
});
