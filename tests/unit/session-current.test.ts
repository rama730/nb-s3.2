import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCurrentSessionRowId } from "@/lib/security/session-current";

describe("session current helpers", () => {
    it("prefers an explicit current session id when it matches an active row", () => {
        assert.equal(
            resolveCurrentSessionRowId(["a", "b", "c"], "b"),
            "b"
        );
    });

    it("falls back to the only active session when there is exactly one row", () => {
        assert.equal(
            resolveCurrentSessionRowId(["only-session"], null),
            "only-session"
        );
    });

    it("returns null when there is no safe current-session match", () => {
        assert.equal(resolveCurrentSessionRowId(["a", "b"], null), null);
        assert.equal(resolveCurrentSessionRowId(["a", "b"], "missing"), null);
    });
});
