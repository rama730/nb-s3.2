import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("extension crash recovery contract", () => {
  it("persists private, expiring, owner-scoped cloud drafts", () => {
    const schema = source("src/lib/db/schema/index.ts");
    const migration = source("drizzle/0100_extension_recovery_drafts.sql");
    const route = source("src/app/api/v1/extension/recovery-drafts/route.ts");

    assert.match(schema, /extensionRecoveryDrafts/);
    assert.match(schema, /baseVersion/);
    assert.match(schema, /baseHash/);
    assert.match(schema, /taskContext/);
    assert.match(schema, /expiresAt/);
    assert.match(migration, /extension-recovery-drafts/);
    assert.match(migration, /VALUES \('extension-recovery-drafts', 'extension-recovery-drafts', false/);
    assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /auth\.uid\(\) = user_id/);
    assert.match(route, /requireAuthenticatedUser/);
    assert.match(route, /getProjectAccessById/);
    assert.match(route, /createSignedUploadUrl/);
    assert.match(route, /createSignedUrl/);
    assert.match(route, /sha256/);
    assert.match(route, /MAX_RECOVERY_DRAFT_BYTES/);
  });

  it("retains only finalized generations and removes expired/account-owned blobs", () => {
    const route = source("src/app/api/v1/extension/recovery-drafts/route.ts");
    const helper = source("src/lib/extension/recovery-drafts.ts");
    const retention = source("src/inngest/functions/extension-recovery-retention.ts");
    const registry = source("src/inngest/registry.ts");
    const hardDelete = source("src/lib/account/hard-delete.ts");

    assert.match(route, /status[^\n]*finalized/);
    assert.match(route, /pruneExtensionRecoveryGenerations/);
    assert.match(helper, /RECOVERY_GENERATIONS_TO_KEEP = 3/);
    assert.match(retention, /extension-recovery-retention/);
    assert.match(retention, /purgeExpiredExtensionRecoveryDrafts/);
    assert.match(retention, /purgeCleanSessionRecoveryDrafts/);
    assert.match(helper, /EXTENSION_RECOVERY_BUCKET = "extension-recovery-drafts"/);
    assert.match(registry, /extensionRecoveryRetention/);
    assert.match(hardDelete, /extensionRecoveryDrafts/);
    assert.match(hardDelete, /extension-recovery-drafts/);
    assert.match(hardDelete, /createAdminClient/);
    assert.doesNotMatch(hardDelete, /delete_auth_user/);
  });

  it("keeps revisions explicit and conflict checked", () => {
    const fileRoute = source("src/app/api/v1/extension/file/route.ts");
    const uploadRoute = source("src/app/api/v1/extension/file-upload/route.ts");
    const draftRoute = source("src/app/api/v1/extension/recovery-drafts/route.ts");

    assert.match(fileRoute, /baseVersion/);
    assert.match(fileRoute, /baseHash/);
    assert.match(fileRoute, /revisionMode/);
    assert.match(uploadRoute, /assertNoExtensionWriteConflict/);
    assert.doesNotMatch(draftRoute, /applyFileRevision/);
  });

  it("separates silent active snapshots from interrupted-session incidents", () => {
    const schema = source("src/lib/db/schema/index.ts");
    const migration = source("drizzle/0102_extension_recovery_sessions.sql");
    const sessionRoute = source("src/app/api/v1/extension/recovery-sessions/route.ts");
    const draftRoute = source("src/app/api/v1/extension/recovery-drafts/route.ts");
    const extensionRoot = path.resolve(process.cwd(), "../workspace-extensions/nb-vscode-sync");
    const recovery = fs.readFileSync(path.join(extensionRoot, "src/recovery.ts"), "utf8");
    const extension = fs.readFileSync(path.join(extensionRoot, "src/extension.ts"), "utf8");
    const sidebar = fs.readFileSync(path.join(extensionRoot, "media/sidebar.js"), "utf8");

    assert.match(schema, /extensionRecoverySessions/);
    assert.match(migration, /active.*clean.*interrupted.*resolved/);
    assert.match(sessionRoute, /previousDisposition/);
    assert.match(sessionRoute, /action: z\.literal\("heartbeat"\)/);
    assert.match(draftRoute, /view === "all" \|\| Boolean\(row\.incidentReason\)/);
    assert.match(draftRoute, /recoveryIncidentReason/);
    assert.match(draftRoute, /currentSessionId/);
    assert.match(recovery, /incidentSessionIds/);
    assert.match(recovery, /lastStateSignature/);
    assert.match(extension, /type: 'recoveryIncidentState'/);
    assert.doesNotMatch(extension, /type: 'recoveryState'/);
    assert.match(sidebar, /renderRecoveryIncidentBanner/);
    assert.match(sidebar, /var html = renderRecoveryPanel\(project\)/);
    assert.doesNotMatch(sidebar, /Saving ['"]? \+ state\.cloudSyncing/);
    assert.match(sidebar, /Date\.parse\(String\(time/);
  });
});
