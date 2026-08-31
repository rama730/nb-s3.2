import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
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

type JournalFile = {
  entries: Array<{ idx: number; tag: string }>;
};

type ReplayRequiredState = {
  tables: string[];
  rlsTables: string[];
  policies: string[];
  realtimePublicationTables: string[];
};

function readText(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function migrationSourcesInJournalOrder() {
  const journal = JSON.parse(readText("drizzle/meta/_journal.json")) as JournalFile;
  return [...journal.entries]
    .sort((left, right) => left.idx - right.idx)
    .map((entry) => readText(`drizzle/${entry.tag}.sql`));
}

function normalizeTableName(value: string | undefined) {
  return value?.replace(/^public\./i, "").replace(/^"|"$/g, "") ?? null;
}

function collectTableMatches(source: string, pattern: RegExp) {
  const tables: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const tableName = normalizeTableName(match[1] || match[2]);
    if (tableName) tables.push(tableName);
  }
  return tables;
}

function drizzleSchemaTables() {
  return [...readText("src/lib/db/schema/index.ts").matchAll(/\bpgTable\(\s*["']([^"']+)["']/g)]
    .map((match) => match[1]!)
    .sort();
}

function collectReplayRequiredState(): ReplayRequiredState {
  // The ORM declaration is the application catalog authority. Deriving this
  // set from migrations made objects absent from both sources invisible.
  const tables = new Set(drizzleSchemaTables());
  const rlsTables = new Set<string>();
  const policies = new Set<string>();
  const realtimePublicationTables = new Set<string>();

  for (const source of migrationSourcesInJournalOrder()) {
    for (const tableName of collectTableMatches(
      source,
      /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?(?:"([^"]+)"|([a-z_][\w$]*))\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi,
    )) {
      rlsTables.add(tableName);
    }

    for (const match of source.matchAll(/\bCREATE\s+POLICY\s+(?:"([^"]+)"|([a-z_][\w$]*))/gi)) {
      policies.add((match[1] || match[2])!);
    }
    for (const match of source.matchAll(/\bDROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([a-z_][\w$]*))/gi)) {
      policies.delete((match[1] || match[2])!);
    }

    for (const tableName of collectTableMatches(
      source,
      /\bALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+(?:public\.)?(?:"([^"]+)"|([a-z_][\w$]*))/gi,
    )) {
      realtimePublicationTables.add(tableName);
    }
    for (const tableName of collectTableMatches(
      source,
      /\bALTER\s+PUBLICATION\s+supabase_realtime\s+DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(?:"([^"]+)"|([a-z_][\w$]*))/gi,
    )) {
      realtimePublicationTables.delete(tableName);
    }
  }

  const liveTables = (values: Set<string>) => [...values]
    .filter((tableName) => tableName !== "app_migration_journal")
    .sort();

  return {
    tables: liveTables(tables),
    rlsTables: liveTables(rlsTables).filter((tableName) => tables.has(tableName)),
    policies: [...policies].sort(),
    realtimePublicationTables: liveTables(realtimePublicationTables).filter((tableName) => tables.has(tableName)),
  };
}

const REQUIRED_STATE = collectReplayRequiredState();

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
    const tableRows = await sql<{ tableName: string }[]>`
      SELECT table_name AS "tableName"
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `;
    if (options.strict) {
      const found = new Set(tableRows.map((row) => row.tableName));
      const missing = REQUIRED_STATE.tables.filter((tableName) => !found.has(tableName));
      const allowedReplayOnly = (tableName: string) =>
        tableName === "app_migration_journal"
        || /^project_node_events_(?:\d{4}_\d{2}|default)$/.test(tableName)
        || /^tasks_p\d+$/.test(tableName);
      const unexpected = [...found]
        .filter((tableName) => !REQUIRED_STATE.tables.includes(tableName) && !allowedReplayOnly(tableName))
        .sort();
      if (missing.length > 0 || unexpected.length > 0) {
        throw new Error(
          `[${label}] catalog mismatch; missing=[${missing.join(", ")}], unexpected=[${unexpected.join(", ")}]`,
        );
      }
    }

    const rlsRows = await sql<{ tableName: string; relrowsecurity: boolean }[]>`
      SELECT c.relname AS "tableName", c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ${sql(REQUIRED_STATE.rlsTables)}
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
      WHERE p.polname IN ${sql(REQUIRED_STATE.policies)}
    `;
    if (options.strict) {
      const found = new Set(policyRows.map((row) => row.polname));
      const missing = REQUIRED_STATE.policies.filter((name) => !found.has(name));
      if (missing.length > 0) {
        throw new Error(
          `[${label}] missing required policies (${missing.length}): ${missing.join(", ")}`,
        );
      }
    }

    const publicationRows = await sql<{ tableName: string }[]>`
      SELECT tablename AS "tableName"
      FROM pg_publication_tables
      WHERE schemaname = 'public'
        AND pubname = 'supabase_realtime'
        AND tablename IN ${sql(REQUIRED_STATE.realtimePublicationTables)}
    `;
    if (options.strict) {
      const found = new Set(publicationRows.map((row) => row.tableName));
      const missing = REQUIRED_STATE.realtimePublicationTables.filter((tableName) => !found.has(tableName));
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
