import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worker = readFileSync("src/inngest/functions/git-sync.ts", "utf8");
const runner = readFileSync("src/lib/github/sync-runner.ts", "utf8");
const webhook = readFileSync("src/app/api/v1/webhooks/github/route.ts", "utf8");
test("both workers require signed review identity, not an unreviewed project ID", () => {
  assert.equal((worker.match(/subjectId: runId/g) || []).length, 2);
  assert.match(worker, /runReviewedGitHubSync/);
  assert.doesNotMatch(worker, /markGitDeltasProcessing|git reset/);
});
test("recovery retains result checkpoints and dispatches the durable outbox", () => {
  assert.match(worker, /Worker interrupted/);
  assert.match(worker, /Previously applied files and remote commit identity have been retained/);
  assert.match(worker, /status, "queued"/);
  assert.match(runner, /result\.applied\?\.includes\(file\.path\)/);
  assert.match(runner, /Synchronization lease was lost/);
  assert.match(runner, /result\.commitSha/);
});
test("pulls go through canonical revisions and preserve attribution separately from importer", () => {
  assert.match(runner, /await applyFileRevision/);
  assert.match(runner, /contentAuthorId:/);
  assert.match(runner, /importedBy: actorId/);
  assert.match(runner, /baseStorageKey:/);
  assert.match(runner, /basePath:/);
  assert.match(runner, /afterMutationTx:/);
  assert.doesNotMatch(runner, /upsert:\s*true|delete\(fileVersions\)/);
});
test("signed webhook records incoming changes; it cannot enqueue an automatic pull", () => {
  assert.match(webhook, /timingSafeEqual/);
  assert.match(webhook, /eq\(githubSyncConnections.repositoryId, repositoryId!/);
  assert.match(webhook, /connection.installationId !== installationId/);
  assert.match(webhook, /incomingSha: payload.after!/);
  assert.doesNotMatch(webhook, /inngest.send|createSignedJobRequestToken|claimGithubDeliveryId/);
});
