"use client";

import { Fragment, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Github, Info, Link2, Loader2, Mail, ShieldCheck, Sparkles } from "lucide-react";
import Button from "@/components/ui-custom/Button";
import Input from "@/components/ui-custom/Input";
import { Label } from "@/components/ui-custom/Label";
import { useToast } from "@/components/ui-custom/Toast";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { PasswordStrengthMeter } from "@/components/settings/PasswordStrengthMeter";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { fetchSecurityStepUpCapabilities, useEnableEmailSignIn, useIntegrationsData } from "@/hooks/useSettingsQueries";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type {
    AuthConnectionMethod,
    IntegrationsAuthProvider,
    IntegrationsAuthProviderState,
    ServiceIntegrationConnection,
} from "@/lib/types/settingsTypes";

type SecurityStepUpMethod = "totp" | "recovery_code";

function GoogleIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
            <path
                fill="#4285F4"
                d="M21.6 12.23c0-.69-.06-1.2-.19-1.73H12v3.27h5.52c-.11.81-.72 2.04-2.08 2.86l-.02.11 3.02 2.29.21.02c1.93-1.75 3.05-4.33 3.05-7.82Z"
            />
            <path
                fill="#34A853"
                d="M12 22c2.7 0 4.96-.87 6.61-2.36l-3.21-2.42c-.86.58-2.01.99-3.4.99-2.64 0-4.88-1.75-5.68-4.18l-.1.01-3.14 2.38-.03.1A9.98 9.98 0 0 0 12 22Z"
            />
            <path
                fill="#FBBC05"
                d="M6.32 14.03A5.98 5.98 0 0 1 6 12c0-.7.12-1.37.31-2.03l-.01-.14-3.18-2.42-.1.05A9.9 9.9 0 0 0 2 12c0 1.6.38 3.1 1.03 4.45l3.29-2.42Z"
            />
            <path
                fill="#EA4335"
                d="M12 5.79c1.76 0 2.94.74 3.61 1.36l2.64-2.53C16.95 3.42 14.7 2 12 2a9.98 9.98 0 0 0-8.95 5.49l3.29 2.51C7.13 7.54 9.36 5.79 12 5.79Z"
            />
        </svg>
    );
}

function ProviderIcon({ provider, className }: { provider: IntegrationsAuthProvider; className?: string }) {
    if (provider === "google") {
        return <GoogleIcon className={className} />;
    }

    if (provider === "github") {
        return <Github className={className} />;
    }

    return <Mail className={className} />;
}

const PROVIDER_GLYPH_STYLES: Record<IntegrationsAuthProvider, string> = {
    google: "bg-white dark:bg-zinc-950",
    github: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    email: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
};

const STATE_BADGE_COPY: Record<IntegrationsAuthProviderState, string> = {
    primary: "Primary",
    linked: "Linked",
    not_linked: "Not linked",
};

const STATE_BADGE_STYLES: Record<IntegrationsAuthProviderState, string> = {
    primary: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    linked: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    not_linked: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const SERVICE_BADGE_STYLES: Record<ServiceIntegrationConnection["status"], string> = {
    connected: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    available: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    not_connected: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

const SERVICE_BADGE_COPY: Record<ServiceIntegrationConnection["status"], string> = {
    connected: "Connected",
    available: "Available",
    not_connected: "Not connected",
};

function ProviderGlyph({ provider }: { provider: IntegrationsAuthProvider }) {
    return (
        <div
            className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200/70 dark:border-zinc-800",
                PROVIDER_GLYPH_STYLES[provider],
            )}
        >
            <ProviderIcon provider={provider} className="h-5 w-5" />
        </div>
    );
}

function formatRelativeTimestamp(value: string | null | undefined): string | null {
    if (!value) return null;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return formatDistanceToNow(date, { addSuffix: true });
}

function ProviderRow({
    provider,
    onEnableEmailSignIn,
    enablingEmailSignIn,
}: {
    provider: AuthConnectionMethod;
    onEnableEmailSignIn?: () => void;
    enablingEmailSignIn?: boolean;
}) {
    const lastUsed = formatRelativeTimestamp(provider.lastUsedAt);
    const showVerificationBadge = provider.provider === "email" && provider.verificationState;

    return (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/40">
            <div className="flex min-w-0 items-start gap-3">
                <ProviderGlyph provider={provider.provider} />
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {provider.label}
                        </div>
                        {showVerificationBadge ? (
                            <span
                                className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                                    provider.verificationState === "verified"
                                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                        : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                                )}
                            >
                                {provider.verificationState === "verified" ? (
                                    <CheckCircle2 className="h-3 w-3" />
                                ) : (
                                    <Info className="h-3 w-3" />
                                )}
                                {provider.verificationState === "verified" ? "Email verified" : "Email not verified"}
                            </span>
                        ) : null}
                        {lastUsed ? (
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                Last used {lastUsed}
                            </span>
                        ) : null}
                    </div>
                    <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        {provider.detail}
                    </div>
                    {provider.secondaryDetail ? (
                        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            {provider.secondaryDetail}
                        </div>
                    ) : null}
                </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
                <Badge className={cn("rounded-full px-3 py-1 font-medium", STATE_BADGE_STYLES[provider.state])}>
                    {STATE_BADGE_COPY[provider.state]}
                </Badge>
                {onEnableEmailSignIn ? (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={onEnableEmailSignIn}
                        disabled={enablingEmailSignIn}
                    >
                        {enablingEmailSignIn ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Opening...
                            </>
                        ) : (
                            "Set a password"
                        )}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

function ExternalServiceRow({ service }: { service: ServiceIntegrationConnection }) {
    const lastUsed = formatRelativeTimestamp(service.lastUsedAt);

    return (
        <div className="flex items-start justify-between gap-4 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
            <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
                    <Github className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {service.label}
                        </div>
                        {service.usageCount > 0 ? (
                            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                {service.usageCount} project{service.usageCount === 1 ? "" : "s"}
                            </span>
                        ) : null}
                    </div>
                    <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        {service.summary}
                    </div>
                    <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                        {service.detail}
                    </div>
                    {lastUsed ? (
                        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            Last synced {lastUsed}
                        </div>
                    ) : null}
                </div>
            </div>

            <Badge className={cn("shrink-0 rounded-full px-3 py-1 font-medium", SERVICE_BADGE_STYLES[service.status])}>
                {SERVICE_BADGE_COPY[service.status]}
            </Badge>
        </div>
    );
}

function IntegrationsSkeleton() {
    return (
        <div className="space-y-6 animate-pulse">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-3 h-6 w-52" />
                <Skeleton className="mt-3 h-4 w-full max-w-xl" />
                <div className="mt-4 flex gap-2">
                    <Skeleton className="h-8 w-36 rounded-full" />
                    <Skeleton className="h-8 w-40 rounded-full" />
                </div>
            </div>
            {[0, 1].map((section) => (
                <div key={section} className="rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="mt-2 h-4 w-full max-w-lg" />
                    <div className="mt-5 space-y-3">
                        <Skeleton className="h-20 rounded-2xl" />
                        <Skeleton className="h-20 rounded-2xl" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function IntegrationsSettings() {
    const { data, isLoading, error } = useIntegrationsData();
    const enableEmailSignInMutation = useEnableEmailSignIn();
    const queryClient = useQueryClient();
    const { showToast } = useToast();

    const [emailSignInOpen, setEmailSignInOpen] = useState(false);
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [stepUpOpen, setStepUpOpen] = useState(false);
    const [stepUpMethods, setStepUpMethods] = useState<SecurityStepUpMethod[]>([]);
    const [primaryTotpFactorId, setPrimaryTotpFactorId] = useState<string | undefined>();

    const errorMessage = (() => {
        if (!error) return null;
        if (error instanceof Error) return error.message;
        return "Unable to load connected account details.";
    })();

    const primaryProvider = useMemo(
        () => data?.authConnections.find((provider) => provider.state === "primary") ?? null,
        [data?.authConnections],
    );

    const resetEmailForm = () => {
        setNewPassword("");
        setConfirmPassword("");
    };

    async function loadStepUpOptions() {
        const payload = await fetchSecurityStepUpCapabilities();
        const nextMethods = payload.availableMethods.filter(
            (method): method is SecurityStepUpMethod => method === "totp" || method === "recovery_code",
        );
        if (nextMethods.length === 0) {
            throw new Error("No additional verification method is available for this account.");
        }

        setPrimaryTotpFactorId(payload.primaryTotpFactorId);
        setStepUpMethods(nextMethods);
        setStepUpOpen(true);
    }

    async function submitEnableEmailSignIn() {
        if (newPassword !== confirmPassword) {
            showToast("Passwords do not match", "error");
            return;
        }

        if (newPassword.length < 12) {
            showToast("Password must be at least 12 characters", "error");
            return;
        }

        const result = await enableEmailSignInMutation.mutateAsync({
            newPassword,
        });

        if (!result.success) {
            const errorCode = "errorCode" in result ? result.errorCode : undefined;
            if (errorCode === "STEP_UP_REQUIRED") {
                try {
                    await loadStepUpOptions();
                } catch (stepUpError) {
                    showToast(
                        stepUpError instanceof Error
                            ? stepUpError.message
                            : "Unable to load verification methods.",
                        "error",
                    );
                }
                return;
            }

            showToast(result.message || "Failed to enable email sign-in", "error");
            return;
        }

        showToast("Password added successfully. Email sign-in is now enabled for this account", "success");
        resetEmailForm();
        setEmailSignInOpen(false);
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.settings.integrations() }),
            queryClient.invalidateQueries({ queryKey: queryKeys.settings.security() }),
        ]);
    }

    if (isLoading) {
        return <IntegrationsSkeleton />;
    }

    return (
        <div className="space-y-6">
            {errorMessage ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300">
                    {errorMessage}
                </div>
            ) : null}

            <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                            Account created with
                        </div>
                        <div className="mt-2 flex items-center gap-3">
                            {primaryProvider ? <ProviderGlyph provider={primaryProvider.provider} /> : null}
                            <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                {data?.createdWithLabel || "Unknown"}
                            </div>
                        </div>
                        <p className="mt-3 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
                            {data?.summary}
                        </p>
                        <div className="mt-4 flex items-start gap-2 rounded-xl bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-950/40 dark:text-zinc-400">
                            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{data?.recommendedNextStep}</span>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Badge className="rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                            {data?.linkedCount ?? 0} sign-in method{(data?.linkedCount ?? 0) === 1 ? "" : "s"}
                        </Badge>
                        <Badge className="rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                            {data?.additionalLinkedCount ?? 0} additional link{(data?.additionalLinkedCount ?? 0) === 1 ? "" : "s"}
                        </Badge>
                    </div>
                </div>
            </section>

            <SettingsSectionCard
                title="Account Connections"
                description="See which sign-in methods are attached to this account."
            >
                <div className="space-y-3">
                    {data?.authConnections.map((provider) => {
                        const showEmailAction =
                            provider.provider === "email" &&
                            provider.state === "not_linked" &&
                            data.capabilities.canEnableEmailSignIn;

                        return (
                            <Fragment key={provider.provider}>
                                <ProviderRow
                                    provider={provider}
                                    onEnableEmailSignIn={showEmailAction ? () => setEmailSignInOpen((current) => !current) : undefined}
                                    enablingEmailSignIn={showEmailAction && emailSignInOpen}
                                />
                                {showEmailAction && emailSignInOpen ? (
                                    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900">
                                        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                            Set a password
                                        </div>
                                        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                                            Set a password to enable email sign-in for {data.emailAddress}. Google and GitHub stay linked.
                                        </p>
                                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label htmlFor="integrations-email-password">New password</Label>
                                                <Input
                                                    id="integrations-email-password"
                                                    type="password"
                                                    value={newPassword}
                                                    onChange={(event) => setNewPassword(event.target.value)}
                                                    disabled={enableEmailSignInMutation.isPending}
                                                />
                                                <PasswordStrengthMeter password={newPassword} />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="integrations-email-password-confirm">Confirm password</Label>
                                                <Input
                                                    id="integrations-email-password-confirm"
                                                    type="password"
                                                    value={confirmPassword}
                                                    onChange={(event) => setConfirmPassword(event.target.value)}
                                                    disabled={enableEmailSignInMutation.isPending}
                                                />
                                                {confirmPassword && newPassword !== confirmPassword ? (
                                                    <p className="text-xs text-red-500">Passwords do not match.</p>
                                                ) : null}
                                            </div>
                                        </div>
                                        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                                            Use at least 12 characters. This enables email/password access on the current account email and does not create a second account.
                                        </p>
                                        <div className="mt-4 flex flex-wrap gap-3">
                                            <Button
                                                type="button"
                                                onClick={() => void submitEnableEmailSignIn()}
                                                disabled={enableEmailSignInMutation.isPending}
                                            >
                                                {enableEmailSignInMutation.isPending ? (
                                                    <>
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        Saving...
                                                    </>
                                                ) : (
                                                    "Set a password"
                                                )}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                disabled={enableEmailSignInMutation.isPending}
                                                onClick={() => {
                                                    resetEmailForm();
                                                    setEmailSignInOpen(false);
                                                }}
                                            >
                                                Cancel
                                            </Button>
                                        </div>
                                    </div>
                                ) : null}
                            </Fragment>
                        );
                    })}
                </div>
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-950/40 dark:text-zinc-400">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                        Google and GitHub reflect linked providers. Email sign-in uses the current account email and is enabled by setting a password when available.
                    </span>
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-950/40 dark:text-zinc-400">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{data?.infoNote}</span>
                </div>
            </SettingsSectionCard>

            <SettingsSectionCard
                title="External Services"
                description="Service connections used by product features on this account."
            >
                <div className="space-y-3">
                    {data?.externalServices.map((service) => (
                        <ExternalServiceRow key={service.id} service={service} />
                    ))}
                </div>
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:bg-zinc-950/40 dark:text-zinc-400">
                    <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                        GitHub here refers to repository import and sync usage inside the product, separate from how you originally signed in.
                    </span>
                </div>
            </SettingsSectionCard>

            <SecurityStepUpDialog
                open={stepUpOpen}
                onOpenChange={setStepUpOpen}
                title="Verify this device"
                description="Complete one more check before setting a password for email sign-in."
                availableMethods={stepUpMethods}
                factorId={primaryTotpFactorId}
                onVerified={async () => {
                    await submitEnableEmailSignIn();
                }}
            />
        </div>
    );
}
