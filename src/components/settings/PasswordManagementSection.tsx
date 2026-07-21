"use client";

import { toast } from "sonner";
import type { FormEvent } from "react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { PasswordStrengthMeter } from "@/components/settings/PasswordStrengthMeter";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { useChangePassword } from "@/hooks/useSettingsQueries";
import { queryKeys } from "@/lib/query-keys";
import { getPasswordPolicyResult, PASSWORD_MIN_LENGTH } from "@/lib/security/password-policy";
import type { SecurityData } from "@/lib/types/settingsTypes";

type SecurityStepUpMethod = "totp" | "recovery_code";

type PasswordManagementSectionProps = {
  hasPassword: boolean;
  lastChangedAt?: string;
  availableStepUpMethods: SecurityStepUpMethod[];
  primaryTotpFactorId?: string;
};

export default function PasswordManagementSection({
  hasPassword,
  lastChangedAt,
  availableStepUpMethods,
  primaryTotpFactorId,
}: PasswordManagementSectionProps) {
  const queryClient = useQueryClient();
  const changePasswordMutation = useChangePassword();
  const [isEditing, setIsEditing] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [stepUpOpen, setStepUpOpen] = useState(false);

  const isChangingPassword = changePasswordMutation.isPending;
  const title = hasPassword ? "Change password" : "Set a password";
  const description = hasPassword
    ? "Manage the password used with this account."
    : "Add a password so email sign-in is available on this account.";
  const statusLabel = hasPassword ? "Password available" : "No password set";
  const helperCopy = hasPassword
    ? `Prefer a strong password with at least ${PASSWORD_MIN_LENGTH} characters.`
    : `Add a strong password with at least ${PASSWORD_MIN_LENGTH} characters if you want email sign-in available on this account.`;
  const passwordPolicy = getPasswordPolicyResult(newPassword);
  const formattedLastChanged = lastChangedAt ? new Date(lastChangedAt).toLocaleString() : null;

  const resetForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const submitPasswordChange = async () => {
    const result = await changePasswordMutation.mutateAsync({ currentPassword, newPassword });
    if (!result.success) {
      const errorCode = "errorCode" in result ? result.errorCode : undefined;
      if (errorCode === "STEP_UP_REQUIRED") {
        setStepUpOpen(true);
        return;
      }
      toast.error(result.message || "Failed to update password");
      return;
    }

    toast.success(hasPassword ? "Password updated successfully" : "Password added successfully");
    resetForm();
    setIsEditing(false);
    queryClient.setQueryData<SecurityData>(queryKeys.settings.security(), (current) => current ? {
      ...current,
      password: { ...current.password, hasPassword: true, lastChangedAt: new Date().toISOString() },
    } : current);
    await queryClient.invalidateQueries({ queryKey: queryKeys.settings.security() });
  };

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (!passwordPolicy.ok) {
      toast.error(passwordPolicy.error || "Password does not meet security requirements");
      return;
    }

    await submitPasswordChange();
  };

  return (
    <SettingsSectionCard
      title="Password"
      description={description}
      testId="security-password-section"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
            Status
          </div>
          <div className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {statusLabel}
          </div>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {helperCopy}
          </p>
          {formattedLastChanged ? (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Last changed {formattedLastChanged}
            </p>
          ) : null}
        </div>

        {!isEditing ? (
          <Button onClick={() => setIsEditing(true)}>
            {title}
          </Button>
        ) : (
          <form onSubmit={(event) => void handlePasswordSubmit(event)} className="space-y-4">
            {hasPassword ? (
              <div className="space-y-2">
                <label htmlFor="current-password" className="text-sm font-medium leading-none">Current password</label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                  disabled={isChangingPassword}
                />
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="new-password" className="text-sm font-medium leading-none">New password</label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  disabled={isChangingPassword}
                />
                <PasswordStrengthMeter password={newPassword} result={passwordPolicy} />
              </div>

              <div className="space-y-2">
                <label htmlFor="confirm-password" className="text-sm font-medium leading-none">Confirm new password</label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  disabled={isChangingPassword}
                />
                {confirmPassword && newPassword !== confirmPassword ? (
                  <p className="text-xs text-red-500">Passwords do not match.</p>
                ) : null}
              </div>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Recovery is handled from the sign-in flow if you ever lose access.
            </p>

            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isChangingPassword || !passwordPolicy.ok}>
                {isChangingPassword ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  title
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isChangingPassword}
                onClick={() => {
                  resetForm();
                  setIsEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>

      <SecurityStepUpDialog
        open={stepUpOpen}
        onOpenChange={setStepUpOpen}
        title="Verify this device"
        description="Complete one more check before changing your password."
        availableMethods={availableStepUpMethods}
        factorId={primaryTotpFactorId}
        onVerified={async () => {
          await submitPasswordChange();
        }}
      />
    </SettingsSectionCard>
  );
}
