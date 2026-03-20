import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { User } from "@supabase/supabase-js";

import { buildGithubAccountConnectionState } from "@/lib/github/connection-state";

function createUser(overrides: Partial<User>): User {
  return {
    id: "user-1",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-03-20T00:00:00.000Z",
    email: "user@example.com",
    ...overrides,
  } as User;
}

describe("github connection state", () => {
  it("returns linked state and username from github identity data", () => {
    const user = createUser({
      app_metadata: {
        provider: "google",
        providers: ["google", "github"],
      },
      identities: [
        { provider: "google" },
        {
          provider: "github",
          identity_data: {
            user_name: "rama730",
          },
        },
      ] as User["identities"],
    });

    assert.deepEqual(buildGithubAccountConnectionState(user), {
      linked: true,
      username: "rama730",
    });
  });

  it("returns not linked when github is not attached", () => {
    const user = createUser({
      app_metadata: {
        provider: "email",
        providers: ["email"],
      },
      identities: [{ provider: "email" }] as User["identities"],
    });

    assert.deepEqual(buildGithubAccountConnectionState(user), {
      linked: false,
      username: null,
    });
  });
});
