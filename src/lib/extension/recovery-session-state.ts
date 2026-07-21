export const RECOVERY_SESSION_HEARTBEAT_MS = 45_000;
export const RECOVERY_SESSION_STALE_MS = 3 * 60_000;

export type RecoveryIncidentReason = "unclean_shutdown" | "session_stale";

export function recoveryIncidentReason(input: {
  draftSessionId: string;
  currentSessionId?: string | null;
  sessionStatus?: "active" | "clean" | "interrupted" | "resolved" | null;
  lastHeartbeatAt?: Date | null;
  nowMs?: number;
}): RecoveryIncidentReason | null {
  if (input.currentSessionId && input.draftSessionId === input.currentSessionId) return null;
  if (input.sessionStatus === "interrupted") return "unclean_shutdown";
  if (input.sessionStatus !== "active" || !input.lastHeartbeatAt) return null;
  const nowMs = input.nowMs ?? Date.now();
  return input.lastHeartbeatAt.getTime() <= nowMs - RECOVERY_SESSION_STALE_MS
    ? "session_stale"
    : null;
}
