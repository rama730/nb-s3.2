/**
 * Audit-record writer for the Files Tab GitHub Redesign end-to-end verification
 * (Requirement 18).
 *
 * Every E2E spec under `tests/e2e/files-tab/*.spec.ts` calls {@link recordAudit}
 * exactly once per verification area, producing a single JSON array at
 * `tests/e2e/files-tab/audit-record.json` that the release gate reads.
 *
 * Contract (Req 18.1–18.5):
 *   - Each entry records `{ area, result, timestamp, testerId, justification? }`.
 *   - `result` is one of `"pass" | "fail" | "not_applicable"`.
 *   - `not_applicable` results MUST include a non-empty `justification` (Req 18.3).
 *   - `testerId` defaults to `process.env.TESTER_ID` or `"e2e-runner"` when absent.
 *   - Writes are atomic (read → merge → write-to-temp → rename) and guarded by
 *     an advisory lockfile so concurrent Playwright workers do not lose entries.
 */
import fs from "node:fs";
import path from "node:path";

export type AuditResult = "pass" | "fail" | "not_applicable";

export type AuditEntry = {
  /** Verification area name from the Req 18.1 enumeration. */
  area: string;
  /** Outcome of the verification for this area. */
  result: AuditResult;
  /** ISO-8601 timestamp at which the entry was recorded. */
  timestamp: string;
  /** Identity of the tester or runner producing the entry. */
  testerId: string;
  /** Required when `result === "not_applicable"` (Req 18.3). */
  justification?: string;
};

/**
 * Absolute path to the audit-record JSON file. Defaults to
 * `<cwd>/tests/e2e/files-tab/audit-record.json`. Tests may override by setting
 * the `FILES_TAB_AUDIT_RECORD_PATH` environment variable before importing.
 */
export const AUDIT_RECORD_PATH =
  process.env.FILES_TAB_AUDIT_RECORD_PATH?.trim() ||
  path.join(process.cwd(), "tests", "e2e", "files-tab", "audit-record.json");

/** Directory containing the audit record. Exported so tests can assert on it. */
export const AUDIT_DIR = path.dirname(AUDIT_RECORD_PATH);

const LOCK_PATH = `${AUDIT_RECORD_PATH}.lock`;
const DEFAULT_TESTER_ID = "e2e-runner";
const LOCK_ACQUIRE_MAX_MS = 10_000;
const LOCK_RETRY_DELAY_MS = 25;
/** A lock older than this is considered stale and is forcibly removed. */
const LOCK_STALE_MS = 30_000;

const VALID_RESULTS: ReadonlySet<AuditResult> = new Set<AuditResult>([
  "pass",
  "fail",
  "not_applicable",
]);

function getTesterId(): string {
  const raw = process.env.TESTER_ID;
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  return DEFAULT_TESTER_ID;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const startedAt = Date.now();
  // Ensure the containing directory exists before we try to create the lock.
  fs.mkdirSync(AUDIT_DIR, { recursive: true });

  while (true) {
    try {
      // O_CREAT | O_EXCL | O_WRONLY — succeeds only if the lockfile does not exist.
      const fd = fs.openSync(LOCK_PATH, "wx");
      try {
        fs.writeSync(fd, `${process.pid}:${Date.now()}`);
      } finally {
        fs.closeSync(fd);
      }
      try {
        return await fn();
      } finally {
        try {
          fs.unlinkSync(LOCK_PATH);
        } catch {
          // lock may already be gone if another process cleared a stale lock
        }
      }
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code !== "EEXIST") {
        throw err;
      }
      // Lock is held; check for staleness and otherwise wait.
      try {
        const stat = fs.statSync(LOCK_PATH);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          try {
            fs.unlinkSync(LOCK_PATH);
          } catch {
            // race with another process that unlinked it first
          }
          continue;
        }
      } catch {
        // lockfile vanished between error and stat — retry immediately
        continue;
      }
      if (Date.now() - startedAt > LOCK_ACQUIRE_MAX_MS) {
        throw new Error(
          `recordAudit: timed out acquiring audit lock after ${LOCK_ACQUIRE_MAX_MS}ms at ${LOCK_PATH}`,
        );
      }
      await delay(LOCK_RETRY_DELAY_MS);
    }
  }
}

function readExisting(): AuditEntry[] {
  if (!fs.existsSync(AUDIT_RECORD_PATH)) return [];
  const raw = fs.readFileSync(AUDIT_RECORD_PATH, "utf8");
  if (raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `recordAudit: audit-record.json is not valid JSON (${(err as Error).message})`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("recordAudit: audit-record.json must contain a JSON array");
  }
  return parsed as AuditEntry[];
}

function writeAtomic(entries: AuditEntry[]): void {
  const tmp = `${AUDIT_RECORD_PATH}.tmp.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  fs.writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, AUDIT_RECORD_PATH);
}

/**
 * Append a verification-audit entry to `tests/e2e/files-tab/audit-record.json`.
 *
 * Each E2E spec under `tests/e2e/files-tab/` calls this exactly once per
 * verification area it covers.
 *
 * @param area Verification area name from the Req 18.1 enumeration.
 * @param result `"pass" | "fail" | "not_applicable"`.
 * @param justification Required (non-empty) when `result === "not_applicable"`.
 * @throws Error on invalid `result`, empty `area`, or missing justification for
 *   `not_applicable` results.
 */
export async function recordAudit(
  area: string,
  result: AuditResult,
  justification?: string,
): Promise<void> {
  if (typeof area !== "string" || area.trim() === "") {
    throw new Error("recordAudit: `area` must be a non-empty string");
  }
  if (!VALID_RESULTS.has(result)) {
    throw new Error(
      `recordAudit: invalid result "${String(result)}" (expected "pass" | "fail" | "not_applicable")`,
    );
  }
  const trimmedJustification =
    typeof justification === "string" ? justification.trim() : undefined;

  if (result === "not_applicable" && (!trimmedJustification || trimmedJustification === "")) {
    throw new Error(
      `recordAudit: area "${area}" recorded as "not_applicable" requires a non-empty justification (Req 18.3)`,
    );
  }

  await withLock(() => {
    const entries = readExisting();
    const entry: AuditEntry = {
      area: area.trim(),
      result,
      timestamp: new Date().toISOString(),
      testerId: getTesterId(),
      ...(trimmedJustification ? { justification: trimmedJustification } : {}),
    };
    entries.push(entry);
    writeAtomic(entries);
  });
}

/**
 * Read all audit entries currently on disk. Returns an empty array when the
 * audit file does not yet exist. Intended for release-gate tooling and tests.
 */
export function readAuditRecord(): AuditEntry[] {
  return readExisting();
}
