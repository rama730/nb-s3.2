import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RECOVERY_SESSION_STALE_MS,
  recoveryIncidentReason,
} from "../../src/lib/extension/recovery-session-state";

describe("extension recovery session incident classification", () => {
  const nowMs = Date.parse("2026-07-02T05:00:00.000Z");

  it("never exposes the current active session", () => {
    assert.equal(recoveryIncidentReason({
      draftSessionId: "session-current",
      currentSessionId: "session-current",
      sessionStatus: "interrupted",
      lastHeartbeatAt: new Date(nowMs - RECOVERY_SESSION_STALE_MS * 2),
      nowMs,
    }), null);
  });

  it("exposes a confirmed interrupted previous session", () => {
    assert.equal(recoveryIncidentReason({
      draftSessionId: "session-old",
      currentSessionId: "session-current",
      sessionStatus: "interrupted",
      nowMs,
    }), "unclean_shutdown");
  });

  it("exposes only stale non-current active sessions", () => {
    assert.equal(recoveryIncidentReason({
      draftSessionId: "session-stale",
      currentSessionId: "session-current",
      sessionStatus: "active",
      lastHeartbeatAt: new Date(nowMs - RECOVERY_SESSION_STALE_MS - 1),
      nowMs,
    }), "session_stale");
    assert.equal(recoveryIncidentReason({
      draftSessionId: "session-fresh",
      currentSessionId: "session-current",
      sessionStatus: "active",
      lastHeartbeatAt: new Date(nowMs - RECOVERY_SESSION_STALE_MS + 1),
      nowMs,
    }), null);
  });

  it("keeps clean, resolved, and unclassified legacy sessions hidden", () => {
    for (const sessionStatus of ["clean", "resolved", null] as const) {
      assert.equal(recoveryIncidentReason({
        draftSessionId: `session-${sessionStatus ?? "legacy"}`,
        currentSessionId: "session-current",
        sessionStatus,
        lastHeartbeatAt: new Date(0),
        nowMs,
      }), null);
    }
  });
});
