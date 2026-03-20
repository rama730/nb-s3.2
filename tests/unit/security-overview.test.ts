import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    getActiveSessionsSummary,
    getAuthenticatorSummary,
    getPasswordSummary,
    getRecoveryCodesSummary,
    getRecommendedSecurityStep,
} from "@/lib/settings/security-overview";

describe("security overview helpers", () => {
    it("formats concise status labels", () => {
        assert.equal(getAuthenticatorSummary(true), "On");
        assert.equal(getAuthenticatorSummary(false), "Off");
        assert.equal(getPasswordSummary(true), "Available");
        assert.equal(getPasswordSummary(false), "Not set");
        assert.equal(getRecoveryCodesSummary(false, 0), "Not generated");
        assert.equal(getRecoveryCodesSummary(true, 10), "10 remaining");
        assert.equal(getActiveSessionsSummary(1), "1 session");
        assert.equal(getActiveSessionsSummary(4), "4 sessions");
    });

    it("recommends the most useful next step", () => {
        assert.equal(
            getRecommendedSecurityStep({
                hasAuthenticatorApp: false,
                hasRecoveryCodes: false,
                remainingRecoveryCodes: 0,
                activeSessions: 1,
                hasPassword: true,
            }),
            "Set up an authenticator app"
        );

        assert.equal(
            getRecommendedSecurityStep({
                hasAuthenticatorApp: true,
                hasRecoveryCodes: false,
                remainingRecoveryCodes: 0,
                activeSessions: 1,
                hasPassword: true,
            }),
            "Generate recovery codes"
        );

        assert.equal(
            getRecommendedSecurityStep({
                hasAuthenticatorApp: true,
                hasRecoveryCodes: true,
                remainingRecoveryCodes: 10,
                activeSessions: 1,
                hasPassword: false,
            }),
            "Set a password"
        );

        assert.equal(
            getRecommendedSecurityStep({
                hasAuthenticatorApp: true,
                hasRecoveryCodes: true,
                remainingRecoveryCodes: 10,
                activeSessions: 3,
                hasPassword: true,
            }),
            "Review active sessions"
        );

        assert.equal(
            getRecommendedSecurityStep({
                hasAuthenticatorApp: true,
                hasRecoveryCodes: true,
                remainingRecoveryCodes: 10,
                activeSessions: 1,
                hasPassword: true,
            }),
            "Your primary sign-in protections are set up"
        );
    });
});
