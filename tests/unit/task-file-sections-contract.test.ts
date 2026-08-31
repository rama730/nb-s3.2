import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("task creation persists selected files as reference links", () => {
  const source = read("src/app/actions/project/_all.ts");

  assert.match(source, /annotation: "#initial_reference"/);
  assert.match(source, /tags: replaceTaskFileRoleTag\(\[\], "reference"\)/);
});

test("task files render reference, deliverable, and working sections without duplicating roles", () => {
  const explorer = read("src/components/projects/v2/tasks/components/TaskFilesExplorer.tsx");
  const referencePosition = explorer.indexOf("Task References");
  const deliverablePosition = explorer.indexOf("Final Deliverables");
  const workingPosition = explorer.lastIndexOf("TASK_WORKING_FILES_TITLE");

  assert.ok(referencePosition >= 0 && referencePosition < deliverablePosition);
  assert.ok(deliverablePosition < workingPosition);
  assert.match(explorer, /inferTaskFileRole\(n\) === "reference"/);
  assert.match(explorer, /inferTaskFileRole\(n\) === "working"/);
  assert.match(explorer, /fileRole=\{role\}/);
});

test("task file actions expose all safe role transitions", () => {
  const row = read("src/components/projects/v2/tasks/components/TaskFileRow.tsx");
  const upload = read("src/components/projects/v2/tasks/components/TaskFileUploadModal.tsx");

  assert.match(row, /Move to Task References/);
  assert.match(row, /Move to Working Files/);
  assert.match(row, /Move to Deliverables/);
  assert.match(upload, /Task Reference/);
  assert.match(upload, /UploadIntent = "reference" \| "working" \| "deliverable" \| "version"/);
});

test("the task detail surface refreshes after a role move", () => {
  const panel = read("src/components/projects/v2/tasks/TaskDetailPanel.tsx");

  assert.match(panel, /onFilesChanged=\{resource\.loadAttachments\}/);
});
