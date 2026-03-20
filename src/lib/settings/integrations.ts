import type { User } from "@supabase/supabase-js";
import {
    buildAccountProviderStates,
    formatAccountProviderLabel,
    getLinkedAccountProviders,
    resolvePasswordCredentialState,
    resolvePrimaryProvider,
    type AccountAuthProvider,
} from "@/lib/auth/account-identity";
import { isEmailVerified } from "@/lib/auth/email-verification";
import { buildGithubAccountConnectionState } from "@/lib/github/connection-state";
import type { AuthConnectionMethod, IntegrationsData, ServiceIntegrationConnection } from "@/lib/types/settingsTypes";

type BuildIntegrationsDataInput = {
    user: User;
    githubRepoProjectCount: number;
    githubLastSyncAt: string | null;
    passwordLastChangedAt: string | null;
};

function normalizeProvider(value: string | null): AccountAuthProvider | null {
    return value === "google" || value === "github" || value === "email" ? value : null;
}

function resolveProviderLastUsedAt(user: User, provider: AccountAuthProvider): string | null {
    if (normalizeProvider(resolvePrimaryProvider(user)) === provider && typeof user.last_sign_in_at === "string") {
        return user.last_sign_in_at;
    }

    if (!Array.isArray(user.identities)) {
        return null;
    }

    for (const identity of user.identities) {
        if (!identity || typeof identity.provider !== "string" || identity.provider !== provider) {
            continue;
        }

        const identityRecord = identity as unknown as Record<string, unknown>;
        const directLastUsed = identityRecord.last_sign_in_at;
        if (typeof directLastUsed === "string" && directLastUsed.trim().length > 0) {
            return directLastUsed;
        }

        const identityData = identityRecord.identity_data;
        if (identityData && typeof identityData === "object") {
            const nestedLastUsed = (identityData as Record<string, unknown>).last_sign_in_at;
            if (typeof nestedLastUsed === "string" && nestedLastUsed.trim().length > 0) {
                return nestedLastUsed;
            }
        }
    }

    return null;
}

function buildAccountSummary(
    createdWithLabel: string,
    linkedCount: number,
    additionalLinkedCount: number,
    hasKnownPrimaryProvider: boolean,
): string {
    if (linkedCount <= 0) {
        return "We could not confirm any sign-in methods attached to this account yet.";
    }

    if (!hasKnownPrimaryProvider) {
        return `${linkedCount} sign-in method${linkedCount === 1 ? "" : "s"} ${linkedCount === 1 ? "is" : "are"} attached to this account.`;
    }

    if (additionalLinkedCount <= 0) {
        return `Account created with ${createdWithLabel}. This is the only sign-in method currently attached to the account.`;
    }

    return `Account created with ${createdWithLabel}. ${additionalLinkedCount} additional sign-in method${additionalLinkedCount === 1 ? "" : "s"} ${additionalLinkedCount === 1 ? "is" : "are"} linked to this account.`;
}

function buildProviderDetail(input: {
    label: string;
    provider: AccountAuthProvider;
    state: AuthConnectionMethod["state"];
    hasPassword: boolean;
    emailAddress: string | null;
    emailVerified: boolean;
}): Pick<AuthConnectionMethod, "detail" | "secondaryDetail"> {
    const { label, provider, state, hasPassword, emailAddress, emailVerified } = input;

    if (provider === "email") {
        if (state === "primary") {
            return {
                detail: "This account was created with email.",
                secondaryDetail: hasPassword ? "Password available for direct sign-in." : "No password credential is currently available.",
            };
        }
        if (state === "linked") {
            return {
                detail: "Email sign-in is enabled on this account.",
                secondaryDetail: hasPassword
                    ? emailAddress
                        ? `Use ${emailAddress} with your password for direct sign-in.`
                        : "Password available for direct sign-in."
                    : "Email is present without a password credential.",
            };
        }
        return {
            detail: "Email sign-in is not enabled on this account.",
            secondaryDetail: emailAddress
                ? emailVerified
                    ? `Set a password to enable email sign-in for ${emailAddress}.`
                    : `Verify ${emailAddress} before enabling email sign-in.`
                : "This account does not currently have an email address available for direct sign-in.",
        };
    }

    switch (state) {
        case "primary":
            return {
                detail: `This account was created with ${label}.`,
                secondaryDetail: null,
            };
        case "linked":
            return {
                detail: `${label} is attached as an additional sign-in method.`,
                secondaryDetail: null,
            };
        case "not_linked":
            return {
                detail: `${label} is not attached to this account.`,
                secondaryDetail: null,
            };
    }
}

function buildProviderVerificationState(input: {
    provider: AccountAuthProvider;
    state: AuthConnectionMethod["state"];
    emailVerified: boolean;
}): AuthConnectionMethod["verificationState"] {
    if (input.provider !== "email" || input.state === "not_linked") {
        return null;
    }

    return input.emailVerified ? "verified" : "not_verified";
}

function buildRecommendedNextStep(input: {
    linkedProviders: AccountAuthProvider[];
    githubRepoProjectCount: number;
    canEnableEmailSignIn: boolean;
    emailAddress: string | null;
    emailVerified: boolean;
}): string {
    const { linkedProviders, githubRepoProjectCount, canEnableEmailSignIn, emailAddress, emailVerified } = input;

    if (canEnableEmailSignIn) {
        return emailAddress
            ? `Set a password to enable email sign-in for ${emailAddress} and add a direct recovery path.`
            : "Set a password to enable email sign-in and add a direct recovery path.";
    }

    if (!linkedProviders.includes("email") && emailAddress && !emailVerified) {
        return `Verify ${emailAddress} before enabling email sign-in on this account.`;
    }

    if (!linkedProviders.includes("github")) {
        return "Attach GitHub if you want repository import and sync.";
    }

    if (githubRepoProjectCount <= 0) {
        return "Connect a GitHub repository to a project when you need import or sync.";
    }

    return "Your sign-in methods and connected services are already set up.";
}

function buildGithubServiceConnection(input: {
    githubLinked: boolean;
    githubRepoProjectCount: number;
    githubLastSyncAt: string | null;
}): ServiceIntegrationConnection {
    const { githubLinked, githubRepoProjectCount, githubLastSyncAt } = input;
    if (githubRepoProjectCount > 0) {
        return {
            id: "github",
            label: "GitHub repository access",
            status: "connected",
            summary: `Active on ${githubRepoProjectCount} project${githubRepoProjectCount === 1 ? "" : "s"}.`,
            detail: githubLinked
                ? "GitHub is attached to this account and is already being used for repository import or sync."
                : "Repository import or sync is already configured on your projects.",
            usageCount: githubRepoProjectCount,
            lastUsedAt: githubLastSyncAt,
        };
    }

    if (githubLinked) {
        return {
            id: "github",
            label: "GitHub repository access",
            status: "available",
            summary: "GitHub is attached as a sign-in method.",
            detail: "Repository import and sync are available, but no project is connected yet.",
            usageCount: 0,
            lastUsedAt: githubLastSyncAt,
        };
    }

    return {
        id: "github",
        label: "GitHub repository access",
        status: "not_connected",
        summary: "Not connected on this account.",
        detail: "No GitHub sign-in method or active repository connection was detected.",
        usageCount: 0,
        lastUsedAt: githubLastSyncAt,
    };
}

export function buildIntegrationsData(input: BuildIntegrationsDataInput): IntegrationsData {
    const { user, githubRepoProjectCount, githubLastSyncAt, passwordLastChangedAt } = input;
    const githubConnection = buildGithubAccountConnectionState(user);
    const emailAddress = typeof user.email === "string" && user.email.trim().length > 0 ? user.email : null;
    const emailVerified = isEmailVerified(user);
    const hasPassword = resolvePasswordCredentialState(user, passwordLastChangedAt);
    const linkedProviders = getLinkedAccountProviders(user);
    const effectiveLinkedProviders = hasPassword && !linkedProviders.includes("email")
        ? [...linkedProviders, "email" as const]
        : linkedProviders;
    const rawPrimaryProvider = normalizeProvider(resolvePrimaryProvider(user));
    const createdWith = effectiveLinkedProviders.find((provider) => provider === rawPrimaryProvider) ?? null;
    const createdWithLabel = formatAccountProviderLabel(createdWith);
    const additionalLinkedCount = Math.max(effectiveLinkedProviders.length - (createdWith ? 1 : 0), 0);
    const canEnableEmailSignIn = !hasPassword && emailAddress !== null && emailVerified;

    const authConnections: AuthConnectionMethod[] = buildAccountProviderStates(user).map((provider) => {
        const resolvedState =
            provider.provider === "email" && hasPassword
                ? rawPrimaryProvider === "email"
                    ? "primary"
                    : "linked"
                : provider.state;
        const detail = buildProviderDetail({
            label: provider.label,
            provider: provider.provider,
            state: resolvedState,
            hasPassword,
            emailAddress,
            emailVerified,
        });

        const secondaryDetail =
            provider.provider === "github" && githubConnection.username
                ? detail.secondaryDetail ?? `Connected account: @${githubConnection.username}.`
                : detail.secondaryDetail;

        return {
            ...provider,
            state: resolvedState,
            detail: detail.detail,
            secondaryDetail,
            lastUsedAt: resolveProviderLastUsedAt(user, provider.provider),
            verificationState: buildProviderVerificationState({
                provider: provider.provider,
                state: resolvedState,
                emailVerified,
            }),
        };
    });

    return {
        createdWith,
        createdWithLabel,
        emailAddress,
        emailVerified,
        linkedCount: effectiveLinkedProviders.length,
        additionalLinkedCount,
        summary: buildAccountSummary(createdWithLabel, effectiveLinkedProviders.length, additionalLinkedCount, createdWith !== null),
        recommendedNextStep: buildRecommendedNextStep({
            linkedProviders: effectiveLinkedProviders,
            githubRepoProjectCount,
            canEnableEmailSignIn,
            emailAddress,
            emailVerified,
        }),
        infoNote: canEnableEmailSignIn
            ? "Google and GitHub reflect linked providers. Email sign-in can be enabled on this account by setting a password for the current account email."
            : "You may see only one sign-in method if this account has not been linked to any additional providers yet.",
        capabilities: {
            canEnableEmailSignIn,
            canLinkAdditionalProvider: false,
            canUnlinkGoogle: false,
            canUnlinkGithub: false,
        },
        authConnections,
        externalServices: [
            buildGithubServiceConnection({
                githubLinked: githubConnection.linked,
                githubRepoProjectCount,
                githubLastSyncAt,
            }),
        ],
    };
}
