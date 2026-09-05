import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { identityLinkError } from "@/lib/github/oauth-client";

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("github unavailable-account end-to-end contract", () => {
  it("turns the provider configuration failure into an actionable message", () => {
    const error = identityLinkError({
      code: "manual_linking_disabled",
      message: "Manual linking is disabled",
    });

    assert.match(error.message, /Allow manual linking in Supabase Auth/);
  });

  it("checks live account availability on the integrations read path", () => {
    const route = source("src/app/api/v1/integrations/route.ts");
    assert.match(route, /resolveGithubExternalAccountHealth/);
    assert.match(route, /githubAccountHealth/);
    assert.match(route, /toIsoString\(githubProjectsAggregate\?\.githubLastSyncAt\)/);
    assert.doesNotMatch(route, /githubLastSyncAt\?\.toISOString\(\)/);
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

  it("replaces a deleted identity through a guarded link flow without mutating projects", () => {
    const replacement = source("src/app/api/v1/github/account/replacement/route.ts");
    const oauth = source("src/lib/github/oauth-client.ts");
    const settings = source("src/components/settings/IntegrationsSettings.tsx");
    const callback = source("src/app/auth/callback/route.ts");

    assert.match(replacement, /validateCsrf/);
    assert.match(replacement, /resolveSecurityStepUp/);
    assert.match(replacement, /hasFallbackIdentity/);
    assert.match(replacement, /unlinkIdentity\(githubIdentity\)/);
    assert.match(replacement, /clearGithubImportAccessCookie/);
    assert.doesNotMatch(replacement, /\.update\(projects\)/);
    assert.match(oauth, /auth\.linkIdentity/);
    assert.match(oauth, /skipBrowserRedirect: true/);
    assert.match(oauth, /await beforeRedirect\?\.\(\)/);
    assert.match(oauth, /manual_linking_disabled/);
    assert.match(settings, /beforeRedirect: async/);
    assert.match(settings, /Replace GitHub account/);
    assert.match(callback, /github_account_replaced/);
  });

  it("moves future attribution to the replacement account without rewriting history", () => {
    const contributor = source("src/lib/github/contributor-identity.ts");
    assert.match(contributor, /current\?\.githubId === account\.id/);
    assert.match(contributor, /githubNoreplyEmail\(account\)/);
    assert.doesNotMatch(contributor, /update\(projects\)/);
  });
});
