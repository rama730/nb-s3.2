import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GITHUB_SYNC_LIMITS } from "../../src/lib/github/sync-limits";

test("GitHub Sync separates comparison, reviewed-operation, and worker capacity", () => {
  assert.ok(GITHUB_SYNC_LIMITS.comparisonFiles >= 30_000);
  assert.ok(GITHUB_SYNC_LIMITS.operationFiles >= 1_131);
  assert.ok(GITHUB_SYNC_LIMITS.operationBytes >= 512 * 1024 * 1024);
  assert.equal(
    GITHUB_SYNC_LIMITS.repositoryBytes,
    GITHUB_SYNC_LIMITS.operationBytes,
  );
});

test("comparison does not reject the entire workspace by byte size", () => {
  const source = readFileSync("src/lib/github/sync-service.ts", "utf8");

  assert.doesNotMatch(source, /safe synchronization workspace limit/);
  assert.doesNotMatch(
    source,
    /tree\.reduce\([\s\S]{0,300}SYNC_LIMITS\.operationBytes/,
  );
  assert.match(source, /total > SYNC_LIMITS\.operationBytes/);
  assert.match(source, /\.filter\(\(path\) => !excludedSyncPath\(path\)\)/);
});

test("large reviewed selections are prepared in bounded failure-safe batches", () => {
  const source = readFileSync("src/lib/github/sync-service.ts", "utf8");

  assert.match(source, /const batchSize = 6/);
  assert.match(source, /const manifestFiles = new Map/);
  assert.match(source, /await Promise\.allSettled\(/);
  assert.match(source, /uploaded\.push\(upload\.value\)/);
});
