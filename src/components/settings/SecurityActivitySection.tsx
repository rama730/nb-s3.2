"use client";

import { useMemo, useState } from "react";
import Button from "@/components/ui-custom/Button";
import type { SecurityActivityEntry } from "@/lib/types/settingsTypes";

type SecurityActivitySectionProps = {
  activity: SecurityActivityEntry[] | undefined;
};

const DEFAULT_VISIBLE_ITEMS = 6;

function getEventLabel(eventType: SecurityActivityEntry["eventType"]): string {
  switch (eventType) {
    case "authenticator_app_enabled":
      return "Authenticator app enabled";
    case "authenticator_app_removed":
      return "Authenticator app removed";
    case "recovery_codes_generated":
      return "Recovery codes generated";
    case "recovery_codes_regenerated":
      return "Recovery codes regenerated";
    case "recovery_code_used":
      return "Recovery code used";
    case "recovery_code_redemption_failed":
      return "Recovery code redemption attempted";
    case "password_set":
      return "Password added";
    case "password_changed":
      return "Password changed";
    case "other_sessions_revoked":
      return "Other devices logged out";
    default:
      return eventType;
  }
}

function getEventSummary(entry: SecurityActivityEntry): string | null {
  if (entry.eventType === "other_sessions_revoked" && typeof entry.metadata.revokedCount === "number") {
    return `${entry.metadata.revokedCount} session${entry.metadata.revokedCount === 1 ? "" : "s"} revoked`;
  }

  if (
    (entry.eventType === "recovery_codes_generated" || entry.eventType === "recovery_codes_regenerated")
    && typeof entry.metadata.remainingCount === "number"
  ) {
    return `${entry.metadata.remainingCount} recovery codes available`;
  }

  if (entry.eventType === "authenticator_app_removed" && entry.metadata.clearedRecoveryCodes === true) {
    return "Recovery codes were cleared because no authenticator app remains";
  }

  if (entry.eventType === "recovery_code_redemption_failed") {
    const reason = typeof entry.metadata.failureReason === "string"
      ? entry.metadata.failureReason
      : null;
    if (reason === "factor_invalidated") {
      return "Attempt rejected — authenticator app has been replaced";
    }
    if (reason === "code_mismatch") {
      return "Submitted code did not match any active recovery code";
    }
    return "An attempt to redeem a recovery code was rejected";
  }

  return null;
}

export default function SecurityActivitySection({ activity }: SecurityActivitySectionProps) {
  const [showAll, setShowAll] = useState(false);
  const items = useMemo(() => activity ?? [], [activity]);
  const visibleItems = useMemo(
    () => (showAll ? items : items.slice(0, DEFAULT_VISIBLE_ITEMS)),
    [items, showAll],
  );

  if (items.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No security changes have been recorded yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {visibleItems.map((entry) => {
        const summary = getEventSummary(entry);
        return (
          <div
            key={entry.id}
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {getEventLabel(entry.eventType)}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {new Date(entry.createdAt).toLocaleString()}
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              {entry.networkFingerprint ? <span>Network {entry.networkFingerprint}</span> : null}
              {entry.deviceFingerprint ? (
                <>
                  {entry.networkFingerprint ? <span>•</span> : null}
                  <span>Device {entry.deviceFingerprint}</span>
                </>
              ) : null}
            </div>
            {summary ? (
              <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
                {summary}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400">
        Security activity stores pseudonymous network and device fingerprints instead of raw IP addresses or full user-agent strings. These records are removed when you delete your account.
      </div>

      {items.length > DEFAULT_VISIBLE_ITEMS ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? "Show fewer security events" : `Show all ${items.length} security events`}
        </Button>
      ) : null}
    </div>
  );
}
