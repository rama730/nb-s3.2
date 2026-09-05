import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sanitizeGitErrorMessage } from "../../src/lib/github/repo-security";
import {
  GITHUB_WORKFLOW_PERMISSION_ERROR,
  includesGithubWorkflowFiles,
} from "../../src/lib/github/sync-contract";

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("a verified zero-diff preview clears stale failure state", () => {
  const action = source("src/app/actions/project/sync-preview.ts");

  assert.match(action, /conflicts\.length === 0 && incomingUpdatesCount === 0/);
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

test("review and queued synchronization survive workspace remounts", () => {
  const action = source("src/app/actions/github-sync.ts");
  const workspace = source(
    "src/components/projects/v2/files-tab/GitHubSyncWorkspace.tsx",
  );

  assert.match(action, /process\.env\.NODE_ENV !== "production"/);
  assert.match(action, /runReviewedGitHubSync\(runId, user\.id, projectId\)/);
  assert.doesNotMatch(
    action,
    /\["completed", "running", "queued"\]\.includes\(run\.status\)/,
  );
  assert.match(
    workspace,
    /run\.status === "review" \|\| run\.status === "failed"/,
  );
  assert.match(workspace, /Synchronization queued/);
  assert.match(workspace, /Resume synchronization/);
});

test("workflow files request GitHub's dedicated permission and retain a retry path", () => {
  const oauth = source("src/lib/github/oauth-client.ts");
  const action = source("src/app/actions/github-sync.ts");
  const workspace = source(
    "src/components/projects/v2/files-tab/GitHubSyncWorkspace.tsx",
  );

  assert.match(oauth, /repo workflow user:email read:org/);
  assert.match(action, /assertGithubWorkflowPermission/);
  assert.match(workspace, /Authorize workflow publishing/);
  assert.match(workspace, /Retry publication/);
});

test("workflow permission failures are detected and translated without leaking git commands", () => {
  assert.equal(
    includesGithubWorkflowFiles(["README.md", ".github/workflows/ci.yml"]),
    true,
  );
  assert.equal(
    sanitizeGitErrorMessage(
      "remote: refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope",
    ),
    GITHUB_WORKFLOW_PERMISSION_ERROR,
  );
});
