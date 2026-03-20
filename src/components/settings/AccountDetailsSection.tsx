"use client";

import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { formatProviderLabel, resolvePrimaryProvider } from "@/lib/auth/account-identity";
import { isEmailVerified } from "@/lib/auth/email-verification";
import { useAuth } from "@/lib/hooks/use-auth";

export default function AccountDetailsSection() {
    const { user } = useAuth();
    const email = user?.email || "Unavailable";
    const providerLabel = formatProviderLabel(resolvePrimaryProvider(user));
    const emailVerified = isEmailVerified(user as Record<string, unknown> | null);

    return (
        <SettingsSectionCard
            title="Account Details"
            description="This is the account currently signed in on this device."
        >
            <div className="space-y-4">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-800/40 p-4">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                        Signed in as
                    </div>
                    <div className="mt-2 break-all text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        {email}
                    </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/30 p-4">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                            Signed in with
                        </div>
                        <div className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {providerLabel}
                        </div>
                    </div>

                    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/30 p-4">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                            Email status
                        </div>
                        <div className="mt-2">
                            <span
                                className={
                                    emailVerified
                                        ? "inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                        : "inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                }
                            >
                                {emailVerified ? "Verified" : "Not verified"}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </SettingsSectionCard>
    );
}
