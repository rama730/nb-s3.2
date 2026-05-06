/**
 * Database setup now delegates to the checked-in Drizzle migration journal.
 * Run with: npx tsx scripts/setup-database.ts
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import * as dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

type JournalEntry = {
  idx: number;
  tag: string;
};

type JournalFile = {
  entries: JournalEntry[];
};

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

const DATABASE_URL = process.env.DATABASE_URL;
const JOURNAL_TABLE = "app_migration_journal";
const MIGRATION_LOCK_KEY = "nb-s3:migration-setup";

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not found in .env.local");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  prepare: false,
  ssl: "require",
});

const DEFAULT_NOTIFICATION_PREFERENCES = JSON.stringify({
  messages: true,
  mentions: true,
  workflows: true,
  projects: true,
  tasks: true,
  applications: true,
  connections: true,
  pausedUntil: null,
  mutedScopes: [],
});

function resolveWorkspacePath(...parts: string[]) {
  return path.join(process.cwd(), ...parts);
}

async function readJournal(): Promise<JournalFile> {
  const source = await readFile(resolveWorkspacePath("drizzle", "meta", "_journal.json"), "utf8");
  return JSON.parse(source) as JournalFile;
}

async function ensureJournalTable() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS public.${JOURNAL_TABLE} (
      tag text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function acquireMigrationLock() {
  await sql`SELECT pg_advisory_lock(hashtext(${MIGRATION_LOCK_KEY}))`;
}

async function releaseMigrationLock() {
  await sql`SELECT pg_advisory_unlock(hashtext(${MIGRATION_LOCK_KEY}))`;
}

async function readAppliedTags() {
  const rows = await sql<{ tag: string }[]>`
    SELECT tag
    FROM public.app_migration_journal
    ORDER BY applied_at ASC, tag ASC
  `;
  return new Set(rows.map((row) => row.tag));
}

function splitMigrationStatements(source: string) {
  return source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function databaseHasExistingApplicationSchema() {
  const rows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name NOT IN (${JOURNAL_TABLE})
  `;
  return (rows[0]?.count ?? 0) > 0;
}

type ExistingSchemaSignals = {
  hasLegacyCoreSchema: boolean;
  hasProfileSecurityState: boolean;
  hasPrivacyAwareProfilePolicy: boolean;
  hasUploadIntentTables: boolean;
  hasAuthorityBackfillPolicies: boolean;
};

async function readExistingSchemaSignals(): Promise<ExistingSchemaSignals> {
  const [tablesRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'profiles',
        'projects',
        'connections',
        'project_members',
        'project_nodes',
        'project_file_index',
        'project_node_locks',
        'project_node_events',
        'onboarding_drafts',
        'onboarding_submissions',
        'onboarding_events',
        'profile_audit_events',
        'profile_audit_events'
      )
  `;
  const [viewRow] = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('public.onboarding_slo_daily') IS NOT NULL AS exists
  `;
  const policyRows = await sql<{ polname: string }[]>`
    SELECT DISTINCT polname
    FROM pg_policy
    WHERE polname IN (
      'Profiles are viewable by allowed users',
      'Users can insert own profile',
      'Users can update own profile',
      'Users can view own connections',
      'Users can create connection requests',
      'Users can update own connections',
      'Public projects are viewable by everyone',
      'Users can create own projects',
      'Users can update own projects',
      'Project members are viewable',
      'project_nodes_write',
      'project_file_index_write',
      'project_node_locks_write',
      'project_node_events_write',
      'project_files_write',
      'Users can manage own onboarding drafts',
      'Users can view own onboarding submissions',
      'Users can update own onboarding submissions',
      'Users can view own profile audit events',
      'project_files_write'
    )
  `;
  const [profileSecurityStateRow] = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('public.profile_security_states') IS NOT NULL AS exists
  `;
  const [uploadIntentRow] = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('public.upload_intents') IS NOT NULL AS exists
  `;
  const [recoveryRedemptionRow] = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('public.recovery_code_redemptions') IS NOT NULL AS exists
  `;
  const policyNames = new Set(policyRows.map((row) => row.polname));

  return {
    hasLegacyCoreSchema: (tablesRow?.count ?? 0) >= 12 && viewRow?.exists === true,
    hasProfileSecurityState: profileSecurityStateRow?.exists === true,
    hasPrivacyAwareProfilePolicy: policyNames.has("Profiles are viewable by allowed users"),
    hasUploadIntentTables: uploadIntentRow?.exists === true && recoveryRedemptionRow?.exists === true,
    hasAuthorityBackfillPolicies:
      policyNames.has("Users can view own connections") && policyNames.has("project_files_write"),
  };
}

function inferBootstrapEntries(entries: JournalEntry[], signals: ExistingSchemaSignals) {
  return entries.filter((entry) => {
    if (entry.idx <= 61) {
      return signals.hasLegacyCoreSchema;
    }

    if (entry.tag === "0061_profile_security_state_privacy_rls") {
      return signals.hasProfileSecurityState && signals.hasPrivacyAwareProfilePolicy;
    }

    if (entry.tag === "0062_upload_intents_and_recovery_redemptions") {
      return signals.hasUploadIntentTables;
    }

    if (entry.tag === "0063_database_setup_authority_backfill") {
      return signals.hasAuthorityBackfillPolicies;
    }

    return false;
  });
}

async function bootstrapAppliedTags(entries: JournalEntry[]) {
  for (const entry of entries) {
    await sql`
      INSERT INTO public.app_migration_journal (tag)
      VALUES (${entry.tag})
      ON CONFLICT (tag) DO NOTHING
    `;
  }
}

async function applyMigration(entry: JournalEntry) {
  const filePath = resolveWorkspacePath("drizzle", `${entry.tag}.sql`);
  const source = await readFile(filePath, "utf8");
  const statements = splitMigrationStatements(source);

  console.log(`📦 Applying migration ${entry.tag} (${statements.length} statement${statements.length === 1 ? "" : "s"})`);
  for (const statement of statements) {
    await sql.unsafe(statement);
  }

  await sql`
    INSERT INTO public.app_migration_journal (tag)
    VALUES (${entry.tag})
    ON CONFLICT (tag) DO NOTHING
  `;
}

async function ensureLatestSchemaRepairs() {
  const preferences = DEFAULT_NOTIFICATION_PREFERENCES.replace(/'/g, "''");

  await sql.unsafe(`
    DO $$
    BEGIN
      IF to_regclass('public.profiles') IS NOT NULL THEN
        ALTER TABLE public."profiles"
          ADD COLUMN IF NOT EXISTS "notification_preferences" jsonb DEFAULT '${preferences}'::jsonb;

        UPDATE public."profiles"
        SET "notification_preferences" = COALESCE("notification_preferences", '${preferences}'::jsonb);

        UPDATE public."profiles"
        SET "notification_preferences" =
          jsonb_set(
            jsonb_set(
              "notification_preferences",
              '{pausedUntil}',
              COALESCE("notification_preferences"->'pausedUntil', 'null'::jsonb),
              true
            ),
            '{mutedScopes}',
            COALESCE("notification_preferences"->'mutedScopes', '[]'::jsonb),
            true
          )
        WHERE "notification_preferences" IS NOT NULL;
      END IF;

      IF to_regclass('public.user_notifications') IS NOT NULL THEN
        ALTER TABLE public."user_notifications"
          ADD COLUMN IF NOT EXISTS "dismissed_at" timestamp with time zone;

        DROP POLICY IF EXISTS "user_notifications_update_own" ON public."user_notifications";
      END IF;
    END $$;
  `);

  await sql.unsafe(`
    DO $$
    BEGIN
      IF to_regclass('public.user_notifications') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS "user_notifications_user_dismissed_idx"
          ON public."user_notifications" USING btree ("user_id", "dismissed_at");
      END IF;
    END $$;
  `);
}

async function setupDatabase() {
  console.log("🚀 Starting database setup via Drizzle migrations...\n");
  const journal = await readJournal();

  await ensureJournalTable();
  await acquireMigrationLock();
  try {
    let appliedTags = await readAppliedTags();
    const hasExistingSchema = await databaseHasExistingApplicationSchema();

    if (appliedTags.size === 0 && hasExistingSchema) {
      const schemaSignals = await readExistingSchemaSignals();
      if (!schemaSignals.hasLegacyCoreSchema) {
        throw new Error(
          "Database already contains application tables but does not match the migration baseline. " +
          "Refuse to infer migration state automatically. Repair the database or apply the missing migrations explicitly.",
        );
      }

      const inferredEntries = inferBootstrapEntries(journal.entries, schemaSignals);
      console.log(
        `🔁 Existing schema detected without migration journal; backfilling ${inferredEntries.length} inferred migration tag(s).`,
      );
      await bootstrapAppliedTags(inferredEntries);
      appliedTags = await readAppliedTags();
    }

    let appliedCount = 0;
    for (const entry of journal.entries.sort((a, b) => a.idx - b.idx)) {
      if (appliedTags.has(entry.tag)) {
        continue;
      }
      await applyMigration(entry);
      appliedCount += 1;
      appliedTags.add(entry.tag);
    }

    if (appliedCount === 0) {
      console.log("✅ Database already matches the migration journal.");
    } else {
      console.log(`✅ Applied ${appliedCount} migration${appliedCount === 1 ? "" : "s"} from the journal.`);
    }

    await ensureLatestSchemaRepairs();
    console.log("✅ Verified latest idempotent schema repairs.");
  } finally {
    await releaseMigrationLock().catch(() => undefined);
    await sql.end();
  }
}

setupDatabase().catch((error) => {
  console.error("❌ Database setup failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
