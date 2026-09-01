import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("src/components/projects/v2/files-tab/TaskLinkPopover.tsx", "utf8");
test("linked-task popover delegates collision handling and dismissal to installed Radix", () => {
  assert.match(source, /from "radix-ui"/);
  assert.match(source, /<Popover.Portal>/);
  assert.match(source, /<Popover.Anchor asChild>/);
  assert.match(source, /collisionPadding=\{12\}/);
  assert.match(source, /--radix-popover-content-available-height/);
  assert.doesNotMatch(source, /getBoundingClientRect|addEventListener/);
});
test("popover restores trigger focus and provides keyboard-accessible task destinations", () => {
  assert.match(source, /onCloseAutoFocus/);
  assert.match(source, /querySelector\("button"\)\?\.focus\(\)/);
  assert.match(source, /aria-expanded=\{isOpen\}/);
  assert.match(source, /drawerType=task/);
  assert.match(source, /encodeURIComponent\(task.taskId\)/);
});
