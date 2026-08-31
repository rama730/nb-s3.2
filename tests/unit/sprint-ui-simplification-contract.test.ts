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
const sprintTimelineSource = readSource(
  "src/components/projects/tabs/sprint/SprintTimelineContent.tsx",
);
const sprintLifecycleModalsSource = readSource(
  "src/components/projects/tabs/sprint/SprintLifecycleModals.tsx",
);
const sprintEditorSource = readSource(
  "src/components/projects/v2/sprints/CreateSprintModal.tsx",
);
const sprintActionsSource = readSource("src/app/actions/project/_all.ts");

describe("sprint tab target architecture contract", () => {
  it("keeps canonical Sprint and task references in URLs", () => {
    assert.match(sprintPlanningSource, /selectedSprint\.code/);
    assert.match(sprintPlanningSource, /params\.delete\("sprintId"\)/);
    assert.match(
      sprintPlanningSource,
      /params\.set\("sprint", selectedSprint\.code\)/,
    );
    assert.match(sprintTimelineSource, /projectKey\?\.trim\(\) \|\| "Task"/);
    assert.match(sprintTimelineSource, /drawerId: taskReference \?\? task\.id/);
    assert.doesNotMatch(sprintTimelineSource, /`NB-\$\{task\.taskNumber\}`/);
  });

  it("shows the compact authoritative Sprint header", () => {
    assert.match(sprintHeaderSource, /\{sprint\.code\}/);
    assert.match(sprintHeaderSource, /SPRINT_STATUS_PRESENTATION/);
    assert.match(sprintHeaderSource, /formatSprintDateRange/);
    assert.match(sprintHeaderSource, /\{sprint\.name\}/);
    assert.doesNotMatch(sprintHeaderSource, /Progress|Activity|Baseline/);
  });

  it("implements the schedule-owned lifecycle instead of a manual status toggle", () => {
    for (const control of ["Close sprint", "Cancel sprint", "Archive sprint"]) {
      assert.match(sprintHeaderSource, new RegExp(control));
    }
    assert.match(sprintHeaderSource, /Starts automatically on schedule/);
    assert.doesNotMatch(sprintHeaderSource, /Start sprint|Reopen sprint/);
    assert.match(sprintLifecycleModalsSource, /unfinishedChoice/);
    assert.match(sprintLifecycleModalsSource, /Move to backlog/);
    assert.match(sprintLifecycleModalsSource, /Move to a Planning Sprint/);
    assert.match(sprintLifecycleModalsSource, /DialogContent/);
    assert.match(sprintLifecycleModalsSource, /DialogTitle/);
    assert.doesNotMatch(sprintLifecycleModalsSource, /role="alertdialog"/);
  });

  it("uses compact lifecycle and health summaries with explicit pagination", () => {
    assert.match(sprintTimelineSource, /aria-label="Sprint summary"/);
    assert.match(sprintTimelineSource, /aria-label="Sprint lifecycle"/);
    assert.match(sprintTimelineSource, /Assign tasks from the Task board/);
    assert.match(sprintTimelineSource, /hasMore && onLoadMore/);
    assert.match(sprintTimelineSource, /Load more tasks/);
    assert.doesNotMatch(sprintTimelineSource, /IntersectionObserver/);
  });

  it("categorizes linked files and keeps discussion owned by the Task panel", () => {
    assert.match(sprintTimelineSource, /role === "deliverable"/);
    assert.match(sprintTimelineSource, /role === "working"/);
    assert.match(sprintTimelineSource, /role === "reference"/);
    assert.match(sprintTimelineSource, /Final Deliverables/);
    assert.match(sprintTimelineSource, /Task References/);
    assert.match(sprintTimelineSource, /TASK_WORKING_FILES_TITLE/);
    assert.doesNotMatch(
      sprintTimelineSource,
      /getProjectTaskActivityAction|includeComments|animate-pulse/,
    );
  });

  it("uses accessible disclosure and motion behavior without the blue task outline", () => {
    assert.match(sprintTimelineSource, /aria-expanded=\{isExpanded\}/);
    assert.match(sprintTimelineSource, /aria-controls=/);
    assert.match(
      sprintTimelineSource,
      /aria-label=\{`\$\{isExpanded \? "Collapse" : "Expand"\}/,
    );
    assert.match(sprintTimelineSource, /focus-visible:outline/);
    assert.doesNotMatch(sprintTimelineSource, /ring-blue|outline-blue/);
  });

  it("groups current and historical Sprints and removes the obsolete drawer", () => {
    assert.match(sprintLeftRailSource, /Current/);
    assert.match(sprintLeftRailSource, /Upcoming/);
    assert.match(sprintLeftRailSource, /Completed/);
    assert.match(sprintLeftRailSource, /Cancelled/);
    assert.match(sprintLeftRailSource, /Archived/);
    assert.equal(
      fs.existsSync(
        path.join(
          process.cwd(),
          "src/components/projects/tabs/sprint/SprintDetailDrawer.tsx",
        ),
      ),
      false,
    );
  });

  it("keeps date handling, editor state, and time-based lifecycle ownership deterministic", () => {
    assert.match(sprintTimelineSource, /completedAt/);
    assert.match(sprintEditorSource, /initializedDraftKeyRef/);
    assert.match(
      sprintActionsSource,
      /a read must not mutate Sprint lifecycle state/,
    );
    assert.doesNotMatch(sprintActionsSource, /await startDueSprints\(/);
  });

  it("does not query a non-existent task completion timestamp", () => {
    assert.doesNotMatch(sprintActionsSource, /\bt\.completed_at\b/);
    assert.match(
      sprintActionsSource,
      /tasks persist status and updated_at, not a completed_at/,
    );
  });
});
