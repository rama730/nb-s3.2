"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import {
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  Loader2,
  Printer,
  Shield,
  ShieldCheck,
  Trash2,
} from "lucide-react";
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
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "sonner";
import { getTotpVerificationErrorMessage, normalizeTotpQrCodeSource } from "@/lib/auth/mfa-ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/query-keys";
import type { MfaFactor, SecurityData } from "@/lib/types/settingsTypes";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";

interface MfaSetupProps {
  initialFactors?: MfaFactor[];
  recoveryCodes?: SecurityData["recoveryCodes"];
}

type PendingTotpFactor = {
  id: string;
  qrCodeDataUrl: string;
  secret: string;
};

type RevealedRecoveryCodes = {
  codes: string[];
  generatedAt?: string;
};

type ProtectedAction =
  | { type: "remove"; factorId: string }
  | { type: "regenerate-recovery-codes" }
  | null;

function formatRecoveryCodesForExport(codes: string[]): string {
  return [
    "NB S3 Recovery Codes",
    "",
    "Each code can be used once.",
    "",
    ...codes,
    "",
    "Store these codes in a safe place.",
  ].join("\n");
}

export function MfaSetup({ initialFactors, recoveryCodes }: MfaSetupProps) {
  const hasInitialFactors = Array.isArray(initialFactors);
  const queryClient = useQueryClient();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [factors, setFactors] = useState<MfaFactor[]>(initialFactors ?? []);
  const [loading, setLoading] = useState(!hasInitialFactors);
  const [enrolling, setEnrolling] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [protectedActionPending, setProtectedActionPending] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [friendlyName, setFriendlyName] = useState("Authenticator app");
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingFactor, setPendingFactor] = useState<PendingTotpFactor | null>(null);
  const [unenrollId, setUnenrollId] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [protectedAction, setProtectedAction] = useState<ProtectedAction>(null);
  const [revealedRecoveryCodes, setRevealedRecoveryCodes] = useState<RevealedRecoveryCodes | null>(null);

  useEffect(() => {
    if (Array.isArray(initialFactors)) {
      setFactors(initialFactors);
      setLoading(false);
    }
  }, [initialFactors]);

  const refreshSecurity = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.settings.security() });
  }, [queryClient]);

  const loadFactors = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/auth/mfa/factors");
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        toast.error(`Failed to load MFA settings (${res.status})`);
        return;
      }
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        toast.error(json?.message || `Failed to load MFA settings (${res.status})`);
        return;
      }
      setFactors(json?.data?.factors || []);
    } catch {
      toast.error("Failed to load MFA settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasInitialFactors) {
      void loadFactors();
    }
  }, [hasInitialFactors, loadFactors]);

  const verifiedFactors = factors.filter((factor) => factor.type === "totp" && factor.status === "verified");
  const pendingFactors = factors.filter((factor) => factor.type === "totp" && factor.status === "unverified");
  const primaryVerifiedFactor = verifiedFactors[0] ?? null;
  const hasVerifiedFactor = verifiedFactors.length > 0;

  const protectedMethods = useMemo(() => {
    const methods: Array<"totp" | "recovery_code"> = [];
    if (primaryVerifiedFactor) methods.push("totp");
    if ((recoveryCodes?.remainingCount ?? 0) > 0) methods.push("recovery_code");
    return methods;
  }, [primaryVerifiedFactor, recoveryCodes?.remainingCount]);

  const cleanupPendingFactor = useCallback(async (factorId: string) => {
    try {
      await supabase.auth.mfa.unenroll({ factorId });
    } catch {
      // Best effort cleanup so abandoned setups do not leave stale unverified factors behind.
    }
  }, [supabase]);

  const resetSetupDialog = useCallback(() => {
    setFriendlyName("Authenticator app");
    setVerificationCode("");
    setPendingFactor(null);
    setEnrolling(false);
    setVerifying(false);
  }, []);

  const handleSetupOpenChange = useCallback(async (open: boolean) => {
    if (!open && pendingFactor && !verifying) {
      await cleanupPendingFactor(pendingFactor.id);
      void loadFactors();
      await refreshSecurity();
    }

    if (!open) {
      resetSetupDialog();
    }

    setSetupOpen(open);
  }, [cleanupPendingFactor, loadFactors, pendingFactor, refreshSecurity, resetSetupDialog, verifying]);

  const handleEnroll = async () => {
    setEnrolling(true);
    try {
      await Promise.all(pendingFactors.map((factor) => cleanupPendingFactor(factor.id)));

      const result = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: friendlyName.trim() || "Authenticator app",
        issuer: "NB S3",
      });

      if (result.error || !result.data) {
        throw new Error(result.error?.message || "Failed to start authenticator setup");
      }

      setPendingFactor({
        id: result.data.id,
        qrCodeDataUrl: normalizeTotpQrCodeSource(result.data.totp.qr_code) ?? "",
        secret: result.data.totp.secret,
      });
      setVerificationCode("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start authenticator setup");
    } finally {
      setEnrolling(false);
    }
  };

  const handleGenerateRecoveryCodes = useCallback(async (mode: "initial" | "regenerate") => {
    const response = await fetch("/api/v1/auth/mfa/recovery-codes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode }),
    });
    const contentType = response.headers.get("content-type") || "";
    const json = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok || json?.success === false) {
      throw new Error(json?.message || "Failed to generate recovery codes");
    }

    setRevealedRecoveryCodes({
      codes: Array.isArray(json?.data?.codes) ? json.data.codes : [],
      generatedAt: typeof json?.data?.generatedAt === "string" ? json.data.generatedAt : undefined,
    });
    await refreshSecurity();
  }, [refreshSecurity]);

  const handleVerify = async () => {
    if (!pendingFactor) return;

    const code = verificationCode.trim();
    if (!/^[0-9]{6}$/.test(code)) {
      toast.error("Enter the 6-digit code from your authenticator app");
      return;
    }

    setVerifying(true);
    try {
      const result = await supabase.auth.mfa.challengeAndVerify({
        factorId: pendingFactor.id,
        code,
      });

      if (result.error) {
        throw result.error;
      }

      toast.success("Authenticator app enabled");
      resetSetupDialog();
      setSetupOpen(false);
      await loadFactors();
      await refreshSecurity();

      try {
        await handleGenerateRecoveryCodes("initial");
      } catch (recoveryError) {
        toast.error(
          recoveryError instanceof Error
            ? `Authenticator app enabled, but recovery code generation failed: ${recoveryError.message}`
            : "Authenticator app enabled, but recovery code generation failed. Generate them from Security settings.",
        );
      }
    } catch (error) {
      toast.error(getTotpVerificationErrorMessage(error as Error));
    } finally {
      setVerifying(false);
    }
  };

  const executeProtectedAction = useCallback(async (action: ProtectedAction) => {
    if (!action) return;

    setProtectedActionPending(true);
    try {
      if (action.type === "remove") {
        const res = await fetch(`/api/v1/auth/mfa/factors/${action.factorId}`, {
          method: "DELETE",
        });
        const contentType = res.headers.get("content-type") || "";
        const json = contentType.includes("application/json") ? await res.json() : null;
        if (!res.ok || json?.success === false) {
          throw new Error(json?.message || `Failed to remove MFA factor (${res.status})`);
        }

        setFactors((prev) => prev.filter((factor) => factor.id !== action.factorId));
        toast.success("Authenticator app removed");
      }

      if (action.type === "regenerate-recovery-codes") {
        await handleGenerateRecoveryCodes("regenerate");
        toast.success("Recovery codes regenerated");
      }

      await loadFactors();
      await refreshSecurity();
      setProtectedAction(null);
      setUnenrollId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to complete this security action");
    } finally {
      setProtectedActionPending(false);
    }
  }, [handleGenerateRecoveryCodes, loadFactors, refreshSecurity]);

  const handleCopySecret = async () => {
    if (!pendingFactor) return;

    try {
      await navigator.clipboard.writeText(pendingFactor.secret);
      toast.success("Secret copied");
    } catch {
      toast.error("Could not copy the secret on this device");
    }
  };

  const handleCopyRecoveryCodes = async () => {
    if (!revealedRecoveryCodes) return;
    try {
      await navigator.clipboard.writeText(formatRecoveryCodesForExport(revealedRecoveryCodes.codes));
      toast.success("Recovery codes copied");
    } catch {
      toast.error("Could not copy the recovery codes on this device");
    }
  };

  const handleDownloadRecoveryCodes = () => {
    if (!revealedRecoveryCodes) return;
    const blob = new Blob([formatRecoveryCodesForExport(revealedRecoveryCodes.codes)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "nb-s3-recovery-codes.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrintRecoveryCodes = () => {
    if (!revealedRecoveryCodes) return;
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=720,height=640");
    if (!printWindow) {
      toast.error("Could not open the print dialog on this device");
      return;
    }
    const recoveryCodesText = formatRecoveryCodesForExport(revealedRecoveryCodes.codes);
    const pre = printWindow.document.createElement("pre");
    pre.textContent = recoveryCodesText;
    printWindow.document.body.innerHTML = "";
    printWindow.document.body.appendChild(pre);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading authenticator settings...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {hasVerifiedFactor ? (
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            Enabled
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <Shield className="h-3.5 w-3.5" />
            Not set up
          </div>
        )}
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Add a 6-digit code from an authenticator app for extra protection.
        </p>
      </div>

      {verifiedFactors.length > 0 ? (
        <div className="space-y-2">
          {verifiedFactors.map((factor) => (
            <div
              key={factor.id}
              className="flex items-center justify-between rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
                  <KeyRound className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
                </div>
                <div>
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {factor.friendly_name || "Authenticator app"}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Added {factor.created_at ? new Date(factor.created_at).toLocaleDateString() : "recently"}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${factor.friendly_name || "authenticator app"}`}
                onClick={() => setUnenrollId(factor.id)}
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No authenticator app is set up yet.
        </p>
      )}

      {pendingFactors.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
          A previous authenticator setup was not completed. Starting again will replace the unfinished setup.
        </div>
      ) : null}

      {hasVerifiedFactor ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Recovery codes
              </div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {recoveryCodes?.configured
                  ? `${recoveryCodes.remainingCount} code${recoveryCodes.remainingCount === 1 ? "" : "s"} remaining`
                  : "Generate one-time recovery codes in case you lose access to your authenticator app."}
              </div>
              {recoveryCodes?.generatedAt ? (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Last generated {new Date(recoveryCodes.generatedAt).toLocaleString()}
                </div>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={protectedActionPending}
              onClick={() => {
                if (recoveryCodes?.configured) {
                  setProtectedAction({ type: "regenerate-recovery-codes" });
                  setStepUpOpen(true);
                  return;
                }
                void handleGenerateRecoveryCodes("initial").catch((error) => {
                  toast.error(error instanceof Error ? error.message : "Failed to generate recovery codes");
                });
              }}
            >
              {recoveryCodes?.configured ? "Regenerate recovery codes" : "Generate recovery codes"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400">
          Recovery codes become available after you finish authenticator setup.
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => setSetupOpen(true)}>
          {hasVerifiedFactor ? "Add another authenticator" : "Set up authenticator app"}
        </Button>
      </div>

      <Dialog open={setupOpen} onOpenChange={(open) => { void handleSetupOpenChange(open); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {pendingFactor ? "Verify your authenticator app" : "Set up an authenticator app"}
            </DialogTitle>
            <DialogDescription>
              {pendingFactor
                ? "Scan the QR code or enter the secret manually, then confirm with the 6-digit code from your app."
                : "Add an authenticator app as your main extra layer of protection."}
            </DialogDescription>
          </DialogHeader>

          {!pendingFactor ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mfa-friendly-name">Name</Label>
                <Input
                  id="mfa-friendly-name"
                  value={friendlyName}
                  onChange={(event) => setFriendlyName(event.target.value)}
                  placeholder="Authenticator app"
                  disabled={enrolling}
                />
              </div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                When setup is confirmed, you will receive 10 one-time recovery codes to store safely.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
                <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950/60">
                  {pendingFactor.qrCodeDataUrl ? (
                    <Image
                      src={pendingFactor.qrCodeDataUrl}
                      alt="Authenticator QR code"
                      width={160}
                      height={160}
                      unoptimized
                      className="mx-auto h-40 w-40"
                    />
                  ) : (
                    <div className="flex h-40 w-40 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                      QR code unavailable on this device. Use the manual setup key instead.
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                      Manual setup key
                    </div>
                    <div className="mt-2 break-all font-mono text-sm text-zinc-900 dark:text-zinc-100">
                      {pendingFactor.secret}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      leftIcon={<Copy className="h-3.5 w-3.5" />}
                      onClick={handleCopySecret}
                    >
                      Copy secret
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mfa-verification-code">6-digit code</Label>
                    <Input
                      id="mfa-verification-code"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={verificationCode}
                      onChange={(event) =>
                        setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      placeholder="Enter the current code"
                      disabled={verifying}
                    />
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Use the current 6-digit code from your authenticator app. Codes refresh every 30 seconds.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={enrolling || verifying}
              onClick={() => {
                void handleSetupOpenChange(false);
              }}
            >
              Cancel
            </Button>
            {!pendingFactor ? (
              <Button type="button" onClick={handleEnroll} disabled={enrolling}>
                {enrolling ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Preparing...
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            ) : (
              <Button type="button" onClick={handleVerify} disabled={verifying}>
                {verifying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Confirm setup
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revealedRecoveryCodes} onOpenChange={(open) => { if (!open) setRevealedRecoveryCodes(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Save your recovery codes</DialogTitle>
            <DialogDescription>
              Each code can be used once if you lose access to your authenticator app. Store them somewhere safe now.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 font-mono text-sm dark:border-zinc-800 dark:bg-zinc-950/40 sm:grid-cols-2">
              {(revealedRecoveryCodes?.codes ?? []).map((code) => (
                <div key={code} className="rounded-lg bg-white px-3 py-2 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
                  {code}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" size="sm" leftIcon={<Copy className="h-4 w-4" />} onClick={() => void handleCopyRecoveryCodes()}>
                Copy
              </Button>
              <Button type="button" variant="outline" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={handleDownloadRecoveryCodes}>
                Download .txt
              </Button>
              <Button type="button" variant="outline" size="sm" leftIcon={<Printer className="h-4 w-4" />} onClick={handlePrintRecoveryCodes}>
                Print
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" onClick={() => setRevealedRecoveryCodes(null)}>
              I saved these codes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!unenrollId}
        onOpenChange={(open) => { if (!open) setUnenrollId(null); }}
        title="Remove authenticator app?"
        description="You will need to set up an authenticator app again to re-enable this backup layer."
        confirmLabel="Continue"
        variant="destructive"
        onConfirm={async () => {
          if (!unenrollId) return;
          setProtectedAction({ type: "remove", factorId: unenrollId });
          setStepUpOpen(true);
        }}
      />

      <SecurityStepUpDialog
        open={stepUpOpen}
        onOpenChange={(open) => {
          setStepUpOpen(open);
          if (!open && !protectedActionPending) {
            setProtectedAction(null);
          }
        }}
        title="Verify this device"
        description="Complete one more check before changing authenticator settings."
        availableMethods={protectedMethods}
        factorId={primaryVerifiedFactor?.id}
        onVerified={async () => {
          await executeProtectedAction(protectedAction);
        }}
      />
    </div>
  );
}
