import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(
  path.join(process.cwd(), "src/app/actions/task.ts"),
  "utf8",
);

function actionBody(name: string, nextName: string) {
  const start = source.indexOf(`export async function ${name}`);
  const end = source.indexOf(`export async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} must exist`);
  return source.slice(start, end === -1 ? undefined : end);
}

test("done transitions request review without publishing task files", () => {
  const updateStatus = actionBody(
    "updateTaskStatusAction",
    "moveTaskToWorkflowColumnAction",
  );
  const moveColumn = actionBody(
    "moveTaskToWorkflowColumnAction",
    "assignTaskAction",
  );

  assert.match(updateStatus, /newReviewStatus = "pending"/);
  assert.match(moveColumn, /newReviewStatus = "pending"/);
  assert.doesNotMatch(updateStatus, /promoteTaskFiles/);
  assert.doesNotMatch(moveColumn, /promoteTaskFiles/);
});

test("approval clears review state without changing file ownership or roles", () => {
  const approve = actionBody("approveTaskReviewAction", "");
  assert.match(approve, /locked\.reviewStatus !== "pending"/);
  assert.match(approve, /reviewStatus: "none"/);
  assert.doesNotMatch(approve, /promoteTaskFiles|taskNodeLinks|projectNodes/);
  assert.doesNotMatch(source, /function promoteTaskFiles/);
});

test("moves between custom sections in the same status remain auditable", () => {
  const moveColumn = actionBody(
    "moveTaskToWorkflowColumnAction",
    "assignTaskAction",
  );
  assert.match(moveColumn, /locked\.currentWorkflowColumnId !== column\.id/);
  assert.match(moveColumn, /eventType: "workflow_column_changed"/);
});
