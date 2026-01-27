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

async function runFile(path: string) {
  const full = join(__dirname, "..", path);
  const text = await readFile(full, "utf8");
  console.log(`\n▶ Applying ${path}`);
  await sql.unsafe(text);
  console.log(`✅ Applied ${path}`);
}

async function main() {
  try {
    // Keep order: index -> locks -> trash/events
    await runFile("drizzle/0014_project_file_index.sql");
    await runFile("drizzle/0015_project_node_locks.sql");
    await runFile("drizzle/0016_project_nodes_trash_and_events.sql");
    console.log("\n✅ Files migrations applied.");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("❌ Failed applying files migrations:", e);
  process.exit(1);
});

