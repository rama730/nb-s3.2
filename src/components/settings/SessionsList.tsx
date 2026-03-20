"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import Button from "@/components/ui-custom/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "sonner";
import { parseUserAgent } from "@/lib/utils/device";
import type { Session } from "@/lib/types/settingsTypes";
import SecurityStepUpDialog from "@/components/settings/SecurityStepUpDialog";

interface SessionsListProps {
  initialSessions?: Session[];
  availableStepUpMethods: Array<"totp" | "recovery_code" | "password">;
  primaryTotpFactorId?: string;
}

type PendingAction =
  | { type: "current"; id: string }
  | { type: "others" }
  | null;

export function SessionsList({
  initialSessions,
  availableStepUpMethods,
  primaryTotpFactorId,
}: SessionsListProps) {
  const hasInitialSessions = Array.isArray(initialSessions);
  const [sessions, setSessions] = useState<Session[]>(initialSessions ?? []);
  const [loading, setLoading] = useState(!hasInitialSessions);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Array.isArray(initialSessions)) {
      setSessions(initialSessions);
      setLoading(false);
    }
  }, [initialSessions]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/sessions");
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        toast.error(`Failed to load sessions (${res.status})`);
        return;
      }
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        toast.error(json?.message || `Failed to load sessions (${res.status})`);
        return;
      }
      setSessions(json?.data?.sessions || []);
    } catch {
      toast.error("Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasInitialSessions) {
      void fetchSessions();
    }
  }, [fetchSessions, hasInitialSessions]);

  const handleLogOutCurrent = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/sessions/${id}`, { method: "DELETE" });
      const contentType = res.headers.get("content-type") || "";
      const json = contentType.includes("application/json") ? await res.json() : null;
      if (!res.ok || json?.success === false) {
        throw new Error(json?.message || `Failed to log out this device (${res.status})`);
      }

      window.location.assign("/login");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to log out this device");
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  };

  const handleLogOutOthers = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/sessions/others", { method: "DELETE" });
      const contentType = res.headers.get("content-type") || "";
      const json = contentType.includes("application/json") ? await res.json() : null;
      if (!res.ok || json?.success === false) {
        throw new Error(json?.message || `Failed to log out other devices (${res.status})`);
      }

      setSessions((prev) => prev.filter((session) => session.is_current));
      toast.success("Other devices were logged out");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to log out other devices");
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  };

  const hasOtherSessions = useMemo(
    () => sessions.some((session) => !session.is_current),
    [sessions],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading active sessions...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {hasOtherSessions ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (availableStepUpMethods.length > 0) {
                setPendingAction({ type: "others" });
                setStepUpOpen(true);
                return;
              }
              void handleLogOutOthers();
            }}
          >
            {busy && pendingAction?.type === "others" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Logging out...
              </>
            ) : (
              "Log out other devices"
            )}
          </Button>
        ) : null}
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No active sessions found.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((session) => {
            const { browser, os, icon: Icon } = parseUserAgent(session.device_info.userAgent);

            return (
              <div
                key={session.id}
                className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
                    <Icon className="h-5 w-5 text-zinc-600 dark:text-zinc-300" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {browser} on {os}
                      </span>
                      {session.is_current ? (
                        <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          This device
                        </span>
                      ) : null}
                      {session.aal === "aal2" ? (
                        <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                          MFA verified
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <span>{session.ip_address || "IP unavailable"}</span>
                      {session.created_at ? (
                        <>
                          <span>•</span>
                          <span>Signed in {new Date(session.created_at).toLocaleString()}</span>
                        </>
                      ) : null}
                      <span>•</span>
                      <span>Last active {new Date(session.last_active).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {session.is_current ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Log out this device"
                    disabled={busy}
                    onClick={() => setPendingAction({ type: "current", id: session.id })}
                  >
                    <LogOut className="h-4 w-4 text-red-500" />
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={pendingAction?.type === "current"}
        onOpenChange={(open) => { if (!open) setPendingAction(null); }}
        title="Log out this device?"
        description="You will need to sign in again on this device."
        confirmLabel="Log out"
        variant="destructive"
        onConfirm={() => {
          if (pendingAction?.type === "current") {
            void handleLogOutCurrent(pendingAction.id);
          }
        }}
      />

      <SecurityStepUpDialog
        open={stepUpOpen}
        onOpenChange={setStepUpOpen}
        title="Verify this device"
        description="Complete one more check before logging out other devices."
        availableMethods={availableStepUpMethods}
        factorId={primaryTotpFactorId}
        onVerified={async () => {
          await handleLogOutOthers();
        }}
      />
    </div>
  );
}
