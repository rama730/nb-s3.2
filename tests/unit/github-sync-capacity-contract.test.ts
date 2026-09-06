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

test("the action and UI use the shared selection limit with readable errors", () => {
  const action = readFileSync("src/app/actions/github-sync.ts", "utf8");
  const workspace = readFileSync(
    "src/components/projects/v2/files-tab/GitHubSyncWorkspace.tsx",
    "utf8",
  );

  assert.doesNotMatch(action, /\.max\(500\)/);
  assert.match(action, /GITHUB_SYNC_LIMITS\.operationFiles/);
  assert.match(action, /error instanceof z\.ZodError/);
  assert.match(action, /error\.issues\[0\]\?\.message/);
  assert.match(workspace, /eligible\.slice\(/);
  assert.match(workspace, /GITHUB_SYNC_LIMITS\.operationFiles/);
});

test("local reviewed files reuse immutable revisions and temporary snapshots use an allowed MIME", () => {
  const source = readFileSync("src/lib/github/sync-service.ts", "utf8");

  assert.match(source, /item\.snapshotKey = file\.storageKey/);
  assert.match(source, /item\.resultHash = file\.localHash/);
  assert.match(source, /contentType: "application\/octet-stream"/);
  assert.doesNotMatch(
    source,
    /source === "edge" && file\.storageKey\)[\s\S]{0,100}readStoredSyncContent/,
  );
});

test("large reviews avoid serial storage, database, and git staging work", () => {
  const service = readFileSync("src/lib/github/sync-service.ts", "utf8");
  const publisher = readFileSync("src/lib/github/sync-git.ts", "utf8");

  assert.match(service, /runWithConcurrency\(\s*paths,[\s\S]{0,240}\s24,/);
  assert.match(service, /const \[nodes, collisions\] = await Promise\.all/);
  assert.match(service, /runWithConcurrency\(files, 24/);
  assert.match(publisher, /runWithConcurrency\(manifest\.files, 24/);
  assert.match(publisher, /git\("add", "--all", "--", "\."\)/);
  assert.doesNotMatch(publisher, /git\("add", "--all", "--", file\.path\)/);
});

test("comparison eliminates redundant S3 downloads via gitBlobCache and knownBlobs", () => {
  const service = readFileSync("src/lib/github/sync-service.ts", "utf8");

  // Asserts gitBlobCache is declared and used
  assert.match(service, /const gitBlobCache = new Map<string, CachedBlobMeta>\(\)/);
  assert.match(service, /knownBlobs/);
  assert.match(service, /knownBlobMap/);
  assert.match(service, /gitBlobCache\.has\(localHash\)/);
  assert.match(service, /sharedStorage/);
});

test("getGitHubSyncState executes runs, identity, files count, and members queries in parallel", () => {
  const action = readFileSync("src/app/actions/github-sync.ts", "utf8");

  assert.match(
    action,
    /const \[runs, identityRow, filesCountResult, membersResult\] =\s*await Promise\.all\(\[/,
  );
});

test("explorer boot restores unloaded folders with append mode without forced refresh cascades", () => {
  const boot = readFileSync(
    "src/components/projects/v2/explorer/useExplorerBoot.ts",
    "utf8",
  );

  assert.match(boot, /loadFolderContent\(id === "root" \? null : id, "append"\)/);
  assert.doesNotMatch(
    boot,
    /loadFolderContent\(id === "root" \? null : id, "refresh"\)/,
  );
});
