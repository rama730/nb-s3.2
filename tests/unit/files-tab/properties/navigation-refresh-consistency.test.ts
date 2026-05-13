// Feature: files-tab-github-redesign, Property 4: navigation_refresh_consistency
//
// **Validates: Req 20.2, 20.3, 10.4**
//
// For any navigation sequence, simulating a "refresh" — take the `?path=`
// written by `planUrlSync`, parse it back out, feed it to the deep-link
// resolver — recovers the pre-reload `currentLocationId`.
//
// `jsdom` is not available in this repo (see design.md notes), so we
// simulate the refresh cycle with the pure helpers the real hooks use:
//   - `encodePath`        — write-side: state → URL segment
//   - `planUrlSync`       — write-side: URL mutation plan (Req 10.4)
//   - `splitEncoded`      — read-side: URL segment → name parts
//   - `evaluateDeepLinkPath` — read-side: validate the raw `?path=` value
//   - `resolveDeepLinkFromSearch` — read-side: raw value → resolved node
//
// Flow per iteration:
//   1. Generate a project tree (depth 1..6, fan-out 0..8, Req 7.9 names).
//   2. Generate a sequence of `navigateTo` actions over that tree.
//   3. Apply the sequence → `terminalLocationId` (state of the "store"
//      at the moment of the simulated reload).
//   4. Compute `encoded = encodePath(nodesById, terminalLocationId)` and
//      run it through `planUrlSync` to observe the URL that would be
//      persisted by `syncUrlToLocation`. `planUrlSync` drives the
//      Req 10.4 invariant that only `replaceState` is ever called with
//      a URL matching `?path=<encoded>` (or no `?path=` at root).
//   5. "Simulate the refresh": extract the `path=` value from the
//      planned URL (or use `null` at root) and feed it through
//      `evaluateDeepLinkPath` + `resolveDeepLinkFromSearch` with an
//      in-memory `findNodeByPathAny` that walks the generated tree.
//   6. Assert the resolver lands on the same `currentLocationId` that
//      was active pre-reload — `ok` with `nodeId === terminalLocationId`
//      for any node, `none` when we reloaded from the root state.
//
// Generators enforce Req 7.9 (no `/` or control chars in names) and
// keep names globally unique — the real DB enforces sibling uniqueness;
// globally unique is strictly stronger, which is fine for the property.
//
// Uses `fc.assert(..., { numRuns: 100 })` per the task spec.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import type { ProjectNode } from "@/lib/db/schema";
import {
  encodePath,
  evaluateDeepLinkPath,
  planUrlSync,
  splitEncoded,
} from "@/components/projects/v2/files-tab/url";
import {
  resolveDeepLinkFromSearch,
  type ResolveDeepLinkDeps,
} from "@/components/projects/v2/files-tab/hooks/useDeepLinkResolver";

// ─── Generated-tree fixture types ────────────────────────────────────

interface Shape {
  type: "folder" | "file";
  children: Shape[];
}

interface FlatNode {
  idx: number;
  parent: number | null;
  type: "folder" | "file";
}

interface GeneratedTree {
  nodes: ProjectNode[];
  nodesById: Record<string, ProjectNode>;
}

// ─── Tree shape generator (bounded, per design § Property 4) ─────────

/**
 * Generates a single tree of up to `depth` levels, max fan-out 8 per
 * node. Files have no children. Depth 0 forces a file leaf — this keeps
 * the recursion bounded and matches the spec's "depth 1..6" bound.
 */
function shapeArb(depth: number): fc.Arbitrary<Shape> {
  const fileLeaf = fc.record({
    type: fc.constant<"file">("file"),
    children: fc.constant<Shape[]>([]),
  });
  if (depth <= 0) return fileLeaf;

  const folder = fc.record({
    type: fc.constant<"folder">("folder"),
    children: fc.array(shapeArb(depth - 1), { minLength: 0, maxLength: 8 }),
  });

  // File leaves are allowed at any depth; depth only caps nesting.
  return fc.oneof(
    { depthIdentifier: `shape-${depth}` },
    fileLeaf,
    folder,
  );
}

/** A forest of root-level nodes, 1..4 per project. */
const forestArb = fc.array(shapeArb(5), { minLength: 1, maxLength: 4 });

// ─── Flatten + name assignment ──────────────────────────────────────

function flattenForest(forest: Shape[]): FlatNode[] {
  const out: FlatNode[] = [];
  function visit(s: Shape, parent: number | null): void {
    const idx = out.length;
    out.push({ idx, parent, type: s.type });
    for (const c of s.children) visit(c, idx);
  }
  for (const root of forest) visit(root, null);
  return out;
}

/**
 * Name "prefix" generator. Excludes `/` and control characters per
 * Req 7.9. May be empty — uniqueness is guaranteed by appending the
 * node index. Allowing empty prefixes lets fast-check shrink toward
 * simpler names while keeping global uniqueness.
 */
const prefixArb: fc.Arbitrary<string> = fc.string({ minLength: 0, maxLength: 6 })
  .map((s) =>
    [...s]
      .filter((c) => {
        const code = c.charCodeAt(0);
        return c !== "/" && code >= 0x20 && code !== 0x7f;
      })
      .join(""),
  );

function buildName(prefix: string, idx: number): string {
  // Index suffix makes every name globally unique — strictly stronger
  // than the DB's sibling-uniqueness invariant, which is what
  // `findNodeByPathAny` relies on to resolve a path deterministically.
  return `${prefix}_${idx}`;
}

function assembleTree(flat: FlatNode[], prefixes: string[]): GeneratedTree {
  const projectId = "proj-1";
  const now = new Date("2026-01-01T00:00:00Z");

  const nodes: ProjectNode[] = flat.map((f, i) => ({
    id: `n${i}`,
    projectId,
    parentId: f.parent === null ? null : `n${f.parent}`,
    path: "/",
    type: f.type,
    name: buildName(prefixes[i] ?? "", i),
    s3Key: null,
    size: 0,
    mimeType: null,
    currentVersion: 1,
    metadata: {},
    gitHash: null,
    createdBy: null,
    deletedBy: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }));

  const nodesById: Record<string, ProjectNode> = Object.create(null);
  for (const n of nodes) nodesById[n.id] = n;
  return { nodes, nodesById };
}

const treeArb: fc.Arbitrary<GeneratedTree> = forestArb.chain((forest) => {
  const flat = flattenForest(forest);
  // Always at least 1 node because forest minLength=1 and each tree has
  // at least a single root. Keep the guard for type-safety.
  const size = Math.max(flat.length, 1);
  return fc
    .array(prefixArb, { minLength: size, maxLength: size })
    .map((prefixes) => assembleTree(flat, prefixes));
});

// ─── Navigation sequence generator ──────────────────────────────────

/**
 * A sequence of `navigateTo(id | null)` calls over an existing tree.
 * Each action selects either `null` (root) or an existing node id. The
 * "current location" after the sequence is the final action's target.
 */
function navigationSequenceArb(
  nodes: ProjectNode[],
): fc.Arbitrary<Array<string | null>> {
  const ids = nodes.map((n) => n.id);
  const stepArb: fc.Arbitrary<string | null> =
    ids.length === 0
      ? fc.constant<string | null>(null)
      : fc.oneof(
          fc.constant<string | null>(null),
          fc.constantFrom<string | null>(...ids),
        );
  return fc.array(stepArb, { minLength: 1, maxLength: 8 });
}

// ─── In-memory `findNodeByPathAny` walker ───────────────────────────

/**
 * An in-memory stand-in for `@/app/actions/files/nodes#findNodeByPathAny`
 * that operates on the generated tree. Mirrors the server implementation:
 *
 *   1. Walk segment-by-segment from `parentId === null`.
 *   2. Non-last segments must match a FOLDER (type === "folder").
 *   3. The last segment matches any type (folder or file).
 *   4. Return `null` on the first miss.
 *
 * Since our generator guarantees globally unique names, the walk is
 * deterministic. Taking the first sibling match by name is safe.
 */
function makeMockWalker(
  nodesById: Record<string, ProjectNode>,
): ResolveDeepLinkDeps["findNodeByPathAny"] {
  const childrenByParent = new Map<string | null, ProjectNode[]>();
  for (const node of Object.values(nodesById)) {
    const bucket = childrenByParent.get(node.parentId) ?? [];
    bucket.push(node);
    childrenByParent.set(node.parentId, bucket);
  }
  return async (_projectId, pathParts) => {
    if (pathParts.length === 0) return null;
    let parentId: string | null = null;
    let current: ProjectNode | null = null;
    for (let i = 0; i < pathParts.length; i++) {
      const segment = pathParts[i];
      const isLast = i === pathParts.length - 1;
      const siblings: ProjectNode[] = childrenByParent.get(parentId) ?? [];
      const match: ProjectNode | undefined = siblings.find((n: ProjectNode) =>
        isLast ? n.name === segment : n.name === segment && n.type === "folder",
      );
      if (!match) return null;
      current = match;
      parentId = match.id;
    }
    return current ? { id: current.id } : null;
  };
}

// ─── Refresh-cycle simulation ───────────────────────────────────────

/**
 * Pull the `path` key's value out of a raw `?...` query string using the
 * same semantic `useDeepLinkResolver` relies on (via `URLSearchParams`),
 * but without touching the DOM. The value is NOT URL-decoded here: the
 * contract of `resolveDeepLinkFromSearch` is to accept the raw encoded
 * value from the URL — decoding happens inside `splitEncoded`.
 *
 * Returns `null` when no `path` key is present (root state), or the raw
 * right-hand side of `path=<value>` otherwise. A bare `path` key with no
 * `=` returns the empty string.
 */
function extractPathParam(search: string): string | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  if (raw.length === 0) return null;
  for (const chunk of raw.split("&")) {
    if (chunk.length === 0) continue;
    const eqIdx = chunk.indexOf("=");
    if (eqIdx === -1) {
      if (chunk === "path") return "";
      continue;
    }
    if (chunk.slice(0, eqIdx) === "path") {
      return chunk.slice(eqIdx + 1);
    }
  }
  return null;
}

// ─── The property ───────────────────────────────────────────────────

describe("Property 4 — navigation_refresh_consistency", () => {
  it("recovers currentLocationId after simulated refresh (planUrlSync → resolveDeepLinkFromSearch)", async () => {
    await fc.assert(
      fc.asyncProperty(
        treeArb.chain((tree) =>
          navigationSequenceArb(tree.nodes).map((sequence) => ({ tree, sequence })),
        ),
        async ({ tree, sequence }) => {
          const projectId = "proj-1";
          const { nodesById } = tree;

          // 1. Apply the navigation sequence. Each action just sets the
          //    current location id; the final action's target IS the
          //    state at the moment of the simulated reload.
          let terminalLocationId: string | null = null;
          for (const action of sequence) terminalLocationId = action;

          // 2. Compute the encoded URL segment for the final location.
          //    For root (null) this is the empty string, which
          //    `planUrlSync` will turn into "no ?path= key at all".
          const encoded = encodePath(nodesById, terminalLocationId);

          // 3. Observe the URL that `syncUrlToLocation` would write.
          //    Start from a clean pathname with no pre-existing search
          //    so the resulting URL reflects only the Files tab's own
          //    contribution.
          const plan = planUrlSync({
            pathname: `/projects/${projectId}`,
            search: "",
            hash: "",
            encodedPath: encoded,
          });

          // Refresh cycle: "capture window.location.search" — the URL
          // the browser would be on right before the simulated unmount.
          const postNavSearch =
            plan.action === "replace"
              ? extractSearchFromUrl(plan.url)
              : "";

          // Sanity-check the write-side invariant (Req 10.4): the URL
          // uses `?path=<encoded>` verbatim, or no `?path=` at root.
          if (encoded === "") {
            assert.equal(
              postNavSearch.includes("path="),
              false,
              "root state must not write `path=` (Req 10.4, URL contract)",
            );
          } else {
            assert.equal(
              postNavSearch,
              `?path=${encoded}`,
              "planUrlSync must write `?path=<encoded>` verbatim",
            );
          }

          // 4. "Unmount + reset store + remount with pre-set ?path=" —
          //    all that survives across the simulated reload is the URL.
          //    Extract the raw `path=` value the way the deep-link
          //    resolver does on mount (Req 20.2, Req 20.3).
          const rawPathFromReload = extractPathParam(postNavSearch);

          // 5. Validate the pre-resolver classification is consistent
          //    with the terminal location. This exercises
          //    `evaluateDeepLinkPath` and `splitEncoded` so the four
          //    helpers listed by the task all participate in the cycle.
          const evaluation = evaluateDeepLinkPath(rawPathFromReload);
          if (terminalLocationId === null) {
            assert.equal(
              evaluation.kind,
              "none",
              "refresh from root must classify as `none`",
            );
          } else {
            assert.equal(
              evaluation.kind,
              "resolvable",
              "refresh from a node must classify as `resolvable`",
            );
            if (evaluation.kind === "resolvable") {
              // splitEncoded applied to the written `encoded` string
              // must yield the same segments evaluateDeepLinkPath
              // produced — otherwise the read path disagrees with the
              // write path.
              assert.deepEqual(splitEncoded(encoded), evaluation.segments);
            }
          }

          // 6. "Wait for the deep-link resolver" — feed the captured
          //    raw value through the same resolver `useDeepLinkResolver`
          //    uses on mount.
          const result = await resolveDeepLinkFromSearch(rawPathFromReload, {
            projectId,
            findNodeByPathAny: makeMockWalker(nodesById),
          });

          // 7. Assert the refresh landed back on the pre-reload id.
          if (terminalLocationId === null) {
            assert.equal(
              result.kind,
              "none",
              "root reload resolves to `none` — store stays at root",
            );
          } else {
            assert.equal(
              result.kind,
              "ok",
              `expected "ok", got ${result.kind} for terminal id ${terminalLocationId}`,
            );
            if (result.kind === "ok") {
              assert.equal(
                result.nodeId,
                terminalLocationId,
                "final currentLocationId must equal pre-reload value",
              );
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Helpers ────────────────────────────────────────────────────────

function extractSearchFromUrl(url: string): string {
  // The URL planUrlSync emits is `${pathname}${search}${hash}` where
  // search (if any) is already prefixed with `?`. Splitting on `?` is
  // unambiguous here because pathname has no `?` and hash comes after
  // the search. We take everything from the first `?` to the hash.
  const qIdx = url.indexOf("?");
  if (qIdx === -1) return "";
  const rest = url.slice(qIdx);
  const hIdx = rest.indexOf("#");
  return hIdx === -1 ? rest : rest.slice(0, hIdx);
}
