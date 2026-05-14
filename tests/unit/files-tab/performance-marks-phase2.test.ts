// Task 9.4 acceptance test — Phase 2 `files-tab` performance marks.
//
// **Validates: Req 17.1, 17.2, 17.3**
//
// Contract under test:
//   * `LinkedTasksPanel` emits `performance.mark("files-tab:linked-tasks-panel-interactive")`
//     on first interactive state (when loading completes).
//   * `FileVersionHistoryPanel` emits `performance.mark("files-tab:version-history-interactive")`
//     on first interactive state (when loading completes).
//   * `V3AttachmentPicker` emits `performance.mark("files-tab:picker-interactive")`
//     on first interactive state (when picker is open).
//   * All marks MUST be guarded by `typeof performance !== "undefined"` so
//     the instrumentation stays SSR- and test-environment-safe.
//   * The mark emission MUST live inside a `useEffect` so it runs exactly
//     once on mount (and not on every render).
//   * The marks MUST be idempotent across re-renders — a `useRef` guard is
//     the canonical pattern used across this codebase.
//
// ─── Test-strategy note (jsdom absence) ─────────────────────────────
//
// Following the same source-level contract pattern as
// `performance-marks.test.ts` (Task 11.1), this test verifies the marks
// are present, correctly named, guarded, and idempotent by reading the
// source files directly. Timing-budget assertions are deferred to E2E.
//
// Requirements: Req 17.1, 17.2, 17.3.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// ─── Source fixtures ────────────────────────────────────────────────

const LINKED_TASKS_PANEL_SRC = readFileSync(
  path.resolve(
    __dirname,
    "../../../src/components/projects/v2/files-tab/file/LinkedTasksPanel.tsx",
  ),
  "utf8",
);

const FILE_VERSION_HISTORY_PANEL_SRC = readFileSync(
  path.resolve(
    __dirname,
    "../../../src/components/projects/v2/files-tab/file/FileVersionHistoryPanel.tsx",
  ),
  "utf8",
);

const V3_ATTACHMENT_PICKER_SRC = readFileSync(
  path.resolve(
    __dirname,
    "../../../src/components/projects/v2/files-tab/picker/V3AttachmentPicker.tsx",
  ),
  "utf8",
);

// Exact literal mark names required by Req 17.
const LINKED_TASKS_MARK = "files-tab:linked-tasks-panel-interactive";
const VERSION_HISTORY_MARK = "files-tab:version-history-interactive";
const PICKER_MARK = "files-tab:picker-interactive";

// ─── LinkedTasksPanel contract (Req 17.1) ───────────────────────────

describe("LinkedTasksPanel — performance.mark('files-tab:linked-tasks-panel-interactive') (Req 17.1)", () => {
  it("emits the exact mark name required by Req 17.1", () => {
    assert.ok(
      LINKED_TASKS_PANEL_SRC.includes(`performance.mark("${LINKED_TASKS_MARK}")`),
      `LinkedTasksPanel.tsx must contain performance.mark("${LINKED_TASKS_MARK}")`,
    );
  });

  it("guards the mark with `typeof performance !== \"undefined\"` (SSR-safety)", () => {
    assert.match(
      LINKED_TASKS_PANEL_SRC,
      /typeof\s+performance\s*(!==|===)\s*"undefined"/,
      "LinkedTasksPanel.tsx must guard performance.mark with a typeof check",
    );
  });

  it("wraps the mark in a useEffect with a ref-based idempotency guard", () => {
    assert.match(
      LINKED_TASKS_PANEL_SRC,
      /perfMarkedRef/,
      "LinkedTasksPanel.tsx must gate the mark with a ref-based idempotency flag",
    );
    assert.match(
      LINKED_TASKS_PANEL_SRC,
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?performance\.mark\("files-tab:linked-tasks-panel-interactive"\)/,
      "LinkedTasksPanel.tsx must emit the mark from inside a useEffect",
    );
  });

  it("marks the ref as consumed after emitting", () => {
    assert.match(
      LINKED_TASKS_PANEL_SRC,
      /perfMarkedRef\.current\s*=\s*true/,
      "LinkedTasksPanel.tsx must set the idempotency ref to true after marking",
    );
  });

  it("only emits the mark when loading is complete", () => {
    assert.match(
      LINKED_TASKS_PANEL_SRC,
      /if\s*\(\s*isLoading\s*\)\s*return/,
      "LinkedTasksPanel.tsx must early-return from the mark effect when isLoading is true",
    );
  });
});

// ─── FileVersionHistoryPanel contract (Req 17.2) ────────────────────

describe("FileVersionHistoryPanel — performance.mark('files-tab:version-history-interactive') (Req 17.2)", () => {
  it("emits the exact mark name required by Req 17.2", () => {
    assert.ok(
      FILE_VERSION_HISTORY_PANEL_SRC.includes(`performance.mark("${VERSION_HISTORY_MARK}")`),
      `FileVersionHistoryPanel.tsx must contain performance.mark("${VERSION_HISTORY_MARK}")`,
    );
  });

  it("guards the mark with `typeof performance !== \"undefined\"` (SSR-safety)", () => {
    assert.match(
      FILE_VERSION_HISTORY_PANEL_SRC,
      /typeof\s+performance\s*(!==|===)\s*"undefined"/,
      "FileVersionHistoryPanel.tsx must guard performance.mark with a typeof check",
    );
  });

  it("wraps the mark in a useEffect with a ref-based idempotency guard", () => {
    assert.match(
      FILE_VERSION_HISTORY_PANEL_SRC,
      /perfMarkedRef/,
      "FileVersionHistoryPanel.tsx must gate the mark with a ref-based idempotency flag",
    );
    assert.match(
      FILE_VERSION_HISTORY_PANEL_SRC,
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?performance\.mark\("files-tab:version-history-interactive"\)/,
      "FileVersionHistoryPanel.tsx must emit the mark from inside a useEffect",
    );
  });

  it("marks the ref as consumed after emitting", () => {
    assert.match(
      FILE_VERSION_HISTORY_PANEL_SRC,
      /perfMarkedRef\.current\s*=\s*true/,
      "FileVersionHistoryPanel.tsx must set the idempotency ref to true after marking",
    );
  });

  it("only emits the mark when loading is complete", () => {
    assert.match(
      FILE_VERSION_HISTORY_PANEL_SRC,
      /if\s*\(\s*isLoading\s*\)\s*return/,
      "FileVersionHistoryPanel.tsx must early-return from the mark effect when isLoading is true",
    );
  });
});

// ─── V3AttachmentPicker contract (Req 17.3) ─────────────────────────

describe("V3AttachmentPicker — performance.mark('files-tab:picker-interactive') (Req 17.3)", () => {
  it("emits the exact mark name required by Req 17.3", () => {
    assert.ok(
      V3_ATTACHMENT_PICKER_SRC.includes(`performance.mark("${PICKER_MARK}")`),
      `V3AttachmentPicker.tsx must contain performance.mark("${PICKER_MARK}")`,
    );
  });

  it("guards the mark with `typeof performance !== \"undefined\"` (SSR-safety)", () => {
    assert.match(
      V3_ATTACHMENT_PICKER_SRC,
      /typeof\s+performance\s*(!==|===)\s*"undefined"/,
      "V3AttachmentPicker.tsx must guard performance.mark with a typeof check",
    );
  });

  it("wraps the mark in a useEffect with a ref-based idempotency guard", () => {
    assert.match(
      V3_ATTACHMENT_PICKER_SRC,
      /perfMarkedRef/,
      "V3AttachmentPicker.tsx must gate the mark with a ref-based idempotency flag",
    );
    assert.match(
      V3_ATTACHMENT_PICKER_SRC,
      /useEffect\(\(\)\s*=>\s*\{[\s\S]*?performance\.mark\("files-tab:picker-interactive"\)/,
      "V3AttachmentPicker.tsx must emit the mark from inside a useEffect",
    );
  });

  it("marks the ref as consumed after emitting", () => {
    assert.match(
      V3_ATTACHMENT_PICKER_SRC,
      /perfMarkedRef\.current\s*=\s*true/,
      "V3AttachmentPicker.tsx must set the idempotency ref to true after marking",
    );
  });

  it("only emits the mark when the picker is open", () => {
    assert.match(
      V3_ATTACHMENT_PICKER_SRC,
      /if\s*\(\s*!isOpen\s*\)\s*return/,
      "V3AttachmentPicker.tsx must early-return from the mark effect when isOpen is false",
    );
  });
});

// ─── Cross-file contract ────────────────────────────────────────────

describe("Phase 2 performance marks — cross-file invariants", () => {
  it("each mark name appears exactly once in its source file (no accidental duplication)", () => {
    const linkedTasksOccurrences = (
      LINKED_TASKS_PANEL_SRC.match(
        new RegExp(`performance\\.mark\\("${LINKED_TASKS_MARK}"\\)`, "g"),
      ) ?? []
    ).length;
    const versionHistoryOccurrences = (
      FILE_VERSION_HISTORY_PANEL_SRC.match(
        new RegExp(`performance\\.mark\\("${VERSION_HISTORY_MARK}"\\)`, "g"),
      ) ?? []
    ).length;
    const pickerOccurrences = (
      V3_ATTACHMENT_PICKER_SRC.match(
        new RegExp(`performance\\.mark\\("${PICKER_MARK}"\\)`, "g"),
      ) ?? []
    ).length;

    assert.equal(
      linkedTasksOccurrences,
      1,
      `Expected exactly one performance.mark("${LINKED_TASKS_MARK}") call in LinkedTasksPanel.tsx, found ${linkedTasksOccurrences}`,
    );
    assert.equal(
      versionHistoryOccurrences,
      1,
      `Expected exactly one performance.mark("${VERSION_HISTORY_MARK}") call in FileVersionHistoryPanel.tsx, found ${versionHistoryOccurrences}`,
    );
    assert.equal(
      pickerOccurrences,
      1,
      `Expected exactly one performance.mark("${PICKER_MARK}") call in V3AttachmentPicker.tsx, found ${pickerOccurrences}`,
    );
  });

  it("no mark name leaks into another component's source file", () => {
    // LinkedTasksPanel mark should not appear in the other two files
    assert.ok(
      !FILE_VERSION_HISTORY_PANEL_SRC.includes(LINKED_TASKS_MARK),
      "FileVersionHistoryPanel.tsx must not reference the linked-tasks-panel mark name",
    );
    assert.ok(
      !V3_ATTACHMENT_PICKER_SRC.includes(LINKED_TASKS_MARK),
      "V3AttachmentPicker.tsx must not reference the linked-tasks-panel mark name",
    );

    // Version history mark should not appear in the other two files
    assert.ok(
      !LINKED_TASKS_PANEL_SRC.includes(VERSION_HISTORY_MARK),
      "LinkedTasksPanel.tsx must not reference the version-history mark name",
    );
    assert.ok(
      !V3_ATTACHMENT_PICKER_SRC.includes(VERSION_HISTORY_MARK),
      "V3AttachmentPicker.tsx must not reference the version-history mark name",
    );

    // Picker mark should not appear in the other two files
    assert.ok(
      !LINKED_TASKS_PANEL_SRC.includes(PICKER_MARK),
      "LinkedTasksPanel.tsx must not reference the picker mark name",
    );
    assert.ok(
      !FILE_VERSION_HISTORY_PANEL_SRC.includes(PICKER_MARK),
      "FileVersionHistoryPanel.tsx must not reference the picker mark name",
    );
  });
});
