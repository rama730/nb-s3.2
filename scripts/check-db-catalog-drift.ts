import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";
import postgres from "postgres";

import {
  PROJECT_UPDATE_ALLOWED_IMAGE_MIME_TYPES,
  PROJECT_UPDATE_MEDIA_BUCKET,
  PROJECT_UPDATE_SCHEMA_CONTRACT,
} from "../src/lib/projects/updates";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

const DATABASE_URL = process.env.DATABASE_URL;

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

const REQUIRED_PROJECT_UPDATE_MEDIA_POLICIES = [
  "project_updates_media_insert",
  "project_updates_media_delete",
] as const;

const MIME_RESTRICTED_BUCKETS = ["project-files", "task-files"] as const;

const ALLOWED_SECURITY_DEFINER_FUNCTIONS = new Map([
  ["public.handle_message_insert_consistency", "search_path=\"\""],
  ["public.rls_auto_enable", "search_path=pg_catalog"],
]);

const ALLOWED_PUBLIC_RLS_NO_POLICY_TABLES = new Set([
  "app_migration_journal",
  "extension_device_session_events",
  "extension_device_sessions",
  "extension_recovery_sessions",
  "import_job_files",
  "import_jobs",
  "job_heartbeats",
  "project_git_deltas",
  "project_node_conflicts",
  "project_node_events_2026_01",
  "project_node_events_2026_02",
  "project_node_events_2026_03",
  "project_node_events_2026_04",
  "project_node_events_2026_05",
  "project_node_events_2026_06",
  "project_node_events_2026_07",
  "project_node_events_2026_08",
  "project_node_events_2026_09",
  "project_node_events_2026_10",
  "project_node_events_2026_11",
  "project_node_events_2026_12",
  "project_node_events_default",
  "reserved_usernames",
  "task_pushes",
]);

if (!DATABASE_URL) {
  console.error("[db-catalog-drift] DATABASE_URL not found in .env.local");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  prepare: false,
  ssl: "require",
  max: 1,
});

async function main() {
  const errors: string[] = [];
  const notes: string[] = [];

  const tableRows = await sql<{ table_name: string }[]>`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname = ANY(${PROJECT_UPDATE_SCHEMA_CONTRACT.tables})
  `;
  const tables = new Set(tableRows.map((row) => row.table_name));
  for (const table of PROJECT_UPDATE_SCHEMA_CONTRACT.tables) {
    if (!tables.has(table)) errors.push(`missing project update table public.${table}`);
  }

  const policyRows = await sql<{ tablename: string; count: number }[]>`
    SELECT tablename, COUNT(*)::int AS count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(${PROJECT_UPDATE_SCHEMA_CONTRACT.tables})
    GROUP BY tablename
  `;
  const policies = new Map(policyRows.map((row) => [row.tablename, row.count]));
  const minPolicyCounts = PROJECT_UPDATE_SCHEMA_CONTRACT.minPolicyCounts as Record<string, number>;
  for (const [table, minPolicyCount] of Object.entries(minPolicyCounts)) {
    const count = policies.get(table) ?? 0;
    if (count < minPolicyCount) {
      errors.push(`public.${table} has ${count} policy/policies, expected at least ${minPolicyCount}`);
    }
  }

  const realtimeRows = await sql<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = ANY(${REQUIRED_REALTIME_PUBLICATION_TABLES})
  `;
  const realtimeTables = new Set(realtimeRows.map((row) => row.tablename));
  for (const table of REQUIRED_REALTIME_PUBLICATION_TABLES) {
    if (!realtimeTables.has(table)) {
      errors.push(`public.${table} is not in supabase_realtime publication`);
    }
  }

  const [bucketRow] = await sql<{
    id: string;
    public: boolean;
    file_size_limit: number | null;
    allowed_mime_types: string[] | null;
  }[]>`
    SELECT id, public, file_size_limit, allowed_mime_types
    FROM storage.buckets
    WHERE id = ${PROJECT_UPDATE_MEDIA_BUCKET}
    LIMIT 1
  `;
  if (!bucketRow) {
    errors.push(`missing storage bucket ${PROJECT_UPDATE_MEDIA_BUCKET}`);
  } else {
    if (bucketRow.public !== true) errors.push(`${PROJECT_UPDATE_MEDIA_BUCKET} bucket must be public`);
    if (Number(bucketRow.file_size_limit ?? 0) < 8 * 1024 * 1024) {
      errors.push(`${PROJECT_UPDATE_MEDIA_BUCKET} bucket file_size_limit is below update media max size`);
    }
    const allowedMimeTypes = new Set(bucketRow.allowed_mime_types ?? []);
    for (const mimeType of Array.from(PROJECT_UPDATE_ALLOWED_IMAGE_MIME_TYPES)) {
      if (!allowedMimeTypes.has(mimeType)) {
        errors.push(`${PROJECT_UPDATE_MEDIA_BUCKET} bucket missing allowed MIME type ${mimeType}`);
      }
    }
  }

  const storagePolicyRows = await sql<{ policyname: string }[]>`
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = ANY(${REQUIRED_PROJECT_UPDATE_MEDIA_POLICIES})
  `;
  const storagePolicies = new Set(storagePolicyRows.map((row) => row.policyname));
  for (const policyName of REQUIRED_PROJECT_UPDATE_MEDIA_POLICIES) {
    if (!storagePolicies.has(policyName)) {
      errors.push(`missing storage.objects policy ${policyName}`);
    }
  }

  const restrictedBucketRows = await sql<{ id: string; allowed_mime_types: string[] | null }[]>`
    SELECT id, allowed_mime_types
    FROM storage.buckets
    WHERE id = ANY(${MIME_RESTRICTED_BUCKETS})
  `;
  const restrictedBuckets = new Map(restrictedBucketRows.map((row) => [row.id, row.allowed_mime_types]));
  for (const bucketId of MIME_RESTRICTED_BUCKETS) {
    const allowedMimeTypes = restrictedBuckets.get(bucketId);
    if (!allowedMimeTypes?.length) {
      errors.push(`${bucketId} bucket must have an explicit MIME allowlist`);
    }
  }

  const securityDefinerRows = await sql<{ function_name: string; config: string[] | null }[]>`
    SELECT
      n.nspname || '.' || p.proname AS function_name,
      p.proconfig AS config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef
      AND n.nspname = 'public'
    ORDER BY function_name
  `;
  const securityDefiners = new Map(
    securityDefinerRows.map((row) => [row.function_name, row.config ?? []]),
  );
  for (const functionName of securityDefiners.keys()) {
    if (!ALLOWED_SECURITY_DEFINER_FUNCTIONS.has(functionName)) {
      errors.push(`unexpected SECURITY DEFINER function ${functionName}`);
    }
  }
  for (const [functionName, expectedSearchPath] of ALLOWED_SECURITY_DEFINER_FUNCTIONS.entries()) {
    const config = securityDefiners.get(functionName);
    if (!config) {
      errors.push(`missing expected SECURITY DEFINER function ${functionName}`);
      continue;
    }
    if (!config.includes(expectedSearchPath)) {
      errors.push(`${functionName} must set ${expectedSearchPath}`);
    }
  }

  const noPolicyRows = await sql<{ table_name: string }[]>`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND NOT EXISTS (
        SELECT 1
        FROM pg_policy p
        WHERE p.polrelid = c.oid
      )
    ORDER BY c.relname
  `;
  for (const row of noPolicyRows) {
    if (!ALLOWED_PUBLIC_RLS_NO_POLICY_TABLES.has(row.table_name)) {
      errors.push(`public.${row.table_name} has RLS enabled with no policy but is not allowlisted`);
    }
  }

  const [typingTableRow] = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('public.typing_indicators') IS NOT NULL AS exists
  `;
  const typingFunctionRows = await sql<{ proname: string }[]>`
    SELECT p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('cleanup_old_typing_indicators', 'update_typing_timestamp')
  `;
  if (!typingTableRow?.exists && typingFunctionRows.length > 0) {
    errors.push(`orphan typing indicator function(s) remain: ${typingFunctionRows.map((row) => row.proname).join(", ")}`);
  }

  const partitionShadowRows = await sql<{ relname: string; row_count: number }[]>`
    SELECT c.relname, COALESCE(s.n_live_tup, 0)::int AS row_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = 'public'
      AND c.relname IN ('tasks_partitioned', 'messages_partitioned')
    ORDER BY c.relname
  `;
  for (const row of partitionShadowRows) {
    notes.push(`${row.relname} is retained as a legacy shadow partition table (${row.row_count} estimated row(s)); app code uses the canonical unpartitioned table.`);
  }

  if (errors.length > 0) {
    console.error("[db-catalog-drift] failed:");
    for (const error of errors) console.error(`- ${error}`);
    if (notes.length > 0) {
      console.error("[db-catalog-drift] notes:");
      for (const note of notes) console.error(`- ${note}`);
    }
    process.exit(1);
  }

  console.log("[db-catalog-drift] ok");
  for (const note of notes) console.log(`[db-catalog-drift] ${note}`);
}

main()
  .catch((error) => {
    console.error("[db-catalog-drift] failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  });
