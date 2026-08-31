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

  const exceptionPaths = new Set(manifest.breakGlassExceptions.map((exception) => exception.path));
  const actualMigrationFiles = repoSqlFiles
    .filter((rel) => rel.startsWith(`${manifest.migrationDirectory}/`))
    .filter((rel) => !exceptionPaths.has(rel))
    .sort();
  const expectedMigrationFiles = [...manifest.existingMigrationFiles];

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
    entries?: Array<{ idx?: number; tag?: string; when?: number }>;
  };
  const journalEntries = (journal.entries ?? []).filter(
    (entry): entry is { idx: number; tag: string; when: number } =>
      Number.isInteger(entry.idx)
      && typeof entry.tag === "string"
      && entry.tag.length > 0
      && Number.isInteger(entry.when),
  );
  const journalTags = new Set(journalEntries.map((entry) => entry.tag));
  const manifestTags = new Set(manifest.existingMigrationFiles.map((file) => path.basename(file, ".sql")));

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

  const journalFiles = [...journalEntries]
    .sort((left, right) => left.idx - right.idx)
    .map((entry) => `${manifest.migrationDirectory}/${entry.tag}.sql`);
  if (journalFiles.length !== expectedMigrationFiles.length) {
    errors.push(`ordered lineage length differs: journal=${journalFiles.length}, manifest=${expectedMigrationFiles.length}.`);
  }
  const strictTagSet = new Set(
    journalEntries
      .filter((entry) => entry.idx >= manifest.strictLineageFromIndex)
      .map((entry) => entry.tag),
  );
  const strictJournalFiles = journalFiles.filter((file) => strictTagSet.has(path.basename(file, ".sql")));
  const strictManifestFiles = expectedMigrationFiles.filter((file) => strictTagSet.has(path.basename(file, ".sql")));
  for (let position = 0; position < Math.max(strictJournalFiles.length, strictManifestFiles.length); position += 1) {
    if (strictJournalFiles[position] !== strictManifestFiles[position]) {
      errors.push(
        `ordered strict lineage mismatch at position ${position}: journal=${strictJournalFiles[position] ?? "<missing>"}, manifest=${strictManifestFiles[position] ?? "<missing>"}.`,
      );
    }
  }

  const seenIndexes = new Set<number>();
  const seenTags = new Set<string>();
  for (const entry of journalEntries) {
    if (seenIndexes.has(entry.idx)) errors.push(`duplicate journal index ${entry.idx}.`);
    if (seenTags.has(entry.tag)) errors.push(`duplicate journal tag ${entry.tag}.`);
    seenIndexes.add(entry.idx);
    seenTags.add(entry.tag);
  }

  const historicalPrefixes = journalEntries
    .filter((entry) => entry.idx < manifest.strictLineageFromIndex)
    .map((entry) => Number(entry.tag.match(/^(\d{4})_/)?.[1]))
    .filter(Number.isFinite);
  let previousPrefix = historicalPrefixes.length > 0 ? Math.max(...historicalPrefixes) : -1;
  let previousTimestamp = -1;
  const strictPrefixes = new Set<number>();
  for (const entry of [...journalEntries]
    .filter((candidate) => candidate.idx >= manifest.strictLineageFromIndex)
    .sort((left, right) => left.idx - right.idx)) {
    const prefix = Number(entry.tag.match(/^(\d{4})_/)?.[1]);
    const descriptiveParts = entry.tag.replace(/^\d{4}_/, "").split("_").filter(Boolean);
    if (descriptiveParts.length < 2) {
      errors.push(`${entry.tag}: new migration name must describe its domain and intent.`);
    }
    const migrationPath = path.join(rootDir, manifest.migrationDirectory, `${entry.tag}.sql`);
    if (fs.existsSync(migrationPath) && fs.statSync(migrationPath).size > 1024 * 1024) {
      errors.push(`${entry.tag}: new migration exceeds 1 MiB; emit a catalog delta instead of repeating full seed state.`);
    }
    if (!Number.isInteger(prefix)) {
      errors.push(`${entry.tag}: new migration tag must begin with a four-digit prefix.`);
    } else {
      if (strictPrefixes.has(prefix)) errors.push(`${entry.tag}: duplicate new migration prefix ${String(prefix).padStart(4, "0")}.`);
      if (prefix <= previousPrefix) errors.push(`${entry.tag}: prefix must increase beyond ${String(previousPrefix).padStart(4, "0")}.`);
      strictPrefixes.add(prefix);
      previousPrefix = prefix;
    }
    if (entry.when <= previousTimestamp) errors.push(`${entry.tag}: journal timestamp must increase monotonically.`);
    if (entry.when > Date.now()) errors.push(`${entry.tag}: journal timestamp is in the future.`);
    previousTimestamp = entry.when;
  }

  const allowedUtilityFiles = new Set(manifest.allowedUtilitySqlFiles);
  const actualUtilityFiles = repoSqlFiles
    .filter((rel) => !rel.startsWith(`${manifest.migrationDirectory}/`))
    .filter((rel) => !exceptionPaths.has(rel))
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
