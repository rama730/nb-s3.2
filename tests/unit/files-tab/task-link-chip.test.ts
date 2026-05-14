// Task 5.1 acceptance test — `TaskLinkChip`.
//
// Verifies (per tasks.md § 5.1):
//   (i)   Accepts `{ count, onClick, className? }` props.
//   (ii)  Renders badge with count.
//   (iii) Emits `files_tab.task_link_chip_clicked` telemetry on click.
//   (iv)  Returns null when count < 1 (Req 7.2 — hide when zero links).
//
// Following the established pattern: structural guarantees are asserted
// against the source file as a text contract (no jsdom).
//
// Requirements: 7.1, 7.2, 16.2.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// ─── Source file under test ──────────────────────────────────────────

const SRC_PATH = path.resolve(
  __dirname,
  "../../../src/components/projects/v2/files-tab/TaskLinkChip.tsx",
);
const SRC = readFileSync(SRC_PATH, "utf8");

// ─── Interface contract ──────────────────────────────────────────────

describe("TaskLinkChip — interface contract", () => {
  it("exports TaskLinkChipProps interface", () => {
    assert.match(
      SRC,
      /export interface TaskLinkChipProps/,
      "Must export TaskLinkChipProps interface",
    );
  });

  it("accepts count prop of type number", () => {
    assert.match(
      SRC,
      /count:\s*number/,
      "Must accept count prop of type number",
    );
  });

  it("accepts onClick prop", () => {
    assert.match(
      SRC,
      /onClick:\s*\(event:\s*React\.MouseEvent\)\s*=>\s*void/,
      "Must accept onClick prop with React.MouseEvent parameter",
    );
  });

  it("accepts optional className prop", () => {
    assert.match(
      SRC,
      /className\?:\s*string/,
      "Must accept optional className prop",
    );
  });
});

// ─── Req 7.2: Returns null when count < 1 ───────────────────────────

describe("TaskLinkChip — zero-count guard (Req 7.2)", () => {
  it("returns null when count < 1", () => {
    assert.match(
      SRC,
      /if\s*\(\s*count\s*<\s*1\s*\)\s*return\s+null/,
      "Must return null when count < 1 to hide chip when no links exist",
    );
  });
});

// ─── Req 16.2: Telemetry event on click ──────────────────────────────

describe("TaskLinkChip — telemetry (Req 16.2)", () => {
  it("emits files_tab.task_link_chip_clicked via logger.metric on click", () => {
    assert.match(
      SRC,
      /logger\.metric\(\s*["']files_tab\.task_link_chip_clicked["']/,
      "Must emit files_tab.task_link_chip_clicked telemetry event",
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

// ─── Req 7.1: Renders badge with count ───────────────────────────────

describe("TaskLinkChip — rendering (Req 7.1)", () => {
  it("renders a button element for click interaction", () => {
    assert.match(
      SRC,
      /<button/,
      "Must render a button element for accessibility and click handling",
    );
  });

  it("renders the count value", () => {
    assert.match(
      SRC,
      /\{count\}/,
      "Must render the count value in the badge",
    );
  });

  it("has a data-testid for testing", () => {
    assert.match(
      SRC,
      /data-testid="files-tab-task-link-chip"/,
      "Must have a data-testid for testing",
    );
  });

  it("has a data-count attribute for testing", () => {
    assert.match(
      SRC,
      /data-count=\{count\}/,
      "Must have a data-count attribute for testing",
    );
  });

  it("has an accessible aria-label", () => {
    assert.match(
      SRC,
      /aria-label=/,
      "Must have an aria-label for accessibility",
    );
  });

  it("stops event propagation on click to prevent row navigation", () => {
    assert.match(
      SRC,
      /event\.stopPropagation\(\)/,
      "Must stop event propagation to prevent parent row click",
    );
  });

  it("uses cn utility for className merging", () => {
    assert.match(
      SRC,
      /import\s+\{[^}]*cn[^}]*\}\s+from\s+["']@\/lib\/utils["']/,
      "Must import cn from @/lib/utils for className merging",
    );
  });
});

// ─── Structural: uses LinkIcon for visual indicator ──────────────────

describe("TaskLinkChip — visual indicator", () => {
  it("renders a link icon from lucide-react", () => {
    assert.match(
      SRC,
      /LinkIcon/,
      "Must render a LinkIcon for visual indication of task links",
    );
  });

  it("imports from lucide-react", () => {
    assert.match(
      SRC,
      /from\s+["']lucide-react["']/,
      "Must import icons from lucide-react",
    );
  });
});
