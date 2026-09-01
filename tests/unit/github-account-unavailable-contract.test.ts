import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("github unavailable-account end-to-end contract", () => {
  it("checks live account availability on the integrations read path", () => {
    const route = source("src/app/api/v1/integrations/route.ts");
    assert.match(route, /resolveGithubExternalAccountHealth/);
    assert.match(route, /githubAccountHealth/);
    assert.doesNotMatch(route, /\.update\(projects\)/, "integrations reads must not mutate sync state");
  });

  it("shows an action-required state without claiming definite deletion", () => {
    const builder = source("src/lib/settings/integrations.ts");
    const settings = source("src/components/settings/IntegrationsSettings.tsx");

    assert.match(builder, /unavailable \? "action_required"/);
    assert.match(builder, /Imported project data remains available/);
    assert.match(settings, /GitHub status unavailable/);
    assert.doesNotMatch(settings, /getSyncPreviewAction/);
    assert.doesNotMatch(settings, /retryGithubImportAction/);
  });

  it("keeps public and GitHub App reads working while private OAuth access is blocked", () => {
    const preview = source("src/app/actions/project/sync-preview.ts");
    const retry = source("src/app/actions/project/_all.ts");
    const syncActions = source("src/app/actions/github-sync.ts");
    const tokenResolver = source("src/lib/github/user-access-token.ts");
    const worker = source("src/inngest/functions/git-sync.ts");

    assert.match(preview, /githubAccess\.source !== "app"/);
    assert.match(preview, /accountCannotAuthorize \? undefined : githubAccess\.token/);
    assert.match(retry, /access\.source !== ["']app["']/);
    assert.match(retry, /accountCannotAuthorize \? undefined : access\.token/);
    assert.match(retry, /githubRepoPrivate: accessCheck\.isPrivate/);
    assert.match(syncActions, /resolveGithubUserAccessToken/);
    assert.match(tokenResolver, /identityIds\.has\(String\(account\.id\)\)/);
    assert.match(worker, /A signed, reviewed push operation is required/);
    assert.match(worker, /runReviewedGitHubSync/);
  });

  it("prevents a stale sealed token from presenting repository browsing as healthy", () => {
    const accessState = source("src/lib/github/import-access-state.ts");
    const wizard = source("src/components/projects/create-wizard/phases/Phase1SourceSelection.tsx");

    assert.match(accessState, /accountHealth\.state !== 'unavailable'/);
    assert.match(accessState, /refreshRequired:/);
    assert.match(wizard, /githubAccountUnavailable/);
    assert.match(wizard, /Review connection/);
  });
});
