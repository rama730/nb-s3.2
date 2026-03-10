import fs from "node:fs";
import path from "node:path";

interface JournalEntry {
  idx: number;
  tag: string;
}

interface JournalFile {
  entries: JournalEntry[];
}

const rootDir = process.cwd();
const migrationsDir = path.join(rootDir, "drizzle");
const journalPath = path.join(rootDir, "drizzle", "meta", "_journal.json");

function readMigrationTags(): string[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.replace(/\.sql$/u, ""))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function readJournal(): JournalFile {
  try {
    return JSON.parse(fs.readFileSync(journalPath, "utf8")) as JournalFile;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      console.error(`Migration journal file not found at ${journalPath}: ${message}`);
      process.exit(1);
    }
    console.error(`Failed to read or parse migration journal at ${journalPath}: ${message}`);
    process.exit(1);
  }
}

function checkNoDuplicateTags(entries: JournalEntry[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry.tag)) duplicates.push(entry.tag);
    seen.add(entry.tag);
  }
  return duplicates;
}

function main() {
  const migrationTags = readMigrationTags();
  const journal = readJournal();
  const journalTags = journal.entries.map((entry) => entry.tag);

  const migrationTagSet = new Set(migrationTags);
  const journalTagSet = new Set(journalTags);

  const missingInJournal = migrationTags.filter((tag) => !journalTagSet.has(tag));
  const missingMigrationFile = journalTags.filter((tag) => !migrationTagSet.has(tag));
  const duplicateTags = checkNoDuplicateTags(journal.entries);

  if (
    missingInJournal.length === 0 &&
    missingMigrationFile.length === 0 &&
    duplicateTags.length === 0
  ) {
    console.log("Migration journal check passed.");
    return;
  }

  console.error("Migration journal drift detected.");
  if (missingInJournal.length > 0) {
    console.error("Missing in drizzle/meta/_journal.json:");
    for (const tag of missingInJournal) console.error(`- ${tag}`);
  }
  if (missingMigrationFile.length > 0) {
    console.error("Missing migration .sql files for journal tags:");
    for (const tag of missingMigrationFile) console.error(`- ${tag}`);
  }
  if (duplicateTags.length > 0) {
    console.error("Duplicate migration tags in journal:");
    for (const tag of duplicateTags) console.error(`- ${tag}`);
  }
  process.exit(1);
}

main();
