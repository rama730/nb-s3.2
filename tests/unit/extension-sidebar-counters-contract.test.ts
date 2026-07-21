import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("extension sidebar counter contract", () => {
  it("returns exact task summaries independently from the capped task preview", () => {
    const workspaceRoute = readSource(
      "src/app/api/v1/extension/workspace/route.ts",
    );
    const summaryRoute = readSource(
      "src/app/api/v1/extension/project-summary/route.ts",
    );
    const tasksRoute = readSource(
      "src/app/api/v1/extension/project-tasks/route.ts",
    );

    assert.match(
      workspaceRoute,
      /taskCount[:,]/,
      "workspace projects must expose an exact task count",
    );
    assert.match(
      workspaceRoute,
      /associatedTaskPreview:/,
      "workspace projects must expose the singleton task preview separately",
    );
    assert.match(
      summaryRoute,
      /taskCount/,
      "lightweight project summaries must return the exact task count",
    );
    assert.match(
      summaryRoute,
      /summaryVersion/,
      "summary responses must carry a stable change version",
    );
    assert.match(
      tasksRoute,
      /nextCursor/,
      "large task lists must be cursor paginated",
    );
    assert.match(
      tasksRoute,
      /totalCount/,
      "paginated task responses must retain the exact total",
    );
  });
});
