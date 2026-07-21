import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveGithubExternalAccountHealth } from "@/lib/github/account-health";

describe("github external account health", () => {
  it("does not call GitHub when no identity is linked", async () => {
    let calls = 0;
    const health = await resolveGithubExternalAccountHealth({
      linked: false,
      username: "old-account",
      fetchImpl: (async () => {
        calls += 1;
        return new Response();
      }) as typeof fetch,
    });

    assert.equal(calls, 0);
    assert.equal(health.state, "not_linked");
    assert.equal(health.reason, "not_linked");
  });

  it("returns the live profile for an available account", async () => {
    const health = await resolveGithubExternalAccountHealth({
      linked: true,
      username: "old-login",
      now: () => Date.parse("2026-06-30T04:30:00.000Z"),
      fetchImpl: (async () =>
        Response.json({
          login: "current-login",
          name: "Current Name",
          avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
          html_url: "https://github.com/current-login",
        })) as typeof fetch,
    });

    assert.equal(health.state, "available");
    assert.equal(health.reason, "verified");
    assert.equal(health.checkedAt, "2026-06-30T04:30:00.000Z");
    assert.equal(health.profile?.username, "current-login");
    assert.equal(health.profile?.profileUrl, "https://github.com/current-login");
  });

  it("marks a missing account unavailable without claiming it was deleted", async () => {
    const health = await resolveGithubExternalAccountHealth({
      linked: true,
      username: "deleted-or-renamed",
      fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
    });

    assert.equal(health.state, "unavailable");
    assert.equal(health.reason, "not_found");
    assert.equal(health.profile, null);
  });

  it("fails open as unknown for rate limits and network errors", async () => {
    const rateLimited = await resolveGithubExternalAccountHealth({
      linked: true,
      username: "rate-limited",
      fetchImpl: (async () =>
        new Response(null, {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        })) as typeof fetch,
    });
    const networkFailure = await resolveGithubExternalAccountHealth({
      linked: true,
      username: "network-failure",
      fetchImpl: (async () => {
        throw new Error("offline");
      }) as typeof fetch,
    });

    assert.equal(rateLimited.state, "unknown");
    assert.equal(rateLimited.reason, "rate_limited");
    assert.equal(networkFailure.state, "unknown");
    assert.equal(networkFailure.reason, "network_error");
  });
});
