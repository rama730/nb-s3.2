import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSessionIdentifierFromSession } from "@/lib/auth/session-identifier";

function createJwtWithSessionId(sessionId: string): string {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url");
    return `${header}.${payload}.`;
}

function encodeBase64BrowserStyle(value: string): string {
    return Buffer.from(value, "utf8").toString("base64");
}

async function withBrowserDecodeRuntime<T>(run: () => T | Promise<T>): Promise<T> {
    const originalBuffer = globalThis.Buffer;
    const originalAtob = globalThis.atob;

    Object.defineProperty(globalThis, "Buffer", {
        configurable: true,
        writable: true,
        value: undefined,
    });
    Object.defineProperty(globalThis, "atob", {
        configurable: true,
        writable: true,
        value: (input: string) => originalBuffer.from(input, "base64").toString("binary"),
    });

    try {
        return await run();
    } finally {
        Object.defineProperty(globalThis, "Buffer", {
            configurable: true,
            writable: true,
            value: originalBuffer,
        });
        Object.defineProperty(globalThis, "atob", {
            configurable: true,
            writable: true,
            value: originalAtob,
        });
    }
}

describe("session identifier helpers", () => {
    it("prefers the explicit session id when present", () => {
        assert.equal(
            getSessionIdentifierFromSession({
                id: "explicit-session-id",
                session_id: "claim-session-id",
                access_token: createJwtWithSessionId("jwt-session-id"),
            }),
            "explicit-session-id"
        );
    });

    it("falls back to the direct session_id field", () => {
        assert.equal(
            getSessionIdentifierFromSession({
                session_id: "claim-session-id",
            }),
            "claim-session-id"
        );
    });

    it("extracts session_id from the access token payload when needed", () => {
        assert.equal(
            getSessionIdentifierFromSession({
                access_token: createJwtWithSessionId("jwt-session-id"),
            }),
            "jwt-session-id"
        );
    });

    it("decodes non-ASCII JWT payloads correctly in the browser fallback path", async () => {
        const sessionId = "sess-雪-🙂";
        const header = encodeBase64BrowserStyle(JSON.stringify({ alg: "none", typ: "JWT" }))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/g, "");
        const payload = encodeBase64BrowserStyle(JSON.stringify({ session_id: sessionId }))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/g, "");
        const token = `${header}.${payload}.`;

        await withBrowserDecodeRuntime(async () => {
            assert.equal(
                getSessionIdentifierFromSession({
                    access_token: token,
                }),
                sessionId
            );
        });
    });

    it("returns null when no session identifier can be resolved", () => {
        assert.equal(getSessionIdentifierFromSession({ access_token: "bad-token" }), null);
        assert.equal(getSessionIdentifierFromSession(null), null);
    });
});
