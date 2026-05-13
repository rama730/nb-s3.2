// Task 2.5 — unit tests for `useFilesTabStartupStage`.
//
// Covers:
//   * Initial stage === "explorer"
//   * Normal (signalled) progression explorer → main → diagnostics
//   * 5s-timeout auto-advance at each non-terminal stage
//   * Timeout emits a non-blocking warning
//   * Terminal stage "diagnostics" does not schedule further timers
//   * Subscribers added in earlier stages keep receiving notifications
//     across advancement — this is how prior-stage state is "preserved"
//     (no listener teardown on transition; only `dispose` tears down).
//
// We drive time deterministically with `node:test`'s built-in
// `mock.timers.enable({ apis: ["setTimeout"] })` instead of real `await`s.
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import {
  STAGE_TIMEOUT_MS,
  StartupStageMachine,
  type StartupStage,
} from "@/components/projects/v2/files-tab/hooks/useFilesTabStartupStage";

describe("StartupStageMachine", () => {
  it("starts in the 'explorer' stage", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const machine = new StartupStageMachine({ onWarn: () => {} });
      assert.equal(machine.getStage(), "explorer");
      machine.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it("advances 'explorer' → 'main' → 'diagnostics' when each stage is signalled complete", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const warnings: StartupStage[] = [];
      const machine = new StartupStageMachine({
        onWarn: (stage) => warnings.push(stage),
      });

      const observed: StartupStage[] = [];
      machine.subscribe(() => observed.push(machine.getStage()));

      machine.signalStageComplete("explorer");
      assert.equal(machine.getStage(), "main");

      machine.signalStageComplete("main");
      assert.equal(machine.getStage(), "diagnostics");

      assert.deepEqual(observed, ["main", "diagnostics"]);
      assert.deepEqual(warnings, []);
      machine.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it("auto-advances when the 5s timeout elapses and emits a non-blocking warning", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const warnings: StartupStage[] = [];
      const machine = new StartupStageMachine({
        onWarn: (stage) => warnings.push(stage),
      });

      // Just before the deadline — still in the same stage.
      mock.timers.tick(STAGE_TIMEOUT_MS - 1);
      assert.equal(machine.getStage(), "explorer");
      assert.deepEqual(warnings, []);

      // Cross the 5s boundary — auto-advance.
      mock.timers.tick(1);
      assert.equal(machine.getStage(), "main");
      assert.deepEqual(warnings, ["explorer"]);

      // Next stage has its own fresh 5s deadline.
      mock.timers.tick(STAGE_TIMEOUT_MS);
      assert.equal(machine.getStage(), "diagnostics");
      assert.deepEqual(warnings, ["explorer", "main"]);

      machine.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it("does not emit a warning when a stage is signalled complete before its deadline", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const warnings: StartupStage[] = [];
      const machine = new StartupStageMachine({
        onWarn: (stage) => warnings.push(stage),
      });

      mock.timers.tick(1_000);
      machine.signalStageComplete("explorer");
      assert.equal(machine.getStage(), "main");

      // Advancing time past the original 5s boundary must not re-fire the
      // old timer for the already-completed stage.
      mock.timers.tick(STAGE_TIMEOUT_MS);
      assert.equal(machine.getStage(), "diagnostics");
      assert.deepEqual(warnings, ["main"]);
      machine.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it("does not schedule a further timeout after reaching the terminal 'diagnostics' stage", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const warnings: StartupStage[] = [];
      const machine = new StartupStageMachine({
        onWarn: (stage) => warnings.push(stage),
      });

      machine.signalStageComplete("explorer");
      machine.signalStageComplete("main");
      assert.equal(machine.getStage(), "diagnostics");

      const observed: StartupStage[] = [];
      machine.subscribe(() => observed.push(machine.getStage()));

      mock.timers.tick(STAGE_TIMEOUT_MS * 10);
      assert.equal(machine.getStage(), "diagnostics");
      assert.deepEqual(observed, []);
      assert.deepEqual(warnings, []);
      machine.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it("preserves prior-stage subscribers across timeout-driven advancement", () => {
    // A subscriber added during stage "explorer" keeps receiving stage
    // transitions after the 5s timeout fires. Req 16.6 says earlier-stage
    // state must be preserved; listener continuity is the machine-level
    // guarantee that underpins that.
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const machine = new StartupStageMachine({ onWarn: () => {} });
      const events: StartupStage[] = [];
      machine.subscribe(() => events.push(machine.getStage()));

      mock.timers.tick(STAGE_TIMEOUT_MS); // explorer → main (timeout)
      machine.signalStageComplete("main"); // main → diagnostics (normal)

      assert.deepEqual(events, ["main", "diagnostics"]);
      machine.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it("ignores a late signalStageComplete for a stage the machine has already left", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const machine = new StartupStageMachine({ onWarn: () => {} });
      // Timeout advances explorer → main.
      mock.timers.tick(STAGE_TIMEOUT_MS);
      assert.equal(machine.getStage(), "main");

      // A delayed "explorer completed" signal must not skip us backwards
      // or forward.
      machine.signalStageComplete("explorer");
      assert.equal(machine.getStage(), "main");
      machine.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it("dispose() is idempotent and halts pending timers", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const warnings: StartupStage[] = [];
      const machine = new StartupStageMachine({
        onWarn: (stage) => warnings.push(stage),
      });
      machine.dispose();
      machine.dispose(); // second call must not throw

      mock.timers.tick(STAGE_TIMEOUT_MS * 3);
      assert.equal(machine.getStage(), "explorer");
      assert.deepEqual(warnings, []);
    } finally {
      mock.timers.reset();
    }
  });

  it("respects a custom timeoutMs override so tests can drive short windows", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const warnings: StartupStage[] = [];
      const machine = new StartupStageMachine({
        timeoutMs: 50,
        onWarn: (stage) => warnings.push(stage),
      });
      mock.timers.tick(49);
      assert.equal(machine.getStage(), "explorer");
      mock.timers.tick(1);
      assert.equal(machine.getStage(), "main");
      assert.deepEqual(warnings, ["explorer"]);
      machine.dispose();
    } finally {
      mock.timers.reset();
    }
  });
});
