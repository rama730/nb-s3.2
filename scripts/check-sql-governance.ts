import fs from "node:fs";
import path from "node:path";

import { parseSqlGovernanceManifest } from "../src/lib/standards/sql-governance";

type ValidationResult = {
  errors: string[];
  checkedMigrationFiles: number;
  checkedUtilityFiles: number;
};

const MANIFEST_PATH = path.join("standards", "sql-governance.manifest.json");

function toPosix(filePath: string) {
  return filePath.split(path.sep).join("/");
}

function collectSqlFiles(dir: string, into: string[]) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSqlFiles(full, into);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".sql")) {
      into.push(full);
    }
  }
}

export function validateSqlGovernance(rootDir: string = process.cwd()): ValidationResult {
  const manifestAbsolute = path.join(rootDir, MANIFEST_PATH);
  const manifest = parseSqlGovernanceManifest(JSON.parse(fs.readFileSync(manifestAbsolute, "utf8")));
  const errors: string[] = [];

  const sqlFiles: string[] = [];
  collectSqlFiles(rootDir, sqlFiles);

  const repoSqlFiles = sqlFiles
    .map((file) => toPosix(path.relative(rootDir, file)))
    .filter((rel) => !rel.startsWith("node_modules/"));

  const actualMigrationFiles = repoSqlFiles
    .filter((rel) => rel.startsWith(`${manifest.migrationDirectory}/`))
    .sort();
  const expectedMigrationFiles = [...manifest.existingMigrationFiles].sort();

  for (const rel of actualMigrationFiles) {
    if (!expectedMigrationFiles.includes(rel)) {
      errors.push(`${rel}: unapproved migration file; add it to the append-only governance manifest and Drizzle journal.`);
    }
  }

  for (const rel of expectedMigrationFiles) {
    if (!actualMigrationFiles.includes(rel)) {
      errors.push(`${rel}: migration file is missing from the repository but still declared in the governance manifest.`);
    }
  }

  const journalPath = path.join(rootDir, manifest.migrationDirectory, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries?: Array<{ tag?: string }>;
  };
  const journalTags = new Set(
    (journal.entries ?? [])
      .map((entry) => entry.tag)
      .filter((tag): tag is string => typeof tag === "string" && tag.length > 0),
  );
  const manifestTags = new Set(
    manifest.existingMigrationFiles.map((file) => path.basename(file, ".sql")),
  );

  for (const tag of manifestTags) {
    if (!journalTags.has(tag)) {
      errors.push(`${tag}: migration is approved in the governance manifest but missing from the Drizzle journal.`);
    }
  }
  for (const tag of journalTags) {
    if (!manifestTags.has(tag)) {
      errors.push(`${tag}: Drizzle journal entry is missing from the governance manifest.`);
    }
  }

  const allowedUtilityFiles = new Set(manifest.allowedUtilitySqlFiles);
  const actualUtilityFiles = repoSqlFiles
    .filter((rel) => !rel.startsWith(`${manifest.migrationDirectory}/`))
    .sort();

  for (const rel of actualUtilityFiles) {
    if (!allowedUtilityFiles.has(rel)) {
      errors.push(`${rel}: standalone SQL asset is not allowlisted in the governance manifest.`);
    }
  }

  for (const exception of manifest.breakGlassExceptions) {
    if (!repoSqlFiles.includes(exception.path)) {
      errors.push(`${exception.path}: break-glass exception references a missing SQL file.`);
      continue;
    }

    if (new Date(exception.expiresOn).getTime() < Date.now()) {
      errors.push(`${exception.path}: break-glass exception expired on ${exception.expiresOn}.`);
    }
  }

  return {
    errors,
    checkedMigrationFiles: actualMigrationFiles.length,
    checkedUtilityFiles: actualUtilityFiles.length,
  };
}

function main() {
  const result = validateSqlGovernance(process.cwd());
  if (result.errors.length > 0) {
    console.error("[sql-governance] violations detected:");
    for (const error of result.errors) {
      console.error(` - ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `[sql-governance] ok (${result.checkedMigrationFiles} migrations, ${result.checkedUtilityFiles} utility SQL files)`,
  );
}

if (require.main === module) {
  main();
}
