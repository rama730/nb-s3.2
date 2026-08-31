import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TaskCard } from "../../src/components/projects/v2/tasks/TaskCard";
import { getTaskTitlePresentation } from "../../src/lib/projects/task-presentation";

test("the canonical title rule treats workflow Done as complete regardless of review state", () => {
  const done = getTaskTitlePresentation({ status: "done", title: "Ship it" });

  assert.equal(done.isCompleted, true);
  assert.match(done.className, /\bline-through\b/);
  assert.equal(done.ariaLabel, "Completed task: Ship it");

  for (const status of ["todo", "in_progress", "blocked", null]) {
    const active = getTaskTitlePresentation({ status, title: "Ship it" });
    assert.equal(active.isCompleted, false);
    assert.doesNotMatch(active.className, /\bline-through\b/);
    assert.equal(active.ariaLabel, undefined);
  }
});

function renderTask(status: string, reviewStatus: string) {
  return renderToStaticMarkup(
    React.createElement(TaskCard, {
      task: {
        id: `task-${status}-${reviewStatus}`,
        title: "Publish the release",
        status,
        reviewStatus,
        priority: "medium",
        taskNumber: 12,
      },
    }),
  );
}

test("task cards strike Done titles during review and restore active titles when reopened", () => {
  const completed = renderTask("done", "none");
  const pendingReview = renderTask("done", "pending");
  const reopened = renderTask("in_progress", "rejected");

  for (const html of [completed, pendingReview]) {
    assert.match(html, /line-through/);
    assert.match(html, /aria-label="Completed task: Publish the release"/);
  }
  assert.doesNotMatch(reopened, /line-through/);
  assert.doesNotMatch(reopened, /Completed task:/);
});

test("every task-oriented title surface consumes the shared Done presentation rule", () => {
  const consumers = [
    "src/components/projects/v2/tasks/TaskCard.tsx",
    "src/components/projects/tabs/sprint/SprintTimelineContent.tsx",
    "src/components/layout/header/GlobalSearchResultCards.tsx",
    "src/components/projects/v2/tasks/TaskDetailTabs/DetailsTab.tsx",
    "src/components/projects/v2/files-tab/picker/TaskSearchPicker.tsx",
    "src/components/projects/v2/files-tab/file/LinkedTasksPanel.tsx",
    "src/components/projects/v2/files-tab/TaskLinkPopover.tsx",
    "src/components/projects/analytics/AnalyticsMemberDetail.tsx",
    "src/components/projects/doc/ProjectDocReferencePreview.tsx",
  ];

  for (const consumer of consumers) {
    const source = fs.readFileSync(path.join(process.cwd(), consumer), "utf8");
    assert.match(
      source,
      /getTaskTitlePresentation/,
      `${consumer} must use the canonical Done-title presentation`,
    );
  }
});
