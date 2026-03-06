import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectFileKey,
  isCanonicalProjectFileKey,
  parseProjectFileKey,
  parseProjectIdFromProjectFileKey,
  toCanonicalProjectFileKey,
} from "../../src/lib/storage/project-file-key";

const PROJECT_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("project file key utilities", () => {
  it("builds canonical keys with normalized path separators", () => {
    const key = buildProjectFileKey(PROJECT_ID, "\\src//app\\main.ts");
    assert.equal(key, `${PROJECT_ID}/src/app/main.ts`);
    assert.equal(isCanonicalProjectFileKey(key), true);
  });

  it("parses canonical keys", () => {
    const parsed = parseProjectFileKey(`${PROJECT_ID}/docs/readme.md`);
    assert.deepEqual(parsed, {
      projectId: PROJECT_ID,
      relativePath: "docs/readme.md",
      format: "canonical",
    });
  });

  it("parses legacy keys and converts them to canonical format", () => {
    const legacy = `projects/${PROJECT_ID}/docs/readme.md`;
    const parsed = parseProjectFileKey(legacy);
    assert.deepEqual(parsed, {
      projectId: PROJECT_ID,
      relativePath: "docs/readme.md",
      format: "legacy",
    });
    assert.equal(parseProjectIdFromProjectFileKey(legacy), PROJECT_ID);
    assert.equal(toCanonicalProjectFileKey(legacy), `${PROJECT_ID}/docs/readme.md`);
  });

  it("rejects malformed keys", () => {
    assert.equal(parseProjectFileKey("projects/not-a-uuid/file.txt"), null);
    assert.equal(parseProjectFileKey(""), null);
    assert.equal(parseProjectIdFromProjectFileKey("random/path"), null);
  });
});

