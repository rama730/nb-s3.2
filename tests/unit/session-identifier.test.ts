import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSessionIdentifierFromSession } from "@/lib/auth/session-identifier";

function createJwtWithSessionId(sessionId: string): string {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url");
    return `${header}.${payload}.`;
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

    it("returns null when no session identifier can be resolved", () => {
        assert.equal(getSessionIdentifierFromSession({ access_token: "bad-token" }), null);
        assert.equal(getSessionIdentifierFromSession(null), null);
    });
});
