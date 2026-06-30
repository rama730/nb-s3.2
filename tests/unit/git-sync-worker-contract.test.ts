import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";

const source = fs.readFileSync("src/inngest/functions/git-sync.ts", "utf8");

describe("git sync worker failure contract", () => {
  it("persists failed claimed deltas before rethrowing", () => {
    assert.match(source, /markGitDeltasFailed\(claimedDeltas\.map\(\(delta\) => delta\.id\), error\)/);
    assert.match(source, /markGitDeltasFailed[\s\S]*processingError/);
  });

  it("does not silently swallow fetch, rename, or cleanup failures", () => {
    const rebaseFetch = source.indexOf('execFileAsync("git", ["-C", tempDir, "fetch", "origin", targetBranch]');
    const rebase = source.indexOf('execFileAsync("git", ["-C", tempDir, "rebase"', rebaseFetch);
    assert.ok(rebaseFetch >= 0 && rebase > rebaseFetch);
    assert.doesNotMatch(source.slice(rebaseFetch, rebase), /\.catch\(/);
    assert.match(source, /await rename\(oldPath, targetPath\)/);
    assert.match(source, /github\.sync\.temp_cleanup_failed/);
    assert.match(source, /github\.sync\.cache_refresh_failed/);
  });

  it("reclaims explicitly failed work for Inngest retries", () => {
    assert.match(source, /inArray\(projectGitDeltas\.status, \['pending', 'failed'\]\)/);
  });
});
