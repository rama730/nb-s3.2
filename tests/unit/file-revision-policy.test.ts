import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isFileRevisionMode,
  nextFileRevisionNumber,
  normalizeRevisionComment,
  parseFileRevisionMode,
} from "../../src/lib/files/revision-policy";

describe("file revision policy", () => {
  it("accepts only the two canonical modes", () => {
    assert.equal(isFileRevisionMode("new_revision"), true);
    assert.equal(isFileRevisionMode("active_revision"), true);
    assert.equal(isFileRevisionMode("overwrite"), false);
    assert.equal(parseFileRevisionMode(undefined), "new_revision");
    assert.equal(parseFileRevisionMode("active_revision"), "active_revision");
  });

  it("normalizes optional comments to the database limit", () => {
    assert.equal(normalizeRevisionComment("   "), null);
    assert.equal(normalizeRevisionComment("  Fixed parser  "), "Fixed parser");
    assert.equal(normalizeRevisionComment("x".repeat(700))?.length, 500);
  });

  it("allocates new revisions after the highest retained history row", () => {
    assert.equal(nextFileRevisionNumber(10, 10), 11);
    assert.equal(nextFileRevisionNumber(1, 10), 11);
    assert.equal(nextFileRevisionNumber(1, null), 2);
    assert.equal(nextFileRevisionNumber(null, null), 1);
  });
});
