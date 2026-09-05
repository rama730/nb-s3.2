"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { SecurityActivityEntry } from "@/lib/types/settingsTypes";
import { SecurityListRow } from "@/components/settings/ui/SecurityListRow";
import { formatDateTime } from "@/lib/ui/date-formatting";

type SecurityActivitySectionProps = {
  activity: SecurityActivityEntry[] | undefined;
};

const DEFAULT_VISIBLE_ITEMS = 6;

const EVENT_LABELS: Record<SecurityActivityEntry["eventType"], string> = {
  authenticator_app_enabled: "Authenticator app enabled",
  authenticator_app_removed: "Authenticator app removed",
  recovery_codes_generated: "Recovery codes generated",
  recovery_codes_regenerated: "Recovery codes regenerated",
  recovery_code_used: "Recovery code used",
  recovery_code_redemption_failed: "Recovery code redemption attempted",
  password_set: "Password added",
  password_changed: "Password changed",
  other_sessions_revoked: "Other devices logged out",
  github_account_replacement_started: "GitHub account replacement started",
  github_account_replaced: "GitHub account replaced",
};

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
  const items = activity ?? [];
  const visibleItems = showAll ? items : items.slice(0, DEFAULT_VISIBLE_ITEMS);

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
        return <SecurityListRow
            key={entry.id}
            title={EVENT_LABELS[entry.eventType]}
            meta={formatDateTime(entry.createdAt)}
            details={<>
              {entry.networkFingerprint ? <span>Network {entry.networkFingerprint}</span> : null}
              {entry.deviceFingerprint ? (
                <>
                  {entry.networkFingerprint ? <span>•</span> : null}
                  <span>Device {entry.deviceFingerprint}</span>
                </>
              ) : null}
            </>}
            summary={summary}
          />;
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
