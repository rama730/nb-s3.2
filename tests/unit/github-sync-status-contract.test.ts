import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("a verified zero-diff preview clears stale failure state", () => {
  const action = source("src/app/actions/project/sync-preview.ts");

  assert.match(
    action,
    /conflicts\.length === 0 && incomingUpdatesCount === 0/,
  );
  assert.match(action, /syncStatus: "ready"/);
  assert.match(action, /githubLastSyncAt: syncedAtDate/);
  assert.match(action, /lastError: null/);
  assert.match(action, /syncProgress: null/);
  assert.match(
    action,
    /inArray\(projects\.syncStatus, \["ready", "failed"\]\)/,
  );
});

test("account integrations keeps repository synchronization on project surfaces", () => {
  const ui = source("src/components/settings/IntegrationsSettings.tsx");
  assert.match(ui, /Repository access is managed from each project/);
  assert.match(ui, /href="\/projects"/);
  assert.doesNotMatch(ui, /getSyncPreviewAction|retryGithubImportAction/);
  assert.doesNotMatch(ui, /role="progressbar"|setSyncRequesting|onSync/);
});
