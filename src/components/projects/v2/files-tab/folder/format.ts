/**
 * Formatting helpers for the Files tab folder list and metadata strip.
 *
 * Validates: Req 4.4 (relative time), Req 4.5 (size), Req 5.1 (metadata strip reuse)
 *
 * These helpers are pure and deterministic. `formatRelativeTime` accepts an
 * optional `now` parameter so tests can pin the reference time.
 */

export type NodeType = "file" | "folder";

/** Names describe the current content revision, never an unrelated creator. */
export function formatFileActor(node: {
  updatedByName?: string | null;
  updatedByUsername?: string | null;
}): string {
  return node.updatedByName?.trim() || node.updatedByUsername?.trim() || "Not recorded";
}

export function formatFileTimestamp(value: Date | string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not recorded";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "long" });
}

const KIB = 1024;
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Format a byte count as a human-readable string using a 1024-base.
 *
 * - Returns the empty string when `type` is "folder" (Req 4.5).
 * - Returns the empty string when `bytes` is null, undefined, NaN, or negative.
 * - Bytes below 1024 are rendered as whole numbers ("1023 B"). Larger values
 *   use one decimal place ("12.4 KB", "1.0 MB").
 * - Values beyond TB are clamped to TB with the appropriate scale.
 */
export function formatBytes(
  bytes: number | null | undefined,
  type?: NodeType,
): string {
  if (type === "folder") return "";
  if (bytes == null) return "";
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 0) return "";

  if (bytes < KIB) {
    // Whole-byte values render without a decimal — mirrors GitHub's code tab
    // and Req 4.5's example value ("12.4 KB") which applies to units ≥ KB.
    return `${Math.trunc(bytes)} B`;
  }

  let value = bytes;
  let unitIndex = 0;
  while (value >= KIB && unitIndex < BYTE_UNITS.length - 1) {
    value /= KIB;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[unitIndex]}`;
}

type RelativeUnit = {
  name: string;
  seconds: number;
};

// Ordered largest → smallest. Months use a 30-day approximation and years use
// 365 days, which is the conventional rounding for "ago" strings.
const RELATIVE_UNITS: readonly RelativeUnit[] = [
  { name: "year", seconds: 365 * 24 * 60 * 60 },
  { name: "month", seconds: 30 * 24 * 60 * 60 },
  { name: "week", seconds: 7 * 24 * 60 * 60 },
  { name: "day", seconds: 24 * 60 * 60 },
  { name: "hour", seconds: 60 * 60 },
  { name: "minute", seconds: 60 },
  { name: "second", seconds: 1 },
];

/**
 * Format an ISO-8601 timestamp as a "{N} {unit} ago" string.
 *
 * - Unit is the largest of year, month, week, day, hour, minute, second whose
 *   count is ≥ 1 (Req 4.4).
 * - Singular unit names are used when N === 1 ("1 minute ago"), plural
 *   otherwise ("2 minutes ago").
 * - Returns "—" for null, undefined, empty strings, or unparseable values.
 * - Future timestamps (now < value) and sub-second diffs render as
 *   "0 seconds ago" — there is no older unit to step up to.
 */
export function formatRelativeTime(
  iso: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (iso == null) return "—";
  if (typeof iso === "string" && iso.trim() === "") return "—";

  const when = iso instanceof Date ? iso : new Date(iso);
  const whenMs = when.getTime();
  if (Number.isNaN(whenMs)) return "—";

  const diffSeconds = Math.max(0, Math.floor((now.getTime() - whenMs) / 1000));

  for (const unit of RELATIVE_UNITS) {
    const count = Math.floor(diffSeconds / unit.seconds);
    if (count >= 1) {
      const label = count === 1 ? unit.name : `${unit.name}s`;
      return `${count} ${label} ago`;
    }
  }

  return "0 seconds ago";
}
