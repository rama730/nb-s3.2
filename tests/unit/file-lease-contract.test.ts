import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

test("file lease migration adds session identity, fencing, realtime, and RLS hardening", () => {
  const migration = read("drizzle/0101_project_file_leases.sql");
  assert.match(migration, /project_node_lock_fencing_seq/);
  assert.match(migration, /ALTER COLUMN "session_id" SET NOT NULL/);
  assert.match(migration, /"lease_id"/);
  assert.match(migration, /"fencing_token"/);
  assert.match(migration, /REPLICA IDENTITY FULL/);
  assert.match(migration, /ALTER PUBLICATION supabase_realtime ADD TABLE "project_node_locks"/);
  assert.match(migration, /DROP POLICY IF EXISTS "project_node_locks_write"/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE/);
});

test("canonical service performs atomic session-scoped acquisition and fenced writes", () => {
  const service = read("src/lib/files/file-lock-service.ts");
  assert.match(service, /ON CONFLICT \(node_id\) DO UPDATE/);
  assert.match(service, /locked_by = EXCLUDED\.locked_by[\s\S]*session_id = EXCLUDED\.session_id/);
  assert.match(service, /nextval\('project_node_lock_fencing_seq'\)/);
  assert.match(service, /lease_id = \$\{input\.credentials\.leaseId\}/);
  assert.match(service, /fencing_token = \$\{input\.credentials\.fencingToken\}/);
  assert.match(service, /FOR UPDATE/);
});

test("browser edit mode waits for a lease and preserves a dirty buffer after lease loss", () => {
  const view = read("src/components/projects/v2/files-tab/file/FileView.tsx");
  const editor = read("src/components/projects/v2/files-tab/file/TextViewer.tsx");
  const hook = read("src/components/projects/v2/files-tab/hooks/useFileLease.ts");
  assert.match(view, /fileLease\.acquire\(\)[\s\S]*setMode\("edit"\)/);
  assert.match(editor, /leaseStatus === "lost"/);
  assert.match(editor, /unsaved buffer is preserved/);
  assert.match(editor, /beforeunload/);
  assert.match(hook, /renewBrowserFileLease/);
  assert.match(hook, /releaseBrowserFileLease\(current, \{ keepalive: true \}\)/);
});

test("project realtime subscription reconciles canonical lease snapshots", () => {
  const channel = read("src/lib/realtime/project-files-channel.ts");
  const rootView = read("src/components/projects/v2/files-tab/FilesTabRoot.tsx");
  const store = read("src/stores/files/editorSlice.ts");
  assert.match(channel, /table: 'project_node_locks'/);
  assert.match(channel, /filter: `project_id=eq\.\$\{projectId\}`/);
  assert.match(rootView, /fetchProjectFileLeases/);
  assert.match(rootView, /onFileLeaseChange: reconcileLocks/);
  assert.match(store, /const nextLocks: Record<string, SoftLock> = \{\}/);
});

test("extension 1.0.42 uses single-flight activation sessions and lease credentials for every publish path", () => {
  const extensionRoot = path.resolve(root, "../workspace-extensions/nb-vscode-sync");
  const extension = fs.readFileSync(path.join(extensionRoot, "src/extension.ts"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));
  assert.equal(packageJson.version, "1.0.42");
  assert.match(extension, /new SingleFlight<string, ExtensionFileLease>\(\)/);
  assert.match(extension, /await pendingAcquisition/);
  assert.match(extension, /_clientSessionId = crypto\.randomUUID\(\)/);
  assert.match(extension, /action: 'renew'/);
  assert.match(extension, /'X-NB-Lease-Id': lease\.leaseId/);
  assert.match(extension, /'X-NB-Fencing-Token': String\(lease\.fencingToken\)/);
  assert.match(extension, /await this\.acquireLock\(uri, true\)/);
  assert.match(extension, /releaseAllLocks/);
  assert.match(extension, /vscode\.FilePermission\.Readonly/);
});

test("background writers defer instead of overwriting active editors", () => {
  const gitSync = read("src/inngest/functions/git-sync.ts");
  const sandboxMerge = read("src/lib/projects/merge-sandbox.ts");
  const conflictResolution = read("src/app/actions/files/gitActions.ts");
  assert.match(gitSync, /Git pull deferred because a collaborator is editing a file/);
  assert.match(sandboxMerge, /Task merge deferred because a collaborator is editing an affected file/);
  assert.doesNotMatch(sandboxMerge, /DELETE FROM project_node_locks/);
  assert.match(conflictResolution, /acquireFileLease/);
  assert.match(conflictResolution, /assertOwnedFileLease/);
});

test("maintenance deduplication refuses to remove active editing leases", () => {
  const deduplicate = read("scripts/deduplicate_nodes.ts");
  assert.match(deduplicate, /expires_at > NOW\(\)/);
  assert.match(deduplicate, /Deduplication aborted:[\s\S]*active editing leases/);
  assert.match(deduplicate, /DELETE FROM project_node_locks[\s\S]*expires_at <= NOW\(\)/);
});
