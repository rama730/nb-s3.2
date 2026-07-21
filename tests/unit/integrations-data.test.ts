import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { User } from "@supabase/supabase-js";
import { buildIntegrationsData } from "@/lib/settings/integrations";

function user(overrides: Partial<User>): User {
  return { id: "user-1", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-03-20T00:00:00.000Z", email: "user@example.com", email_confirmed_at: "2026-03-20T00:00:00.000Z", ...overrides } as User;
}

describe("integrations settings builder", () => {
  it("builds account connections and a GitHub usage summary", () => {
    const data = buildIntegrationsData({
      user: user({
        app_metadata: { provider: "google", providers: ["google", "github", "email"] },
        identities: [
          { provider: "google" },
          { provider: "github", identity_data: { login: "octocat" } },
        ] as User["identities"],
      }),
      githubRepoProjectCount: 1,
      githubLastSyncAt: "2026-03-19T12:00:00.000Z",
      passwordLastChangedAt: "2026-03-19T11:00:00.000Z",
    });
    assert.match(data.summary, /Account created with Google/);
    assert.equal(data.authConnections.length, 3);
    assert.equal(data.githubService.status, "connected");
    assert.equal(data.githubService.usageCount, 1);
    assert.equal(data.githubService.githubUsername, "octocat");
  });

  it("directs an OAuth-only account to Security for email sign-in", () => {
    const data = buildIntegrationsData({
      user: user({ app_metadata: { provider: "google", providers: ["google"] }, identities: [{ provider: "google" }] as User["identities"] }),
      githubRepoProjectCount: 0,
      githubLastSyncAt: null,
      passwordLastChangedAt: null,
    });
    const email = data.authConnections.find((provider) => provider.provider === "email");
    assert.equal(email?.state, "not_linked");
    assert.match(email?.secondaryDetail || "", /Security/);
  });

  it("reports unavailable GitHub accounts without exposing a sync console", () => {
    const data = buildIntegrationsData({
      user: user({
        app_metadata: { provider: "google", providers: ["google", "github"] },
        identities: [{ provider: "google" }, { provider: "github", identity_data: { login: "deleted-or-renamed" } }] as User["identities"],
      }),
      githubRepoProjectCount: 1,
      githubLastSyncAt: null,
      passwordLastChangedAt: null,
      githubAccountHealth: { state: "unavailable", reason: "not_found", checkedAt: "2026-06-30T04:30:00.000Z", profile: null },
    });
    assert.equal(data.githubService.status, "action_required");
    assert.equal(data.githubService.summary, "GitHub account unavailable.");
    assert.match(data.githubService.detail, /Imported project data remains available/);
  });

  it("does not claim repository access is connected without a linked account", () => {
    const data = buildIntegrationsData({
      user: user({ app_metadata: { provider: "email", providers: ["email"] }, identities: [{ provider: "email" }] as User["identities"] }),
      githubRepoProjectCount: 1,
      githubLastSyncAt: null,
      passwordLastChangedAt: "2026-06-01T00:00:00.000Z",
    });
    assert.equal(data.githubService.status, "not_connected");
    assert.equal(data.githubService.usageCount, 1);
  });
});
