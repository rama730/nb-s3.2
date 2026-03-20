import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const globalsCssPath = path.join(process.cwd(), "src/app/globals.css");
const globalsCss = fs.readFileSync(globalsCssPath, "utf8");

test("interactive cursor contract defines pointer baseline for semantic controls", () => {
  assert.match(globalsCss, /a\[href\]/);
  assert.match(globalsCss, /button:not\(:disabled\)/);
  assert.match(globalsCss, /\[role="button"\]:not\(\[aria-disabled="true"\]\)/);
  assert.match(globalsCss, /\[role="tab"\]:not\(\[aria-disabled="true"\]\)/);
  assert.match(globalsCss, /cursor:\s*pointer;/);
});

test("interactive cursor contract defines not-allowed cursor for disabled controls", () => {
  assert.match(globalsCss, /button:disabled/);
  assert.match(globalsCss, /\[aria-disabled="true"\]/);
  assert.match(globalsCss, /cursor:\s*not-allowed;/);
});
