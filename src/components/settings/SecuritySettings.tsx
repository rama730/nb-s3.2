"use client";

import dynamic from "next/dynamic";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import SecurityOverviewSection from "@/components/settings/SecurityOverviewSection";
import { useSecurityData } from "@/hooks/useSettingsQueries";
import { useAuth } from "@/hooks/useAuth";
import { hasPasswordCredential } from "@/lib/auth/account-identity";
import { isSecurityHardeningEnabled } from "@/lib/features/security";
import { buildSecurityStepUpMethods } from "@/lib/security/step-up-methods";

const SecurityActivitySection = dynamic(() => import("@/components/settings/SecurityActivitySection"));
const PasswordManagementSection = dynamic(() => import("@/components/settings/PasswordManagementSection"));
const MfaSetup = dynamic(() => import("@/components/auth/MfaSetup").then((mod) => mod.MfaSetup));
const SessionsList = dynamic(() => import("@/components/settings/SessionsList").then((mod) => mod.SessionsList));
const LoginHistory = dynamic(() => import("@/components/auth/LoginHistory"));

function SecuritySectionsSkeleton() {
    return <div className="h-96 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900" />;
}

export default function SecurityPage() {
    const { user } = useAuth();
    const securityHardeningEnabled = isSecurityHardeningEnabled(user?.id ?? null);
    const { data: securityData, isLoading, error } = useSecurityData({ hardeningEnabled: securityHardeningEnabled });
    const securityErrorMessage = error ? (error instanceof Error ? error.message : String(error)) : null;
    const passwordAvailable = Boolean(securityData?.password?.hasPassword || hasPasswordCredential(user));
    const verifiedTotpFactors = (securityData?.mfaFactors ?? []).filter(
        (factor) => factor.type === "totp" && factor.status === "verified"
    );
    const primaryVerifiedFactorId = verifiedTotpFactors[0]?.id;
    const stepUpState = {
        hasTotp: Boolean(primaryVerifiedFactorId),
        hasRecoveryCodes: (securityData?.recoveryCodes?.remainingCount ?? 0) > 0,
    };
    const passwordStepUpMethods = buildSecurityStepUpMethods({ ...stepUpState, hasPassword: false })
        .filter((method): method is "totp" | "recovery_code" => method !== "password");
    const sessionStepUpMethods = buildSecurityStepUpMethods({ ...stepUpState, hasPassword: passwordAvailable });

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
                    testId="security-authenticator-section"
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
                    testId="security-active-sessions-section"
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
                    testId="security-login-activity-section"
                >
                    <LoginHistory initialHistory={securityData?.loginHistory} />
                </SettingsSectionCard>

                <SettingsSectionCard
                    title="Security Activity"
                    description="Recent changes to your account security."
                    testId="security-activity-section"
                >
                    <SecurityActivitySection activity={securityData?.securityActivity} />
                </SettingsSectionCard>
            </div>
        </div>
    );
}
