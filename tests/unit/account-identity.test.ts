import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { User } from "@supabase/supabase-js";
import {
    buildAccountProviderStates,
    formatAccountProviderLabel,
    getLinkedAccountProviders,
    resolvePasswordCredentialState,
} from "@/lib/auth/account-identity";

function createUser(overrides: Partial<User>): User {
    return {
        id: "user-1",
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
        created_at: "2026-03-20T00:00:00.000Z",
        email: "user@example.com",
        ...overrides,
    } as User;
}

describe("account identity helpers", () => {
    it("builds provider states from primary provider, identities, and password credential", () => {
        const user = createUser({
            app_metadata: {
                provider: "google",
                providers: ["google", "github"],
            },
            identities: [
                { provider: "google" },
                { provider: "github" },
            ] as User["identities"],
        });

        const linkedProviders = getLinkedAccountProviders(user);
        const providerStates = buildAccountProviderStates(user);

        assert.deepEqual(linkedProviders, ["google", "github"]);
        assert.deepEqual(
            providerStates.map((provider) => [provider.provider, provider.state]),
            [
                ["google", "primary"],
                ["github", "linked"],
                ["email", "not_linked"],
            ],
        );
    });

    it("treats email accounts as a real attached sign-in method", () => {
        const user = createUser({
            app_metadata: {
                provider: "email",
                providers: ["email"],
            },
        });

        assert.deepEqual(getLinkedAccountProviders(user), ["email"]);
        assert.equal(formatAccountProviderLabel("email"), "Email");
    });

    it("uses password history as a fallback password signal for oauth accounts", () => {
        const user = createUser({
            app_metadata: {
                provider: "google",
                providers: ["google"],
            },
            identities: [{ provider: "google" }] as User["identities"],
        });

        assert.equal(resolvePasswordCredentialState(user, null), false);
        assert.equal(resolvePasswordCredentialState(user, "2026-03-20T04:00:00.000Z"), true);
    });
});
