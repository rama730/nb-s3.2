// Task 11.1 acceptance test — `files-tab` performance marks.
//
// **Validates: Req 16.5**
//
// Contract under test:
//   * `FilesTabSidebar` emits `performance.mark("files-tab:sidebar-interactive")`
//     on first paint when the sidebar is NOT collapsed.
//   * `BreadcrumbBar` emits `performance.mark("files-tab:breadcrumb-interactive")`
//     on first paint.
//   * Both marks MUST be guarded by `typeof performance !== "undefined"` so
//     the instrumentation stays SSR- and test-environment-safe.
//   * The mark emission MUST live inside a `useEffect` so it runs exactly
//     once on mount (and not on every render).
//   * The marks MUST be idempotent across re-renders — a `useRef` guard is
//     the canonical pattern used across this codebase.
//
// ─── Test-strategy note (jsdom absence) ─────────────────────────────
//
// This repository intentionally does NOT run jsdom in unit tests (see the
// "jsdom is not installed in this repo" note that recurs in every
// `tests/unit/files-tab/*.test.ts` file — for example `sidebar.test.ts`,
// `files-tab-main.test.ts`, and `file-view.test.ts` all substitute a
// source-level text contract for JSX-rendering assertions).
//
// Following the same pattern, this task converts the design-document's
// "render a 1000-node fixture, stub `performance.now()`, assert
// sidebar-interactive ≤ 500ms and breadcrumb-interactive ≤ 750ms" plan into
// a **source-level contract** that is cheap, deterministic, and CI-stable:
//
//   1. Grep the two source files for the exact `performance.mark(...)`
//      call with the exact literal mark name required by Req 16.5.
//   2. Assert the mark emission is wrapped in the prescribed
//      `typeof performance !== "undefined"` guard.
//   3. Assert the emission lives inside a `useEffect` and is gated by a
//      `useRef` idempotency flag so re-renders cannot double-emit.
//
// The actual timing-budget assertions (sidebar-interactive ≤ 500ms,
// breadcrumb-interactive ≤ 750ms) are deferred to the E2E suite in
// Task 12 (`tests/e2e/files-tab/`), which runs against a real browser
// timeline where `performance.mark` and `performance.measure` produce
// meaningful values. That is the correct home for budget assertions
// because any jsdom-simulated `performance.now()` would measure only the
// stub driver, not the instrumentation itself — rendering the assertion
// vacuous.
//
// This test is the authoritative unit-level guard that the *marks themselves*
// are present, correctly named, guarded, and idempotent. If either source
// file drops or renames a mark the build fails here with a specific error
// pointing at the missing contract, exactly as Task 11.1 requires.
//
// Requirements: Req 16.5.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// ─── Source fixtures ────────────────────────────────────────────────

const SIDEBAR_SRC = readFileSync(
  path.resolve(
    __dirname,
    "../../../src/components/projects/v2/files-tab/FilesTabSidebar.tsx",
  ),
  "utf8",
);

const BREADCRUMB_SRC = readFileSync(
  path.resolve(
    __dirname,
    "../../../src/components/projects/v2/files-tab/breadcrumb/BreadcrumbBar.tsx",
  ),
  "utf8",
);

// Exact literal mark names required by Req 16.5 / Task 11.1.
const SIDEBAR_MARK = "files-tab:sidebar-interactive";
const BREADCRUMB_MARK = "files-tab:breadcrumb-interactive";

// ─── FilesTabSidebar contract ───────────────────────────────────────

describe("FilesTabSidebar — performance.mark('files-tab:sidebar-interactive') (Req 16.5)", () => {
  it("emits the exact mark name required by Req 16.5", () => {
    // The literal string is intentionally checked verbatim; any drift in
    // the mark name would silently break downstream performance dashboards
    // and the E2E budget assertion in Task 12.
    assert.ok(
      SIDEBAR_SRC.includes(`performance.mark("${SIDEBAR_MARK}")`),
      `FilesTabSidebar.tsx must contain performance.mark("${SIDEBAR_MARK}")`,
    );
  });

  it("guards the mark with `typeof performance !== \"undefined\"` (SSR-safety)", () => {
    // The guard is REQUIRED by Task 11.1 so the instrumentation cannot
    // crash in SSR / non-DOM test environments where `performance` may be
    // absent.
    assert.match(
      SIDEBAR_SRC,
      /typeof\s+performance\s*!==\s*"undefined"/,
      "FilesTabSidebar.tsx must guard performance.mark with a typeof check",
    );
  });

  it("only emits the mark when the sidebar is not collapsed", () => {
    // Task 11.1 note: "Add it only when the sidebar is not collapsed."
    // The effect checks `sidebarCollapsed` and returns early when true.
    assert.match(
      SIDEBAR_SRC,
      /if\s*\(\s*sidebarCollapsed\s*\)\s*return\s*;/,
      "FilesTabSidebar.tsx must early-return from the mark effect when sidebarCollapsed is true",
    );
  });

  it("wraps the mark in a useEffect with a ref-based idempotency guard", () => {
    // The ref pattern (`sidebarInteractiveMarkedRef.current`) keeps the
    // mark single-shot across re-renders — a critical property for any
    // User Timing entry that represents "first interactive".
    assert.match(
      SIDEBAR_SRC,
      /sidebarInteractiveMarkedRef/,
      "FilesTabSidebar.tsx must gate the mark with a ref-based idempotency flag",
    );
    assert.match(
      SIDEBAR_SRC,
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?performance\.mark\("files-tab:sidebar-interactive"\)/,
      "FilesTabSidebar.tsx must emit the mark from inside a useEffect",
    );
  });

  it("marks the ref as consumed after emitting", () => {
    // Completes the idempotency contract: after the first mark, the ref
    // flips to `true` so subsequent effect runs short-circuit.
    assert.match(
      SIDEBAR_SRC,
      /sidebarInteractiveMarkedRef\.current\s*=\s*true/,
      "FilesTabSidebar.tsx must set the idempotency ref to true after marking",
    );
  });
});

// ─── BreadcrumbBar contract ─────────────────────────────────────────

describe("BreadcrumbBar — performance.mark('files-tab:breadcrumb-interactive') (Req 16.5)", () => {
  it("emits the exact mark name required by Req 16.5", () => {
    assert.ok(
      BREADCRUMB_SRC.includes(`performance.mark("${BREADCRUMB_MARK}")`),
      `BreadcrumbBar.tsx must contain performance.mark("${BREADCRUMB_MARK}")`,
    );
  });

  it("guards the mark with `typeof performance !== \"undefined\"` (SSR-safety)", () => {
    assert.match(
      BREADCRUMB_SRC,
      /typeof\s+performance\s*!==\s*"undefined"/,
      "BreadcrumbBar.tsx must guard performance.mark with a typeof check",
    );
  });

  it("wraps the mark in a useEffect with a ref-based idempotency guard", () => {
    assert.match(
      BREADCRUMB_SRC,
      /breadcrumbInteractiveMarkedRef/,
      "BreadcrumbBar.tsx must gate the mark with a ref-based idempotency flag",
    );
    assert.match(
      BREADCRUMB_SRC,
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?performance\.mark\("files-tab:breadcrumb-interactive"\)/,
      "BreadcrumbBar.tsx must emit the mark from inside a useEffect",
    );
  });

  it("marks the ref as consumed after emitting", () => {
    assert.match(
      BREADCRUMB_SRC,
      /breadcrumbInteractiveMarkedRef\.current\s*=\s*true/,
      "BreadcrumbBar.tsx must set the idempotency ref to true after marking",
    );
  });
});

// ─── Cross-file contract ────────────────────────────────────────────

describe("performance marks — cross-file invariants", () => {
  it("each mark name appears exactly once in its source file (no accidental duplication)", () => {
    const sidebarOccurrences = (
      SIDEBAR_SRC.match(new RegExp(`performance\\.mark\\("${SIDEBAR_MARK}"\\)`, "g")) ?? []
    ).length;
    const breadcrumbOccurrences = (
      BREADCRUMB_SRC.match(
        new RegExp(`performance\\.mark\\("${BREADCRUMB_MARK}"\\)`, "g"),
      ) ?? []
    ).length;
    assert.equal(
      sidebarOccurrences,
      1,
      `Expected exactly one performance.mark("${SIDEBAR_MARK}") call in FilesTabSidebar.tsx, found ${sidebarOccurrences}`,
    );
    assert.equal(
      breadcrumbOccurrences,
      1,
      `Expected exactly one performance.mark("${BREADCRUMB_MARK}") call in BreadcrumbBar.tsx, found ${breadcrumbOccurrences}`,
    );
  });

  it("the sidebar mark name does NOT leak into the breadcrumb file and vice versa", () => {
    assert.ok(
      !BREADCRUMB_SRC.includes(SIDEBAR_MARK),
      "BreadcrumbBar.tsx must not reference the sidebar mark name",
    );
    assert.ok(
      !SIDEBAR_SRC.includes(BREADCRUMB_MARK),
      "FilesTabSidebar.tsx must not reference the breadcrumb mark name",
    );
  });
});
