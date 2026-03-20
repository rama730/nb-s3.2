"use client";

import type { ComponentType } from "react";
import { KeyRound, ShieldCheck, LockKeyhole, MonitorSmartphone } from "lucide-react";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import type { SecurityData } from "@/lib/types/settingsTypes";
import {
    getActiveSessionsSummary,
    getAuthenticatorSummary,
    getPasswordSummary,
    getRecoveryCodesSummary,
    getRecommendedSecurityStep,
} from "@/lib/settings/security-overview";

type SecurityOverviewSectionProps = {
    securityData: SecurityData | undefined;
    hasPassword: boolean;
};

type OverviewStat = {
    label: string;
    value: string;
    icon: ComponentType<{ className?: string }>;
};

export default function SecurityOverviewSection({
    securityData,
    hasPassword,
}: SecurityOverviewSectionProps) {
    const hasAuthenticatorApp = (securityData?.mfaFactors ?? []).some(
        (factor) => factor.type === "totp" && factor.status === "verified"
    );
    const activeSessions = securityData?.sessions.length ?? 0;
    const recoveryCodesConfigured = securityData?.recoveryCodes.configured ?? false;
    const remainingRecoveryCodes = securityData?.recoveryCodes.remainingCount ?? 0;
    const recommendedStep = getRecommendedSecurityStep({
        hasAuthenticatorApp,
        hasRecoveryCodes: recoveryCodesConfigured,
        remainingRecoveryCodes,
        activeSessions,
        hasPassword,
    });

    const stats: OverviewStat[] = [
        {
            label: "Authenticator app",
            value: getAuthenticatorSummary(hasAuthenticatorApp),
            icon: ShieldCheck,
        },
        {
            label: "Password",
            value: getPasswordSummary(hasPassword),
            icon: LockKeyhole,
        },
        {
            label: "Recovery codes",
            value: getRecoveryCodesSummary(recoveryCodesConfigured, remainingRecoveryCodes),
            icon: KeyRound,
        },
        {
            label: "Active sessions",
            value: getActiveSessionsSummary(activeSessions),
            icon: MonitorSmartphone,
        },
    ];

    return (
        <SettingsSectionCard
            title="Security Overview"
            description="A quick view of your main sign-in protections and recent account activity."
        >
            <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {stats.map((stat) => {
                        const Icon = stat.icon;
                        return (
                            <div
                                key={stat.label}
                                className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/40"
                            >
                                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                                    <Icon className="h-3.5 w-3.5" />
                                    {stat.label}
                                </div>
                                <div className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                    {stat.value}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-100">
                    <span className="font-semibold">Recommended next step:</span> {recommendedStep}
                </div>
            </div>
        </SettingsSectionCard>
    );
}
