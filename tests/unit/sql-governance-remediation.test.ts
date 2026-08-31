import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("forward migrations own missing task lineage and native hardening", () => {
  const lineage = source("drizzle/0153_task_server_table_lineage.sql");
  const hardening = source("drizzle/0154_native_database_security_hardening.sql");

  assert.match(lineage, /CREATE TABLE IF NOT EXISTS public\.task_pushes/);
  assert.match(lineage, /CREATE TABLE IF NOT EXISTS public\.task_read_receipts/);
  for (const column of ["added_by", "project_id", "removed_by"]) {
    assert.match(lineage, new RegExp(`sprint_task_memberships \\(${column}\\)`));
  }
  assert.match(hardening, /profiles_id_auth_users_fk/);
  assert.match(hardening, /FOREIGN KEY \(id\) REFERENCES auth\.users\(id\).*NOT VALID/);
  assert.match(hardening, /DROP INDEX IF EXISTS public\.dm_pairs_user_low_user_high_key/);
  assert.match(hardening, /SET search_path = ''/);
  assert.match(hardening, /member\.role <> 'viewer'/);
});

test("migration lineage is exact and the duplicate backfill is quarantined", () => {
  const journal = JSON.parse(source("drizzle/meta/_journal.json")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const manifest = JSON.parse(source("standards/sql-governance.manifest.json")) as {
    strictLineageFromIndex: number;
    existingMigrationFiles: string[];
    breakGlassExceptions: Array<{ path: string }>;
  };
  const tags = new Set(journal.entries.map((entry) => entry.tag));

  for (const tag of [
    "0153_task_server_table_lineage",
    "0154_native_database_security_hardening",
    "0155_account_deletion_privacy",
    "0156_profile_counter_authority",
  ]) {
    assert.ok(tags.has(tag));
    assert.ok(manifest.existingMigrationFiles.includes(`drizzle/${tag}.sql`));
  }
  assert.equal(manifest.strictLineageFromIndex, 152);
  assert.ok(
    manifest.breakGlassExceptions.some(
      (exception) => exception.path === "drizzle/0152_message_preview_backfill.sql",
    ),
  );
});

test("hard-delete retries Auth finalization and removes retained identity", () => {
  const hardDelete = source("src/lib/account/hard-delete.ts");
  const accountAction = source("src/app/actions/account.ts");

  assert.match(hardDelete, /cleanupStatus !== "completed"[\s\S]*cleanupStatus !== "in_progress"/);
  assert.match(hardDelete, /userId: deletionId/);
  assert.match(hardDelete, /email: "deleted-account@invalid"/);
  assert.doesNotMatch(accountAction, /randomBytes\(32\).*confirmationToken/);
});

test("one worker owns monthly partition maintenance", () => {
  const registry = source("src/inngest/registry.ts");
  const maintenance = source("src/inngest/functions/database-partition-maintenance.ts");

  assert.equal(fs.existsSync(path.join(process.cwd(), "scripts/setup-partitioning.sql")), false);
  assert.match(registry, /databasePartitionMaintenance/);
  assert.match(maintenance, /cron: "15 4 1 \* \*"/);
  assert.match(maintenance, /SELECT public\.create_future_partitions\(\)/);
});
