// Task 5.3 acceptance test — formatBytes + formatRelativeTime threshold cases.
// Covers Req 4.4 (relative time: "{N} {unit} ago") and Req 4.5 (size: 1024-base,
// one decimal, folders render empty). Property-based coverage is out of scope
// here — this file pins the exact rendered strings at every documented
// boundary.
//
// The `formatRelativeTime` helper accepts an optional `now` parameter so the
// clock can be deterministically pinned. All relative-time cases below use a
// fixed `pinnedNow` anchor and derive `iso` inputs by subtracting seconds.

import test from "node:test";
import assert from "node:assert/strict";

import {
  formatBytes,
  formatRelativeTime,
} from "@/components/projects/v2/files-tab/folder/format";

// ---------------------------------------------------------------------------
// formatBytes — Req 4.5
// ---------------------------------------------------------------------------
//
// The helper is 1024-base and renders one decimal for units ≥ KB. Bytes below
// 1024 are rendered as whole integers ("N B"). Folders return the empty
// string regardless of size so the File_List "Size" column is blank for them.

test("formatBytes: 0 bytes renders as '0 B'", () => {
  assert.equal(formatBytes(0), "0 B");
});

test("formatBytes: 1023 bytes stays in the 'B' unit (boundary - 1)", () => {
  assert.equal(formatBytes(1023), "1023 B");
});

test("formatBytes: 1024 bytes promotes to '1.0 KB' (KB boundary)", () => {
  assert.equal(formatBytes(1024), "1.0 KB");
});

test("formatBytes: 1536 bytes renders as '1.5 KB' (one decimal mid-unit)", () => {
  assert.equal(formatBytes(1536), "1.5 KB");
});

test("formatBytes: 1_048_576 bytes promotes to '1.0 MB' (MB boundary)", () => {
  assert.equal(formatBytes(1048576), "1.0 MB");
});

test("formatBytes: 1_073_741_824 bytes promotes to '1.0 GB' (GB boundary)", () => {
  assert.equal(formatBytes(1073741824), "1.0 GB");
});

test("formatBytes: 1_099_511_627_776 bytes promotes to '1.0 TB' (TB boundary)", () => {
  assert.equal(formatBytes(1099511627776), "1.0 TB");
});

test("formatBytes: folders render as empty string regardless of size", () => {
  // Req 4.5: "SHALL render the column as empty for folders".
  assert.equal(formatBytes(0, "folder"), "");
  assert.equal(formatBytes(1024, "folder"), "");
  assert.equal(formatBytes(1099511627776, "folder"), "");
});

// ---------------------------------------------------------------------------
// formatRelativeTime — Req 4.4
// ---------------------------------------------------------------------------
//
// Unit is the largest of seconds/minutes/hours/days/weeks/months/years whose
// count is ≥ 1. Singular form when count === 1, plural otherwise.
//
// All boundary cases below pin the clock via the `now` parameter so they are
// independent of wall time.

const pinnedNow = new Date("2026-05-10T12:00:00.000Z");

/** Builds an ISO-8601 timestamp `secondsAgo` seconds before `pinnedNow`. */
function isoSecondsAgo(secondsAgo: number): string {
  return new Date(pinnedNow.getTime() - secondsAgo * 1000).toISOString();
}

test("formatRelativeTime: diff === 0 renders '0 seconds ago'", () => {
  // Pinned timestamp equals the pinned now — no unit has count ≥ 1, so the
  // helper falls through to the sub-second "0 seconds ago" string.
  assert.equal(
    formatRelativeTime(pinnedNow.toISOString(), pinnedNow),
    "0 seconds ago",
  );
});

test("formatRelativeTime: 59s ago renders '59 seconds ago' (below minute boundary)", () => {
  assert.equal(
    formatRelativeTime(isoSecondsAgo(59), pinnedNow),
    "59 seconds ago",
  );
});

test("formatRelativeTime: 60s ago renders '1 minute ago' (minute boundary, singular)", () => {
  assert.equal(
    formatRelativeTime(isoSecondsAgo(60), pinnedNow),
    "1 minute ago",
  );
});

test("formatRelativeTime: 3599s ago renders '59 minutes ago' (below hour boundary)", () => {
  assert.equal(
    formatRelativeTime(isoSecondsAgo(3599), pinnedNow),
    "59 minutes ago",
  );
});

test("formatRelativeTime: 3600s ago renders '1 hour ago' (hour boundary, singular)", () => {
  assert.equal(
    formatRelativeTime(isoSecondsAgo(3600), pinnedNow),
    "1 hour ago",
  );
});

test("formatRelativeTime: 86399s ago renders '23 hours ago' (below day boundary)", () => {
  assert.equal(
    formatRelativeTime(isoSecondsAgo(86399), pinnedNow),
    "23 hours ago",
  );
});

test("formatRelativeTime: 86400s ago renders '1 day ago' (day boundary, singular)", () => {
  assert.equal(
    formatRelativeTime(isoSecondsAgo(86400), pinnedNow),
    "1 day ago",
  );
});

test("formatRelativeTime: missing (undefined) renders '—'", () => {
  // Req 4.4: "SHALL render the column value as '—' when updatedAt is missing
  // or null".
  assert.equal(formatRelativeTime(undefined, pinnedNow), "—");
});

test("formatRelativeTime: null renders '—'", () => {
  assert.equal(formatRelativeTime(null, pinnedNow), "—");
});
