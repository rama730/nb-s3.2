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
  "project_updates_media_public_read",
  "project_updates_media_write",
  "project_updates_media_delete",
] as const;

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
