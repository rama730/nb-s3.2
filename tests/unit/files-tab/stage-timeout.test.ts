// Task 11.2 acceptance test — 5s per-stage timeout warning surface.
//
// **Validates: Req 16.6**
//
// Contract under test:
//
//   When a stage's underlying work (e.g. a hung folder-fetch) does NOT
//   signal completion within 5 seconds, the Files-tab startup machine:
//
//     1. Advances automatically to the next stage (so the UI does not
//        stall on a wedged fetch).
//     2. Emits a non-blocking `console.warn` surface (the design's
//        "console + inline non-blocking warning" indication — here we
//        exercise the console half, which is the part `StartupStageMachine`
//        owns directly).
//     3. Preserves all state already established in earlier stages:
//        subscribers registered during stage "explorer" continue to receive
//        stage-transition notifications across the timeout-driven advance
//        into "main" and beyond. No listener is dropped, no internal state
//        is reset.
//
// Why this file in addition to `startup-stage.test.ts`?
//
//   `startup-stage.test.ts` (Task 2.5) exercises the machine primitives in
//   isolation. This file (Task 11.2) covers the **integration shape**:
//
//     * The task explicitly asks us to "simulate a hung fetch that exceeds
//       5s" and assert auto-advance + warning + no state reset. That's a
//       scenario-level check, not a primitive one.
//     * We also confirm, at the source level, that `FilesTabRoot` actually
//       wires `useFilesTabStartupStage(projectId)` — so the timeout
//       surfaces in the real component tree, not only in the unit machine.
//
// We drive time deterministically with `node:test`'s built-in
// `mock.timers.enable({ apis: ["setTimeout"] })`. This repo does NOT run
// jsdom in unit tests (see the "jsdom is not installed" note in
// `performance-marks.test.ts` and every other `tests/unit/files-tab/*.test.ts`),
// so component-level `render` is out of scope; we drive the machine class
// directly, same as `startup-stage.test.ts`.

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  STAGE_TIMEOUT_MS,
  StartupStageMachine,
  type StartupStage,
} from "@/components/projects/v2/files-tab/hooks/useFilesTabStartupStage";

// ─── Source fixture (integration-shape assertion) ──────────────────

const FILES_TAB_ROOT_SRC = readFileSync(
  path.resolve(
    __dirname,
    "../../../src/components/projects/v2/files-tab/FilesTabRoot.tsx",
  ),
  "utf8",
);

// ─── Scenario: a single hung stage exceeds its 5s deadline ─────────

describe("Stage timeout — hung fetch exceeds 5s (Req 16.6)", () => {
  it("auto-advances past a stage whose work never signals complete", () => {
    // Scenario: we enter stage "explorer" and NEVER call
    // `signalStageComplete("explorer")`. This simulates a hung
    // `loadFolderContent(null, "refresh")` fetch — the kind of stall that
    // Req 16.6 protects against. After 5s elapse, the machine must
    // advance to "main" on its own.
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const warnings: StartupStage[] = [];
      const machine = new StartupStageMachine({
        onWarn: (stage) => warnings.push(stage),
      });

      assert.equal(
        machine.getStage(),
        "explorer",
        "machine must start in 'explorer'",
      );

      // Advance to exactly 5s but never signal complete.
      mock.timers.tick(STAGE_TIMEOUT_MS);

      assert.equal(
        machine.getStage(),
        "main",
        "hung 'explorer' fetch must time out and auto-advance to 'main'",
      );
      assert.deepEqual(
        warnings,
        ["explorer"],
        "the 'explorer' stage timeout must surface exactly one warning",
      );

      machine.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it("surfaces the warning via the injectable callback (non-blocking, no throw)", () => {
    // The warning surface must be non-blocking: if a buggy consumer
    // throws from the warn handler, the stage still advances. This is
    // the "non-blocking" clause of Req 16.6.
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      let warnCallCount = 0;
      const machine = new StartupStageMachine({
        onWarn: () => {
          warnCallCount++;
          throw new Error("consumer bug — must be swallowed by the machine");
        },
      });

      // Hung fetch — let the 5s deadline elapse.
      mock.timers.tick(STAGE_TIMEOUT_MS);

      assert.equal(
        warnCallCount,
        1,
        "warn handler must be invoked exactly once per timeout",
      );
      assert.equal(
        machine.getStage(),
        "main",
        "a throwing warn handler must NOT block stage advancement (Req 16.6 'non-blocking')",
      );

      machine.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it("the default warn surface calls console.warn (no override supplied)", () => {
    // Without the `onWarn` injection, the machine falls back to its
    // built-in `console.warn` surface. We swap out `console.warn` for
    // this test only — isolated via try/finally so the stub never leaks.
    mock.timers.enable({ apis: ["setTimeout"] });
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnCalls.push(args);
    };
    try {
      const machine = new StartupStageMachine();

      mock.timers.tick(STAGE_TIMEOUT_MS);

      assert.equal(
        warnCalls.length,
        1,
        "default surface must call console.warn exactly once on stage timeout",
      );
      // Verify the message body names the stage that timed out and the
      // next stage, so operators reading the console get a clear signal.
      const [firstCallArgs] = warnCalls;
      assert.ok(firstCallArgs !== undefined);
      const message = String(firstCallArgs[0]);
      assert.match(
        message,
        /files-tab/,
        "warning must be scoped to the files-tab surface",
      );
      assert.match(
        message,
        /explorer/,
        "warning must name the stage that timed out",
      );
      assert.match(
        message,
        /main/,
        "warning must name the stage we advanced to",
      );

      machine.dispose();
    } finally {
      console.warn = originalWarn;
      mock.timers.reset();
    }
  });
});

// ─── State preservation across timeout-driven advancement ──────────

describe("Stage timeout — prior-stage state is not reset (Req 16.6)", () => {
  it("subscribers registered in 'explorer' keep receiving notifications after the timeout", () => {
    // This is the "preserve any state already established in previous
    // stages" clause of Req 16.6. In the machine, subscribers stand in
    // for any piece of in-memory state earlier stages built up (explorer
    // boot cache, sidebar tree, etc.). The timeout-driven advance must
    // never clear them.
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const machine = new StartupStageMachine({ onWarn: () => {} });

      // A subscriber "born in 'explorer'" watches the full journey.
      const observedDuringExplorer: StartupStage[] = [];
      machine.subscribe(() =>
        observedDuringExplorer.push(machine.getStage()),
      );
      assert.equal(machine.getStage(), "explorer");

      // Stage 1: hung fetch → timeout → advance to 'main'.
      mock.timers.tick(STAGE_TIMEOUT_MS);
      assert.equal(machine.getStage(), "main");

      // A fresh subscriber added after the timeout starts from "main".
      // It must also continue to receive subsequent transitions.
      const observedAfterTimeout: StartupStage[] = [];
      machine.subscribe(() =>
        observedAfterTimeout.push(machine.getStage()),
      );

      // Stage 2: 'main' also hangs and times out.
      mock.timers.tick(STAGE_TIMEOUT_MS);
      assert.equal(machine.getStage(), "diagnostics");

      assert.deepEqual(
        observedDuringExplorer,
        ["main", "diagnostics"],
        "a subscriber from stage 'explorer' must observe BOTH subsequent transitions — prior-stage state is preserved across timeout advance",
      );
      assert.deepEqual(
        observedAfterTimeout,
        ["diagnostics"],
        "a subscriber added after the first timeout must observe the second transition",
      );

      machine.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it("stage transitions driven by timeout do not re-run subscribers from any reset listener set", () => {
    // Another angle on "no state reset": the listener set must be the
    // *same* set across advancement. If the machine were internally
    // rebuilding itself on timeout (a form of reset), a listener's
    // identity would be swapped out. We verify by identity.
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const machine = new StartupStageMachine({ onWarn: () => {} });

      let firedCount = 0;
      const listener = () => {
        firedCount++;
      };
      const unsubscribe = machine.subscribe(listener);

      // explorer → main (timeout)
      mock.timers.tick(STAGE_TIMEOUT_MS);
      // main → diagnostics (timeout)
      mock.timers.tick(STAGE_TIMEOUT_MS);

      assert.equal(
        firedCount,
        2,
        "the SAME listener instance must fire on every transition — no internal listener set rebuild",
      );

      // And unsubscribe must still work after timeout-driven transitions:
      // if the machine had silently re-registered a fresh listener, our
      // unsubscribe closure would fail to remove it and a further
      // trigger would still fire. No further timers fire from
      // 'diagnostics' (terminal), so we exercise this with a fresh
      // machine ...
      unsubscribe();
      machine.dispose();

      const m2 = new StartupStageMachine({ onWarn: () => {} });
      let l2Fired = 0;
      const off = m2.subscribe(() => {
        l2Fired++;
      });
      off();
      mock.timers.tick(STAGE_TIMEOUT_MS);
      assert.equal(
        l2Fired,
        0,
        "unsubscribed listeners must not fire on subsequent timeout-driven transitions",
      );
      m2.dispose();
    } finally {
      mock.timers.reset();
    }
  });

  it("no new timer is scheduled once 'diagnostics' has been reached via timeout", () => {
    // The terminal-stage contract is part of "prior-stage state
    // preservation": once we reach 'diagnostics', the machine must stay
    // there regardless of further time advancing. Otherwise a long-lived
    // subscriber could spuriously fire after the user has already moved
    // past the Files tab.
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const warnings: StartupStage[] = [];
      const machine = new StartupStageMachine({
        onWarn: (stage) => warnings.push(stage),
      });

      // Time out BOTH non-terminal stages in one go.
      mock.timers.tick(STAGE_TIMEOUT_MS); // explorer → main
      mock.timers.tick(STAGE_TIMEOUT_MS); // main → diagnostics
      assert.equal(machine.getStage(), "diagnostics");
      assert.deepEqual(warnings, ["explorer", "main"]);

      // Run the clock a long way forward. If the terminal stage had a
      // latent timer, we'd either crash, re-advance, or emit a third
      // warning — all of which violate Req 16.6's preservation clause.
      let extraListenerFires = 0;
      machine.subscribe(() => {
        extraListenerFires++;
      });
      mock.timers.tick(STAGE_TIMEOUT_MS * 10);

      assert.equal(
        machine.getStage(),
        "diagnostics",
        "'diagnostics' is terminal — no further auto-advance",
      );
      assert.deepEqual(
        warnings,
        ["explorer", "main"],
        "no additional warning after reaching terminal stage",
      );
      assert.equal(
        extraListenerFires,
        0,
        "no spurious listener notifications at terminal stage",
      );

      machine.dispose();
    } finally {
      mock.timers.reset();
    }
  });
});

// ─── Integration-shape: FilesTabRoot wires the hook ────────────────

describe("Stage timeout — FilesTabRoot integration wiring", () => {
  // Source-level check: the task asks us to "verify integration with
  // FilesTabRoot". Because jsdom is not available in this repo's unit
  // suite (see file-header note above), we confirm the wiring at the
  // source level: FilesTabRoot must import and call
  // `useFilesTabStartupStage(projectId)`, passing the project id
  // through. This is the single point where the timeout surface reaches
  // the component tree, so guarding it at source level prevents
  // silent regression.

  it("imports the hook from the colocated module path", () => {
    assert.match(
      FILES_TAB_ROOT_SRC,
      /import\s*\{\s*useFilesTabStartupStage\s*\}\s*from\s*"\.\/hooks\/useFilesTabStartupStage"/,
      "FilesTabRoot.tsx must import useFilesTabStartupStage from ./hooks/useFilesTabStartupStage",
    );
  });

  it("invokes useFilesTabStartupStage(projectId) exactly once at runtime", () => {
    // Target the `const stage = useFilesTabStartupStage(projectId)`
    // assignment specifically so documentation mentions inside `//` or
    // `/* */` comment blocks don't inflate the count. We want exactly
    // one *runtime* invocation — double-calling would start two timer
    // chains and two console warnings on a hung stage.
    const callRe =
      /const\s+\[\s*stage\s*,\s*signalStageComplete\s*\]\s*=\s*useFilesTabStartupStage\s*\(\s*projectId\s*\)\s*;/g;
    const matches = FILES_TAB_ROOT_SRC.match(callRe) ?? [];
    assert.equal(
      matches.length,
      1,
      `Expected exactly one 'const [stage, signalStageComplete] = useFilesTabStartupStage(projectId);' call site in FilesTabRoot.tsx, found ${matches.length}`,
    );
  });

  it("signals stage completion from the root boot lifecycle", () => {
    assert.match(
      FILES_TAB_ROOT_SRC,
      /signalStageComplete\("explorer"\)/,
      "FilesTabRoot.tsx must complete the explorer startup stage after booting",
    );
    assert.match(
      FILES_TAB_ROOT_SRC,
      /signalStageComplete\("main"\)/,
      "FilesTabRoot.tsx must complete the main startup stage without waiting for timeout",
    );
  });

  it("exposes the current stage on the root element for E2E assertions", () => {
    // FilesTabRoot threads the stage into a `data-startup-stage`
    // attribute on its root element. Playwright specs in Task 12 use
    // this attribute to observe the timeout surface end-to-end. If the
    // attribute is renamed, the timeout warning surface loses its
    // externally observable signal.
    assert.match(
      FILES_TAB_ROOT_SRC,
      /data-startup-stage=\{\s*stage\s*\}/,
      "FilesTabRoot.tsx must bind the startup stage onto data-startup-stage for observability",
    );
  });
});

