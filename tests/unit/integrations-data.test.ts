import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { User } from "@supabase/supabase-js";
import { buildIntegrationsData } from "@/lib/settings/integrations";

function createUser(overrides: Partial<User>): User {
    return {
        id: "user-1",
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
        created_at: "2026-03-20T00:00:00.000Z",
        email: "user@example.com",
        email_confirmed_at: "2026-03-20T00:00:00.000Z",
        ...overrides,
    } as User;
}

describe("integrations settings builder", () => {
    it("builds auth connections, recommendation, and github service detail", () => {
        const user = createUser({
            app_metadata: {
                provider: "google",
                providers: ["google", "github", "email"],
            },
            identities: [
                {
                    provider: "google",
                    last_sign_in_at: "2026-03-19T10:00:00.000Z",
                },
                {
                    provider: "github",
                    last_sign_in_at: "2026-03-18T08:00:00.000Z",
                    identity_data: {
                        login: "octocat",
                        name: "The Octocat",
                        avatar_url: "https://avatars.githubusercontent.com/u/5832347?v=4",
                    },
                },
            ] as User["identities"],
            last_sign_in_at: "2026-03-19T10:00:00.000Z",
        });

        const githubProjects = [
            {
                id: "proj-1",
                title: "My Project",
                repoUrl: "https://github.com/octocat/my-project",
                defaultBranch: "main",
                lastSyncAt: "2026-03-19T12:00:00.000Z",
                lastCommitSha: "abc123commitsha",
                syncStatus: "ready" as const,
            }
        ];

        const data = buildIntegrationsData({
            user,
            githubRepoProjectCount: 1,
            githubLastSyncAt: "2026-03-19T12:00:00.000Z",
            passwordLastChangedAt: "2026-03-19T11:00:00.000Z",
            githubProjects,
        });

        assert.equal(data.createdWith, "google");
        assert.equal(data.linkedCount, 3);
        assert.equal(data.additionalLinkedCount, 2);
        assert.equal(data.recommendedNextStep, "Your sign-in methods and connected services are already set up.");
        assert.equal(data.capabilities.canEnableEmailSignIn, false);
        assert.equal(data.authConnections.length, 3);
        assert.equal(data.authConnections[0]?.lastUsedAt, "2026-03-19T10:00:00.000Z");
        assert.equal(data.authConnections[2]?.secondaryDetail, "Use user@example.com with your password for direct sign-in.");
        assert.equal(data.authConnections[2]?.verificationState, "verified");
        assert.equal(data.externalServices[0]?.status, "connected");
        assert.equal(data.externalServices[0]?.lastUsedAt, "2026-03-19T12:00:00.000Z");
        assert.equal(data.externalServices[0]?.githubUsername, "octocat");
        assert.equal(data.externalServices[0]?.githubFullName, "The Octocat");
        assert.equal(data.externalServices[0]?.githubAvatarUrl, "https://avatars.githubusercontent.com/u/5832347?v=4");
        assert.equal(data.externalServices[0]?.projects?.length, 1);
        assert.equal(data.externalServices[0]?.projects?.[0]?.title, "My Project");
    });

    it("recommends adding email when only oauth sign-in exists", () => {
        const user = createUser({
            app_metadata: {
                provider: "google",
                providers: ["google"],
            },
            identities: [{ provider: "google" }] as User["identities"],
        });

        const data = buildIntegrationsData({
            user,
            githubRepoProjectCount: 0,
            githubLastSyncAt: null,
            passwordLastChangedAt: null,
        });

        assert.equal(data.recommendedNextStep, "Set a password to enable email sign-in for user@example.com and add a direct recovery path.");
        assert.equal(data.authConnections.find((provider) => provider.provider === "email")?.state, "not_linked");
        assert.equal(data.capabilities.canEnableEmailSignIn, true);
        assert.equal(data.authConnections.find((provider) => provider.provider === "email")?.verificationState, null);
    });

    it("treats password audit history as a linked email sign-in signal", () => {
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

        const data = buildIntegrationsData({
            user,
            githubRepoProjectCount: 0,
            githubLastSyncAt: null,
            passwordLastChangedAt: "2026-03-20T04:00:00.000Z",
        });

        assert.equal(data.linkedCount, 3);
        assert.equal(data.authConnections.find((provider) => provider.provider === "email")?.state, "linked");
        assert.equal(data.capabilities.canEnableEmailSignIn, false);
        assert.equal(data.authConnections.find((provider) => provider.provider === "email")?.detail, "Email sign-in is enabled on this account.");
    });
});
