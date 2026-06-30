import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const projectActionsSource = fs.readFileSync(
  path.join(process.cwd(), "src/app/actions/project/_all.ts"),
  "utf8",
);
const projectActionsBarrelSource = fs.readFileSync(
  path.join(process.cwd(), "src/app/actions/project/index.ts"),
  "utf8",
);
const sprintDataHookSource = fs.readFileSync(
  path.join(process.cwd(), "src/hooks/hub/useProjectTasksData.ts"),
  "utf8",
);

describe("sprint member access contract", () => {
  it("resolves server-rendered sprint detail with the current actor", () => {
    assert.match(
      projectActionsSource,
      /resolveProjectDetailTarget\(\s*input\.slugOrId,\s*input\.actorUserId\s*\?\?\s*null,?\s*\)/,
      "readProjectSprintDetail must pass actorUserId so project membership is included in the project lookup",
    );
  });

  it("exports the authenticated sprint detail action for client refetches", () => {
    assert.match(
      projectActionsSource,
      /export async function fetchProjectSprintDetailAction\(input:\s*\{\s*projectId:\s*string;/s,
      "the authenticated project-id action should exist for client sprint detail queries",
    );
    assert.match(
      projectActionsBarrelSource,
      /\bfetchProjectSprintDetailAction\b/,
      "the project action barrel must expose fetchProjectSprintDetailAction directly",
    );
    assert.doesNotMatch(
      projectActionsBarrelSource,
      /readProjectSprintDetail\s+as\s+fetchProjectSprintDetailAction/,
      "the client fetch alias must not point at the actorless readProjectSprintDetail path",
    );
  });

  it("requests sprint detail through projectId instead of the slug-based reader", () => {
    assert.match(
      sprintDataHookSource,
      /fetchProjectSprintDetailAction\(\{\s*projectId:\s*normalizedProjectId,/s,
      "client first-page sprint queries should call the authenticated action with projectId",
    );
    assert.doesNotMatch(
      sprintDataHookSource,
      /fetchProjectSprintDetailAction\(\{\s*slugOrId:/s,
      "client sprint detail queries should not use the slug reader through the action barrel",
    );
  });
});
