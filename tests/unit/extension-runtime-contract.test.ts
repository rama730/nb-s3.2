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
    const settingsPage = readSource("src/components/settings/IntegrationsSettings.tsx");
    const actionSource = readSource("src/app/actions/extension-sessions.ts");
    const routeSource = readSource("src/app/api/v1/extension/auth-code/route.ts");
    const helperSource = readSource("src/lib/extension/auth-code.ts");
    const eventSource = readSource("src/lib/extension/session-events.ts");
    const baselineMigration = readSource("drizzle/0086_virtual_workspace_fields.sql");
    const repairMigration = readSource("drizzle/0091_extension_auth_code_events.sql");

    assert.match(authorizePage, /generateExtensionAuthCode/, "authorize page should issue an auth code");
    assert.match(authorizePage, /redirectToEditor\(\{ code: res\.code \}\)/, "authorize page should redirect with code, not raw token");
    assert.doesNotMatch(authorizePage, /redirectToEditor\(\{ token:/, "authorize page must not place raw tokens in callback URLs");
    assert.match(settingsPage, /generateExtensionAuthCode/, "settings callback flow should also issue an auth code");
    assert.doesNotMatch(settingsPage, /token=\$\{res\.rawToken\}/, "settings callback flow must not redirect raw tokens");
    assert.match(eventSource, /auth_code_issued/, "event registry should allow auth-code issuance events");
    assert.match(eventSource, /auth_code_consumed/, "event registry should allow auth-code consumption events");
    assert.match(actionSource, /EXTENSION_DEVICE_SESSION_EVENTS\.authCodeIssued/, "server action should audit auth-code issuance");
    assert.match(routeSource, /EXTENSION_DEVICE_SESSION_EVENTS\.authCodeConsumed/, "exchange route should audit one-time consumption");
    assert.match(routeSource, /pg_advisory_xact_lock/, "exchange route should serialize one-time code consumption");
    assert.match(helperSource, /aes-256-gcm/, "auth code should encrypt the raw device token");
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
    assert.match(uploadRoute, /assertNoWriteConflict/, "large upload finalize should re-check version/hash and locks");
    assert.match(uploadRoute, /recordNodeEvent/, "large upload finalize should publish file sync events");
    assert.match(uploadRoute, /recordExtensionMetric/, "extension upload routes should emit metrics");
  });

  it("has production observability and load coverage for the extension path", () => {
    const logRoute = readSource("src/app/api/v1/extension/log/route.ts");
    const dashboard = readSource("ops/stability/extension-dashboard.json");
    const loadScript = readSource("qa/load/extension-sync.k6.js");
    const loadRunner = readSource("scripts/run-load-suite.ts");
    const runbook = readSource("docs/operations/extension-runtime-observability.md");

    assert.doesNotMatch(logRoute, /appendFileSync|webview-error\.log/, "extension logs should not write to a local absolute file");
    assert.match(logRoute, /requireAuthenticatedUser/, "extension logs should require an authenticated device session");
    assert.match(dashboard, /extension\.auth_code\.exchange/, "dashboard should include auth exchange metrics");
    assert.match(dashboard, /extension\.file_upload\.finalize/, "dashboard should include large upload finalize metrics");
    assert.match(loadScript, /extension_signed_range_ms/, "load probe should measure signed range reads");
    assert.match(loadRunner, /'extension-sync'/, "load-suite wrapper should expose the extension sync probe");
    assert.match(runbook, /EXTENSION_AUTH_CODE_SECRET/, "runbook should document auth-code secret stability");
  });

  it("renders actual IDE app icons for active editor sessions", () => {
    const settingsPage = readSource("src/components/settings/IntegrationsSettings.tsx");
    const requiredAssets = [
      "public/ide-icons/cursor.png",
      "public/ide-icons/vscode.png",
      "public/ide-icons/antigravity-ide.png",
      "public/ide-icons/antigravity.png",
      "public/ide-icons/kiro.png",
      "public/ide-icons/zed.png",
      "public/ide-icons/vscodium.png",
      "public/ide-icons/void.png",
      "public/ide-icons/trae.png",
      "public/ide-icons/windsurf.svg",
      "public/ide-icons/intellij-idea.svg",
      "public/ide-icons/webstorm.svg",
      "public/ide-icons/pycharm.svg",
      "public/ide-icons/phpstorm.svg",
      "public/ide-icons/clion.svg",
      "public/ide-icons/goland.svg",
      "public/ide-icons/rider.svg",
      "public/ide-icons/rubymine.svg",
      "public/ide-icons/datagrip.svg",
      "public/ide-icons/dataspell.svg",
      "public/ide-icons/fleet.svg",
      "public/ide-icons/rustrover.svg",
      "public/ide-icons/aqua.svg",
      "public/ide-icons/qt-creator.png",
    ];

    for (const asset of requiredAssets) {
      assert.ok(fs.existsSync(path.join(process.cwd(), asset)), `${asset} should be shipped as a static IDE icon asset`);
    }

    assert.match(settingsPage, /IDE_ICON_ASSETS/, "settings should render static IDE icon assets");
    assert.match(settingsPage, /cursor: "\/ide-icons\/cursor\.png"/, "Cursor sessions should use the actual Cursor app icon asset");
    assert.match(settingsPage, /vscode: "\/ide-icons\/vscode\.png"/, "VS Code sessions should use the actual VS Code app icon asset");
    assert.match(settingsPage, /"antigravity-ide": "\/ide-icons\/antigravity-ide\.png"/, "Antigravity IDE sessions should use the actual Antigravity IDE app icon asset");
    assert.match(settingsPage, /kiro: "\/ide-icons\/kiro\.png"/, "Kiro sessions should use the actual Kiro app icon asset");
    assert.match(settingsPage, /zed: "\/ide-icons\/zed\.png"/, "Zed sessions should use the actual Zed app icon asset");
    assert.match(settingsPage, /vscodium: "\/ide-icons\/vscodium\.png"/, "VSCodium sessions should use the VSCodium app icon asset");
    assert.match(settingsPage, /void: "\/ide-icons\/void\.png"/, "Void sessions should use the Void app icon asset");
    assert.match(settingsPage, /trae: "\/ide-icons\/trae\.png"/, "Trae sessions should use the Trae app icon asset");
    assert.match(settingsPage, /windsurf: "\/ide-icons\/windsurf\.svg"/, "Windsurf sessions should use its brand icon asset");
    assert.match(settingsPage, /"intellij-idea": "\/ide-icons\/intellij-idea\.svg"/, "IntelliJ IDEA sessions should use the IntelliJ IDEA app icon asset");
    assert.match(settingsPage, /webstorm: "\/ide-icons\/webstorm\.svg"/, "WebStorm sessions should use the WebStorm app icon asset");
    assert.match(settingsPage, /pycharm: "\/ide-icons\/pycharm\.svg"/, "PyCharm sessions should use the PyCharm app icon asset");
    assert.match(settingsPage, /phpstorm: "\/ide-icons\/phpstorm\.svg"/, "PhpStorm sessions should use the PhpStorm app icon asset");
    assert.match(settingsPage, /clion: "\/ide-icons\/clion\.svg"/, "CLion sessions should use the CLion app icon asset");
    assert.match(settingsPage, /goland: "\/ide-icons\/goland\.svg"/, "GoLand sessions should use the GoLand app icon asset");
    assert.match(settingsPage, /rider: "\/ide-icons\/rider\.svg"/, "Rider sessions should use the Rider app icon asset");
    assert.match(settingsPage, /rubymine: "\/ide-icons\/rubymine\.svg"/, "RubyMine sessions should use the RubyMine app icon asset");
    assert.match(settingsPage, /datagrip: "\/ide-icons\/datagrip\.svg"/, "DataGrip sessions should use the DataGrip app icon asset");
    assert.match(settingsPage, /dataspell: "\/ide-icons\/dataspell\.svg"/, "DataSpell sessions should use the DataSpell app icon asset");
    assert.match(settingsPage, /fleet: "\/ide-icons\/fleet\.svg"/, "Fleet sessions should use the Fleet app icon asset");
    assert.match(settingsPage, /rustrover: "\/ide-icons\/rustrover\.svg"/, "RustRover sessions should use the RustRover app icon asset");
    assert.match(settingsPage, /aqua: "\/ide-icons\/aqua\.svg"/, "Aqua sessions should use the Aqua app icon asset");
    assert.match(settingsPage, /"qt-creator": "\/ide-icons\/qt-creator\.png"/, "Qt Creator sessions should use the Qt Creator app icon asset");
    assert.match(settingsPage, /protocol === "kiro"/, "Kiro callback requests should resolve to the Kiro icon");
    assert.match(settingsPage, /protocol === "zed"/, "Zed callback requests should resolve to the Zed icon");
    assert.match(settingsPage, /protocol === "vscodium"/, "VSCodium callback requests should resolve to the VSCodium icon");
    assert.match(settingsPage, /protocol === "trae"/, "Trae callback requests should resolve to the Trae icon");
    assert.match(settingsPage, /protocol === "void"/, "Void callback requests should resolve to the Void icon");
    assert.match(settingsPage, /protocol === "intellij"/, "IntelliJ IDEA callback requests should resolve to the IntelliJ IDEA icon");
    assert.match(settingsPage, /protocol === "jetbrains"/, "JetBrains callback URLs should resolve product-specific IDE names when present");
    assert.match(settingsPage, /protocol === "webstorm"/, "WebStorm callback requests should resolve to the WebStorm icon");
    assert.match(settingsPage, /protocol === "pycharm"/, "PyCharm callback requests should resolve to the PyCharm icon");
    assert.match(settingsPage, /protocol === "phpstorm"/, "PhpStorm callback requests should resolve to the PhpStorm icon");
    assert.match(settingsPage, /protocol === "qtcreator"/, "Qt Creator callback requests should resolve to the Qt Creator icon");
    assert.match(settingsPage, /getSessionEditorTheme\(session\)/, "active rows should resolve icons from the full extension session");
    assert.match(settingsPage, /session\.editorName/, "icon resolution should use editorName heartbeat metadata");
    assert.match(settingsPage, /session\.editorHost/, "icon resolution should use editorHost heartbeat metadata");
    assert.match(settingsPage, /session\.deviceName/, "icon resolution should preserve existing manual-token session names");
    assert.match(settingsPage, /IconComponent className=\{theme\.iconClassName\}/, "active rows should render each IDE icon at the resolved brand size");
    assert.match(settingsPage, /CallbackEditorIcon className=\{callbackEditorTheme\.iconClassName\}/, "callback add-to-editor UI should render the requesting IDE icon at the resolved brand size");
    assert.match(settingsPage, /getCallbackEditorTheme\(callbackUrl\)/, "the add-to-editor panel should use the requesting IDE icon");
    const recommendedPathIndex = settingsPage.indexOf("Recommended connection path");
    assert.ok(recommendedPathIndex > 0, "settings should keep the recommended connection path copy");
    assert.match(settingsPage, /const showRecommendedConnectionPath =\s*!loadingSessions && extensionSessions\.length === 0;/, "recommended connection path should show only before a user has an active signed-in editor session");
    assert.match(settingsPage, /\{showRecommendedConnectionPath \? \(/, "recommended connection path should be gated by the unsigned extension state");
    const recommendedPathBlock = settingsPage.slice(
      Math.max(0, recommendedPathIndex - 500),
      recommendedPathIndex + 500,
    );
    assert.doesNotMatch(recommendedPathBlock, /CallbackEditorIcon|callbackEditorTheme\.containerClass/, "recommended connection path should stay text-only without an editor icon");
    assert.match(settingsPage, /ExtensionAppIcon/, "unknown compatible editors should fall back to the NB extension app icon");
    assert.doesNotMatch(settingsPage, /MonitorIcon|<Monitor className/, "active editor sessions should not fall back to a generic monitor icon");
  });
});
