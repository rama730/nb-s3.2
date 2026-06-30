import { spawnSync } from "node:child_process";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const PRIMARY_DATABASE_URL = process.env.DATABASE_URL;
const FRESH_DATABASE_URL =
  process.env.DATABASE_URL_FRESH ||
  process.env.DATABASE_URL_REPLAY_FRESH ||
  null;

if (!PRIMARY_DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const REQUIRED_TABLES = [
  "profiles",
  "connections",
  "projects",
  "project_members",
  "project_nodes",
  "project_file_index",
  "project_node_locks",
  "project_node_events",
  "onboarding_drafts",
  "onboarding_submissions",
  "onboarding_events",
  "profile_audit_events",
  "profile_security_states",
  "upload_intents",
  "recovery_code_redemptions",
  "message_read_receipts",
  "message_delivery_receipts",
  "project_updates",
  "project_update_likes",
  "project_update_comments",
  "project_update_drafts",
];

const REQUIRED_RLS_TABLES = [...REQUIRED_TABLES];

const REQUIRED_POLICIES = [
  "Profiles are viewable by allowed users",
  "Users can insert own profile",
  "Users can update own profile",
  "Users can view own connections",
  "Users can create connection requests",
  "Users can update own connections",
  "Public projects are viewable by everyone",
  "Users can create own projects",
  "Users can update own projects",
  "Project members are viewable",
  "project_nodes_read",
  "project_nodes_public_read",
  "project_nodes_write",
  "project_file_index_read",
  "project_file_index_public_read",
  "project_file_index_write",
  "project_node_locks_read",
  "project_node_locks_write",
  "project_node_events_read",
  "project_node_events_write",
  "Users can manage own onboarding drafts",
  "Users can view own onboarding submissions",
  "Users can create own onboarding submissions",
  "Users can update own onboarding submissions",
  "Users can view own onboarding events",
  "Users can view own profile audit events",
  "Users can view own profile security state",
  "Users can update own profile security state",
  "Users can view own upload intents",
  "Users can update own upload intents",
  "Users can create own recovery code redemptions",
  "project_files_read",
  "project_files_public_read",
  "project_files_write",
  "Users can view delivery receipts in their conversations",
  "Users can insert their own delivery receipts",
  "Users can view read receipts in their conversations",
  "Users can upsert their own read receipts",
  "Project updates are viewable by project access",
  "Project members can create updates",
  "Authors and admins can manage updates",
  "Project update likes are viewable with updates",
  "Users can create their project update likes",
  "Users can remove their project update likes",
  "Project update comments are viewable with updates",
  "Users can create project update comments",
  "Authors and admins can manage project update comments",
  "Project update authors can manage own drafts",
  "project_updates_media_public_read",
  "project_updates_media_write",
  "project_updates_media_delete",
];

const REQUIRED_COLUMNS = [
  { tableName: "message_read_receipts", columnName: "conversation_id" },
  { tableName: "message_delivery_receipts", columnName: "conversation_id" },
  { tableName: "profiles", columnName: "onboarding_status" },
  { tableName: "profiles", columnName: "onboarding_completed_at" },
  { tableName: "profiles", columnName: "onboarding_version" },
  { tableName: "onboarding_drafts", columnName: "completed_through" },
  { tableName: "onboarding_drafts", columnName: "active_section" },
  { tableName: "onboarding_drafts", columnName: "schema_version" },
  { tableName: "onboarding_drafts", columnName: "expires_at" },
];

const REQUIRED_REALTIME_PUBLICATION_TABLES = [
  "profiles",
  "projects",
  "tasks",
  "task_comments",
  "task_subtasks",
  "task_comment_likes",
  "task_node_links",
  "project_updates",
  "project_update_comments",
  "message_read_receipts",
  "message_delivery_receipts",
];

function run(command: string, args: string[], env: Record<string, string | undefined>) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });

  if (result.error) throw result.error;
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
  if (result.signal) {
    throw new Error(`${command} ${args.join(" ")} exited with signal ${result.signal}`);
  }
}

function runWithRetry(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
  label: string,
  attempts = 2,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      run(command, args, env);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      console.warn(
        `[db-remigration] ${label} attempt ${attempt} failed, retrying...`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  throw lastError;
}

async function validateDatabase(
  databaseUrl: string,
  label: string,
  options: { strict: boolean },
) {
  const sql = postgres(databaseUrl, { ssl: "require", prepare: false, max: 1 });
  try {
    const [tablesRow] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ${sql(REQUIRED_TABLES)}
    `;
    if (options.strict && (tablesRow?.count ?? 0) !== REQUIRED_TABLES.length) {
      throw new Error(
        `[${label}] missing required tables (found ${tablesRow?.count ?? 0}/${REQUIRED_TABLES.length})`,
      );
    }

    const rlsRows = await sql<{ tableName: string; relrowsecurity: boolean }[]>`
      SELECT c.relname AS "tableName", c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ${sql(REQUIRED_RLS_TABLES)}
    `;
    const rlsDisabled = rlsRows
      .filter((row) => !row.relrowsecurity)
      .map((row) => row.tableName);
    if (options.strict && rlsDisabled.length > 0) {
      throw new Error(`[${label}] RLS disabled on tables: ${rlsDisabled.join(", ")}`);
    }

    const policyRows = await sql<{ polname: string }[]>`
      SELECT DISTINCT p.polname
      FROM pg_policy p
      WHERE p.polname IN ${sql(REQUIRED_POLICIES)}
    `;
    if (options.strict) {
      const found = new Set(policyRows.map((row) => row.polname));
      const missing = REQUIRED_POLICIES.filter((name) => !found.has(name));
      if (missing.length > 0) {
        throw new Error(
          `[${label}] missing required policies (${missing.length}): ${missing.join(", ")}`,
        );
      }
    }

    const requiredColumnTables = Array.from(new Set(REQUIRED_COLUMNS.map((column) => column.tableName)));
    const requiredColumnNames = Array.from(new Set(REQUIRED_COLUMNS.map((column) => column.columnName)));
    const columnRows = await sql<{ tableName: string; columnName: string }[]>`
      SELECT table_name AS "tableName", column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ${sql(requiredColumnTables)}
        AND column_name IN ${sql(requiredColumnNames)}
    `;
    if (options.strict) {
      const found = new Set(columnRows.map((row) => `${row.tableName}.${row.columnName}`));
      const missing = REQUIRED_COLUMNS
        .map(({ tableName, columnName }) => `${tableName}.${columnName}`)
        .filter((entry) => !found.has(entry));
      if (missing.length > 0) {
        throw new Error(`[${label}] missing required columns: ${missing.join(", ")}`);
      }
    }

    const publicationRows = await sql<{ tableName: string }[]>`
      SELECT tablename AS "tableName"
      FROM pg_publication_tables
      WHERE schemaname = 'public'
        AND pubname = 'supabase_realtime'
        AND tablename IN ${sql(REQUIRED_REALTIME_PUBLICATION_TABLES)}
    `;
    if (options.strict) {
      const found = new Set(publicationRows.map((row) => row.tableName));
      const missing = REQUIRED_REALTIME_PUBLICATION_TABLES.filter((tableName) => !found.has(tableName));
      if (missing.length > 0) {
        throw new Error(`[${label}] missing Supabase realtime publication tables: ${missing.join(", ")}`);
      }
    }

    const [sloViewRow] = await sql<{ exists: boolean }[]>`
      SELECT to_regclass('public.onboarding_slo_daily') IS NOT NULL AS exists
    `;
    if (options.strict && !sloViewRow?.exists) {
      throw new Error(`[${label}] missing onboarding SLO view: public.onboarding_slo_daily`);
    }

    const [dmPairsPkRow] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM pg_constraint
      WHERE conrelid = to_regclass('public.dm_pairs')
        AND contype = 'p'
    `;
    if (options.strict && (dmPairsPkRow?.count ?? 0) !== 1) {
      throw new Error(`[${label}] dm_pairs must have exactly 1 primary key`);
    }

    console.log(`[db-remigration] ${label}: validation passed`);
  } finally {
    await sql.end();
  }
}

async function replayForDatabase(databaseUrl: string, label: string) {
  console.log(`\n[db-remigration] validating ${label} (pre-check)...`);
  await validateDatabase(databaseUrl, `${label}:pre`, { strict: false });

  console.log(`[db-remigration] applying migration journal pass 1 (${label})...`);
  runWithRetry(
    process.execPath,
    ["--import", "tsx", "scripts/setup-database.ts"],
    { DATABASE_URL: databaseUrl },
    `${label}:migration-pass-1`,
  );

  console.log(`[db-remigration] applying migration journal pass 2 (${label})...`);
  runWithRetry(
    process.execPath,
    ["--import", "tsx", "scripts/setup-database.ts"],
    { DATABASE_URL: databaseUrl },
    `${label}:migration-pass-2`,
  );

  console.log(`[db-remigration] validating ${label} (post-check)...`);
  await validateDatabase(databaseUrl, `${label}:post`, { strict: true });

  console.log(`[db-remigration] running onboarding SLO check (${label})...`);
  run(process.execPath, ["--import", "tsx", "scripts/check-onboarding-slo.ts"], { DATABASE_URL: databaseUrl });
}

async function main() {
  console.log("[db-remigration] checking migration journal...");
  run(process.execPath, ["--import", "tsx", "scripts/check-migration-journal.ts"], process.env);

  if (!FRESH_DATABASE_URL) {
    throw new Error(
      "Fresh replay requires DATABASE_URL_FRESH (or DATABASE_URL_REPLAY_FRESH) pointing to a disposable database. " +
        "The primary database is never mutated by this check.",
    );
  }
  if (FRESH_DATABASE_URL === PRIMARY_DATABASE_URL) {
    throw new Error("fresh DB replay requires DATABASE_URL_FRESH to be distinct from DATABASE_URL.");
  }

  console.log("[db-remigration] validating primary database read-only...");
  await validateDatabase(PRIMARY_DATABASE_URL!, "primary-db:read-only", { strict: true });

  await replayForDatabase(FRESH_DATABASE_URL, "fresh-db");

  console.log("\n[db-remigration] replay validation passed.");
}

main().catch((error) => {
  console.error("[db-remigration] failed:", error);
  process.exit(1);
});
