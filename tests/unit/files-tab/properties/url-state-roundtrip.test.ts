// Property 3 — url_state_roundtrip
//
// **Validates: Req 10.1, 10.4, 20.1**
//
// Files Tab GitHub Redesign spec, Task 2.9. See design.md § Correctness
// Properties / Property 3 for the prose statement, and url.ts for the
// subject under test.
//
// Invariant (design.md § Property 3):
//   For every `currentLocationId` that is either `null` or resolves to a
//   `ProjectNode` in `nodesById`:
//     (a) `mockFindNodeByPathAny(projectId, splitEncoded(encodePath(
//             nodesById, id))).id === id` for every non-null id.
//     (b) `encodePath(nodesById, null) === ""` — the root state carries no
//         `?path=` param (design.md § URL Contract), so callers that omit
//         `?path=` entirely on absence are the root-state branch.
//     (c) When the URL has no `?path=` param, the deep-link pipeline falls
//         back to root. We represent this branch by showing that
//         `splitEncoded("")` yields `[]`, i.e. there are no segments to
//         hand to `findNodeByPathAny`, which means the resolver stays at
//         root per the URL contract.
//
// The mock stands in for the `findNodeByPathAny` server action. It mirrors
// the production walk (`src/app/actions/files/nodes.ts`): match by name at
// each parent boundary, require every non-terminal match to be a folder,
// and return `null` on the first miss. Because this is a unit PBT we never
// touch the DB — see design.md § Property 3 ("Tested against an in-memory
// mock of the server action that walks the provided `nodesById` tree").

import test from "node:test";
import fc from "fast-check";
import assert from "node:assert/strict";

import type { ProjectNode } from "@/lib/db/schema";
import {
  encodePath,
  splitEncoded,
} from "@/components/projects/v2/files-tab/url";

// ---------------------------------------------------------------------------
// Generators (design.md § Property 3 / Inputs)
// ---------------------------------------------------------------------------

// Name character generator. Excludes:
//   • "/"    — Req 7.9: segment separator, forbidden in names.
//   • C0/C1 control chars + U+007F (DEL) — Req 7.9 forbids control chars.
//   • Unicode surrogate halves — invalid as standalone code points.
//
// We draw from the BMP minus surrogates so encodeURIComponent stays lossless
// and the round-trip we assert below is meaningful across the Unicode range
// that real filenames use.
const nameCharArb = fc
  .integer({ min: 0x20, max: 0xd7ff })
  .map((cp) => String.fromCodePoint(cp))
  .filter((ch) => {
    if (ch === "/") return false;
    const code = ch.charCodeAt(0);
    if (code === 0x7f) return false; // DEL
    if (code >= 0x80 && code <= 0x9f) return false; // C1 controls
    return true;
  });

const nameArb = fc.string({
  unit: nameCharArb,
  minLength: 1,
  maxLength: 6,
});

const typeArb = fc.constantFrom<"file" | "folder">("file", "folder");

type GenNode = {
  readonly name: string;
  readonly type: "file" | "folder";
  readonly children: readonly GenNode[];
};

// fc.letrec recursive tree generator. The `depthSize: "small"` discipline
// bounds the expected depth near the spec target (1..6) without fixing an
// exact depth, and sibling uniqueness on `name` guarantees the server's
// `findFirst` semantics resolve to a single node at every level.
const treeArbs = fc.letrec<{ genNode: GenNode }>((tie) => ({
  genNode: fc.record({
    name: nameArb,
    type: typeArb,
    children: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      fc.constant([] as readonly GenNode[]),
      fc.uniqueArray(tie("genNode") as fc.Arbitrary<GenNode>, {
        minLength: 1,
        maxLength: 8,
        selector: (n) => n.name,
      }),
    ),
  }),
}));

const forestArb = fc.uniqueArray(treeArbs.genNode, {
  minLength: 1,
  maxLength: 8,
  selector: (n) => n.name,
});

// ---------------------------------------------------------------------------
// Tree materialization: generated forest → flat ProjectNode maps
// ---------------------------------------------------------------------------

type FlatTree = {
  nodesById: Record<string, ProjectNode>;
  // Map from parentId (`"root"` sentinel for top-level) to its children.
  // The mock walker uses this to avoid scanning nodesById on each step.
  childrenByParentId: Record<string, ProjectNode[]>;
  nodeIds: string[];
};

function flatten(forest: readonly GenNode[], projectId: string): FlatTree {
  const nodesById: Record<string, ProjectNode> = {};
  const childrenByParentId: Record<string, ProjectNode[]> = { root: [] };
  const nodeIds: string[] = [];
  let counter = 0;

  function visit(gen: GenNode, parentId: string | null): void {
    counter += 1;
    const id = `n-${counter}`;
    // Force any node with children to be a folder. This mirrors reality
    // (files cannot contain children) AND the `findNodeByPathAny` walker
    // contract (non-terminal segments must be folders) so the generated
    // tree is legal input for the property.
    const type: "file" | "folder" = gen.children.length > 0 ? "folder" : gen.type;
    const node: ProjectNode = {
      id,
      projectId,
      parentId,
      path: "/",
      type,
      name: gen.name,
      s3Key: null,
      size: 0,
      mimeType: null,
      currentVersion: 1,
      metadata: {},
      gitHash: null,
      createdBy: null,
      deletedBy: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      deletedAt: null,
    };
    nodesById[id] = node;
    nodeIds.push(id);
    const bucketKey = parentId ?? "root";
    (childrenByParentId[bucketKey] ??= []).push(node);
    for (const child of gen.children) visit(child, id);
  }

  for (const top of forest) visit(top, null);
  return { nodesById, childrenByParentId, nodeIds };
}

// ---------------------------------------------------------------------------
// In-memory mock of `findNodeByPathAny`
// ---------------------------------------------------------------------------

// Mirrors `src/app/actions/files/nodes.ts#findNodeByPathAny`:
//   - Empty segments → null.
//   - Walk from root down, matching child `name` at each level.
//   - For every NON-terminal segment the matched child must be a folder.
//   - Return null on the first miss; otherwise return the final node.
//
// `projectId` is accepted for API parity with the server action (the task
// writes `mockFindNodeByPathAny(projectId, ...)` verbatim) but is unused
// here because the mock only ever sees a single project's tree.
function mockFindNodeByPathAny(
  _projectId: string,
  childrenByParentId: Record<string, ProjectNode[]>,
  segments: string[],
): ProjectNode | null {
  if (segments.length === 0) return null;
  let parentKey: string = "root";
  let matched: ProjectNode | null = null;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    const siblings = childrenByParentId[parentKey] ?? [];
    const candidate = siblings.find(
      (n) => n.name === segment && (isLast || n.type === "folder"),
    );
    if (!candidate) return null;
    matched = candidate;
    parentKey = candidate.id;
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Property assertion — design.md § Property 3
// ---------------------------------------------------------------------------

test("Property 3: url_state_roundtrip — encodePath ⇄ splitEncoded ⇄ findNodeByPathAny", () => {
  // **Validates: Req 10.1, 10.4, 20.1**
  fc.assert(
    fc.property(forestArb, (forest) => {
      const projectId = "proj-1";
      const { nodesById, childrenByParentId, nodeIds } = flatten(
        forest,
        projectId,
      );

      // Invariant (b): null id encodes to empty string (root state has no
      //                `?path=` per the URL contract).
      assert.equal(
        encodePath(nodesById, null),
        "",
        "encodePath(nodesById, null) must be empty string",
      );

      // Invariant (c): when `?path=` is absent the deep-link pipeline sees
      //                no segments. splitEncoded("") === [] models the
      //                "root resolves when ?path= absent" branch: no
      //                segments to hand the resolver → stay at root.
      assert.deepEqual(
        splitEncoded(""),
        [],
        "splitEncoded('') must yield [] so absent ?path= resolves to root",
      );

      // Invariant (a): every non-null id in the generated tree round-trips
      //                through encode → split → resolve and returns itself.
      for (const id of nodeIds) {
        const encoded = encodePath(nodesById, id);
        const segments = splitEncoded(encoded);
        const resolved = mockFindNodeByPathAny(
          projectId,
          childrenByParentId,
          segments,
        );
        assert.ok(
          resolved,
          `round-trip resolved null for id=${id} name=${JSON.stringify(
            nodesById[id].name,
          )} encoded=${JSON.stringify(encoded)}`,
        );
        assert.equal(
          resolved.id,
          id,
          `round-trip id mismatch: got ${resolved.id} expected ${id} (encoded=${JSON.stringify(encoded)})`,
        );
      }

      return true;
    }),
    { numRuns: 100 },
  );
});
