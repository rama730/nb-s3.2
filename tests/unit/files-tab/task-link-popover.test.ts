// Regression coverage for the file-tree linked task popover.
//
// The popover is triggered from deeply indented file rows. If it is rendered as
// row-local absolute content, it contributes to the sidebar's scroll width and
// creates an unwanted horizontal scrollbar.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const SRC_PATH = path.resolve(
  __dirname,
  "../../../src/components/projects/v2/files-tab/TaskLinkPopover.tsx",
);
const SRC = readFileSync(SRC_PATH, "utf8");

describe("TaskLinkPopover — sidebar overflow contract", () => {
  it("renders the floating panel through a document body portal", () => {
    assert.match(
      SRC,
      /import\s+\{\s*createPortal\s*\}\s+from\s+["']react-dom["']/,
      "Must import createPortal from react-dom",
    );
    assert.match(SRC, /createPortal\(/, "Must render through a portal");
    assert.match(SRC, /document\.body/, "Must portal outside row layout");
  });

  it("uses fixed viewport positioning instead of row-local absolute positioning", () => {
    assert.match(
      SRC,
      /"fixed z-\[240\]/,
      "Popover panel must be fixed-positioned",
    );
    assert.doesNotMatch(
      SRC,
      /"absolute left-0 top-full/,
      "Popover panel must not be positioned inside the file row",
    );
  });

  it("keeps the portal anchored while scroll containers move", () => {
    assert.match(
      SRC,
      /getBoundingClientRect\(\)/,
      "Must derive the portal anchor from the trigger rect",
    );
    assert.match(
      SRC,
      /window\.addEventListener\("resize",\s*updatePopoverPosition\)/,
      "Must recalculate position on viewport resize",
    );
    assert.match(
      SRC,
      /window\.addEventListener\("scroll",\s*updatePopoverPosition,\s*true\)/,
      "Must recalculate position for nested scroll containers",
    );
  });

  it("keeps outside-click handling aware of both trigger and portal", () => {
    assert.match(
      SRC,
      /containerRef\.current\?\.contains\(target\)/,
      "Must keep trigger clicks from closing the popover",
    );
    assert.match(
      SRC,
      /popoverRef\.current\?\.contains\(target\)/,
      "Must keep clicks inside portaled content from closing the popover",
    );
  });
});
