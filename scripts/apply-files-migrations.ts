/**
 * Applies ONLY the new Files subsystem SQL migrations (idempotent).
 *
 * Run:
 *   npx tsx scripts/apply-files-migrations.ts
 */

import postgres from "postgres";
import * as dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFile } from "fs/promises";
import { resolvePathUnderRoot } from "../src/lib/security/path-safety";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not found in .env.local");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  prepare: false,
  ssl: "require",
});

const MIGRATION_FILES = [
  "drizzle/0014_project_file_index.sql",
  "drizzle/0015_project_node_locks.sql",
  "drizzle/0016_project_nodes_trash_and_events.sql",
] as const;

const MIGRATION_FILE_ALLOWLIST = new Set<string>(MIGRATION_FILES);
const REPO_ROOT = join(__dirname, "..");

async function runFile(relativeSqlPath: string) {
  if (!MIGRATION_FILE_ALLOWLIST.has(relativeSqlPath)) {
    throw new Error(`Migration is not allowlisted: ${relativeSqlPath}`);
  }

  const fullPath = resolvePathUnderRoot(REPO_ROOT, relativeSqlPath, "migration file path");
  const text = await readFile(fullPath, "utf8");
  console.log("Applying migration", { path: relativeSqlPath });
  await sql.unsafe(text);
  console.log("Applied migration", { path: relativeSqlPath });
}

async function main() {
  try {
    // Keep order: index -> locks -> trash/events
    for (const file of MIGRATION_FILES) {
      await runFile(file);
    }
    console.log("\n✅ Files migrations applied.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("❌ Failed applying files migrations:", e);
  process.exit(1);
});
