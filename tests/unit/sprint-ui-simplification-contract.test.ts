import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const sprintPlanningSource = readSource(
  "src/components/projects/tabs/SprintPlanning.tsx",
);
const sprintHeaderSource = readSource(
  "src/components/projects/tabs/sprint/SprintHeader.tsx",
);
const sprintLeftRailSource = readSource(
  "src/components/projects/tabs/sprint/SprintLeftRail.tsx",
);
const sprintTimelineContentSource = readSource(
  "src/components/projects/tabs/sprint/SprintTimelineContent.tsx",
);
const sprintDetailDrawerSource = readSource(
  "src/components/projects/tabs/sprint/SprintDetailDrawer.tsx",
);
const projectActionsSource = readSource("src/app/actions/project/_all.ts");

describe("sprint tab simplified interface contract", () => {
  it("keeps filter counts inside the compact more menu", () => {
    assert.match(
      sprintHeaderSource,
      /DropdownMenu/,
      "sprint filters should be exposed through a dropdown menu",
    );
    assert.match(
      sprintHeaderSource,
      /MoreHorizontal/,
      "the sprint header should use a three-dot options trigger",
    );
    for (const label of [
      "All work items",
      "Work items",
      "Blocked",
      "Complete",
      "Files",
    ]) {
      assert.match(
        sprintHeaderSource,
        new RegExp(label),
        `${label} should live inside the sprint options menu`,
      );
    }
    assert.match(
      sprintPlanningSource,
      /visibleCounts=\{timelineView\.visibleCounts\}/,
      "the header menu should receive the filtered count model",
    );
    assert.match(
      sprintPlanningSource,
      /onFilterChange=\{handleFilterChange\}/,
      "the header menu should own filter changes after removing the toolbar",
    );
  });

  it("removes the noisy main-area controls and status summaries", () => {
    assert.doesNotMatch(
      sprintPlanningSource,
      /SprintTimelineToolbar/,
      "the timeline toolbar should not render",
    );
    assert.doesNotMatch(
      sprintPlanningSource,
      /useSprintViewPreferences/,
      "local mode preferences should not drive this page",
    );
    assert.doesNotMatch(
      sprintHeaderSource,
      /SPRINT_STATUS_PRESENTATION/,
      "the main header should not show sprint status badges",
    );
    assert.doesNotMatch(
      sprintHeaderSource,
      /Progress|Activity|Baseline/,
      "progress, activity, and baseline cards should be removed",
    );
    assert.doesNotMatch(
      sprintTimelineContentSource,
      /SPRINT_STATUS_PRESENTATION/,
      "timeline closeout should not reintroduce planning or active status labels",
    );
  });

  it("uses one canonical chronological view while cleaning legacy mode query state", () => {
    assert.match(
      sprintPlanningSource,
      /mode:\s*"chronological"/,
      "the page should render the timeline as one stable chronological view",
    );
    assert.match(
      sprintPlanningSource,
      /params\.delete\("mode"\)/,
      "legacy grouped/files mode query parameters should be removed from sprint URLs",
    );
    assert.doesNotMatch(
      sprintPlanningSource,
      /resolvedViewState/,
      "the removed view-state abstraction should not remain as page-level mode plumbing",
    );
  });

  it("places the date next to the sprint name and moves copy below the divider", () => {
    const nameIndex = sprintHeaderSource.indexOf("{sprint.name}");
    const dateIndex = sprintHeaderSource.indexOf("{dateRange}");
    const dividerIndex = sprintHeaderSource.indexOf("border-t");
    const goalIndex = sprintHeaderSource.indexOf("{goal ||");

    assert.ok(nameIndex >= 0, "sprint name should be rendered in the header");
    assert.ok(
      dateIndex > nameIndex,
      "date range should render immediately after the sprint name",
    );
    assert.ok(
      dividerIndex > dateIndex,
      "the header copy area should be separated by a divider",
    );
    assert.ok(
      goalIndex > dividerIndex,
      "sprint title/description copy should live under the divider",
    );
  });

  it("keeps the sprint navigation rail sticky while the detail pane scrolls", () => {
    assert.match(
      sprintLeftRailSource,
      /lg:sticky/,
      "the sprint sidebar should stay visible on larger screens while the timeline scrolls",
    );
    assert.match(
      sprintPlanningSource,
      /overflow-y-auto app-scroll app-scroll-y app-scroll-gutter/,
      "only the detail timeline body should own the vertical scroll",
    );
  });

  it("uses a compact continuous timeline rail", () => {
    assert.match(sprintTimelineContentSource, /function TimelineNode/);
    assert.match(sprintTimelineContentSource, /bottom-\[-1\.5rem\] top-7 w-px/);
    assert.match(sprintTimelineContentSource, /<div className="space-y-6">/);
    assert.doesNotMatch(sprintTimelineContentSource, /bottom-\[-2\.5rem\]/);
    assert.doesNotMatch(sprintTimelineContentSource, /space-y-10/);
  });

  it("routes files directly to the Files workspace without a sprint file drawer", () => {
    assert.match(
      sprintTimelineContentSource,
      /new URLSearchParams\(\{ tab: "files", fileId: nodeId \}\)/,
    );
    assert.doesNotMatch(
      sprintTimelineContentSource,
      /onOpenDrawer\(\{ type: "file"/,
    );
    assert.doesNotMatch(sprintDetailDrawerSource, /File detail/);
    assert.doesNotMatch(sprintDetailDrawerSource, /getNodeMetadataBatch/);
  });

  it("hydrates and describes task file version activity", () => {
    assert.match(projectActionsSource, /ROW_NUMBER\(\) OVER/);
    assert.match(projectActionsSource, /ranked\.version_rank <= 3/);
    assert.match(projectActionsSource, /versionEvents,/);
    assert.match(
      sprintTimelineContentSource,
      /updated\{" "\}/,
    );
    assert.match(
      sprintTimelineContentSource,
      /to V\{row\.versionEvent\.versionNumber\} for \{taskLabel\}/,
    );
  });
});
