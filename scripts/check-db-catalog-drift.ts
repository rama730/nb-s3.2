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

const REQUIRED_TASK_COLUMNS = [
  "timeline_origin_sprint_id",
  "timeline_origin_at",
] as const;

const REQUIRED_PROJECT_UPDATE_MEDIA_POLICIES = [
  "project_updates_media_insert",
  "project_updates_media_delete",
] as const;

const MIME_RESTRICTED_BUCKETS = ["project-files", "task-files"] as const;
const PROJECT_FILE_ALLOWED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/octet-stream",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/zip",
  "application/x-zip-compressed",
] as const;

const MESSAGING_AUTHORITY_TABLES = [
  "conversations",
  "conversation_participants",
  "dm_pairs",
  "messages",
  "message_attachments",
  "message_hidden_for_users",
  "message_edit_logs",
  "attachment_uploads",
  "message_reactions",
  "message_reports",
  "message_read_receipts",
  "message_delivery_receipts",
  "message_workflow_items",
  "message_work_links",
  "message_pins",
  "role_applications",
  "application_events",
] as const;

const REQUIRED_MESSAGING_CONSTRAINTS = [
  "dm_pairs_user_low_high_unique",
  "dm_pairs_ordered_users_check",
  "conversation_participants_unread_non_negative_check",
  "conversation_participants_last_read_message_conversation_fkey",
  "conversation_participants_last_message_conversation_fkey",
  "conversation_participants_last_message_sender_fkey",
  "messages_reply_to_message_conversation_fkey",
  "messages_type_check",
  "messages_client_message_id_check",
  "messages_metadata_object_check",
  "messages_content_length_check",
  "messages_system_idempotency_check",
  "messages_active_payload_check",
  "message_workflow_items_message_conversation_fkey",
  "message_work_links_source_message_conversation_fkey",
  "message_attachments_storage_reference_check",
] as const;

const REQUIRED_MESSAGING_INDEXES = [
  "conversation_participants_active_inbox_idx",
  "messages_conversation_created_id_idx",
  "messages_content_search_idx",
  "message_workflow_items_pending_project_invite_unique",
  "message_work_links_source_target_unique",
  "message_pins_conversation_pinned_idx",
  "conversation_participants_last_message_sender_idx",
] as const;

const REQUIRED_LIFECYCLE_INDEXES = [
  "profile_audit_events_retention_idx",
  "onboarding_events_retention_idx",
  "extension_device_session_events_retention_idx",
] as const;

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
  // ponytail: lifecycle records are server-only; RLS without client policies
  // is intentional so task/Sprint history is accessed through authorized actions.
  "project_sprint_events",
  "task_activity_events",
  "task_pushes",
  "task_read_receipts",
  "sprint_task_memberships",
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

  const taskColumnRows = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = ANY(${REQUIRED_TASK_COLUMNS})
  `;
  const taskColumns = new Set(taskColumnRows.map((row) => row.column_name));
  for (const column of REQUIRED_TASK_COLUMNS) {
    if (!taskColumns.has(column)) {
      errors.push(`missing tasks.${column}; apply the Sprint history migration`);
    }
  }

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
    if (Number(bucketRow.file_size_limit ?? 0) !== 8 * 1024 * 1024) {
      errors.push(`${PROJECT_UPDATE_MEDIA_BUCKET} bucket file_size_limit differs from the 8 MiB application contract`);
    }
    const allowedMimeTypes = [...(bucketRow.allowed_mime_types ?? [])].sort();
    const expectedMimeTypes = Array.from(PROJECT_UPDATE_ALLOWED_IMAGE_MIME_TYPES).sort();
    if (JSON.stringify(allowedMimeTypes) !== JSON.stringify(expectedMimeTypes)) {
      errors.push(`${PROJECT_UPDATE_MEDIA_BUCKET} bucket MIME allowlist differs from the canonical contract`);
    }
  }

  const realtimePolicyRows = await sql<{ policyname: string }[]>`
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname IN ('application_topic_read', 'application_topic_send')
  `;
  const realtimePolicies = new Set(realtimePolicyRows.map((row) => row.policyname));
  for (const policyName of ['application_topic_read', 'application_topic_send']) {
    if (!realtimePolicies.has(policyName)) {
      errors.push(`missing realtime.messages authorization policy ${policyName}`);
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
    const allowedMimeTypes = [...(restrictedBuckets.get(bucketId) ?? [])].sort();
    const expectedMimeTypes = [...PROJECT_FILE_ALLOWED_MIME_TYPES].sort();
    if (JSON.stringify(allowedMimeTypes) !== JSON.stringify(expectedMimeTypes)) {
      errors.push(`${bucketId} bucket MIME allowlist differs from the canonical contract`);
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

  const [nativeHardeningRow] = await sql<{
    profile_auth_fk: boolean;
    archive_rls: boolean;
    duplicate_dm_index: boolean;
    workflow_search_path: boolean;
    anon_can_execute_workflow_seed: boolean;
    authenticated_can_execute_workflow_seed: boolean;
  }[]>`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.profiles'::regclass
          AND conname = 'profiles_id_auth_users_fk'
      ) AS profile_auth_fk,
      COALESCE((
        SELECT c.relrowsecurity
        FROM pg_class c
        WHERE c.oid = to_regclass('app_private.retired_domain_archive')
      ), false) AS archive_rls,
      to_regclass('public.dm_pairs_user_low_user_high_key') IS NOT NULL AS duplicate_dm_index,
      COALESCE((
        SELECT p.proconfig @> ARRAY['search_path=""']::text[]
        FROM pg_proc p
        WHERE p.oid = to_regprocedure('public.seed_project_workflow_columns()')
      ), false) AS workflow_search_path,
      has_function_privilege('anon', 'public.seed_project_workflow_columns()', 'EXECUTE') AS anon_can_execute_workflow_seed,
      has_function_privilege('authenticated', 'public.seed_project_workflow_columns()', 'EXECUTE') AS authenticated_can_execute_workflow_seed
  `;
  if (!nativeHardeningRow?.profile_auth_fk) errors.push("profiles is missing the auth.users identity FK invariant");
  if (!nativeHardeningRow?.archive_rls) errors.push("app_private.retired_domain_archive must have fail-closed RLS");
  if (nativeHardeningRow?.duplicate_dm_index) errors.push("redundant dm_pairs_user_low_user_high_key still exists");
  if (!nativeHardeningRow?.workflow_search_path) errors.push("seed_project_workflow_columns must set an empty search_path");
  if (nativeHardeningRow?.anon_can_execute_workflow_seed || nativeHardeningRow?.authenticated_can_execute_workflow_seed) {
    errors.push("client roles must not execute seed_project_workflow_columns directly");
  }

  const mergedContributionPolicies = await sql<{ tablename: string; count: number }[]>`
    SELECT tablename, count(*)::int AS count
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profile_project_contributions', 'profile_project_contribution_stages')
      AND cmd = 'SELECT'
    GROUP BY tablename
  `;
  for (const tableName of ["profile_project_contributions", "profile_project_contribution_stages"] as const) {
    const count = mergedContributionPolicies.find((row) => row.tablename === tableName)?.count ?? 0;
    if (count !== 1) errors.push(`public.${tableName} must have one consolidated SELECT policy; found ${count}`);
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

  const messagingConstraintRows = await sql<{ constraint_name: string; validated: boolean }[]>`
    SELECT con.conname AS constraint_name, con.convalidated AS validated
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public'
      AND con.conname = ANY(${REQUIRED_MESSAGING_CONSTRAINTS})
  `;
  const messagingConstraints = new Map(
    messagingConstraintRows.map((row) => [row.constraint_name, row.validated]),
  );
  for (const constraintName of REQUIRED_MESSAGING_CONSTRAINTS) {
    if (!messagingConstraints.has(constraintName)) {
      errors.push(`missing messaging constraint ${constraintName}`);
    } else if (!messagingConstraints.get(constraintName)) {
      errors.push(`messaging constraint ${constraintName} is not validated`);
    }
  }

  const messagingIndexRows = await sql<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY(${REQUIRED_MESSAGING_INDEXES})
  `;
  const messagingIndexes = new Map(
    messagingIndexRows.map((row) => [row.indexname, row.indexdef]),
  );
  for (const indexName of REQUIRED_MESSAGING_INDEXES) {
    if (!messagingIndexes.has(indexName)) {
      errors.push(`missing messaging index ${indexName}`);
    }
  }
  const searchIndexDefinition = messagingIndexes.get("messages_content_search_idx") ?? "";
  if (!/USING gin \(search_document\)/i.test(searchIndexDefinition)) {
    errors.push("messages_content_search_idx must index generated search_document with GIN");
  }

  const lifecycleIndexRows = await sql<{ indexname: string }[]>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY(${REQUIRED_LIFECYCLE_INDEXES})
  `;
  const lifecycleIndexes = new Set(lifecycleIndexRows.map((row) => row.indexname));
  for (const indexName of REQUIRED_LIFECYCLE_INDEXES) {
    if (!lifecycleIndexes.has(indexName)) {
      errors.push(`missing lifecycle retention index ${indexName}`);
    }
  }
  const inboxIndexDefinition = messagingIndexes.get("conversation_participants_active_inbox_idx") ?? "";
  if (
    !/user_id, last_message_at DESC, conversation_id DESC/i.test(inboxIndexDefinition)
    || !/archived_at IS NULL/i.test(inboxIndexDefinition)
  ) {
    errors.push("conversation_participants_active_inbox_idx does not match the active inbox order/predicate");
  }

  const [searchDocumentRow] = await sql<{ generated: string; expression: string | null }[]>`
    SELECT
      a.attgenerated AS generated,
      pg_get_expr(d.adbin, d.adrelid) AS expression
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relname = 'messages'
      AND a.attname = 'search_document'
      AND NOT a.attisdropped
    LIMIT 1
  `;
  if (!searchDocumentRow || searchDocumentRow.generated !== "s") {
    errors.push("public.messages.search_document must be a stored generated column");
  } else if (!searchDocumentRow.expression?.includes("to_tsvector('simple'::regconfig")) {
    errors.push("public.messages.search_document must use the simple text-search configuration");
  }

  const messagingPolicyRows = await sql<{
    tablename: string;
    cmd: string;
    roles: string[];
  }[]>`
    SELECT tablename, cmd, roles
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(${MESSAGING_AUTHORITY_TABLES})
  `;
  for (const tableName of MESSAGING_AUTHORITY_TABLES) {
    const tablePolicies = messagingPolicyRows.filter((row) => row.tablename === tableName);
    if (tablePolicies.length === 0) {
      errors.push(`public.${tableName} has no authenticated SELECT policy`);
      continue;
    }
    for (const policy of tablePolicies) {
      if (policy.cmd !== "SELECT" || !policy.roles.includes("authenticated")) {
        errors.push(`public.${tableName} policy must be SELECT-only TO authenticated`);
      }
    }
  }

  const messagingGrantRows = await sql<{
    table_name: string;
    grantee: string;
    privilege_type: string;
  }[]>`
    SELECT table_name, grantee, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = ANY(${MESSAGING_AUTHORITY_TABLES})
      AND grantee IN ('anon', 'authenticated')
  `;
  for (const grant of messagingGrantRows) {
    if (grant.grantee === "anon" || grant.privilege_type !== "SELECT") {
      errors.push(`unexpected ${grant.privilege_type} grant on public.${grant.table_name} to ${grant.grantee}`);
    }
  }
  for (const tableName of MESSAGING_AUTHORITY_TABLES) {
    const hasAuthenticatedSelect = messagingGrantRows.some(
      (grant) =>
        grant.table_name === tableName
        && grant.grantee === "authenticated"
        && grant.privilege_type === "SELECT",
    );
    if (!hasAuthenticatedSelect) {
      errors.push(`public.${tableName} is missing authenticated SELECT grant`);
    }
  }

  const [messageTriggerRow] = await sql<{ definition: string }[]>`
    SELECT pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'handle_message_insert_consistency'
    LIMIT 1
  `;
  const triggerDefinition = messageTriggerRow?.definition.toLowerCase() ?? "";
  if (
    !triggerDefinition.includes("(new.created_at, new.id)")
    || !triggerDefinition.includes("coalesce(last_message_id")
  ) {
    errors.push("handle_message_insert_consistency must maintain inbox projections with a monotonic timestamp/id tuple");
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
