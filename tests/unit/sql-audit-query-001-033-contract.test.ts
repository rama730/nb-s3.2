import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("QRY-001..006 hub pagination keeps filters, rejects cursors, and has no dead project owner", () => {
  const action = source("src/app/actions/hub.ts");
  const hub = source("src/lib/data/hub.ts");

  assert.match(action, /includedIds:\s*filters\.includedIds/);
  assert.match(hub, /throw new InvalidHubCursorError\(\)/);
  assert.match(hub, /\.limit\(pageSize \+ 1\)/);
  assert.match(hub, /while \(pageRows\.length < pageSize/);
  assert.equal(fs.existsSync(path.join(root, "src/lib/data/project.ts")), false);
});

test("QRY-007..012 authorize before sensitive reads and keep file reads side-effect free", () => {
  const matchmaking = source("src/app/actions/matchmaking/resolver.ts");
  const content = source("src/app/actions/files/content.ts");
  const search = source("src/app/actions/files/search.ts");

  assert.ok(matchmaking.indexOf("const access = await getProjectAccessById") < matchmaking.indexOf("db.query.profiles.findFirst"));
  assert.match(matchmaking, /!access\.isOwner && access\.memberRole !== 'admin'/);
  assert.match(content, /class FileContentUnavailableError/);
  assert.doesNotMatch(content.slice(content.indexOf("getProjectFileSignedUrl"), content.indexOf("getProjectFileSignedUrlBatch")), /\.upload\(|\.update\(projectNodes\)/);
  assert.match(search, /searchProjectFileIndexAuthorized/);
  assert.match(search, /innerJoin\([\s\S]*projectNodes/);
  assert.match(search, /isNull\(projectNodes\.deletedAt\)/);
});

test("QRY-013..023 retire unsafe batch replacement and full-tree/task-slug scans", () => {
  const search = source("src/app/actions/files/search.ts");
  const nodes = source("src/app/actions/files/nodes.ts");
  const urlSync = source("src/components/projects/v2/files-tab/hooks/useFilesTabUrlSync.ts");

  assert.doesNotMatch(search, /previewProjectSearchReplace|applyProjectSearchReplace|rollbackProjectSearchReplace/);
  assert.doesNotMatch(nodes, /getProjectTreeFlat|TASK_WORKING_FILE_URL_PREFIX/);
  assert.match(nodes, /eq\(projectNodes\.path, `\/\$\{path\.join\("\/"\)\}`\)/);
  assert.match(nodes, /inArray\(projectNodes\.path, Array\.from\(ancestorPaths\)\)/);
  assert.doesNotMatch(nodes, /for \(let depth = 0; depth < 32/);
  assert.match(nodes, /projectNodes\.taskId\} IS NULL AND \$\{projectNodes\.path\} NOT LIKE '\/\.system%'/);
  assert.match(urlSync, /fileId:\s*taskFileId/);
});

test("QRY-024..030 maintenance workers are bounded, durable, and starvation-safe", () => {
  const reconciliation = source("src/inngest/functions/project-files-reconciliation.ts");
  const stale = source("src/inngest/functions/project-import-reconcile.ts");
  const cleanup = source("src/inngest/functions/account-cleanup.ts");
  const hardDelete = source("src/inngest/functions/account-hard-delete.ts");
  const hashes = source("scripts/backfill-file-hashes.ts");

  assert.match(reconciliation, /jobHeartbeats\.lastPayload/);
  assert.match(reconciliation, /projectNodes\.projectId\}, \$\{projectNodes\.id\}\) >/);
  assert.match(stale, /lt\(projects\.updatedAt, staleBefore\)/);
  assert.match(cleanup, /createAdminClient/);
  assert.match(cleanup, /gt\(projects\.id, cursor\)/);
  assert.match(cleanup, /deleteStoragePrefix\(supabase, bucket, prefix\)/);
  assert.match(cleanup, /gt\(messageAttachments\.id, cursor\)/);
  assert.match(hardDelete, /orderBy\(asc\(accountDeletions\.hardDeleteAt\), asc\(accountDeletions\.id\)\)/);
  assert.match(hardDelete, /\.limit\(100\)/);
  assert.match(hashes, /gt\(fileVersions\.id, afterId\)/);
  assert.match(hashes, /orderBy\(asc\(fileVersions\.id\)\)/);
  assert.equal(fs.existsSync(path.join(root, "src/inngest/functions/cleanup-docs.ts")), false);
});

test("QRY-031 legacy normalization is explicit, set-based, and cycle-guarded", () => {
  const backfill = source("scripts/backfill.ts");

  assert.match(backfill, /process\.argv\.includes\("--apply"\)/);
  assert.match(backfill, /jsonb_array_elements_text/);
  assert.match(backfill, /WITH RECURSIVE tree/);
  assert.match(backfill, /ANY\(parent\.visited\)/);
  assert.match(backfill, /Path backfill refused/);
  assert.doesNotMatch(backfill, /db\.select\(\)\.from\(projects\)|function buildPath/);
});

test("QRY-032 migration uses deterministic objects and transactional metadata cleanup", () => {
  const migration = source("scripts/migrate-task-files-to-project-files.ts");

  assert.match(migration, /legacy-task-files\/\$\{legacy\.id\}/);
  assert.match(migration, /upsert:\s*true/);
  assert.match(migration, /sql\.begin/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /SELECT id FROM project_nodes WHERE s3_key = \$\{copiedPath\}/);
  assert.match(migration, /from\("project-files"\)\.remove\(\[copiedPath\]\)/);
});

test("QRY-033 validates concurrent replacement indexes before an atomic name swap", () => {
  const dedupe = source("scripts/deduplicate_nodes.ts");
  const firstCreate = dedupe.indexOf("CREATE UNIQUE INDEX CONCURRENTLY");
  const firstOldDrop = dedupe.indexOf("DROP INDEX IF EXISTS project_nodes_active_parent_name_uidx");

  assert.ok(firstCreate >= 0 && firstCreate < firstOldDrop);
  assert.match(dedupe, /i\.indisvalid/);
  assert.match(dedupe, /i\.indisunique/);
  assert.match(dedupe, /valid_count !== 2/);
  assert.match(dedupe, /sql\.begin\(async \(tx\)/);
});
