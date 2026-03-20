"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Button from "@/components/ui-custom/Button";
import Input from "@/components/ui-custom/Input";
import { Label } from "@/components/ui-custom/Label";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { PasswordStrengthMeter } from "@/components/settings/PasswordStrengthMeter";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";
import { useToast } from "@/components/ui-custom/Toast";
import { useChangePassword } from "@/hooks/useSettingsQueries";
import { queryKeys } from "@/lib/query-keys";

type SecurityStepUpMethod = "totp" | "recovery_code";

type PasswordManagementSectionProps = {
  hasPassword: boolean;
  lastChangedAt?: string;
  availableStepUpMethods: SecurityStepUpMethod[];
  primaryTotpFactorId?: string;
  onPasswordConfigured?: () => void;
};

export default function PasswordManagementSection({
  hasPassword,
  lastChangedAt,
  availableStepUpMethods,
  primaryTotpFactorId,
  onPasswordConfigured,
}: PasswordManagementSectionProps) {
  const { showToast } = useToast();
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
    ? "Prefer a strong password with at least 12 characters."
    : "Add a strong password with at least 12 characters if you want email sign-in available on this account.";

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
      showToast(result.message || "Failed to update password", "error");
      return;
    }

    showToast(hasPassword ? "Password updated successfully" : "Password added successfully", "success");
    resetForm();
    setIsEditing(false);
    onPasswordConfigured?.();
    await queryClient.invalidateQueries({ queryKey: queryKeys.settings.security() });
  };

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (newPassword !== confirmPassword) {
      showToast("Passwords do not match", "error");
      return;
    }

    if (newPassword.length < 12) {
      showToast("Password must be at least 12 characters", "error");
      return;
    }

    await submitPasswordChange();
  };

  return (
    <SettingsSectionCard title="Password" description={description}>
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
          {lastChangedAt ? (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Last changed {new Date(lastChangedAt).toLocaleString()}
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
                <Label htmlFor="current-password">Current password</Label>
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
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  disabled={isChangingPassword}
                />
                <PasswordStrengthMeter password={newPassword} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
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
              <Button type="submit" disabled={isChangingPassword}>
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
