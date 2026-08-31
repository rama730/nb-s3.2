import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const schema = source("src/lib/db/schema/index.ts");
const projectActions = source("src/app/actions/project/_all.ts");
const taskActions = source("src/app/actions/task.ts");
const migration = source("drizzle/0149_sprint_lifecycle_memberships.sql");

describe("sprint lifecycle and history integrity contract", () => {
  it("persists stable Sprint numbers and enforces one Active Sprint per project", () => {
    assert.match(schema, /sprintNumber: integer\("sprint_number"\)\.notNull\(\)/);
    assert.match(schema, /project_sprints_one_active_idx/);
    assert.match(migration, /WHERE "status" = 'active'/);
  });

  it("uses durable memberships instead of mutable task placement for Sprint history", () => {
    assert.match(schema, /export const sprintTaskMemberships/);
    assert.match(schema, /removedAt: timestamp\("removed_at"/);
    assert.match(projectActions, /FROM \$\{sprintTaskMemberships\}/);
    assert.match(projectActions, /membershipState: row\.membership_removed_at \? "historical" : "committed"/);
    assert.match(taskActions, /tx\.insert\(sprintTaskMemberships\)/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS "sprint_task_memberships"/);
  });

  it("blocks destructive history deletion and records lifecycle events transactionally", () => {
    assert.match(projectActions, /Sprints with work history are archived instead of deleted/);
    assert.match(projectActions, /tx\.insert\(projectSprintEvents\)/);
    assert.match(schema, /taskId: uuid\("task_id"\)[\s\S]*?references\(\(\) => tasks\.id, \{ onDelete: "restrict" \}\)/);
  });

  it("keeps Sprint assignment and lifecycle mutations on the same owner boundary", () => {
    assert.match(projectActions, /Only the project owner can assign tasks to a Sprint/);
    assert.match(taskActions, /Only the project owner can change sprint assignments/);
    assert.match(projectActions, /eq\(projectSprints\.status, "active"\)/);
  });

  it("preserves readable creator snapshots", () => {
    assert.match(projectActions, /creatorName: creator\.actorName/);
    assert.match(projectActions, /applySprintCreatorSnapshots/);
  });
});
