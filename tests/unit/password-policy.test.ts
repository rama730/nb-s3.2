import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PASSWORD_MIN_LENGTH, getPasswordPolicyResult } from "@/lib/security/password-policy";

describe("password policy", () => {
    it("rejects passwords that do not meet the required checks", () => {
        const result = getPasswordPolicyResult("short");

        assert.equal(result.ok, false);
        assert.equal(result.checks.minLength, false);
        assert.match(result.error ?? "", new RegExp(`${PASSWORD_MIN_LENGTH}\\+ characters`));
    });

    it("accepts passwords that meet the required checks without requiring a symbol", () => {
        const result = getPasswordPolicyResult("VeryStrong123");

        assert.equal(result.ok, true);
        assert.equal(result.checks.minLength, true);
        assert.equal(result.checks.uppercase, true);
        assert.equal(result.checks.lowercase, true);
        assert.equal(result.checks.number, true);
        assert.equal(result.error, null);
    });

    it("tracks symbol usage as an optional extra-strength signal", () => {
        const result = getPasswordPolicyResult("VeryStrong123!");

        assert.equal(result.ok, true);
        assert.equal(result.checks.symbol, true);
        assert.equal(result.score, 5);
    });
});
