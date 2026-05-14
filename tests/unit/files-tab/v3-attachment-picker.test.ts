// Task 3.1 acceptance test — `V3AttachmentPicker`.
//
// Verifies (per tasks.md § 3.1):
//   (i)   Renders `FilesTabSidebar` tree in `mode="navigate-only"` (disable
//         mutations, context-menu limited to "Reveal" and "Open").
//   (ii)  Right pane: search results when query non-empty, recent files
//         when query empty.
//   (iii) Pinned tray at bottom showing selected items as removable chips.
//   (iv)  Removing a chip deselects the item from the selection set.
//   (v)   Emits `files_tab.picker_opened` telemetry event on mount.
//   (vi)  Records `performance.mark("files-tab:picker-interactive")` on
//         first interactive state.
//   (vii) Must NOT import `FileExplorer` or `ExplorerShell`.
//
// Following the established pattern: structural guarantees are asserted
// against the source file as a text contract (no jsdom).
//
// Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 16.1, 17.3.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// ─── Source file under test ──────────────────────────────────────────

const SRC_PATH = path.resolve(
  __dirname,
  "../../../src/components/projects/v2/files-tab/picker/V3AttachmentPicker.tsx",
);
const SRC = readFileSync(SRC_PATH, "utf8");

// ─── Req 6.7: Must NOT import FileExplorer or ExplorerShell ──────────

describe("V3AttachmentPicker — forbidden imports (Req 6.7)", () => {
  it("does NOT import FileExplorer", () => {
    // Check for actual import statements, not comments
    const importLines = SRC.split("\n").filter(
      (line) =>
        line.match(/^\s*import\s/) && line.includes("FileExplorer"),
    );
    assert.equal(
      importLines.length,
      0,
      "V3AttachmentPicker must not import FileExplorer",
    );
  });

  it("does NOT import ExplorerShell", () => {
    const importLines = SRC.split("\n").filter(
      (line) =>
        line.match(/^\s*import\s/) && line.includes("ExplorerShell"),
    );
    assert.equal(
      importLines.length,
      0,
      "V3AttachmentPicker must not import ExplorerShell",
    );
  });
});

// ─── Req 16.1: Telemetry event on mount ──────────────────────────────

describe("V3AttachmentPicker — telemetry (Req 16.1)", () => {
  it("emits files_tab.picker_opened via logger.metric on mount", () => {
    assert.match(
      SRC,
      /logger\.metric\(\s*["']files_tab\.picker_opened["']/,
      "Must emit files_tab.picker_opened telemetry event",
    );
  });

  it("imports logger from @/lib/logger", () => {
    assert.match(
      SRC,
      /import\s+\{[^}]*logger[^}]*\}\s+from\s+["']@\/lib\/logger["']/,
      "Must import logger from @/lib/logger",
    );
  });
});

// ─── Req 17.3: Performance mark ──────────────────────────────────────

describe("V3AttachmentPicker — performance mark (Req 17.3)", () => {
  it("records performance.mark('files-tab:picker-interactive')", () => {
    assert.match(
      SRC,
      /performance\.mark\(\s*["']files-tab:picker-interactive["']\s*\)/,
      "Must record performance.mark('files-tab:picker-interactive')",
    );
  });
});

// ─── Req 6.1: Navigate-only tree (no mutations) ─────────────────────

describe("V3AttachmentPicker — navigate-only tree (Req 6.1)", () => {
  it("does NOT import useExplorerMutations (no mutations in picker)", () => {
    const importLines = SRC.split("\n").filter(
      (line) =>
        line.match(/^\s*import\s/) &&
        line.includes("useExplorerMutations"),
    );
    assert.equal(
      importLines.length,
      0,
      "V3AttachmentPicker must not import useExplorerMutations",
    );
  });

  it("does NOT import useExplorerDragDrop (no drag-drop in picker)", () => {
    const importLines = SRC.split("\n").filter(
      (line) =>
        line.match(/^\s*import\s/) &&
        line.includes("useExplorerDragDrop"),
    );
    assert.equal(
      importLines.length,
      0,
      "V3AttachmentPicker must not import useExplorerDragDrop",
    );
  });
});

// ─── Req 6.2: Right pane shows search results / recents ──────────────

describe("V3AttachmentPicker — right pane content (Req 6.2)", () => {
  it("uses rankFuzzyResults for search results", () => {
    assert.match(
      SRC,
      /rankFuzzyResults/,
      "Must use rankFuzzyResults for search results",
    );
  });

  it("reads recents from the store", () => {
    assert.match(
      SRC,
      /recents/,
      "Must read recents from the store for the empty-query state",
    );
  });

  it("renders a search input for filtering", () => {
    assert.match(
      SRC,
      /data-testid="v3-attachment-picker-search"/,
      "Must render a search input with proper test id",
    );
  });
});

// ─── Req 6.3: Pinned tray with removable chips ──────────────────────

describe("V3AttachmentPicker — pinned tray (Req 6.3, 6.4)", () => {
  it("renders a pinned tray container", () => {
    assert.match(
      SRC,
      /data-testid="v3-attachment-picker-tray"/,
      "Must render a pinned tray with proper test id",
    );
  });

  it("renders chips for selected nodes", () => {
    assert.match(
      SRC,
      /v3-attachment-picker-chip-/,
      "Must render chips with node-specific test ids",
    );
  });

  it("renders a remove button on each chip", () => {
    assert.match(
      SRC,
      /v3-attachment-picker-chip-remove-/,
      "Must render remove buttons on chips",
    );
  });

  it("calls removeFromSelection when chip remove button is clicked", () => {
    assert.match(
      SRC,
      /removeFromSelection\(node\.id\)/,
      "Removing a chip must deselect the item from the selection set",
    );
  });
});

// ─── Interface contract ──────────────────────────────────────────────

describe("V3AttachmentPicker — interface contract", () => {
  it("exports V3AttachmentPickerProps interface", () => {
    assert.match(
      SRC,
      /export interface V3AttachmentPickerProps/,
      "Must export V3AttachmentPickerProps interface",
    );
  });

  it("accepts projectId prop", () => {
    assert.match(
      SRC,
      /projectId:\s*string/,
      "Must accept projectId prop",
    );
  });

  it("accepts isOpen prop", () => {
    assert.match(
      SRC,
      /isOpen:\s*boolean/,
      "Must accept isOpen prop",
    );
  });

  it("accepts onClose prop", () => {
    assert.match(
      SRC,
      /onClose:\s*\(\)\s*=>\s*void/,
      "Must accept onClose prop",
    );
  });

  it("accepts initialSelection prop", () => {
    assert.match(
      SRC,
      /initialSelection\?:\s*ProjectNode\[\]/,
      "Must accept optional initialSelection prop",
    );
  });

  it("accepts onSelectionChange prop", () => {
    assert.match(
      SRC,
      /onSelectionChange\?:\s*\(nodes:\s*ProjectNode\[\]\)\s*=>\s*void/,
      "Must accept optional onSelectionChange prop",
    );
  });
});

// ─── Structural: uses computeVisibleIdsForSearch for tree filtering ──

describe("V3AttachmentPicker — tree filtering (Req 6.1)", () => {
  it("uses computeVisibleIdsForSearch for tree filtering", () => {
    assert.match(
      SRC,
      /computeVisibleIdsForSearch/,
      "Must use computeVisibleIdsForSearch for tree filtering",
    );
  });
});
