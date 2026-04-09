import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateSqlGovernance } from "../../scripts/check-sql-governance";

function write(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeManifest(rootDir: string, existingMigrationFiles: string[], allowedUtilitySqlFiles: string[] = []) {
  write(
    path.join(rootDir, "standards/sql-governance.manifest.json"),
    JSON.stringify(
      {
        policyVersion: 1,
        defaultChangeKind: "remigration",
        migrationDirectory: "drizzle",
        existingMigrationFiles,
        allowedUtilitySqlFiles,
        breakGlassExceptions: [],
      },
      null,
      2,
    ),
  );
}

describe("check-sql-governance script", () => {
  it("passes when SQL files match the governance manifest", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sql-governance-pass-"));
    write(path.join(tmp, "drizzle/0001_initial.sql"), "-- migration");
    write(path.join(tmp, "scripts/setup.sql"), "-- utility");
    writeManifest(tmp, ["drizzle/0001_initial.sql"], ["scripts/setup.sql"]);

    const result = validateSqlGovernance(tmp);
    assert.equal(result.errors.length, 0, `Expected no violations, got: ${result.errors.join("\n")}`);
  });

  it("fails when a new migration file is added outside the manifest", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sql-governance-fail-"));
    write(path.join(tmp, "drizzle/0001_initial.sql"), "-- migration");
    write(path.join(tmp, "drizzle/0002_new.sql"), "-- migration");
    writeManifest(tmp, ["drizzle/0001_initial.sql"]);

    const result = validateSqlGovernance(tmp);
    assert.ok(result.errors.length > 0, "Expected violations but none were reported");
    assert.ok(result.errors.some((line) => line.includes("new migration file detected")));
  });
});
