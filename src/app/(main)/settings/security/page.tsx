"use client";

import { memo, useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import SecurityOverviewSection from "@/components/settings/SecurityOverviewSection";
import SecurityActivitySection from "@/components/settings/SecurityActivitySection";
import PasswordManagementSection from "@/components/settings/PasswordManagementSection";
import { MfaSetup } from "@/components/auth/MfaSetup";
import { SessionsList } from "@/components/settings/SessionsList";
import LoginHistory from "@/components/auth/LoginHistory";
import { useSecurityData } from "@/hooks/useSettingsQueries";
import { useAuth } from "@/hooks/useAuth";
import { formatProviderLabel, hasPasswordCredential, resolvePrimaryProvider } from "@/lib/auth/account-identity";
import { isEmailVerified } from "@/lib/auth/email-verification";
import { isSecurityHardeningEnabled } from "@/lib/features/security";

const SECURITY_SECTION_KEYS = ["overview", "mfa", "password", "sessions", "login-history", "security-activity"] as const;

const SecuritySectionsSkeleton = memo(function SecuritySectionsSkeleton() {
    return (
        <div className="space-y-6 animate-pulse">
            {SECURITY_SECTION_KEYS.map((key) => (
                <div
                    key={key}
                    className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
                >
                    <div className="mb-4 h-5 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
                    <div className="space-y-3">
                        <div className="h-12 rounded bg-zinc-100 dark:bg-zinc-800" />
                        <div className="h-12 rounded bg-zinc-100 dark:bg-zinc-800" />
                    </div>
                </div>
            ))}
        </div>
    );
});

export default function SecurityPage() {
    const { user } = useAuth();
    const securityHardeningEnabled = isSecurityHardeningEnabled(user?.id ?? null);
    const { data: securityData, isLoading, error } = useSecurityData({ hardeningEnabled: securityHardeningEnabled });
    const [passwordConfiguredLocally, setPasswordConfiguredLocally] = useState(false);

    useEffect(() => {
        setPasswordConfiguredLocally(false);
    }, [user?.id]);

    const securityErrorMessage = (() => {
        if (!error) return null;
        if (error instanceof Error) return error.message;
        if (typeof error === "object" && error !== null && "message" in error) {
            const message = (error as { message?: unknown }).message;
            if (typeof message === "string") return message;
        }
        if (typeof error === "string") return error;
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    })();

    const providerLabel = formatProviderLabel(resolvePrimaryProvider(user));
    const emailVerified = isEmailVerified(user as Record<string, unknown> | null);
    const passwordAvailable = securityData?.password?.hasPassword || hasPasswordCredential(user) || passwordConfiguredLocally;
    const verifiedTotpFactors = (securityData?.mfaFactors ?? []).filter(
        (factor) => factor.type === "totp" && factor.status === "verified"
    );
    const primaryVerifiedFactorId = verifiedTotpFactors[0]?.id;
    const recoveryCodeMethods = (securityData?.recoveryCodes?.remainingCount ?? 0) > 0 ? ["recovery_code" as const] : [];
    const passwordStepUpMethods = [
        ...(primaryVerifiedFactorId ? (["totp" as const]) : []),
        ...recoveryCodeMethods,
    ];
    const sessionStepUpMethods = [
        ...(primaryVerifiedFactorId ? (["totp" as const]) : []),
        ...recoveryCodeMethods,
        ...(passwordAvailable ? (["password" as const]) : []),
    ];

    if (isLoading) {
        return (
            <div className="space-y-6" data-hardening-security={securityHardeningEnabled ? "v1" : "off"}>
                <SettingsPageHeader
                    title="Security"
                    description="Protect your account with an authenticator app, manage your fallback password, and review recent activity."
                />
                <SecuritySectionsSkeleton />
            </div>
        );
    }

    return (
        <div className="space-y-8" data-hardening-security={securityHardeningEnabled ? "v1" : "off"}>
            <SettingsPageHeader
                title="Security"
                description="Protect your account with an authenticator app, manage your fallback password, and review recent activity."
            />

            <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                            Signed in as
                        </div>
                        <div className="mt-1 break-all text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {user?.email || "Unavailable"}
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                        <span className="inline-flex rounded-full bg-zinc-100 px-3 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                            Via {providerLabel}
                        </span>
                        <span
                            className={
                                emailVerified
                                    ? "inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                    : "inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                            }
                        >
                            {emailVerified ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                            {emailVerified ? "Email verified" : "Email not verified"}
                        </span>
                    </div>
                </div>
            </div>

            {securityErrorMessage ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300">
                    {securityErrorMessage}
                </div>
            ) : null}

            <SecurityOverviewSection securityData={securityData} hasPassword={passwordAvailable} />

            <div className="space-y-4">
                <div className="space-y-1">
                    <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                        Sign-In Protection
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Use an authenticator app as your main extra protection, and keep a password available as a fallback sign-in method.
                    </p>
                </div>

                <SettingsSectionCard
                    title="Authenticator App"
                    description="Add a 6-digit code from an authenticator app as your main extra layer of protection."
                >
                    <MfaSetup
                        initialFactors={securityData?.mfaFactors}
                        recoveryCodes={securityData?.recoveryCodes}
                    />
                </SettingsSectionCard>

                <PasswordManagementSection
                    hasPassword={passwordAvailable}
                    lastChangedAt={securityData?.password?.lastChangedAt}
                    availableStepUpMethods={passwordStepUpMethods}
                    primaryTotpFactorId={primaryVerifiedFactorId}
                    onPasswordConfigured={() => setPasswordConfiguredLocally(true)}
                />
            </div>

            <div className="space-y-4">
                <div className="space-y-1">
                    <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                        Session Activity
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Review where you are signed in and check recent sign-in activity.
                    </p>
                </div>

                <SettingsSectionCard
                    title="Active Sessions"
                    description="Review where your account is currently signed in."
                >
                    <SessionsList
                        initialSessions={securityData?.sessions}
                        availableStepUpMethods={sessionStepUpMethods}
                        primaryTotpFactorId={primaryVerifiedFactorId}
                    />
                </SettingsSectionCard>

                <SettingsSectionCard
                    title="Recent Login Activity"
                    description="Recent sign-ins to your account."
                >
                    <LoginHistory initialHistory={securityData?.loginHistory} />
                </SettingsSectionCard>

                <SettingsSectionCard
                    title="Security Activity"
                    description="Recent changes to your account security."
                >
                    <SecurityActivitySection activity={securityData?.securityActivity} />
                </SettingsSectionCard>
            </div>
        </div>
    );
}
