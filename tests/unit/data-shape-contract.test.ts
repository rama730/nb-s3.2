import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateDataShapeContract } from "../../scripts/check-data-shape-contract";

function write(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

describe("check-data-shape-contract script", () => {
  it("warns for allowlisted legacy surfaces in non-strict mode", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "data-shape-warn-"));
    write(
      path.join(tmp, "src/components/profile/ProfileForm.tsx"),
      `export function ProfileForm(){ return <div>{profile.avatar_url}</div>; }`,
    );

    const result = validateDataShapeContract(tmp);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.ok(result.warnings[0]?.includes("legacy snake_case surface remains allowlisted"));
  });

  it("fails when a non-allowlisted component uses raw snake_case fields", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "data-shape-fail-"));
    write(
      path.join(tmp, "src/components/foo/NewCard.tsx"),
      `export function NewCard(){ return <div>{profile.avatar_url}</div>; }`,
    );

    const result = validateDataShapeContract(tmp);
    assert.ok(result.errors.length > 0, "Expected violations but none were reported");
    assert.ok(result.errors.some((line) => line.includes("direct snake_case identity/profile fields are forbidden")));
  });

  it("promotes allowlisted legacy surfaces to violations in strict mode", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "data-shape-strict-"));
    write(
      path.join(tmp, "src/components/profile/ProfileForm.tsx"),
      `export function ProfileForm(){ return <div>{profile.avatar_url}</div>; }`,
    );

    const result = validateDataShapeContract(tmp, { strict: true });
    assert.ok(result.errors.length > 0, "Expected strict-mode violations but none were reported");
    assert.ok(result.errors.some((line) => line.includes("strict mode forbids allowlisted legacy surface")));
  });
});
