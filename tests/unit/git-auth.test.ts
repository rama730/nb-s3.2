import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { withGitCredentialEnv } from "@/lib/github/git-auth";

describe("withGitCredentialEnv", () => {
  it("creates scoped git credential files and removes them after success", async () => {
    let askpassPath = "";
    let tokenPath = "";

    const result = await withGitCredentialEnv("test-access-token", async (env) => {
      askpassPath = env.GIT_ASKPASS || "";
      tokenPath = env.NB_GIT_TOKEN_FILE || "";

      assert.equal(env.GIT_ASKPASS_REQUIRE, "force");
      assert.equal(env.GIT_USERNAME, "x-access-token");
      assert.ok(askpassPath.length > 0);
      assert.ok(tokenPath.length > 0);

      const token = await readFile(tokenPath, "utf8");
      assert.equal(token, "test-access-token");

      return "ok";
    });

    assert.equal(result, "ok");
    await assert.rejects(access(tokenPath));
    await assert.rejects(access(askpassPath));
  });

  it("removes credential files even when the git operation throws", async () => {
    let askpassPath = "";
    let tokenPath = "";

    await assert.rejects(
      withGitCredentialEnv("throwing-token", async (env) => {
        askpassPath = env.GIT_ASKPASS || "";
        tokenPath = env.NB_GIT_TOKEN_FILE || "";
        throw new Error("boom");
      }),
      /boom/,
    );

    await assert.rejects(access(tokenPath));
    await assert.rejects(access(askpassPath));
  });

  it("does not inject askpass state when no token is provided", async () => {
    await withGitCredentialEnv(null, async (env) => {
      assert.equal(env.GIT_ASKPASS, undefined);
      assert.equal(env.NB_GIT_TOKEN_FILE, undefined);
      assert.equal(env.GIT_TERMINAL_PROMPT, "0");
      assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
    });
  });
});
