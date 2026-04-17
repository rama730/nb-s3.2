import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isValidGithubBranchName,
  normalizeGithubBranch,
} from "@/lib/github/repo-validation";

describe("GitHub branch validation", () => {
  it("rejects branch names that start with a dash", () => {
    assert.equal(isValidGithubBranchName("-main"), false);
    assert.equal(normalizeGithubBranch("-main"), undefined);
  });

  it("accepts safe branch names", () => {
    assert.equal(isValidGithubBranchName("feature/sprint-overhaul"), true);
    assert.equal(normalizeGithubBranch(" feature/sprint-overhaul "), "feature/sprint-overhaul");
  });
});
