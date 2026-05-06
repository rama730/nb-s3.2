import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAttachCandidateHints,
  buildTaskFileChoicePreview,
  buildTaskFileOutcomeSummary,
  formatTaskFileRoleSummaryLabel,
  getTaskFileResolutionChoiceCopy,
  summarizeTaskFileWarningNextStep,
  summarizeTaskFileRoles,
} from "@/lib/projects/task-file-presentation";

test("summarizeTaskFileRoles groups attachments into deliverable, working, and reference buckets", () => {
  const summary = summarizeTaskFileRoles([
    { name: "final-report.pdf", type: "file", path: "/final-report.pdf", annotation: null },
    { name: "working-draft.md", type: "file", path: "/working-draft.md", annotation: null },
    { name: "project-spec.docx", type: "file", path: "/project-spec.docx", annotation: null },
  ]);

  assert.deepEqual(summary, [
    { label: "Deliverables", count: 1 },
    { label: "Working", count: 1 },
    { label: "Reference", count: 1 },
  ]);
});

test("formatTaskFileRoleSummaryLabel returns a calm fallback when no roles are present", () => {
  assert.equal(formatTaskFileRoleSummaryLabel([]), "No file roles detected yet");
  assert.equal(
    formatTaskFileRoleSummaryLabel([
      { label: "Deliverables", count: 2 },
      { label: "Working", count: 1 },
    ]),
    "2 deliverables · 1 working",
  );
});

test("getTaskFileResolutionChoiceCopy returns distinct file and folder copy", () => {
  assert.deepEqual(getTaskFileResolutionChoiceCopy("replace", "file"), {
    label: "Replace existing link",
    description: "Use the new file for this task and unlink the older direct task file.",
  });

  assert.deepEqual(getTaskFileResolutionChoiceCopy("merge", "folder"), {
    label: "Merge into existing folder",
    description:
      "Drop these files into the linked folder. Matching names get saved as new files alongside originals.",
  });

  assert.deepEqual(getTaskFileResolutionChoiceCopy("subfolder", "folder"), {
    label: "Add as a subfolder",
    description:
      "Create a new folder inside the linked one. Keeps the original contents untouched.",
  });
});

test("buildTaskFileOutcomeSummary highlights the current deliverable when one is linked", () => {
  const summary = buildTaskFileOutcomeSummary([
    {
      id: "deliverable-1",
      name: "final-report.pdf",
      type: "file",
      path: "/final-report.pdf",
      annotation: null,
      currentVersion: 3,
      updatedAt: new Date("2026-04-20T10:00:00.000Z"),
    },
    {
      id: "working-1",
      name: "working-draft.md",
      type: "file",
      path: "/working-draft.md",
      annotation: null,
      currentVersion: 5,
      updatedAt: new Date("2026-04-20T11:00:00.000Z"),
    },
  ]);

  assert.equal(summary.currentDeliverableId, "deliverable-1");
  assert.equal(summary.headline, "Current deliverable: final-report.pdf");
});

test("summarizeTaskFileWarningNextStep returns the most actionable next step", () => {
  assert.equal(
    summarizeTaskFileWarningNextStep([
      { code: "warning_unresolved_replacement", message: "replace" },
    ]),
    "Resolve the open replace-or-attach decision so the file list can settle.",
  );
});

test("buildAttachCandidateHints explains why a file is a good attach-existing candidate", () => {
  const hints = buildAttachCandidateHints(
    {
      id: "candidate-1",
      name: "hello.py",
      type: "file",
      path: "/src/hello.py",
    },
    [
      {
        id: "linked-folder-1",
        name: "src",
        type: "folder",
        path: "/src",
        annotation: null,
        updatedAt: new Date("2026-04-20T10:00:00.000Z"),
        currentVersion: null,
      },
      {
        id: "linked-file-1",
        name: "hello.py",
        type: "file",
        path: "/hello.py",
        annotation: null,
        updatedAt: new Date("2026-04-20T11:00:00.000Z"),
        currentVersion: null,
      },
    ],
    "search",
  );

  assert.deepEqual(hints, [
    "Matches the linked item name hello.py",
    "Lives under linked folder src",
  ]);
});

test("buildTaskFileChoicePreview explains the resulting root-list outcome", () => {
  assert.deepEqual(buildTaskFileChoicePreview("attach_new", "file"), {
    title: "Result",
    detail: "This file appears as a separate root attachment alongside the current task files.",
  });
});
