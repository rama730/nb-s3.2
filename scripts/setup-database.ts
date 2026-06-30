/**
 * Database setup now delegates to the checked-in Drizzle migration journal.
 * Run with: npx tsx scripts/setup-database.ts
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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

type AppliedMigration = {
  tag: string;
  checksum: string | null;
  status: "applying" | "completed" | "failed";
};

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes("--dry-run") || process.env.MIGRATION_DRY_RUN === "1";
const JOURNAL_TABLE = "app_migration_journal";
const MIGRATION_LOCK_KEY = "nb-s3:migration-setup";
const NON_TRANSACTIONAL_MIGRATIONS = new Set([
  "0006_messages_performance_indexes",
  "0039_files_workspace_scale_indexes",
  "0087_non_transactional_indexes",
  "0092_project_updates_performance_indexes",
  "0099_schema_lineage_and_fk_indexes",
]);
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
] as const;

if (!DATABASE_URL && !DRY_RUN) {
  console.error("❌ DATABASE_URL not found in .env.local");
  process.exit(1);
}

const sql = postgres(DATABASE_URL || "postgres://dry-run.invalid/unused", {
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

function sqlLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlTextArray(values: readonly string[]) {
  return `ARRAY[${values.map(sqlLiteral).join(", ")}]`;
}

async function readJournal(): Promise<JournalFile> {
  const source = await readFile(resolveWorkspacePath("drizzle", "meta", "_journal.json"), "utf8");
  return JSON.parse(source) as JournalFile;
}

async function ensureJournalTable() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS public.${JOURNAL_TABLE} (
      tag text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      checksum text,
      status text NOT NULL DEFAULT 'completed',
      started_at timestamptz,
      completed_at timestamptz,
      error_message text
    );

    ALTER TABLE public.${JOURNAL_TABLE}
      ADD COLUMN IF NOT EXISTS checksum text,
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
      ADD COLUMN IF NOT EXISTS started_at timestamptz,
      ADD COLUMN IF NOT EXISTS completed_at timestamptz,
      ADD COLUMN IF NOT EXISTS error_message text;

    UPDATE public.${JOURNAL_TABLE}
    SET status = 'completed',
        completed_at = COALESCE(completed_at, applied_at)
    WHERE status IS NULL OR status NOT IN ('applying', 'completed', 'failed');

    DO $journal_constraint$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.${JOURNAL_TABLE}'::regclass
          AND conname = 'app_migration_journal_status_check'
      ) THEN
        ALTER TABLE public.${JOURNAL_TABLE}
          ADD CONSTRAINT app_migration_journal_status_check
          CHECK (status IN ('applying', 'completed', 'failed'));
      END IF;
    END
    $journal_constraint$;
  `);
}

async function ensureAuthUidHelper() {
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION public.get_auth_uid()
    RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path = ''
    AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
  `);
}

async function acquireMigrationLock() {
  await sql`SELECT pg_advisory_lock(hashtext(${MIGRATION_LOCK_KEY}))`;
}

async function releaseMigrationLock() {
  await sql`SELECT pg_advisory_unlock(hashtext(${MIGRATION_LOCK_KEY}))`;
}

async function readAppliedMigrations() {
  const rows = await sql<AppliedMigration[]>`
    SELECT tag, checksum, status
    FROM public.app_migration_journal
    ORDER BY applied_at ASC, tag ASC
  `;
  return new Map(rows.map((row) => [row.tag, row]));
}

function splitMigrationStatements(source: string) {
  return source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function readMigration(tag: string) {
  const filePath = resolveWorkspacePath("drizzle", `${tag}.sql`);
  const source = await readFile(filePath, "utf8");
  return {
    checksum: createHash("sha256").update(source).digest("hex"),
    statements: splitMigrationStatements(source),
  };
}

async function readMigrationStatements(tag: string) {
  return (await readMigration(tag)).statements;
}

async function validateMigrationSources(entries: JournalEntry[]) {
  const seenIndexes = new Set<number>();
  const seenTags = new Set<string>();

  for (const entry of [...entries].sort((a, b) => a.idx - b.idx)) {
    if (seenIndexes.has(entry.idx)) throw new Error(`Duplicate migration index: ${entry.idx}`);
    if (seenTags.has(entry.tag)) throw new Error(`Duplicate migration tag: ${entry.tag}`);
    seenIndexes.add(entry.idx);
    seenTags.add(entry.tag);

    const { statements } = await readMigration(entry.tag);
    if (statements.length === 0) throw new Error(`Migration ${entry.tag} has no executable statements.`);
    const containsConcurrentOperation = statements.some((statement) => /\bCONCURRENTLY\b/i.test(statement));
    if (containsConcurrentOperation && !NON_TRANSACTIONAL_MIGRATIONS.has(entry.tag)) {
      throw new Error(
        `Migration ${entry.tag} contains a concurrent operation but is not allowlisted as non-transactional.`,
      );
    }
  }
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
    const { checksum } = await readMigration(entry.tag);
    await sql`
      INSERT INTO public.app_migration_journal (
        tag,
        checksum,
        status,
        started_at,
        completed_at
      )
      VALUES (${entry.tag}, ${checksum}, 'completed', now(), now())
      ON CONFLICT (tag) DO NOTHING
    `;
  }
}

async function applyMigration(entry: JournalEntry) {
  const { checksum, statements } = await readMigration(entry.tag);
  const isNonTransactional = NON_TRANSACTIONAL_MIGRATIONS.has(entry.tag);

  const containsConcurrentOperation = statements.some((statement) => /\bCONCURRENTLY\b/i.test(statement));
  if (containsConcurrentOperation && !isNonTransactional) {
    throw new Error(
      `Migration ${entry.tag} contains a concurrent operation but is not allowlisted as non-transactional.`,
    );
  }

  console.log(
    `📦 Applying migration ${entry.tag} (${statements.length} statement${statements.length === 1 ? "" : "s"}, ${isNonTransactional ? "non-transactional" : "transactional"})`,
  );

  await sql`
    INSERT INTO public.app_migration_journal (
      tag,
      checksum,
      status,
      started_at,
      completed_at,
      error_message
    )
    VALUES (${entry.tag}, ${checksum}, 'applying', now(), null, null)
    ON CONFLICT (tag) DO UPDATE
    SET checksum = EXCLUDED.checksum,
        status = 'applying',
        started_at = now(),
        completed_at = null,
        error_message = null
  `;

  try {
    if (isNonTransactional) {
      for (const statement of statements) {
        await sql.unsafe(statement);
      }
      await sql`
        UPDATE public.app_migration_journal
        SET status = 'completed',
            applied_at = now(),
            completed_at = now(),
            error_message = null
        WHERE tag = ${entry.tag}
      `;
      return;
    }

    await sql.begin(async (transaction) => {
      for (const statement of statements) {
        await transaction.unsafe(statement);
      }
      await transaction.unsafe(
        `UPDATE public.app_migration_journal
         SET status = 'completed',
             applied_at = now(),
             completed_at = now(),
             error_message = null
         WHERE tag = $1`,
        [entry.tag],
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      UPDATE public.app_migration_journal
      SET status = 'failed',
          completed_at = now(),
          error_message = ${message.slice(0, 2000)}
      WHERE tag = ${entry.tag}
    `;
    throw error;
  }
}

async function validateAndBackfillChecksums(
  entries: JournalEntry[],
  appliedMigrations: Map<string, AppliedMigration>,
) {
  for (const entry of entries) {
    const applied = appliedMigrations.get(entry.tag);
    if (!applied || applied.status !== "completed") continue;

    const { checksum } = await readMigration(entry.tag);
    if (applied.checksum && applied.checksum !== checksum) {
      throw new Error(
        `Checksum mismatch for applied migration ${entry.tag}. Applied migrations are immutable; create a new migration instead.`,
      );
    }

    if (!applied.checksum) {
      await sql`
        UPDATE public.app_migration_journal
        SET checksum = ${checksum},
            completed_at = COALESCE(completed_at, applied_at),
            status = 'completed'
        WHERE tag = ${entry.tag}
      `;
      appliedMigrations.set(entry.tag, { ...applied, checksum });
    }
  }
}

const PROJECT_UPDATES_REPAIR_BEGIN = "-- project_updates_schema_repair_begin";
const PROJECT_UPDATES_REPAIR_END = "-- project_updates_schema_repair_end";

async function readProjectUpdatesRepairStatements() {
  const filePath = resolveWorkspacePath("drizzle", "0063_database_setup_authority_backfill.sql");
  const source = await readFile(filePath, "utf8");
  const begin = source.indexOf(PROJECT_UPDATES_REPAIR_BEGIN);
  const end = source.indexOf(PROJECT_UPDATES_REPAIR_END);
  if (begin < 0 || end < 0 || end <= begin) {
    throw new Error("Project updates repair block is missing from drizzle/0063_database_setup_authority_backfill.sql");
  }
  return splitMigrationStatements(source.slice(begin + PROJECT_UPDATES_REPAIR_BEGIN.length, end));
}

async function ensureProjectUpdatesSchema() {
  const [dependencies] = await sql<{ ready: boolean }[]>`
    SELECT
      to_regclass('public.projects') IS NOT NULL
      AND to_regclass('public.profiles') IS NOT NULL AS ready
  `;

  if (dependencies?.ready !== true) {
    return;
  }

  const statements = await readProjectUpdatesRepairStatements();
  for (const statement of statements) {
    await sql.unsafe(statement);
  }
}

async function ensureProjectUpdateDraftsRls() {
  const [dependencies] = await sql<{ ready: boolean }[]>`
    SELECT
      to_regclass('public.project_update_drafts') IS NOT NULL
      AND to_regclass('public.projects') IS NOT NULL
      AND to_regclass('public.project_members') IS NOT NULL AS ready
  `;

  if (dependencies?.ready !== true) {
    return;
  }

  const statements = await readMigrationStatements("0083_project_update_drafts_rls");
  for (const statement of statements) {
    await sql.unsafe(statement);
  }
}

async function ensureRealtimePublicationCoverage() {
  await sql.unsafe(`
    DO $repair$
    DECLARE
      realtime_table text;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        RETURN;
      END IF;

      FOREACH realtime_table IN ARRAY ${sqlTextArray(REQUIRED_REALTIME_PUBLICATION_TABLES)} LOOP
        IF to_regclass(format('public.%I', realtime_table)) IS NULL THEN
          CONTINUE;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_publication_tables
          WHERE pubname = 'supabase_realtime'
            AND schemaname = 'public'
            AND tablename = realtime_table
        ) THEN
          EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', realtime_table);
        END IF;
      END LOOP;
    END
    $repair$;
  `);
}

async function ensureProjectUpdateMediaStorage() {
  const [dependencies] = await sql<{ ready: boolean }[]>`
    SELECT
      to_regclass('storage.buckets') IS NOT NULL
      AND to_regclass('public.projects') IS NOT NULL
      AND to_regclass('public.project_members') IS NOT NULL AS ready
  `;

  if (dependencies?.ready !== true) {
    return;
  }

  const statements = await readMigrationStatements("0085_project_update_media_storage");
  for (const statement of statements) {
    await sql.unsafe(statement);
  }
}

async function cleanupOrphanTypingIndicatorFunctions() {
  await sql.unsafe(`
    DO $repair$
    BEGIN
      IF to_regclass('public.typing_indicators') IS NULL THEN
        DROP FUNCTION IF EXISTS public.cleanup_old_typing_indicators();
        DROP FUNCTION IF EXISTS public.update_typing_timestamp();
      END IF;
    END
    $repair$;
  `);
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

      IF to_regclass('public.projects') IS NOT NULL THEN
        ALTER TABLE public."projects"
          ADD COLUMN IF NOT EXISTS "stage_completion_dates" jsonb DEFAULT '{}'::jsonb;
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

  await ensureProjectUpdatesSchema();
  await ensureProjectUpdateDraftsRls();
  await ensureRealtimePublicationCoverage();
  await ensureProjectUpdateMediaStorage();
  await cleanupOrphanTypingIndicatorFunctions();
}

async function setupDatabase() {
  console.log("🚀 Starting database setup via Drizzle migrations...\n");
  const journal = await readJournal();
  await validateMigrationSources(journal.entries);

  if (DRY_RUN) {
    console.log(`✅ Validated ${journal.entries.length} migration sources without connecting to the database.`);
    await sql.end();
    return;
  }

  await ensureJournalTable();
  await acquireMigrationLock();
  try {
    await ensureAuthUidHelper();
    let appliedMigrations = await readAppliedMigrations();
    const hasExistingSchema = await databaseHasExistingApplicationSchema();

    if (appliedMigrations.size === 0 && hasExistingSchema) {
      if (process.env.ALLOW_MIGRATION_JOURNAL_BOOTSTRAP !== "1") {
        throw new Error(
          "Database contains application tables without migration lineage. " +
          "Refusing to infer applied migrations; set ALLOW_MIGRATION_JOURNAL_BOOTSTRAP=1 only for an approved one-time legacy adoption.",
        );
      }
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
      appliedMigrations = await readAppliedMigrations();
    }

    await validateAndBackfillChecksums(journal.entries, appliedMigrations);

    let appliedCount = 0;
    for (const entry of journal.entries.sort((a, b) => a.idx - b.idx)) {
      const applied = appliedMigrations.get(entry.tag);
      if (applied?.status === "completed") {
        continue;
      }
      await applyMigration(entry);
      appliedCount += 1;
      appliedMigrations.set(entry.tag, {
        tag: entry.tag,
        checksum: (await readMigration(entry.tag)).checksum,
        status: "completed",
      });
    }

    if (appliedCount === 0) {
      console.log("✅ Database already matches the migration journal.");
    } else {
      console.log(`✅ Applied ${appliedCount} migration${appliedCount === 1 ? "" : "s"} from the journal.`);
    }

    if (process.env.ALLOW_LEGACY_SCHEMA_REPAIRS === "1") {
      await ensureLatestSchemaRepairs();
      console.log("✅ Applied explicitly enabled legacy schema repairs.");
    }
  } finally {
    await releaseMigrationLock().catch(() => undefined);
    await sql.end();
  }
}

setupDatabase().catch((error) => {
  console.error("❌ Database setup failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
