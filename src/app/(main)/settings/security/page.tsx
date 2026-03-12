"use client";

import { useState, memo } from "react";
import Button from "@/components/ui-custom/Button";
import Input from "@/components/ui-custom/Input";
import { Label } from "@/components/ui-custom/Label";
import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { PasswordStrengthMeter } from "@/components/settings/PasswordStrengthMeter";
import { useToast } from "@/components/ui-custom/Toast";
import { useSecurityData, useChangePassword } from "@/hooks/useSettingsQueries";
import { useAuth } from "@/hooks/useAuth";
import { isSecurityHardeningEnabled } from "@/lib/features/security";

const MfaSetup = dynamic(() => import("@/components/auth/MfaSetup").then((m) => m.MfaSetup), {
    ssr: false,
    loading: () => <div className="text-xs text-zinc-500">Loading MFA settings...</div>,
});
const PasskeysSection = dynamic(() => import("@/components/auth/PasskeysSection"), {
    ssr: false,
    loading: () => <div className="text-xs text-zinc-500">Loading passkeys...</div>,
});
const SessionsList = dynamic(() => import("@/components/settings/SessionsList").then((m) => m.SessionsList), {
    ssr: false,
    loading: () => <div className="text-xs text-zinc-500">Loading sessions...</div>,
});
const LoginHistory = dynamic(() => import("@/components/auth/LoginHistory"), {
    ssr: false,
    loading: () => <div className="text-xs text-zinc-500">Loading login history...</div>,
});

const SECURITY_SECTION_KEYS = ["mfa", "passkeys", "password", "sessions", "login-history"] as const;

// Skeleton for security sections
const SecuritySectionsSkeleton = memo(function SecuritySectionsSkeleton() {
    return (
        <div className="space-y-6 animate-pulse">
            {SECURITY_SECTION_KEYS.map((key) => (
                <div
                    key={key}
                    className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6"
                >
                    <div className="h-5 w-40 bg-zinc-200 dark:bg-zinc-800 rounded mb-4" />
                    <div className="space-y-3">
                        <div className="h-12 bg-zinc-100 dark:bg-zinc-800 rounded" />
                        <div className="h-12 bg-zinc-100 dark:bg-zinc-800 rounded" />
                    </div>
                </div>
            ))}
        </div>
    );
});

export default function SecurityPage() {
    const { user } = useAuth();
    const securityHardeningEnabled = isSecurityHardeningEnabled(user?.id ?? null);
    const { showToast } = useToast();
    const { data: securityData, isLoading, error } = useSecurityData({ hardeningEnabled: securityHardeningEnabled });
    const changePasswordMutation = useChangePassword();

    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();

        if (newPassword !== confirmPassword) {
            showToast("Passwords do not match", "error");
            return;
        }

        if (newPassword.length < 8) {
            showToast("Password must be at least 8 characters", "error");
            return;
        }

        changePasswordMutation.mutate(
            { currentPassword, newPassword },
            {
                onSuccess: (result) => {
                    if (result.success) {
                        showToast("Password updated successfully", "success");
                        setCurrentPassword("");
                        setNewPassword("");
                        setConfirmPassword("");
                    } else {
                        showToast(result.message || "Failed to update password", "error");
                    }
                },
                onError: () => {
                    showToast("An error occurred while changing password", "error");
                },
            }
        );
    };

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

    const isChangingPassword = changePasswordMutation.isPending;

    if (isLoading) {
        return (
            <div className="space-y-6" data-hardening-security={securityHardeningEnabled ? "v1" : "off"}>
                <SettingsPageHeader
                    title="Security"
                    description="Protect your account with modern authentication and active session controls."
                />
                <SecuritySectionsSkeleton />
            </div>
        );
    }

    return (
        <div className="space-y-6" data-hardening-security={securityHardeningEnabled ? "v1" : "off"}>
            <SettingsPageHeader
                title="Security"
                description="Protect your account with modern authentication and active session controls."
            />

            {securityErrorMessage ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300">
                    {securityErrorMessage}
                </div>
            ) : null}

            <SettingsSectionCard
                title="Multi-factor authentication"
                description="Add an extra layer of security to your account."
            >
                <MfaSetup initialFactors={securityData?.mfaFactors} />
            </SettingsSectionCard>

            <SettingsSectionCard
                title="Passkeys"
                description="Use passkeys for faster and safer sign-in."
            >
                <PasskeysSection initialPasskeys={securityData?.passkeys} />
            </SettingsSectionCard>

            <SettingsSectionCard
                title="Password"
                description="Change your password. We recommend using a strong, unique password."
            >
                <form onSubmit={handlePasswordChange} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="current">Current password</Label>
                        <Input
                            id="current"
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            required
                            disabled={isChangingPassword}
                        />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="new">New password</Label>
                            <Input
                                id="new"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                                disabled={isChangingPassword}
                            />
                            <PasswordStrengthMeter password={newPassword} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="confirm">Confirm new password</Label>
                            <Input
                                id="confirm"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                disabled={isChangingPassword}
                            />
                            {confirmPassword && newPassword !== confirmPassword && (
                                <p className="text-xs text-red-500">Passwords don&apos;t match</p>
                            )}
                        </div>
                    </div>
                    <Button type="submit" disabled={isChangingPassword}>
                        {isChangingPassword ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Updating...
                            </>
                        ) : (
                            "Update password"
                        )}
                    </Button>
                </form>
            </SettingsSectionCard>

            <SettingsSectionCard
                title="Active sessions"
                description="Review and revoke active sessions across devices."
            >
                <SessionsList initialSessions={securityData?.sessions} />
            </SettingsSectionCard>

            <SettingsSectionCard
                title="Login history"
                description="Recent sign-in activity for your account."
            >
                <LoginHistory initialHistory={securityData?.loginHistory} />
            </SettingsSectionCard>
        </div>
    );
}
