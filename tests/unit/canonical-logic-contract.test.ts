import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateCanonicalLogicContract } from "../../scripts/check-canonical-logic-contract";

function write(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function seedCanonicalModules(rootDir: string) {
  write(path.join(rootDir, "src/components/ui/UserAvatar.tsx"), "export function UserAvatar(){ return null; }");
  write(path.join(rootDir, "src/lib/ui/identity.ts"), "export const identity = true;");
  write(path.join(rootDir, "src/lib/ui/status-config.ts"), "export const status = true;");
  write(path.join(rootDir, "src/lib/profile/display.ts"), "export const display = true;");
  write(path.join(rootDir, "src/components/people/person-card-model.ts"), "export const model = true;");
  write(path.join(rootDir, "src/lib/import/import-filters.ts"), "export const filters = true;");
}

describe("check-canonical-logic-contract script", () => {
  it("passes when a first-wave surface uses UserAvatar", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-logic-pass-"));
    seedCanonicalModules(tmp);
    write(
      path.join(tmp, "src/components/people/PersonCard.tsx"),
      `
        import { UserAvatar } from "@/components/ui/UserAvatar";
        export function PersonCard() {
          return <UserAvatar identity={{ fullName: "Ch Rama" }} />;
        }
      `,
    );

    const result = validateCanonicalLogicContract(tmp);
    assert.equal(result.errors.length, 0, `Expected no violations, got: ${result.errors.join("\n")}`);
  });

  it("fails when a first-wave surface keeps inline avatar fallback logic", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-logic-fail-"));
    seedCanonicalModules(tmp);
    write(
      path.join(tmp, "src/components/people/PersonCard.tsx"),
      `
        export function PersonCard({ profile }) {
          return profile.avatarUrl ? <div /> : <div className="app-accent-gradient">{profile.fullName?.[0]}</div>;
        }
      `,
    );

    const result = validateCanonicalLogicContract(tmp);
    assert.ok(result.errors.length > 0, "Expected violations but none were reported");
    assert.ok(result.errors.some((line) => line.includes("must import UserAvatar")));
    assert.ok(result.errors.some((line) => line.includes("must not branch on avatar URLs inline")));
  });
});
