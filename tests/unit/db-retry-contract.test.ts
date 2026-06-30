import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { isTransientDbError, readDbErrorCode, withDbRetry } from "../../src/lib/db/retry";

function readSource(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("database retry contract", () => {
    it("detects nested transient postgres and socket failures", () => {
        const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
        const wrapped = new Error("Failed query");
        (wrapped as { cause?: unknown }).cause = reset;

        assert.equal(readDbErrorCode(wrapped), "ECONNRESET");
        assert.equal(isTransientDbError(wrapped), true);
        assert.equal(isTransientDbError(new Error("validation failed")), false);
    });

    it("retries bounded transient operations only", async () => {
        let attempts = 0;
        const result = await withDbRetry("unit.retry", async () => {
            attempts += 1;
            if (attempts === 1) {
                throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
            }
            return "ok";
        }, { delaysMs: [0], module: "test" });

        assert.equal(result, "ok");
        assert.equal(attempts, 2);

        let nonTransientAttempts = 0;
        await assert.rejects(
            () => withDbRetry("unit.no_retry", async () => {
                nonTransientAttempts += 1;
                throw new Error("business rule failed");
            }, { delaysMs: [0], module: "test" }),
            /business rule failed/,
        );
        assert.equal(nonTransientAttempts, 1);
    });

    it("protects the extension login and non-critical preference/presence paths from transient DB resets", () => {
        const extensionAction = readSource("src/app/actions/extension-sessions.ts");
        const heartbeatRoute = readSource("src/app/api/v1/presence/heartbeat/route.ts");
        const notificationActions = readSource("src/app/actions/notifications.ts");

        assert.match(extensionAction, /withDbRetry\("extension\.generate_token"/, "extension token creation should retry transient DB failures");
        assert.match(extensionAction, /db\.transaction\(async \(tx\)/, "extension session and login audit should be written in one transaction");
        assert.match(extensionAction, /onConflictDoNothing\(\{ target: extensionDeviceSessions\.tokenHash \}\)/, "token retry should recover a committed session by token hash");
        assert.match(extensionAction, /withDbRetry\("extension\.auth_code\.issue_event"/, "auth-code audit event should retry transient DB failures");

        assert.match(heartbeatRoute, /withDbRetry\("presence\.heartbeat\.last_active"/, "heartbeat last_active write should retry transient DB failures");
        assert.match(heartbeatRoute, /presence\.heartbeat_last_active_skipped/, "heartbeat should log skipped non-critical transient failures");
        assert.match(heartbeatRoute, /skipped: "transient_db"/, "heartbeat should return a successful degraded response for transient write failures");

        assert.match(notificationActions, /withDbRetry\("notifications\.preferences\.read"/, "settings preference reads should retry transient DB failures");
        assert.match(notificationActions, /notifications\.preferences_read_transient_fallback/, "preference reads should fall back to defaults after transient failures");
        assert.match(notificationActions, /success: true as const,\s+preferences: DEFAULT_NOTIFICATION_PREFERENCES/s, "preference transient fallback should avoid surfacing a settings error");
    });
});
