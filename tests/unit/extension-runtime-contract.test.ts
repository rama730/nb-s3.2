import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("extension runtime contract", () => {
  it("uses one-time auth codes for browser editor authorization", () => {
    const authorizePage = readSource("src/app/(auth)/authorize/page.tsx");
    const mainLayout = readSource("src/components/layout/MainLayout.tsx");
    const settingsPage = readSource("src/components/settings/IntegrationsSettings.tsx");
    const actionSource = readSource("src/app/actions/extension-sessions.ts");
    const routeSource = readSource("src/app/api/v1/extension/auth-code/route.ts");
    const sessionRouteSource = readSource("src/app/api/v1/extension/session/route.ts");
    const helperSource = readSource("src/lib/extension/auth-code.ts");
    const callbackSource = readSource("src/lib/extension/session-callback.ts");
    const settingsQuerySource = readSource("src/hooks/useSettingsQueries.ts");
    const eventSource = readSource("src/lib/extension/session-events.ts");
    const baselineMigration = readSource("drizzle/0086_virtual_workspace_fields.sql");
    const repairMigration = readSource("drizzle/0091_extension_auth_code_events.sql");

    assert.match(authorizePage, /generateExtensionAuthCode/, "authorize page should issue an auth code");
    assert.match(authorizePage, /redirectToEditor\(\{ code: res\.code \}\)/, "authorize page should redirect with code, not raw token");
    assert.doesNotMatch(authorizePage, /redirectToEditor\(\{ token:/, "authorize page must not place raw tokens in callback URLs");
    assert.doesNotMatch(authorizePage, /useAuth|authLoading|BroadcastChannel|GET_SESSION|SEND_SESSION/, "authorization must rely on the server action instead of a second client-auth session");
    assert.match(authorizePage, /setNeedsSignIn\(true\)/, "an unauthenticated browser must receive a recoverable sign-in path");
    assert.doesNotMatch(mainLayout, /BroadcastChannel|AUTH_REQ|AUTH_ACK|<iframe/, "the app shell must not relay browser authorization through an iframe");
    assert.doesNotMatch(settingsPage, /generateExtensionAuthCode/, "settings should defer editor authorization to the dedicated route");
    assert.match(settingsPage, /Manual authentication token/, "settings should label its deliberate manual-token fallback");
    assert.match(settingsPage, /generatedToken/, "the manual-token fallback should remain transient component state");
    assert.match(eventSource, /auth_code_issued/, "event registry should allow auth-code issuance events");
    assert.match(eventSource, /auth_code_consumed/, "event registry should allow auth-code consumption events");
    assert.match(actionSource, /EXTENSION_DEVICE_SESSION_EVENTS\.authCodeIssued/, "server action should audit auth-code issuance");
    assert.match(routeSource, /EXTENSION_DEVICE_SESSION_EVENTS\.authCodeConsumed/, "exchange route should audit one-time consumption");
    assert.match(routeSource, /pg_advisory_xact_lock/, "exchange route should serialize one-time code consumption");
    assert.match(helperSource, /aes-256-gcm/, "auth code should encrypt the raw device token");
    assert.match(authorizePage, /callbackUri: callbackUrl/, "the browser flow should persist the verified editor callback with the device session");
    assert.match(authorizePage, /EXTENSION_URI_AUTHORITY/, "the browser must reject callbacks for a different application");
    assert.match(actionSource, /requestStateHash/, "issued authorization codes must be bound to the extension state");
    assert.match(routeSource, /timingSafeEqual/, "the exchange route must verify the original extension state");
    assert.match(callbackSource, /nb-workspace\.nb-vscode-sync/, "callbacks must target this extension only");
    assert.match(callbackSource, /session-revoked/, "the server should derive a dedicated disconnect callback");
    assert.match(callbackSource, /inferExtensionCallbackUri/, "existing editor sessions should also receive a compatible disconnect callback");
    assert.match(actionSource, /isNull\(extensionDeviceSessions\.revokedAt\)/, "settings revocation must update an active session atomically");
    assert.match(sessionRouteSource, /export async function GET/, "the extension needs a minimal revocation-status endpoint");
    assert.match(sessionRouteSource, /revoked tokens may read only their own liveness/, "status checks must not restore revoked bearer access");
    assert.match(settingsQuerySource, /refetchInterval: EXTENSION_SESSION_POLL_MS/, "the active Integrations tab must reconcile IDE-side logout promptly");
    assert.match(baselineMigration, /auth_code_issued/, "fresh databases should allow auth-code issuance events");
    assert.match(baselineMigration, /auth_code_consumed/, "fresh databases should allow auth-code consumption events");
    assert.match(repairMigration, /DROP CONSTRAINT IF EXISTS extension_device_session_events_event_type_check/, "existing databases should replace the stale event type check");
    assert.match(repairMigration, /auth_code_issued/, "repair migration should allow auth-code issuance events");
    assert.match(repairMigration, /auth_code_consumed/, "repair migration should allow auth-code consumption events");
  });

  it("keeps extension large-file transfer off the normal request body path", () => {
    const fileRoute = readSource("src/app/api/v1/extension/file/route.ts");
    const uploadRoute = readSource("src/app/api/v1/extension/file-upload/route.ts");

    assert.match(fileRoute, /transfer === "signed"/, "file route should expose signed download intents");
    assert.match(fileRoute, /createSignedUrl/, "signed download intent should use storage signed URLs");
    assert.match(uploadRoute, /createSignedUploadUrl/, "large uploads should go through signed storage URLs");
    assert.match(uploadRoute, /assertNoExtensionWriteConflict/, "large upload finalize should re-check version/hash and locks");
    assert.match(uploadRoute, /applyFileRevision/, "large upload finalize should use the canonical revision transaction");
    assert.match(uploadRoute, /revisionMode/, "large upload intent should preserve explicit revision policy");
    assert.match(uploadRoute, /operationId/, "large upload retries should preserve a stable operation identity");
    assert.match(uploadRoute, /recoverFinalizedIntent/, "large upload retries should recover a committed result after a lost response");
    assert.match(fileRoute, /X-NB-Revision-Mode|x-nb-revision-mode/i, "inline uploads should accept explicit revision policy");
    assert.match(uploadRoute, /recordExtensionMetric/, "extension upload routes should emit metrics");
  });

  it("has production observability and load coverage for the extension path", () => {
    const dashboard = readSource("ops/stability/extension-dashboard.json");
    const loadScript = readSource("qa/load/extension-sync.k6.js");
    const loadRunner = readSource("scripts/run-load-suite.ts");
    const runbook = readSource("docs/operations/extension-runtime-observability.md");

    assert.match(dashboard, /extension\.auth_code\.exchange/, "dashboard should include auth exchange metrics");
    assert.match(dashboard, /extension\.file_upload\.finalize/, "dashboard should include large upload finalize metrics");
    assert.match(loadScript, /extension_signed_range_ms/, "load probe should measure signed range reads");
    assert.match(loadRunner, /'extension-sync'/, "load-suite wrapper should expose the extension sync probe");
    assert.match(runbook, /EXTENSION_AUTH_CODE_SECRET/, "runbook should document auth-code secret stability");
  });

  it("keeps active editor sessions revocable without recreating an IDE catalog", () => {
    const settingsPage = readSource("src/components/settings/IntegrationsSettings.tsx");
    assert.match(settingsPage, /function ExtensionSessionRow/);
    assert.match(settingsPage, /revokeExtensionSession/);
    assert.match(settingsPage, /session\.editorName/);
    assert.match(settingsPage, /session\.deviceName/);
    assert.match(settingsPage, /IDE_ICON_ASSETS/, "the current integrations UI should render supported editor icons");
    assert.match(settingsPage, /<Code2 className=/, "unknown editors should retain a compact fallback icon");
    assert.doesNotMatch(settingsPage, /getCallbackEditorTheme/);
  });
});
