// Task 9.3 — Verify all telemetry events are properly wired.
//
// Requirements covered:
//   * Req 16.1 — `files_tab.picker_opened` fires on V3AttachmentPicker open
//   * Req 16.2 — `files_tab.task_link_chip_clicked` fires on TaskLinkChip click
//   * Req 16.3 — `files_tab.version_replaced` includes correct `source` field
//                ("task_panel" vs "files_tab")
//   * Req 16.4 — `files_tab.version_restored` fires on restore
//
// Testing approach: source-level verification using `readFileSync` to confirm
// that the telemetry calls are present in the relevant source files. This
// avoids needing to mount components with full env/server dependencies.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../src");

const V3_ATTACHMENT_PICKER_SRC = readFileSync(
  path.join(ROOT, "components/projects/v2/files-tab/picker/V3AttachmentPicker.tsx"),
  "utf-8",
);

const TASK_LINK_CHIP_SRC = readFileSync(
  path.join(ROOT, "components/projects/v2/files-tab/TaskLinkChip.tsx"),
  "utf-8",
);

const FILE_ACTIONS_BAR_SRC = readFileSync(
  path.join(ROOT, "components/projects/v2/files-tab/file/FileActionsBar.tsx"),
  "utf-8",
);

const FILE_VERSION_HISTORY_PANEL_SRC = readFileSync(
  path.join(ROOT, "components/projects/v2/files-tab/file/FileVersionHistoryPanel.tsx"),
  "utf-8",
);

const TASK_DETAIL_PANEL_SRC = readFileSync(
  path.join(ROOT, "components/projects/v2/tasks/TaskDetailPanel.tsx"),
  "utf-8",
);

// ─── Req 16.1: files_tab.picker_opened ──────────────────────────────

describe("Telemetry — files_tab.picker_opened (Req 16.1)", () => {
  it("V3AttachmentPicker emits files_tab.picker_opened via logger.metric", () => {
    assert.match(
      V3_ATTACHMENT_PICKER_SRC,
      /logger\.metric\(\s*["']files_tab\.picker_opened["']/,
      "V3AttachmentPicker must emit files_tab.picker_opened telemetry event",
    );
  });

  it("fires when isOpen becomes true (useEffect guard)", () => {
    assert.match(
      V3_ATTACHMENT_PICKER_SRC,
      /if\s*\(\s*!isOpen\s*\)\s*return/,
      "Telemetry should only fire when picker is open",
    );
  });

  it("includes projectId in the telemetry payload", () => {
    assert.match(
      V3_ATTACHMENT_PICKER_SRC,
      /files_tab\.picker_opened[\s\S]*?projectId/,
      "Telemetry payload must include projectId",
    );
  });
});

// ─── Req 16.2: files_tab.task_link_chip_clicked ─────────────────────

describe("Telemetry — files_tab.task_link_chip_clicked (Req 16.2)", () => {
  it("TaskLinkChip emits files_tab.task_link_chip_clicked via logger.metric", () => {
    assert.match(
      TASK_LINK_CHIP_SRC,
      /logger\.metric\(\s*["']files_tab\.task_link_chip_clicked["']/,
      "TaskLinkChip must emit files_tab.task_link_chip_clicked telemetry event",
    );
  });

  it("includes count in the telemetry payload", () => {
    assert.match(
      TASK_LINK_CHIP_SRC,
      /files_tab\.task_link_chip_clicked[\s\S]*?count/,
      "Telemetry payload must include count",
    );
  });

  it("fires inside the click handler", () => {
    assert.match(
      TASK_LINK_CHIP_SRC,
      /handleClick[\s\S]*?logger\.metric/,
      "Telemetry must fire inside the click handler",
    );
  });
});

// ─── Req 16.3: files_tab.version_replaced with source field ─────────

describe("Telemetry — files_tab.version_replaced (Req 16.3)", () => {
  it("FileActionsBar emits files_tab.version_replaced with source: 'files_tab'", () => {
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /logger\.metric\(\s*["']files_tab\.version_replaced["']/,
      "FileActionsBar must emit files_tab.version_replaced telemetry event",
    );
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /source:\s*["']files_tab["']/,
      "FileActionsBar telemetry must include source: 'files_tab'",
    );
  });

  it("TaskDetailPanel emits files_tab.version_replaced with source: 'task_panel'", () => {
    assert.match(
      TASK_DETAIL_PANEL_SRC,
      /logger\.metric\(\s*["']files_tab\.version_replaced["']/,
      "TaskDetailPanel must emit files_tab.version_replaced telemetry event",
    );
    assert.match(
      TASK_DETAIL_PANEL_SRC,
      /source:\s*["']task_panel["']/,
      "TaskDetailPanel telemetry must include source: 'task_panel'",
    );
  });

  it("both sources include projectId and nodeId in the payload", () => {
    // Files tab source
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /files_tab\.version_replaced[\s\S]*?projectId/,
      "FileActionsBar telemetry payload must include projectId",
    );
    assert.match(
      FILE_ACTIONS_BAR_SRC,
      /files_tab\.version_replaced[\s\S]*?nodeId/,
      "FileActionsBar telemetry payload must include nodeId",
    );
    // Task panel source
    assert.match(
      TASK_DETAIL_PANEL_SRC,
      /files_tab\.version_replaced[\s\S]*?projectId/,
      "TaskDetailPanel telemetry payload must include projectId",
    );
    assert.match(
      TASK_DETAIL_PANEL_SRC,
      /files_tab\.version_replaced[\s\S]*?nodeId/,
      "TaskDetailPanel telemetry payload must include nodeId",
    );
  });
});

// ─── Req 16.4: files_tab.version_restored ───────────────────────────

describe("Telemetry — files_tab.version_restored (Req 16.4)", () => {
  it("FileVersionHistoryPanel emits files_tab.version_restored via logger.metric", () => {
    assert.match(
      FILE_VERSION_HISTORY_PANEL_SRC,
      /logger\.metric\(\s*["']files_tab\.version_restored["']/,
      "FileVersionHistoryPanel must emit files_tab.version_restored telemetry event",
    );
  });

  it("includes projectId and nodeId in the telemetry payload", () => {
    assert.match(
      FILE_VERSION_HISTORY_PANEL_SRC,
      /files_tab\.version_restored[\s\S]*?projectId/,
      "Telemetry payload must include projectId",
    );
    assert.match(
      FILE_VERSION_HISTORY_PANEL_SRC,
      /files_tab\.version_restored[\s\S]*?nodeId/,
      "Telemetry payload must include nodeId",
    );
  });

  it("includes restoredFromVersion and newVersion in the payload", () => {
    assert.match(
      FILE_VERSION_HISTORY_PANEL_SRC,
      /restoredFromVersion/,
      "Telemetry payload must include restoredFromVersion",
    );
    assert.match(
      FILE_VERSION_HISTORY_PANEL_SRC,
      /newVersion/,
      "Telemetry payload must include newVersion",
    );
  });

  it("fires only on successful restore (inside success branch)", () => {
    // The telemetry call should appear after a success check
    assert.match(
      FILE_VERSION_HISTORY_PANEL_SRC,
      /result\.success[\s\S]*?files_tab\.version_restored/,
      "Telemetry must fire only after successful restore",
    );
  });
});
