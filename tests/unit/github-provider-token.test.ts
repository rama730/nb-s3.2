import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { describe, it } from "node:test";
import type { User } from "@supabase/supabase-js";

import {
  readGithubSessionProviderToken,
} from "@/lib/github/connection-state";

const loader = Module as unknown as {
  _load: (request: string, ...args: unknown[]) => unknown;
};
const originalLoad = loader._load;
loader._load = (request, ...args) =>
  request === "server-only" ? {} : originalLoad(request, ...args);
const { validateGithubUserAccessToken } = createRequire(import.meta.url)(
  "../../src/lib/github/user-access-token",
) as typeof import("../../src/lib/github/user-access-token");
loader._load = originalLoad;

function user(provider: string, providers: string[]): User {
  return {
    app_metadata: { provider, providers },
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001",
  } as User;
}

describe("GitHub provider-token isolation", () => {
  it("never treats a Google-primary session token as GitHub repository access", () => {
    const googlePrimary = user("google", ["google", "github"]);
    assert.equal(
      readGithubSessionProviderToken(googlePrimary, {
        provider_token: "google-provider-token",
      }),
      "",
    );
  });

  it("accepts and trims a GitHub-primary session token", () => {
    const githubPrimary = user("github", ["github", "google"]);
    assert.equal(
      readGithubSessionProviderToken(githubPrimary, {
        provider_token: "  github-provider-token  ",
      }),
      "github-provider-token",
    );
  });

  it("returns no token for a missing session", () => {
    assert.equal(readGithubSessionProviderToken(user("github", ["github"]), null), "");
  });

  it("binds a repository token to the linked GitHub account", async () => {
    const linked = user("google", ["google", "github"]);
    linked.identities = [
      {
        provider: "github",
        id: "217795742",
        identity_id: "identity-row-id",
        user_id: linked.id,
      },
    ];
    assert.deepEqual(
      await validateGithubUserAccessToken(linked, "github-token", async () => ({
        id: 217795742,
        login: "rama730",
      })),
      { id: 217795742, login: "rama730" },
    );
    assert.equal(
      await validateGithubUserAccessToken(linked, "other-token", async () => ({
        id: 999,
        login: "other-account",
      })),
      null,
    );
  });

  it("routes repository browsing and synchronization through one verified resolver", () => {
    const picker = readFileSync("src/app/actions/github.ts", "utf8");
    const sync = readFileSync("src/app/actions/github-sync.ts", "utf8");
    const access = readFileSync("src/lib/github/import-access-state.ts", "utf8");

    assert.match(picker, /resolveGithubUserAccessToken\(user, session\)/);
    assert.match(sync, /resolveGithubUserAccessToken\(user, value\)/);
    assert.match(access, /readGithubSessionProviderToken\(user, session\)/);
    assert.match(access, /validateGithubUserAccessToken\(user, sessionProviderToken\)/);
    assert.doesNotMatch(access, /validateGithubUserAccessToken\(user, cookieToken\)/);
    assert.doesNotMatch(access, /session\.provider_token\.trim\(\)/);
  });

  it("validates the callback grant and preserves the initiating session", () => {
    const callback = readFileSync("src/app/auth/callback/route.ts", "utf8");
    const oauth = readFileSync("src/lib/github/oauth-client.ts", "utf8");
    const snapshot = readFileSync("src/lib/auth/snapshot.ts", "utf8");
    assert.match(snapshot, /identities: \[\]/);
    assert.match(callback, /previousUser\.id === data\.user\.id/);
    assert.doesNotMatch(callback, /sharesLinkedGithubIdentity/);
    assert.match(callback, /providerToken && !githubIdentityMatches \? 'account_mismatch' : 'token_missing'/);
    assert.match(callback, /successUrl\.searchParams\.delete\('githubAuth'\)/);
    assert.match(callback, /previousSessionData\.session/);
    assert.match(callback, /clearGithubImportAccessCookie\(response\)/);
    assert.match(oauth, /prompt: "select_account"/);
    assert.match(oauth, /login: login\.trim\(\)/);
    assert.match(oauth, /destination\.searchParams\.delete\("githubAuth"\)/);
  });
});
