import assert from "node:assert/strict";
import test from "node:test";

import { compareGithubSyncTrees } from "../../src/lib/github/sync-preview-comparison";

const unchangedRemote = {
  path: "src/app.ts",
  name: "app.ts",
  sha: "same-sha",
};

const unchangedLocal = {
  path: "/src/app.ts",
  gitHash: "same-sha",
  s3Key: null,
  updatedAt: new Date("2026-06-30T10:00:00.000Z"),
};

test("matching repository trees are genuinely up to date", () => {
  assert.deepEqual(
    compareGithubSyncTrees([unchangedRemote], [unchangedLocal]),
    { conflicts: [], incomingUpdatesCount: 0 },
  );
});

test("a remote deletion of an unchanged local file requires a sync", () => {
  const result = compareGithubSyncTrees([], [unchangedLocal]);

  assert.equal(result.incomingUpdatesCount, 1);
  assert.deepEqual(result.conflicts, []);
});

test("a remote deletion of a locally modified file is a conflict", () => {
  const result = compareGithubSyncTrees([], [
    { ...unchangedLocal, s3Key: "project/local/src/app.ts" },
  ]);

  assert.equal(result.incomingUpdatesCount, 0);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0]?.path, "src/app.ts");
});

test("new and remotely modified files count as incoming updates", () => {
  const result = compareGithubSyncTrees(
    [
      { ...unchangedRemote, sha: "new-sha" },
      { path: "src/new.ts", name: "new.ts", sha: "new-file-sha" },
    ],
    [unchangedLocal],
  );

  assert.equal(result.incomingUpdatesCount, 2);
  assert.deepEqual(result.conflicts, []);
});
