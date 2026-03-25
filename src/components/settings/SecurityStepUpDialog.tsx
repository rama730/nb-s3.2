"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import Button from "@/components/ui-custom/Button";
import Input from "@/components/ui-custom/Input";
import { Label } from "@/components/ui-custom/Label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type SecurityStepUpMethod = "totp" | "recovery_code" | "password";

type SecurityStepUpDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  availableMethods: SecurityStepUpMethod[];
  factorId?: string;
  onVerified: () => void | Promise<void>;
};

const METHOD_LABELS: Record<SecurityStepUpMethod, string> = {
  totp: "Authenticator app",
  recovery_code: "Recovery code",
  password: "Password",
};

export default function SecurityStepUpDialog({
  open,
  onOpenChange,
  title,
  description,
  availableMethods,
  factorId,
  onVerified,
}: SecurityStepUpDialogProps) {
  const defaultMethod = useMemo(
    () => availableMethods[0] ?? null,
    [availableMethods],
  );
  const [method, setMethod] = useState<SecurityStepUpMethod | null>(defaultMethod);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setCode("");
      setPassword("");
      setSubmitting(false);
      setMethod(defaultMethod);
      return;
    }
    setMethod((current) => (current && availableMethods.includes(current) ? current : defaultMethod));
  }, [availableMethods, defaultMethod, open]);

  if (!method) {
    return null;
  }

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { method };
      if (method === "totp") {
        payload.factorId = factorId;
        payload.code = code.trim();
      }
      if (method === "recovery_code") {
        payload.code = code.trim();
      }
      if (method === "password") {
        payload.password = password;
      }

      const response = await fetch("/api/v1/auth/security-step-up", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const contentType = response.headers.get("content-type") || "";
      const json = contentType.includes("application/json") ? await response.json() : null;
      if (!response.ok || json?.success === false) {
        throw new Error(json?.message || "Failed to verify this device");
      }

      toast.success("This device is verified for security changes");
      await onVerified();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to verify this device");
    } finally {
      setSubmitting(false);
    }
  };

  const isTotp = method === "totp";
  const isRecoveryCode = method === "recovery_code";
  const submitDisabled = submitting
    || (isTotp && (!factorId || !/^[0-9]{6}$/.test(code.trim())))
    || (isRecoveryCode && code.trim().length < 6)
    || (method === "password" && password.length === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {availableMethods.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {availableMethods.map((entry) => (
                <Button
                  key={entry}
                  type="button"
                  size="sm"
                  variant={entry === method ? "secondary" : "outline"}
                  onClick={() => {
                    setMethod(entry);
                    setCode("");
                    setPassword("");
                  }}
                >
                  {METHOD_LABELS[entry]}
                </Button>
              ))}
            </div>
          ) : null}

          {isTotp ? (
            <div className="space-y-2">
              <Label htmlFor="security-step-up-totp">Current 6-digit code</Label>
              <Input
                id="security-step-up-totp"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                disabled={submitting}
              />
            </div>
          ) : null}

          {isRecoveryCode ? (
            <div className="space-y-2">
              <Label htmlFor="security-step-up-recovery-code">Recovery code</Label>
              <Input
                id="security-step-up-recovery-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="ABCD-EFGH"
                disabled={submitting}
              />
            </div>
          ) : null}

          {method === "password" ? (
            <div className="space-y-2">
              <Label htmlFor="security-step-up-password">Current password</Label>
              <Input
                id="security-step-up-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                disabled={submitting}
              />
            </div>
          ) : null}

          <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-300">
            This verification stays active for up to 5 minutes on this device.
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={submitDisabled} onClick={() => void handleSubmit()}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying...
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                Verify device
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
