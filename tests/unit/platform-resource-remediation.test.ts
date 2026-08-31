import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isPrivateRealtimeAuthorizationEnabled } from "../../src/lib/realtime/authorization";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Storage and private Realtime share the application key/topic contracts", () => {
  const migration = read("drizzle/0157_storage_realtime_contract_alignment.sql");
  assert.match(migration, /file_size_limit = 8388608/);
  assert.match(migration, /ELSE split_part\(objects\.name, '\/', 1\)/);
  assert.match(migration, /CREATE POLICY application_topic_read ON realtime\.messages/);
  assert.match(migration, /CREATE POLICY application_topic_send ON realtime\.messages/);
  assert.match(migration, /app_private\.nb_can_observe_user_presence/);
  assert.match(migration, /target\.conversation_id = viewer\.conversation_id/);
  assert.match(migration, /app_private\.nb_is_conversation_participant/);
  assert.match(migration, /app_private\.nb_project_can_read/);
});

test("private Realtime is fail-closed until database authorization is promoted", () => {
  const authorization = read("src/lib/realtime/authorization.ts");
  const presence = read("src/lib/realtime/presence-client.ts");
  const subscriptions = read("src/lib/realtime/subscriptions.ts");
  const activation = read("drizzle/0160_realtime_authorization_activation.sql");
  const exampleEnv = read(".env.local.example");

  assert.match(authorization, /NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED/);
  assert.match(presence, /if \(!isPrivateRealtimeAuthorizationEnabled\(\)\)/);
  assert.match(presence, /await supabase\.realtime\.setAuth\(accessToken\)/);
  assert.match(subscriptions, /if \(!isPrivateRealtimeAuthorizationEnabled\(\)\) return null/);
  assert.match(activation, /CREATE POLICY application_topic_read ON realtime\.messages/);
  assert.match(activation, /realtime\.messages\.extension IN \('presence', 'broadcast'\)/);
  assert.match(activation, /realtime\.messages\.extension = 'broadcast'/);
  assert.doesNotMatch(presence, /ensureGlobalAuthListener|onAuthStateChange|connectEntry started/);
  assert.match(exampleEnv, /NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED=0/);
});

test("private Realtime rollout parser enables only explicit true values", () => {
  const previous = process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED;
  try {
    delete process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED;
    assert.equal(isPrivateRealtimeAuthorizationEnabled(), false);
    process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED = "0";
    assert.equal(isPrivateRealtimeAuthorizationEnabled(), false);
    process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED = "true";
    assert.equal(isPrivateRealtimeAuthorizationEnabled(), true);
    process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED = " ON ";
    assert.equal(isPrivateRealtimeAuthorizationEnabled(), true);
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED = previous;
    }
  }
});

test("resource retention and partition maintenance are bounded and observable", () => {
  const retention = read("src/inngest/functions/data-lifecycle-retention.ts");
  const retentionIndexes = read("drizzle/0158_lifecycle_retention_indexes.sql");
  const partitions = read("src/inngest/functions/database-partition-maintenance.ts");
  const registry = read("src/inngest/registry.ts");

  assert.match(retention, /profileReadAuditDays: 30/);
  assert.match(retention, /profileActivityAuditDays: 365/);
  assert.match(retention, /FOR UPDATE SKIP LOCKED/g);
  assert.match(retention, /batchSize: 500/);
  assert.match(retentionIndexes, /profile_audit_events \(created_at, id\)/);
  assert.match(retentionIndexes, /onboarding_events \(created_at, id\)/);
  assert.match(retentionIndexes, /extension_device_session_events \(created_at, id\)/);
  assert.match(registry, /dataLifecycleRetention/);
  assert.match(partitions, /project_node_events_default/);
  assert.match(partitions, /defaultRowCount/);
});

test("account cleanup covers every owned project Storage prefix", () => {
  const cleanup = read("src/inngest/functions/account-cleanup.ts");
  for (const contract of [
    '["project-files", project.id]',
    '["project-files", `projects/${project.id}`]',
    '["project-files", `${userId}/project-images/${project.id}`]',
    '["project-files", `${userId}/project-covers/${project.id}`]',
    '["task-files", project.id]',
    '["project-updates-media", `projects/${project.id}`]',
  ]) {
    assert.ok(cleanup.includes(contract), contract);
  }
  assert.match(cleanup, /createAdminClient/);
  assert.match(cleanup, /deleteStoragePrefix\(supabase, "avatars", userId\)/);
  assert.match(cleanup, /deleteStoragePrefix\(supabase, "chat-attachments", userId\)/);
  assert.match(cleanup, /throw new Error\(`\$\{bucket\}\/\$\{prefix\} cleanup failed/);
});

test("project-file reconciliation attaches verified path-correlated objects idempotently", () => {
  const reconciliation = read("src/inngest/functions/project-files-reconciliation.ts");
  assert.match(reconciliation, /buildProjectFileKey/);
  assert.match(reconciliation, /metadataMatches/);
  assert.match(reconciliation, /isNull\(projectNodes\.s3Key\)/);
  assert.match(reconciliation, /storage_reconcile_attached_object/);
  assert.match(reconciliation, /storage_reconcile_ambiguous_path/);
  assert.match(reconciliation, /orphanStorageRows\.filter\(\(row\) => !candidateByName\.has\(row\.name\)\)/);
  assert.match(reconciliation, /reconciliationKey/);
  assert.match(reconciliation, /FOR UPDATE|onConflictDoUpdate|seenKeys/);
});

test("compatibility and typing behavior have one exact owner", () => {
  const projects = read("src/app/actions/project/_all.ts");
  const typing = read("src/lib/chat/typing-state.ts");
  const avatars = read("src/lib/services/avatar-service.ts");

  const catchStart = projects.indexOf('} catch (error) {', projects.indexOf("toggleProjectFollowAction"));
  const fallbackStart = projects.indexOf("if (shouldFollow)", catchStart);
  assert.ok(projects.indexOf('return { success: false, error: "Failed to update follow status" };', catchStart) < fallbackStart);
  assert.match(typing, /toPresenceTypingUser/);
  assert.doesNotMatch(typing, /function toTypingUser/);
  assert.doesNotMatch(avatars, /uploadAvatarWithPreview|fileToDataUrl|export async function uploadAvatar\(/);
});

test("presence subscriptions stay in authorized messaging owners", () => {
  const avatar = read("src/components/ui/UserAvatar.tsx");
  const presenceClient = read("src/lib/realtime/presence-client.ts");

  assert.doesNotMatch(avatar, /useOnlineUsers/);
  assert.match(presenceClient, /entry\.roomType !== "user" \|\| entry\.roomId === userId/);
});

test("capacity evidence includes owner/project Storage soft budgets", () => {
  const checker = read("scripts/check-capacity-audit.ts");
  assert.match(checker, /largestOwnerBytes/);
  assert.match(checker, /largestProjectBytes/);
  assert.match(checker, /perOwnerSoftBudgetBytes/);
  assert.match(checker, /perProjectSoftBudgetBytes/);
  assert.match(checker, /largest_owner_storage_bytes/);
  assert.match(checker, /largest_project_storage_bytes/);
});

test("migration generation is replay-gated and production verifies the runtime database role", () => {
  const packageJson = read("package.json");
  const generationGate = read("scripts/generate-db-migration.ts");
  const releaseGate = read("scripts/run-stability-release-gate.ts");

  assert.match(packageJson, /"db:generate": "tsx scripts\/generate-db-migration\.ts"/);
  assert.match(generationGate, /DATABASE_URL_FRESH/);
  assert.match(generationGate, /check:db:remigration-replay/);
  assert.match(generationGate, /disposable replay\/catalog parity failed/);
  assert.match(releaseGate, /label: 'check:db:runtime-role'/);
});
