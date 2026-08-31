import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { upsertTaskSubtask } from "@/lib/projects/task-subtasks";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("subtasks use an accessible grouped checklist with explicit creation and recovery", () => {
  const tab = read("src/components/projects/v2/tasks/TaskDetailTabs/SubtasksTab.tsx");

  assert.match(tab, /role="progressbar"/);
  assert.match(tab, /role="checkbox"/);
  assert.match(tab, /aria-checked=\{subtask\.completed\}/);
  assert.match(tab, /Open · \{openSubtasks\.length\}/);
  assert.match(tab, /Completed · \{completedSubtasks\.length\}/);
  assert.match(tab, /Add a subtask…/);
  assert.match(tab, /onUpdateSubtask/);
  assert.match(tab, /onBlur=\{\(\) => void saveTitle\(subtask\)\}/);
  assert.match(tab, /await onDeleteSubtask\(subtask\.id\)/);
  assert.doesNotMatch(tab, /setTimeout\(\(\) => void commit/);
  assert.match(tab, /void onRetry\(\)/);
});

test("subtask mutations reconcile by id and use deterministic, narrow reads", () => {
  const hook = read("src/hooks/useTaskPanelResource.ts");
  const actions = read("src/app/actions/subtask.ts");
  const reducer = read("src/lib/projects/task-subtasks.ts");

  assert.match(hook, /upsertTaskSubtask/);
  assert.match(hook, /const replaceSubtasks/);
  assert.match(reducer, /left\.id\.localeCompare\(right\.id\)/);
  assert.match(hook, /select\("id, task_id, title, completed, position, created_at, updated_at"\)/);
  assert.match(hook, /updateSubtaskAction/);
  assert.match(hook, /completedSubtaskCount: counts\.completedSubtasks/);
  assert.match(hook, /task_panel\.subtask/);
  assert.match(actions, /pg_advisory_xact_lock/);
  assert.match(actions, /export async function updateSubtaskAction/);
  assert.match(actions, /return \{ success: true, data: updated \}/);
});

test("subtask upserts preserve concurrent rows and stable order", () => {
  const current = [
    { id: "b", taskId: "task", title: "Second", completed: false, position: 1, createdAt: "2026-01-01T00:00:01.000Z", updatedAt: "2026-01-01T00:00:01.000Z" },
    { id: "a", taskId: "task", title: "First", completed: false, position: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
  ];

  const merged = upsertTaskSubtask(current, {
    ...current[0],
    title: "Second, updated remotely",
    completed: true,
  });

  assert.deepEqual(merged.map((subtask) => subtask.id), ["a", "b"]);
  assert.equal(merged[1]?.title, "Second, updated remotely");
  assert.equal(merged[1]?.completed, true);
});
