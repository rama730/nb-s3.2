// Task 2.7 — Property 1: tree ⇄ breadcrumb sync.
//
// **Validates: Req 3.1, 3.2, 6.1, 6.2, 6.3, 6.5, 2.8, 2.10, 4.7, 4.8**
//
// Invariant (design.md § Correctness Properties / Property 1):
//   For every sequence of navigation actions applied to a generated project
//   tree, the ordered ids of the rendered breadcrumb segments equal the
//   ordered ids of `ancestorChain(nodesById, currentLocationId)`.
//
// Adaptation note: `deriveBreadcrumbSegments` (see
// src/components/projects/v2/files-tab/breadcrumb/BreadcrumbBar.tsx) prepends
// a synthetic `root` segment with `id: null`, so we compare
// `segments.slice(1).map(s => s.id)` against
// `ancestorChain(...).map(n => n.id)`.
//
// Generators (per tasks.md § Task 2.7):
//   * `fc.letrec` project tree: depth 1..6, fan-out 0..8, with file/folder
//     discrimination. Node names exclude `/` and ASCII/Unicode control
//     characters per Req 7.9 (names that include `/` or are empty are
//     invalid operations — see requirements.md § Req 7.9).
//   * `fc.array` of navigation actions — each action is either the id of a
//     node in the generated tree or `null` (navigate to project root).
//
// Runs: `fc.assert(..., { numRuns: 100 })` per design § Correctness
// Properties and the README in this folder.
//
// ─── Module-load dance ───────────────────────────────────────────────
//
// `BreadcrumbBar.tsx` transitively imports `@/app/actions/files`, which
// loads `@/lib/db` at module time — and that triggers Zod env validation
// for `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, etc. `npm run test:unit`
// does not load `.env.local`, so a direct static `import` would crash with
// "Environment validation failed" before any assertion ran. We stub the
// required env vars in a `before` hook and dynamically import the module.
// `deriveBreadcrumbSegments` is pure and never touches the stubbed values.

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import type { ProjectNode } from "@/lib/db/schema";
import {
  ancestorChain,
  type CurrentLocation,
} from "@/components/projects/v2/files-tab/navigation";

// Late-bound module exports; assigned in the `before` hook below.
type BreadcrumbSegment =
  | { kind: "root"; id: null; name: string }
  | { kind: "folder"; id: string; name: string }
  | { kind: "file"; id: string; name: string };

let deriveBreadcrumbSegments: (
  location: CurrentLocation | null,
  chain: ReadonlyArray<{ id: string; name: string; type: "folder" | "file" }>,
) => BreadcrumbSegment[];

before(async () => {
  // Any non-empty values that satisfy the Zod schema inside `@/lib/db`.
  // The helpers under test never touch these, but the schema runs at
  // module-load time and must succeed for the import to complete.
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";

  const mod = await import(
    "@/components/projects/v2/files-tab/breadcrumb/BreadcrumbBar"
  );
  deriveBreadcrumbSegments = mod.deriveBreadcrumbSegments;
});

// ---------------------------------------------------------------------------
// Tree spec types — the shape produced by the `fc.letrec` arbitrary. Ids are
// assigned deterministically in a post-processing pass so the generator only
// has to worry about shape and names.
// ---------------------------------------------------------------------------

type TreeSpec =
  | { type: "file"; name: string }
  | { type: "folder"; name: string; children: TreeSpec[] };

// Project-node name arbitrary (Req 7.9):
//   - at least 1 char, at most 6 (tight bound keeps shrinks readable)
//   - MUST NOT contain `/`
//   - MUST NOT contain ASCII/Unicode control characters (0x00-0x1F, 0x7F,
//     and the C1 range 0x80-0x9F)
//   - trimmed string MUST be non-empty (Req 7.9's intent — names that would
//     render as visually empty breadcrumb segments are invalid)
const nameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 6 })
  .filter((s) => {
    if (s.includes("/")) return false;
    if (s.trim().length === 0) return false;
    for (let i = 0; i < s.length; i += 1) {
      const code = s.charCodeAt(i);
      if (code < 0x20) return false; // C0 controls + NUL
      if (code === 0x7f) return false; // DEL
      if (code >= 0x80 && code <= 0x9f) return false; // C1 controls
    }
    return true;
  });

// Tree arbitrary (depth 1..6, fan-out 0..8).
//
// `fc.letrec` + `fc.oneof({ maxDepth: 6 }, ...)` bounds tree depth: once the
// depth budget is consumed, `fc.oneof` picks the first non-recursive branch
// (the `file` record), so recursion always terminates.
const treeSpecArb: fc.Arbitrary<TreeSpec> = fc.letrec<{ tree: TreeSpec }>(
  (tie) => ({
    tree: fc.oneof(
      { maxDepth: 6 },
      fc.record({
        type: fc.constant("file" as const),
        name: nameArb,
      }),
      fc.record({
        type: fc.constant("folder" as const),
        name: nameArb,
        children: fc.array(tie("tree"), { minLength: 0, maxLength: 8 }),
      }),
    ) as fc.Arbitrary<TreeSpec>,
  }),
).tree;

// ---------------------------------------------------------------------------
// Materialize a `TreeSpec` into a `Record<id, ProjectNode>` + a flat id list.
// Ids are assigned deterministically by DFS order so the property's
// counter-examples are stable under shrinking.
// ---------------------------------------------------------------------------

interface Materialized {
  nodesById: Record<string, ProjectNode>;
  nodeIds: string[]; // every id in the tree, DFS pre-order
}

function buildNode(
  id: string,
  parentId: string | null,
  spec: TreeSpec,
): ProjectNode {
  const now = new Date("2026-01-01T00:00:00Z");
  return {
    id,
    projectId: "proj-pbt",
    parentId,
    path: "/",
    type: spec.type,
    name: spec.name,
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
  };
}

function materialize(root: TreeSpec): Materialized {
  const nodesById: Record<string, ProjectNode> = {};
  const nodeIds: string[] = [];
  let counter = 0;

  const walk = (spec: TreeSpec, parentId: string | null): void => {
    const id = `n${counter++}`;
    nodeIds.push(id);
    nodesById[id] = buildNode(id, parentId, spec);
    if (spec.type === "folder") {
      for (const child of spec.children) walk(child, id);
    }
  };

  walk(root, null);
  return { nodesById, nodeIds };
}

// ---------------------------------------------------------------------------
// Navigation action arbitrary: a sequence of `currentLocationId` targets.
// Each target is either one of the tree's node ids or `null` (project root).
// `fc.constantFrom` lets the shrinker prefer earlier ids in the tree.
// ---------------------------------------------------------------------------

function navigationActionsArb(
  nodeIds: string[],
): fc.Arbitrary<Array<string | null>> {
  const choices: fc.Arbitrary<string | null> = fc.oneof(
    fc.constant(null as string | null),
    fc.constantFrom(...nodeIds),
  );
  return fc.array(choices, { minLength: 1, maxLength: 20 });
}

// ---------------------------------------------------------------------------
// Turn a `currentLocationId` + `nodesById` into a `CurrentLocation`, the
// shape `deriveBreadcrumbSegments` consumes. Mirrors `useCurrentLocation`
// without pulling React into the test.
// ---------------------------------------------------------------------------

function toCurrentLocation(
  nodesById: Record<string, ProjectNode>,
  id: string | null,
): CurrentLocation {
  if (id === null) return { type: "root" };
  const node = nodesById[id];
  // Unresolved id → root, consistent with `useCurrentLocation`.
  if (!node) return { type: "root" };
  if (node.type === "file") return { type: "file", id: node.id, node };
  return { type: "folder", id: node.id, node };
}

// ---------------------------------------------------------------------------
// Property 1 — the invariant.
// ---------------------------------------------------------------------------

describe("property: tree ⇄ breadcrumb sync (Property 1)", () => {
  it("breadcrumb segments minus synthetic root equal ancestorChain ids", () => {
    fc.assert(
      fc.property(
        treeSpecArb.chain((root) => {
          const materialized = materialize(root);
          return fc.tuple(
            fc.constant(materialized),
            navigationActionsArb(materialized.nodeIds),
          );
        }),
        ([materialized, actions]) => {
          const { nodesById } = materialized;

          for (const currentLocationId of actions) {
            const chain = ancestorChain(nodesById, currentLocationId);
            const location = toCurrentLocation(nodesById, currentLocationId);
            const segments = deriveBreadcrumbSegments(location, chain);

            // Adapted invariant: strip the synthetic `root` segment that
            // `deriveBreadcrumbSegments` always prepends, then compare ids
            // 1:1 against `ancestorChain`.
            const segmentIds = segments.slice(1).map((s) => s.id);
            const chainIds = chain.map((n) => n.id);

            assert.deepEqual(segmentIds, chainIds);

            // Cross-check the synthetic root is present and shaped correctly
            // (Req 3.1–3.2): every breadcrumb starts with the `root` kind
            // carrying `id: null`.
            assert.equal(segments[0]?.kind, "root");
            assert.equal(segments[0]?.id, null);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
