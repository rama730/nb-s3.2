// Task 12.1 — acceptance test for the Req 18 audit-record writer.
//
// Covers the `recordAudit` helper's contract:
//   - appends entries with the required shape `{ area, result, timestamp,
//     testerId, justification? }` to the audit-record JSON file
//   - derives `testerId` from `process.env.TESTER_ID` with an `"e2e-runner"`
//     default
//   - rejects invalid `area` / `result` inputs
//   - rejects `not_applicable` results without a non-empty justification
//     (Req 18.3)
//   - writes atomically such that concurrent `recordAudit` invocations do not
//     lose entries (Req 18.1: the audit record must enumerate all areas)
//
// The test isolates on-disk state via the `FILES_TAB_AUDIT_RECORD_PATH`
// environment variable, which the helper consults at import time.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "files-tab-audit-"));
const isolatedFile = path.join(isolatedDir, "audit-record.json");
process.env.FILES_TAB_AUDIT_RECORD_PATH = isolatedFile;
process.env.TESTER_ID = "unit-tester";

// Import after env overrides so the module picks them up at evaluation time.
let audit: typeof import("../../e2e/files-tab/audit");

test.before(async () => {
  audit = await import("../../e2e/files-tab/audit");
});

test.after(() => {
  fs.rmSync(isolatedDir, { recursive: true, force: true });
});

function resetAuditFile(): void {
  if (fs.existsSync(isolatedFile)) fs.unlinkSync(isolatedFile);
}

function loadAudit(): unknown {
  return JSON.parse(fs.readFileSync(isolatedFile, "utf8"));
}

test("recordAudit: appends a pass entry with the full required shape", async () => {
  resetAuditFile();
  await audit.recordAudit("single file upload", "pass");
  const entries = loadAudit() as Array<Record<string, unknown>>;
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.area, "single file upload");
  assert.equal(entry.result, "pass");
  assert.equal(entry.testerId, "unit-tester");
  assert.equal(typeof entry.timestamp, "string");
  assert.ok(!Number.isNaN(Date.parse(entry.timestamp as string)));
  assert.equal("justification" in entry, false);
});

test("recordAudit: second call appends rather than replaces the first entry", async () => {
  resetAuditFile();
  await audit.recordAudit("inline rename", "pass");
  await audit.recordAudit("soft delete", "fail");
  const entries = loadAudit() as Array<Record<string, unknown>>;
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.area, "inline rename");
  assert.equal(entries[0]?.result, "pass");
  assert.equal(entries[1]?.area, "soft delete");
  assert.equal(entries[1]?.result, "fail");
});

test("recordAudit: not_applicable entry persists the justification verbatim", async () => {
  resetAuditFile();
  await audit.recordAudit(
    'git Change_Indicator correctness for "modified"',
    "not_applicable",
    "no Git_Enabled_Project fixture available in this run",
  );
  const entries = loadAudit() as Array<Record<string, unknown>>;
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.result, "not_applicable");
  assert.equal(
    entries[0]?.justification,
    "no Git_Enabled_Project fixture available in this run",
  );
});

test("recordAudit: not_applicable without justification throws (Req 18.3)", async () => {
  resetAuditFile();
  await assert.rejects(
    () => audit.recordAudit("folder upload", "not_applicable"),
    /non-empty justification/i,
  );
  await assert.rejects(
    () => audit.recordAudit("folder upload", "not_applicable", "   "),
    /non-empty justification/i,
  );
  assert.equal(fs.existsSync(isolatedFile), false);
});

test("recordAudit: rejects invalid result values", async () => {
  resetAuditFile();
  await assert.rejects(
    // @ts-expect-error — intentionally passing an invalid value at runtime.
    () => audit.recordAudit("move", "skipped"),
    /invalid result/i,
  );
});

test("recordAudit: rejects empty or whitespace-only area", async () => {
  resetAuditFile();
  await assert.rejects(() => audit.recordAudit("", "pass"), /non-empty string/i);
  await assert.rejects(() => audit.recordAudit("   ", "pass"), /non-empty string/i);
});

test("recordAudit: testerId falls back to 'e2e-runner' when TESTER_ID is unset", async () => {
  resetAuditFile();
  const previous = process.env.TESTER_ID;
  delete process.env.TESTER_ID;
  try {
    await audit.recordAudit("favorites toggle", "pass");
  } finally {
    if (previous !== undefined) process.env.TESTER_ID = previous;
  }
  const entries = loadAudit() as Array<Record<string, unknown>>;
  assert.equal(entries.at(-1)?.testerId, "e2e-runner");
});

test("recordAudit: concurrent invocations do not lose entries", async () => {
  resetAuditFile();
  const areas = Array.from({ length: 20 }, (_, i) => `concurrent area ${i}`);
  await Promise.all(areas.map((area) => audit.recordAudit(area, "pass")));
  const entries = loadAudit() as Array<Record<string, unknown>>;
  assert.equal(entries.length, areas.length);
  const recordedAreas = new Set(entries.map((e) => e.area as string));
  for (const area of areas) {
    assert.ok(recordedAreas.has(area), `missing area ${area}`);
  }
});

test("readAuditRecord: returns empty array when file does not exist", () => {
  resetAuditFile();
  const entries = audit.readAuditRecord();
  assert.deepEqual(entries, []);
});
