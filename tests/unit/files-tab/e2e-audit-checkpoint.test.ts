/**
 * Task 12.17 — E2E audit-record checkpoint.
 *
 * **Validates: Req 18.1, 18.2, 18.3, 18.5**
 *
 * Confirms that the `tests/e2e/files-tab/audit-record.json` artifact:
 *   1. Exists and parses as a JSON array.
 *   2. Carries one entry per verification area enumerated in Req 18.1.
 *      Areas listed in `EXPECTED_AREA_PREFIXES` must each match at least
 *      one entry whose `area` either equals or starts with the prefix
 *      (E2E specs are free to add a `/ scenario` suffix per Req 18.5 so
 *      the same prefix can host multiple scenarios).
 *   3. Every entry conforms to the {area, result, timestamp, testerId}
 *      shape, with `justification` non-empty whenever
 *      `result === "not_applicable"` (Req 18.3).
 *
 * Soft-fail policy: while the rollout is still pre-flip, an environment
 * may have produced a partial record (e.g. only the soft-delete area
 * ran). The checkpoint emits informational warnings for missing prefixes
 * but only fails the build when:
 *   - the file exists but is not a JSON array, OR
 *   - any entry violates the shape contract, OR
 *   - any `not_applicable` entry has an empty justification (Req 18.3).
 *
 * Once the rollout reaches Task 13.7's final-checkpoint pass, the
 * release gate re-runs this test with `STRICT=1` and the missing-prefix
 * branch becomes a hard failure. The strict envelope is opt-in via the
 * `FILES_TAB_AUDIT_STRICT` env var so local runs and CI smoke-runs
 * stay non-blocking during the coexistence period.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const AUDIT_PATH = path.join(
  REPO_ROOT,
  "tests",
  "e2e",
  "files-tab",
  "audit-record.json",
);
const STRICT = process.env.FILES_TAB_AUDIT_STRICT === "1";

/**
 * Verification-area prefixes derived from tasks.md § 12.2-12.16. Each
 * prefix MUST be matched by at least one entry in audit-record.json.
 * Specs are encouraged to suffix the area with " / scenario-name" when
 * a single task covers multiple scenarios; the prefix-match handles
 * both the bare area name and the suffixed forms.
 */
const EXPECTED_AREA_PREFIXES: ReadonlyArray<{ task: string; prefix: string }> = [
  // 12.2
  { task: "12.2", prefix: "single file upload" },
  { task: "12.2", prefix: "drag-and-drop upload onto Sidebar_Tree folders" },
  { task: "12.2", prefix: "drag-and-drop upload onto File_List folder rows" },
  // 12.3
  { task: "12.3", prefix: "folder upload" },
  // 12.4
  { task: "12.4", prefix: "rename via F2 keyboard" },
  { task: "12.4", prefix: "rename via dialog" },
  // 12.5
  { task: "12.5", prefix: "soft delete" },
  { task: "12.5", prefix: "permanent delete" },
  // 12.6
  { task: "12.6", prefix: "move" },
  // 12.7
  { task: "12.7", prefix: "favorites toggle" },
  // 12.8
  { task: "12.8", prefix: "Recents list correctness" },
  // 12.9
  { task: "12.9", prefix: "version pill display" },
  // 12.10
  { task: "12.10", prefix: "git change indicators" },
  // 12.11
  { task: "12.11", prefix: "breadcrumb navigation" },
  // 12.12
  { task: "12.12", prefix: "sidebar tree" },
  // 12.13
  { task: "12.13", prefix: "file view" },
  // 12.14
  { task: "12.14", prefix: "deep link" },
  // 12.15
  { task: "12.15", prefix: "url sync" },
  // 12.16
  { task: "12.16", prefix: "viewer role" },
];

interface AuditEntry {
  area: string;
  result: "pass" | "fail" | "not_applicable";
  timestamp: string;
  testerId: string;
  justification?: string;
}

function readEntries(): AuditEntry[] {
  if (!fs.existsSync(AUDIT_PATH)) return [];
  const raw = fs.readFileSync(AUDIT_PATH, "utf8");
  if (raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `audit-record.json is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("audit-record.json must contain a JSON array");
  }
  return parsed as AuditEntry[];
}

test("audit-record.json conforms to the {area,result,timestamp,testerId} shape (Req 18.5)", () => {
  const entries = readEntries();
  if (entries.length === 0) {
    // No E2E run has produced an audit record yet — informational.
    console.log(
      "[audit-checkpoint] audit-record.json is empty or absent; this is expected " +
        "before the first E2E run. Re-run after the E2E suite executes.",
    );
    return;
  }
  for (const [index, entry] of entries.entries()) {
    assert.equal(
      typeof entry.area,
      "string",
      `entry[${index}].area must be a string`,
    );
    assert.ok(
      entry.area.trim().length > 0,
      `entry[${index}].area must be non-empty`,
    );
    assert.ok(
      ["pass", "fail", "not_applicable"].includes(entry.result),
      `entry[${index}].result must be one of pass | fail | not_applicable, got ${entry.result}`,
    );
    assert.equal(
      typeof entry.timestamp,
      "string",
      `entry[${index}].timestamp must be a string`,
    );
    assert.ok(
      !Number.isNaN(Date.parse(entry.timestamp)),
      `entry[${index}].timestamp must be ISO-8601-parseable`,
    );
    assert.equal(
      typeof entry.testerId,
      "string",
      `entry[${index}].testerId must be a string`,
    );
    assert.ok(
      entry.testerId.trim().length > 0,
      `entry[${index}].testerId must be non-empty`,
    );
    if (entry.result === "not_applicable") {
      assert.ok(
        typeof entry.justification === "string" &&
          entry.justification.trim().length > 0,
        `entry[${index}] (area="${entry.area}"): not_applicable result MUST include a non-empty justification (Req 18.3)`,
      );
    }
  }
});

test("audit-record.json has at least one entry per Req 18.1 area prefix", () => {
  const entries = readEntries();
  if (entries.length === 0) {
    console.log(
      "[audit-checkpoint] audit-record.json is absent — skipping the per-area " +
        "presence check. Set FILES_TAB_AUDIT_STRICT=1 to make this a hard failure.",
    );
    if (STRICT) {
      assert.fail(
        "STRICT mode: audit-record.json is empty or absent; expected entries for every Req 18.1 area",
      );
    }
    return;
  }
  const missing: Array<{ task: string; prefix: string }> = [];
  for (const expected of EXPECTED_AREA_PREFIXES) {
    const found = entries.some((e) =>
      e.area === expected.prefix ||
      e.area.startsWith(`${expected.prefix} /`) ||
      e.area.startsWith(expected.prefix),
    );
    if (!found) missing.push(expected);
  }
  if (missing.length === 0) return;
  const summary = missing
    .map((m) => `  - Task ${m.task}: "${m.prefix}"`)
    .join("\n");
  if (STRICT) {
    assert.fail(
      `audit-record.json is missing entries for ${missing.length} Req 18.1 area(s):\n${summary}`,
    );
  }
  console.log(
    `[audit-checkpoint] audit-record.json is missing entries for ${missing.length} ` +
      `Req 18.1 area(s) (informational pre-flip):\n${summary}`,
  );
});
