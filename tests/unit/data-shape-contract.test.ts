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
  it("fails former legacy surfaces instead of allowlisting them", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "data-shape-warn-"));
    write(
      path.join(tmp, "src/components/profile/ProfileForm.tsx"),
      `export function ProfileForm(){ return <div>{profile.avatar_url}</div>; }`,
    );

    const result = validateDataShapeContract(tmp);
    assert.ok(result.errors.length > 0);
    assert.equal(result.warnings.length, 0);
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

  it("keeps the contract blocking for every component path", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "data-shape-strict-"));
    write(
      path.join(tmp, "src/components/profile/ProfileForm.tsx"),
      `export function ProfileForm(){ return <div>{profile.avatar_url}</div>; }`,
    );

    const result = validateDataShapeContract(tmp);
    assert.ok(result.errors.length > 0, "Expected strict-mode violations but none were reported");
    assert.ok(result.errors.some((line) => line.includes("direct snake_case")));
  });
});
