export type SecurityOverviewInput = {
    hasAuthenticatorApp: boolean;
    hasRecoveryCodes: boolean;
    remainingRecoveryCodes: number;
    activeSessions: number;
    hasPassword: boolean;
};

export function getAuthenticatorSummary(hasAuthenticatorApp: boolean): string {
    return hasAuthenticatorApp ? "On" : "Off";
}

export function getPasswordSummary(hasPassword: boolean): string {
    return hasPassword ? "Available" : "Not set";
}

export function getRecoveryCodesSummary(configured: boolean, remainingCount: number): string {
    if (!configured) return "Not generated";
    if (remainingCount === 1) return "1 remaining";
    return `${remainingCount} remaining`;
}

export function getActiveSessionsSummary(activeSessions: number): string {
    if (activeSessions <= 0) return "No sessions";
    if (activeSessions === 1) return "1 session";
    return `${activeSessions} sessions`;
}

export function getRecommendedSecurityStep({
    hasAuthenticatorApp,
    hasRecoveryCodes,
    remainingRecoveryCodes,
    activeSessions,
    hasPassword,
}: SecurityOverviewInput): string {
    if (!hasAuthenticatorApp) return "Set up an authenticator app";
    if (!hasRecoveryCodes || remainingRecoveryCodes <= 0) return "Generate recovery codes";
    if (!hasPassword) return "Set a password";
    if (activeSessions > 1) return "Review active sessions";
    return "Your primary sign-in protections are set up";
}
