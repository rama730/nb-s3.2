import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildGithubImportEventId,
  resolveGithubRepoAccess,
} from "../../src/lib/github/auth-resolver";
import { sealGithubImportToken } from "../../src/lib/github/repo-security";

const ORIGINAL_APP_ID = process.env.GITHUB_APP_ID;
const ORIGINAL_APP_KEY = process.env.GITHUB_APP_PRIVATE_KEY;
const ORIGINAL_IMPORT_KEY = process.env.GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY;

afterEach(() => {
  process.env.GITHUB_APP_ID = ORIGINAL_APP_ID;
  process.env.GITHUB_APP_PRIVATE_KEY = ORIGINAL_APP_KEY;
  process.env.GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY = ORIGINAL_IMPORT_KEY;
});

describe("github auth resolver", () => {
  it("returns oauth access when app context is unavailable", async () => {
    process.env.GITHUB_APP_ID = "";
    process.env.GITHUB_APP_PRIVATE_KEY = "";

    const result = await resolveGithubRepoAccess({
      repoUrl: "github.com/example-org/example-repo",
      oauthToken: "oauth-token-1",
    });

    assert.equal(result.source, "oauth");
    assert.equal(result.token, "oauth-token-1");
    assert.equal(result.installationId, null);
    assert.equal(result.normalizedRepoUrl, "https://github.com/example-org/example-repo");
  });

  it("falls back to sealed import token when oauth is unavailable", async () => {
    process.env.GITHUB_APP_ID = "";
    process.env.GITHUB_APP_PRIVATE_KEY = "";
    process.env.GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY = "unit-test-import-key";

    const sealed = sealGithubImportToken("sealed-token-1");
    assert.ok(sealed);

    const result = await resolveGithubRepoAccess({
      repoUrl: "https://github.com/example-org/example-repo",
      sealedImportToken: sealed,
    });

    assert.equal(result.source, "sealed");
    assert.equal(result.token, "sealed-token-1");
    assert.equal(result.installationId, null);
    assert.equal(result.normalizedRepoUrl, "https://github.com/example-org/example-repo");
  });

  it("returns none for invalid repo urls", async () => {
    const result = await resolveGithubRepoAccess({
      repoUrl: "not-a-repo-url",
      oauthToken: "oauth-token-1",
    });

    assert.equal(result.source, "none");
    assert.equal(result.token, null);
    assert.equal(result.normalizedRepoUrl, null);
  });
});

describe("github import event ids", () => {
  it("is deterministic for the same input", () => {
    const first = buildGithubImportEventId(
      "project-1",
      "github.com/example-org/example-repo",
      "main",
    );
    const second = buildGithubImportEventId(
      "project-1",
      "https://github.com/example-org/example-repo",
      "main",
    );

    assert.equal(first, second);
  });

  it("changes when branch changes", () => {
    const mainId = buildGithubImportEventId(
      "project-1",
      "https://github.com/example-org/example-repo",
      "main",
    );
    const devId = buildGithubImportEventId(
      "project-1",
      "https://github.com/example-org/example-repo",
      "dev",
    );

    assert.notEqual(mainId, devId);
  });
});
