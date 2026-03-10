import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { openGithubImportToken, sealGithubImportToken } from "../../src/lib/github/repo-security";

const ORIGINAL_KEY = process.env.GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY;

afterEach(() => {
  process.env.GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("repo-security token sealing", () => {
  it("decrypts a valid sealed token", () => {
    process.env.GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY = "unit-test-import-key";
    const sealed = sealGithubImportToken("ghp_example_token");
    assert.ok(sealed);
    assert.equal(openGithubImportToken(sealed), "ghp_example_token");
  });

  it("fails closed on malformed auth tags", () => {
    process.env.GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY = "unit-test-import-key";
    const sealed = sealGithubImportToken("ghp_example_token");
    assert.ok(sealed);
    const malformed = { ...sealed, authTag: Buffer.from("short").toString("base64url") };
    assert.equal(openGithubImportToken(malformed), null);
  });
});
