// Task 2.5 — `useFilesTabStartupStage(projectId)`
//
// Drives the three-stage Files-tab mount sequence per design.md § Startup
// Staging and Req 16.4 + 16.6:
//
//   "explorer"  ──(normal complete | 5s timeout)──▶ "main"
//   "main"      ──(normal complete | 5s timeout)──▶ "diagnostics"
//   "diagnostics" (terminal — no further timer)
//
// Rules:
//   * Each non-terminal stage starts a fresh 5000ms timer.
//   * If the timer fires before the stage is signalled complete, the hook
//     (a) advances to the next stage, (b) emits a non-blocking
//     `console.warn`, and (c) preserves every bit of state that earlier
//     stages produced (the machine never mutates app state — advancement is
//     strictly the `stage` enum changing).
//   * If a stage is signalled complete early via `signalStageComplete`, we
//     advance WITHOUT emitting a warning and WITHOUT touching prior state.
//
// The hook is intentionally split into two surfaces:
//   * `StartupStageMachine` — a pure, React-agnostic state machine exposing
//     `getStage`, `subscribe`, `signalStageComplete`, `dispose`. Unit tests
//     drive it directly with `node:test`'s MockTimers, which is cleaner than
//     standing up a React renderer just to assert timer semantics.
//   * `useFilesTabStartupStage` — a thin React hook that owns the machine's
//     lifetime and bridges it into React via `useState` + `useEffect`.
//
// See also Task 11.2, which verifies this hook's integration with
// `FilesTabRoot` at the component level (tests/unit/files-tab/stage-timeout).
"use client";

import { useCallback, useEffect, useState } from "react";

export type StartupStage = "explorer" | "main" | "diagnostics";

/** Per-stage timeout ceiling, in milliseconds (Req 16.6). */
export const STAGE_TIMEOUT_MS = 5_000;

export interface StartupStageMachineOptions {
  /**
   * Override the per-stage timeout. Tests pass a small value or use Node's
   * `mock.timers` to drive time deterministically; production code uses the
   * default (5000ms).
   */
  timeoutMs?: number;
  /**
   * Callback fired when a stage auto-advances because its 5s timer elapsed.
   * Default emits a non-blocking `console.warn`. Injectable so tests can
   * observe warnings without asserting on `console`.
   */
  onWarn?: (timedOutStage: StartupStage) => void;
}

type Listener = () => void;

/** Pure state machine behind {@link useFilesTabStartupStage}. */
export class StartupStageMachine {
  private currentStage: StartupStage = "explorer";
  private readonly listeners = new Set<Listener>();
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly timeoutMs: number;
  private readonly onWarn: (timedOutStage: StartupStage) => void;

  constructor(options: StartupStageMachineOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? STAGE_TIMEOUT_MS;
    this.onWarn = options.onWarn ?? defaultOnTimeoutWarn;
    this.scheduleTimeout();
  }

  getStage(): StartupStage {
    return this.currentStage;
  }

  /**
   * Subscribe to stage changes. Returns an unsubscribe function. Listeners
   * added at any point continue to observe future transitions — this is how
   * Req 16.6 "preserve any state already established in previous stages" is
   * satisfied: we never clear listeners or reset state across stage
   * advancement. Only {@link dispose} tears down the machine.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Signal that the named stage's work completed normally (no warning).
   * No-op if the machine has already moved past that stage or is disposed.
   */
  signalStageComplete(stage: StartupStage): void {
    if (this.disposed) return;
    if (this.currentStage !== stage) return;
    this.advance({ timedOut: false });
  }

  /** Tear down pending timers and drop subscribers. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimeout();
    this.listeners.clear();
  }

  private scheduleTimeout(): void {
    if (this.disposed) return;
    if (this.currentStage === "diagnostics") return; // terminal: no timer
    this.clearTimeout();
    const stageAtSchedule = this.currentStage;
    this.timeoutHandle = setTimeout(() => {
      this.timeoutHandle = null;
      if (this.disposed) return;
      // Guard against a signalStageComplete race that already advanced us.
      if (this.currentStage !== stageAtSchedule) return;
      this.advance({ timedOut: true });
    }, this.timeoutMs);
  }

  private clearTimeout(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  private advance(params: { timedOut: boolean }): void {
    const previous = this.currentStage;
    const next = nextStage(previous);
    if (next === previous) {
      // Already terminal — nothing to do.
      this.clearTimeout();
      return;
    }
    if (params.timedOut) {
      // Fire the warning BEFORE state mutation so observers that read the
      // stage during the warn callback still see the stage that timed out.
      try {
        this.onWarn(previous);
      } catch {
        // Warning must be non-blocking (Req 16.6). Swallow listener errors.
      }
    }
    this.currentStage = next;
    this.scheduleTimeout();
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Same non-blocking rationale: a buggy subscriber must not stop
        // other subscribers from receiving the notification.
      }
    }
  }
}

function nextStage(stage: StartupStage): StartupStage {
  switch (stage) {
    case "explorer":
      return "main";
    case "main":
      return "diagnostics";
    case "diagnostics":
      return "diagnostics";
  }
}

function defaultOnTimeoutWarn(timedOutStage: StartupStage): void {
  // Non-blocking, dev-visible, production-visible. Matches the design's
  // "non-blocking console warning" contract and does not throw.
  console.warn(
    `[files-tab] startup stage "${timedOutStage}" did not complete within ` +
      `${STAGE_TIMEOUT_MS}ms; auto-advancing to "${nextStage(timedOutStage)}". ` +
      "Prior-stage state is preserved.",
  );
}

/**
 * React hook exposing the current startup stage for a given project. The
 * machine is re-created whenever `projectId` changes so a tab switch between
 * two projects gets a fresh staged boot.
 */
export function useFilesTabStartupStage(projectId: string): [StartupStage, (s: StartupStage) => void] {
  const [machine, setMachine] = useState<StartupStageMachine | null>(null);
  const [stage, setStage] = useState<StartupStage>("explorer");

  useEffect(() => {
    const nextMachine = new StartupStageMachine();
    setMachine(nextMachine);
    setStage(nextMachine.getStage());
    const unsubscribe = nextMachine.subscribe(() => {
      setStage(nextMachine.getStage());
    });
    return () => {
      unsubscribe();
      nextMachine.dispose();
    };
  }, [projectId]);

  const signalStageComplete = useCallback((s: StartupStage) => {
    machine?.signalStageComplete(s);
  }, [machine]);

  return [stage, signalStageComplete];
}
