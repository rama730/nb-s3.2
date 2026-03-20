import type { User } from "@supabase/supabase-js";

export type AccountAuthProvider = "google" | "github" | "email";
export type AccountAuthProviderState = "primary" | "linked" | "not_linked";

const ACCOUNT_AUTH_PROVIDER_ORDER: AccountAuthProvider[] = ["google", "github", "email"];

function normalizeAccountProvider(value: string | null | undefined): AccountAuthProvider | null {
    if (!value) return null;

    switch (value.trim().toLowerCase()) {
        case "google":
            return "google";
        case "github":
            return "github";
        case "email":
            return "email";
        default:
            return null;
    }
}

export function resolvePrimaryProvider(user: User | null | undefined): string | null {
    if (!user) return null;

    const appProvider =
        typeof user.app_metadata?.provider === "string"
            ? user.app_metadata.provider.trim().toLowerCase()
            : "";
    if (appProvider) return appProvider;

    const providers = Array.isArray(user.app_metadata?.providers)
        ? user.app_metadata.providers.filter(
            (provider): provider is string => typeof provider === "string" && provider.trim().length > 0
        )
        : [];

    const nonEmailProvider = providers.find((provider) => provider.toLowerCase() !== "email");
    if (nonEmailProvider) return nonEmailProvider.trim().toLowerCase();
    if (providers.length > 0) return providers[0]!.trim().toLowerCase();

    const identityProvider = Array.isArray(user.identities)
        ? user.identities.find(
            (identity) =>
                identity
                && typeof identity.provider === "string"
                && identity.provider.trim().length > 0
        )?.provider
        : null;

    if (identityProvider) {
        return identityProvider.trim().toLowerCase();
    }

    return user.email ? "email" : null;
}

export function formatProviderLabel(provider: string | null): string {
    if (!provider) return "Unknown";

    switch (provider) {
        case "google":
            return "Google";
        case "github":
            return "GitHub";
        case "email":
            return "Email and password";
        default:
            return provider.charAt(0).toUpperCase() + provider.slice(1);
    }
}

export function formatAccountProviderLabel(provider: AccountAuthProvider | string | null): string {
    const normalized = normalizeAccountProvider(provider);
    if (!normalized) return "Unknown";

    switch (normalized) {
        case "google":
            return "Google";
        case "github":
            return "GitHub";
        case "email":
            return "Email";
    }
}

export function hasPasswordCredential(user: User | null | undefined): boolean {
    if (!user) return false;

    const provider = resolvePrimaryProvider(user);
    if (provider === "email") {
        return true;
    }

    const providers = Array.isArray(user.app_metadata?.providers)
        ? user.app_metadata.providers.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0
        )
        : [];
    if (providers.some((value) => value.trim().toLowerCase() === "email")) {
        return true;
    }

    return Array.isArray(user.identities)
        ? user.identities.some(
            (identity) =>
                identity
                && typeof identity.provider === "string"
                && identity.provider.trim().toLowerCase() === "email"
        )
        : false;
}

export function resolvePasswordCredentialState(
    user: User | null | undefined,
    passwordLastChangedAt?: string | null,
): boolean {
    if (hasPasswordCredential(user)) {
        return true;
    }

    return typeof passwordLastChangedAt === "string" && passwordLastChangedAt.trim().length > 0;
}

export function getLinkedAccountProviders(user: User | null | undefined): AccountAuthProvider[] {
    if (!user) return [];

    const linkedProviders = new Set<AccountAuthProvider>();
    const primaryProvider = normalizeAccountProvider(resolvePrimaryProvider(user));
    if (primaryProvider) {
        linkedProviders.add(primaryProvider);
    }

    const appProviders = Array.isArray(user.app_metadata?.providers)
        ? user.app_metadata.providers
        : [];
    for (const provider of appProviders) {
        const normalized = normalizeAccountProvider(typeof provider === "string" ? provider : null);
        if (normalized) {
            linkedProviders.add(normalized);
        }
    }

    if (Array.isArray(user.identities)) {
        for (const identity of user.identities) {
            const normalized = normalizeAccountProvider(
                identity && typeof identity.provider === "string" ? identity.provider : null
            );
            if (normalized) {
                linkedProviders.add(normalized);
            }
        }
    }

    if (hasPasswordCredential(user)) {
        linkedProviders.add("email");
    }

    return ACCOUNT_AUTH_PROVIDER_ORDER.filter((provider) => linkedProviders.has(provider));
}

export function buildAccountProviderStates(user: User | null | undefined): Array<{
    provider: AccountAuthProvider;
    label: string;
    state: AccountAuthProviderState;
}> {
    const linkedProviders = new Set(getLinkedAccountProviders(user));
    const primaryProvider = normalizeAccountProvider(resolvePrimaryProvider(user));

    return ACCOUNT_AUTH_PROVIDER_ORDER.map((provider) => ({
        provider,
        label: formatAccountProviderLabel(provider),
        state:
            primaryProvider === provider
                ? "primary"
                : linkedProviders.has(provider)
                    ? "linked"
                    : "not_linked",
    }));
}
