import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectImportEventId,
  buildUploadManifestHash,
  normalizeImportIdComponent,
} from "../../src/lib/import/idempotency";

describe("import idempotency helpers", () => {
  it("normalizes components and applies fallback", () => {
    assert.equal(normalizeImportIdComponent("  My Repo / Main  ", "fallback"), "my-repo-main");
    assert.equal(normalizeImportIdComponent("###", "fallback"), "fallback");
  });

  it("builds deterministic event ids", () => {
    const first = buildProjectImportEventId({
      projectId: "Project_123",
      source: "github",
      normalizedTarget: "HTTPS://github.com/Org/Repo",
      branchOrManifestHash: "Main",
    });
    const second = buildProjectImportEventId({
      projectId: "project_123",
      source: "github",
      normalizedTarget: "https://github.com/org/repo",
      branchOrManifestHash: "main",
    });

    assert.equal(first, second);
    assert.equal(first, "project-import:project_123:github:https-github.com-org-repo:main");
  });

  it("hashes upload manifests deterministically regardless of order", () => {
    const hashA = buildUploadManifestHash([
      { relativePath: "src/index.ts", size: 120, mimeType: "text/plain" },
      { relativePath: "README.md", size: 10, mimeType: "text/markdown" },
    ]);
    const hashB = buildUploadManifestHash([
      { relativePath: "README.md", size: 10, mimeType: "text/markdown" },
      { relativePath: "./src\\index.ts".replace("./", ""), size: 120, mimeType: "text/plain" },
    ]);

    assert.equal(hashA, hashB);
  });

  it("changes hash when manifest entries change", () => {
    const base = buildUploadManifestHash([
      { relativePath: "src/index.ts", size: 120, mimeType: "text/plain" },
    ]);
    const changed = buildUploadManifestHash([
      { relativePath: "src/index.ts", size: 121, mimeType: "text/plain" },
    ]);

    assert.notEqual(base, changed);
  });
});
