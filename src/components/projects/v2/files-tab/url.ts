// URL contract helpers for the Files Tab GitHub redesign.
// See design.md § URL Contract.
//
// Tasks 2.1 (encodePath / splitEncoded) and 2.4 (evaluateDeepLinkPath /
// planUrlSync) both land helpers here. Keeping them in one module lets the
// URL-state roundtrip property (Task 2.9, Property 3) pull every piece from
// the same surface.

import type { ProjectNode } from "@/lib/db/schema";
import {
  isInternalTaskWorkingFilesNode,
} from "@/lib/files/task-working-files";

/**
 * Maximum allowed length of the `?path=` value AFTER URL-decoding, per
 * Req 10.5 (see also design.md § URL Contract).
 */
export const DEEP_LINK_MAX_LENGTH = 4096;

/**
 * Encodes the path from project root to `nodeId` into the `?path=` query value.
 *
 * Contract (design.md § URL Contract, Req 10.1, Req 10.4, Req 20.1):
 * - Returns `""` when `nodeId === null`. Root state emits no `?path=` param,
 *   callers must omit the key rather than emit `?path=`.
 * - Returns `""` when `nodeId` cannot be resolved to a node in `nodesById`.
 * - Otherwise returns segments joined by `/`, where each segment is
 *   `encodeURIComponent(node.name)`. The joined string is NOT further encoded.
 * - Walks `parentId` upward; terminates on null parent, missing ancestor, or
 *   cycle. Partial chains still round-trip correctly when paired with
 *   `splitEncoded` + `findNodeByPathAny` (Req 20.1 property).
 */
export function encodePath(
  nodesById: Record<string, ProjectNode>,
  nodeId: string | null,
): string {
  if (nodeId === null) return "";
  const start = nodesById[nodeId];
  if (!start) return "";
  // Private task storage has no public path. The URL-sync owner emits the
  // opaque fileId for these nodes.
  if (isInternalTaskWorkingFilesNode(start)) {
    return "";
  }

  const parts: string[] = [];
  const seen = new Set<string>();
  let cursor: ProjectNode | undefined = start;
  let missingAncestor = false;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    parts.unshift(encodeURIComponent(cursor.name));
    if (cursor.parentId === null || cursor.parentId === undefined) break;
    const parentNode: ProjectNode | undefined = nodesById[cursor.parentId];
    if (!parentNode) {
      missingAncestor = true;
      break;
    }
    cursor = parentNode;
  }
  if (missingAncestor) {
    const materialized = encodeMaterializedPath(start);
    if (materialized) return materialized;
  }
  return parts.join("/");
}

function encodeMaterializedPath(node: ProjectNode): string {
  const rawPath = typeof node.path === "string" ? node.path.trim() : "";
  if (!rawPath || rawPath === "/") return encodeURIComponent(node.name);
  const segments = rawPath.split("/").filter(Boolean);
  if (segments.length === 0) return encodeURIComponent(node.name);
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

/**
 * Splits a raw `?path=` query value into decoded segments.
 *
 * Contract (design.md § URL Contract, Req 10.1):
 * - Splits on `/`.
 * - Decodes each segment with `decodeURIComponent`.
 * - Filters empty segments (leading, trailing, or consecutive `/`).
 * - Malformed percent-escape segments are dropped silently; callers treat
 *   the resulting shorter path as a resolution miss rather than crash (deep
 *   link resolver surfaces the inline error per Req 10.5).
 */
export function splitEncoded(raw: string): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const segment of raw.split("/")) {
    if (!segment) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      continue;
    }
    if (decoded) out.push(decoded);
  }
  return out;
}

// ─── Task 2.4 — deep-link evaluation + URL sync planning ─────────────

/**
 * Classification of the `?path=` raw value read from `URLSearchParams.get`.
 *
 * See design.md § URL Contract and Req 10.1 / 10.5 for the acceptance rules.
 *
 * - `none` — no `?path=` param present. The caller treats this as "stay at
 *   project root with no error indicator". Per the task "root state: no
 *   `?path=` parameter (not empty-value `?path=`)" — the empty-value case is
 *   classified as `error`, not `none`.
 * - `error` — the raw value is present but invalid for one of:
 *     - `empty`      — the URL-decoded value, after trimming whitespace, is
 *                      the empty string or decodes to zero resolvable
 *                      segments. Req 10.5.
 *     - `overlength` — the URL-decoded value is strictly greater than 4096
 *                      characters. Req 10.5 + 19.8.
 * - `resolvable` — the value yielded `segments.length >= 1` and is within
 *   the length ceiling. The caller should attempt `findNodeByPathAny`.
 */
export type DeepLinkEvaluation =
  | { kind: "none" }
  | { kind: "error"; reason: "empty" | "overlength" }
  | { kind: "resolvable"; segments: string[] };

/**
 * Classify a `?path=` raw value per the deep-link validation rules. The
 * length check runs against the URL-decoded value (Req 10.5) — callers must
 * pass the value already decoded once (e.g. from
 * `URLSearchParams.get("path")`), matching the design's read path.
 *
 * Ordering discipline:
 *   1. `null` → `none`
 *   2. Trim-empty → `empty` (the empty-value branch of Req 10.5)
 *   3. Over 4096 chars → `overlength` (Req 10.5 bounds cheap path attacks)
 *   4. No resolvable segments → `empty` (all-slashes or all-malformed)
 *   5. Otherwise → `resolvable`
 */
export function evaluateDeepLinkPath(raw: string | null): DeepLinkEvaluation {
  if (raw === null) return { kind: "none" };

  // Leading/trailing whitespace is trimmed per Req 10.1. We check length
  // against the trimmed value so a user-pasted `"  \t\n"` hits the empty
  // branch instead of the overlength branch.
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "error", reason: "empty" };
  if (trimmed.length > DEEP_LINK_MAX_LENGTH) {
    return { kind: "error", reason: "overlength" };
  }

  const segments = splitEncoded(trimmed);
  if (segments.length === 0) {
    // All segments were empty or malformed escapes. We cannot construct a
    // lookup path, so the caller should fall back to root + inline error
    // per Req 10.5.
    return { kind: "error", reason: "empty" };
  }
  return { kind: "resolvable", segments };
}

/**
 * The decision `useFilesTabUrlSync` makes on every `currentLocationId`
 * change. Exposed as a pure function so tests exercise every branch without
 * touching the DOM.
 */
export type UrlSyncPlan = { action: "noop" } | { action: "replace"; url: string };

export interface PlanUrlSyncInput {
  /** `window.location.pathname` at the time of the write. */
  pathname: string;
  /** `window.location.search` at the time of the write (includes leading `?`). */
  search: string;
  /** `window.location.hash` at the time of the write (includes leading `#`). */
  hash: string;
  /**
   * The `encodePath(...)` output for the current location. Empty string
   * means "root state" — the caller must remove `?path=` entirely per the
   * URL contract (NOT leave an empty `?path=`).
   */
  encodedPath: string;
  /**
   * Opaque identity used only for a task-scoped file. It takes precedence
   * over `encodedPath`, which is intentionally empty for private task
   * storage.
   */
  fileId?: string | null;
}

/**
 * Decide how to sync the URL to `encodedPath`.
 *
 * Rules (design.md § URL Contract):
 * - Always `history.replaceState`, never `pushState` — the caller
 *   (`useFilesTabUrlSync`) enforces this by only ever calling
 *   `replaceState` on the result.
 * - Root state (`encodedPath === ""`) removes the `path` key entirely; the
 *   URL must not carry an empty-value `?path=`. This is the distinction the
 *   task calls out: "no `?path=` parameter (not empty-value `?path=`)".
 * - Other query params are preserved verbatim without re-encoding. Per the
 *   design, "the full value is not additionally URL-encoded", so we bypass
 *   `URLSearchParams` (which would re-encode `/` → `%2F`) and manipulate
 *   the raw query string by key.
 */
export function planUrlSync(input: PlanUrlSyncInput): UrlSyncPlan {
  const nextSearch = computeNextSearch(
    input.search,
    input.encodedPath,
    input.fileId,
  );
  if (nextSearch === input.search) return { action: "noop" };
  return {
    action: "replace",
    url: `${input.pathname}${nextSearch}${input.hash}`,
  };
}

/**
 * Rewrite the raw query string so the `path` key matches `encodedPath`.
 * Keeps non-path pairs in their original order; appends `path` at the end
 * when present. No re-encoding of values.
 */
function computeNextSearch(
  currentSearch: string,
  encodedPath: string,
  fileId?: string | null,
): string {
  const raw = currentSearch.startsWith("?")
    ? currentSearch.slice(1)
    : currentSearch;

  const others: Array<{ key: string; value: string; hasEquals: boolean }> = [];
  if (raw.length > 0) {
    for (const chunk of raw.split("&")) {
      if (!chunk) continue;
      const eqIdx = chunk.indexOf("=");
      if (eqIdx === -1) {
        if (chunk === "path") continue; // drop
        others.push({ key: chunk, value: "", hasEquals: false });
        continue;
      }
      const key = chunk.slice(0, eqIdx);
      if (key === "path" || key === "fileId" || key === "line" || key === "column") continue; // drop and re-emit if needed
      others.push({
        key,
        value: chunk.slice(eqIdx + 1),
        hasEquals: true,
      });
    }
  }

  const pairs = others.map((p) => (p.hasEquals ? `${p.key}=${p.value}` : p.key));
  if (fileId) {
    pairs.push(`fileId=${encodeURIComponent(fileId)}`);
  } else if (encodedPath !== "") {
    pairs.push(`path=${encodedPath}`);
  }

  if (pairs.length === 0) return "";
  return `?${pairs.join("&")}`;
}
