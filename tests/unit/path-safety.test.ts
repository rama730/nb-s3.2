import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { appendSafePathSegment, normalizeSafeRelativePath, resolvePathUnderRoot } from "../../src/lib/security/path-safety";

describe("path-safety helpers", () => {
  it("accepts normal relative subpaths", () => {
    assert.equal(normalizeSafeRelativePath("a/b/c.txt"), "a/b/c.txt");
  });

  it("rejects traversal and absolute paths", () => {
    assert.throws(() => normalizeSafeRelativePath("../secret.txt"), /Unsafe path/);
    assert.throws(() => normalizeSafeRelativePath("/etc/passwd"), /Unsafe path/);
  });

  it("keeps resolved paths under the root directory", () => {
    const root = path.resolve("/tmp/nb-path-safety-root");
    const fullPath = resolvePathUnderRoot(root, "nested/file.sql");
    assert.equal(fullPath, path.join(root, "nested", "file.sql"));
    assert.throws(() => resolvePathUnderRoot(root, "../../escape.sql"), /Unsafe path/);
  });

  it("appends only safe single path segments", () => {
    const base = path.resolve("/tmp/nb-path-safety-segment");
    assert.equal(appendSafePathSegment(base, "file.txt"), path.join(base, "file.txt"));
    assert.throws(() => appendSafePathSegment(base, "../file.txt"), /Unsafe path segment/);
  });
});
