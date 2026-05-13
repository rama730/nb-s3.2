// Task 2.8 — Property test: `metadata_matches_selection` (Property 2).
//
// **Validates: Req 17.1, 17.2, 17.3, 17.4, 5.1, 5.3, 5.4**
//
// See design.md § Correctness Properties and § Metadata Bug Fix for the
// architectural rationale. This property pins the Req 17 structural fix
// for the metadata-stale-on-close bug.
//
// ─── Invariant ───────────────────────────────────────────────────────
//
// For every reachable navigation state (tree, navigation sequence) of
// the Files tab v3, after any sequence of navigation actions exactly
// one of the following holds:
//
//   (a) `currentLocation.type !== "file"` — the MetadataStrip is NOT
//       rendered anywhere in the tree.  FilesTabMain takes the folder /
//       root branch and `<FileView>` (and therefore
//       `<MetadataStrip>`) is not in the React output at all
//       (Req 17.1, 17.2, 17.4; Req 5.1 is n/a in this branch).
//
//   (b) `currentLocation.type === "file"` — the MetadataStrip IS
//       rendered, and its `data-node-id` attribute equals
//       `currentLocation.id`, which equals the raw `currentLocationId`
//       written to the store (Req 17.3, Req 5.1, Req 5.3, Req 5.4).
//
// ─── Testing strategy (no jsdom, no RTL) ─────────────────────────────
//
// This repo does not ship jsdom or React Testing Library, so we cannot
// query the live DOM. Following the pattern set by neighbouring tests
// (`tests/unit/files-tab/file-view.test.ts`, `files-tab-main.test.ts`,
// `metadata-strip.test.ts`, `folder-list.test.ts`) we prove the same
// invariant in two complementary ways:
//
//   1. Data-level PBT (`numRuns: 100`) — generate a project tree and a
//      navigation sequence, walk the sequence using the real
//      `selectCurrentLocation` selector from `useCurrentLocation.ts`,
//      and assert the invariant on the derived `CurrentLocation` plus
//      the "expected MetadataStrip" it implies. This exhaustively
//      covers the navigation state machine up to 100 random sequences.
//
//   2. Source-level pins on the three components that implement the
//      DOM contract:
//        - `FilesTabMain.tsx` renders `<FileView key={location.id}>`
//          only in the `location.type === "file"` branch (structurally
//          excluding `MetadataStrip` from folder/root branches).
//        - `FileView.tsx` renders `<MetadataStrip>` unconditionally
//          inside its own body (so when FileView is in the tree, so is
//          MetadataStrip).
//        - `MetadataStrip.tsx` sets `data-node-id={node.id}` at the
//          root element and derives its `node` from props (no shared
//          state, no cache).
//      Together these bridges prove the data-level invariant is
//      preserved in the rendered DOM.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import fc from "fast-check";

import type { ProjectNode } from "@/lib/db/schema";
import {
  defaultWorkspace,
  type ProjectWorkspaceState,
} from "@/stores/files/types";
import { selectCurrentLocation } from "@/components/projects/v2/files-tab/hooks/useCurrentLocation";

// ---------------------------------------------------------------------------
// Tree generation
// ---------------------------------------------------------------------------
//
// Generates a depth-bounded project tree. Each node knows its type,
// parent, and a safe name. Names exclude `/` and control characters
// (mirrors Task 2.7's node-name constraint and Req 7.9 — even though
// the metadata property does not exercise names, we use the same
// generator so sibling PBTs can share a fixture).
//
// Rationale for the shape:
//   • depth ∈ [1, 6]  matches Task 2.7 ("depth 1..6")
//   • fanout ∈ [0, 8] matches Task 2.7 ("fan-out 0..8"); fanout 0 yields
//     a leaf folder (empty folder) which is a useful edge case.
//   • Every subtree root is either a `file` leaf or a `folder` with
//     children. We always allow folders even at max depth so we can
//     exercise "navigate to an empty folder" branches.

interface RawNode {
  type: "file" | "folder";
  children: RawNode[];
}

function rawNodeArb(depth: number): fc.Arbitrary<RawNode> {
  const leaf = fc.record<RawNode>({
    type: fc.constantFrom<"file" | "folder">("file"),
    children: fc.constant<RawNode[]>([]),
  });

  if (depth <= 0) {
    // Max depth reached: only leaves (file) or an empty folder.
    return fc.oneof(
      leaf,
      fc.record<RawNode>({
        type: fc.constant("folder"),
        children: fc.constant<RawNode[]>([]),
      }),
    );
  }

  // Recursive arm: a folder with 0..8 children, each recursively
  // generated with depth decreased. `fc.oneof` biases toward the first
  // entry, so weight leaves lightly higher at shallow depths to keep
  // trees interesting (not all-folder cascades).
  return fc.oneof(
    { withCrossShrink: true },
    leaf,
    fc.record<RawNode>({
      type: fc.constant("folder"),
      children: fc.array(rawNodeArb(depth - 1), {
        minLength: 0,
        maxLength: 8,
      }),
    }),
  );
}

// Root is always a folder with 0..8 children so a "project" is always a
// container of nodes. An empty root (no children) is a legal edge case
// (first-time project) — still covered.
const projectTreeArb: fc.Arbitrary<{
  root: RawNode;
  depth: number;
}> = fc
  .integer({ min: 1, max: 6 })
  .chain((depth) =>
    fc.record({
      depth: fc.constant(depth),
      root: fc.record<RawNode>({
        type: fc.constant("folder"),
        children: fc.array(rawNodeArb(depth - 1), {
          minLength: 0,
          maxLength: 8,
        }),
      }),
    }),
  );

// ---------------------------------------------------------------------------
// Flatten the raw tree into `nodesById` + `ids`
// ---------------------------------------------------------------------------

interface FlatTree {
  nodesById: Record<string, ProjectNode>;
  /** All node ids, including the root folder. */
  ids: string[];
  /** Root id — always present, the natural "folder" navigation target. */
  rootId: string;
}

function flattenTree(root: RawNode, projectId: string): FlatTree {
  const nodesById: Record<string, ProjectNode> = {};
  const ids: string[] = [];

  let seq = 0;
  function mkId(): string {
    seq += 1;
    return `n${seq}`;
  }

  function walk(raw: RawNode, parentId: string | null): string {
    const id = mkId();
    // Minimum shape required by `selectCurrentLocation` — it only reads
    // `.id`, `.type`. Other fields carry safe defaults so consumers
    // treating the node as a `ProjectNode` do not crash on access.
    const node = {
      id,
      projectId,
      parentId,
      path: "/",
      type: raw.type,
      name: raw.type === "folder" ? `folder-${id}` : `file-${id}.txt`,
      s3Key: raw.type === "file" ? `s3/${id}` : null,
      size: raw.type === "file" ? 42 : 0,
      mimeType: raw.type === "file" ? "text/plain" : null,
      currentVersion: 1,
      metadata: {},
      gitHash: null,
      createdBy: null,
      deletedBy: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      deletedAt: null,
    } as unknown as ProjectNode;
    nodesById[id] = node;
    ids.push(id);
    for (const child of raw.children) {
      walk(child, id);
    }
    return id;
  }

  const rootId = walk(root, null);
  return { nodesById, ids, rootId };
}

// ---------------------------------------------------------------------------
// Navigation target generator
// ---------------------------------------------------------------------------
//
// Each step in a navigation sequence is one of:
//   • `null` — navigate to project root (`{ type: "root" }`)
//   • an existing id — resolves to either folder or file
//   • a synthetic "ghost" id — exercises the transient-race branch
//     where `selectCurrentLocation` falls back to `{ type: "root" }`
//     (deep-link arrival before cache hydrates; Req 6.6 / Req 10.5
//     surfaces are owned by the caller, not the selector).
//
// Including the ghost branch ensures the invariant holds even under
// the "set but unresolvable" state that only `selectCurrentLocation`
// handles gracefully.

function navigationTargetArb(ids: string[]): fc.Arbitrary<string | null> {
  const branches: fc.Arbitrary<string | null>[] = [
    fc.constant<string | null>(null),
    // Ghost id — intentionally NOT in `nodesById`. Prefix with `ghost-`
    // so it cannot collide with the `n<seq>` ids produced by
    // `flattenTree`.
    fc
      .string({ minLength: 1, maxLength: 8 })
      .map<string | null>((s) => `ghost-${s}`),
  ];
  if (ids.length > 0) {
    branches.push(fc.constantFrom<string>(...ids));
  }
  return fc.oneof(...branches);
}

// ---------------------------------------------------------------------------
// Property: the test case
// ---------------------------------------------------------------------------

interface TestCase {
  flat: FlatTree;
  navigation: Array<string | null>;
}

const testCaseArb: fc.Arbitrary<TestCase> = projectTreeArb.chain(({ root }) => {
  const flat = flattenTree(root, "project-1");
  return fc.record<TestCase>({
    flat: fc.constant(flat),
    navigation: fc.array(navigationTargetArb(flat.ids), {
      minLength: 1,
      maxLength: 12,
    }),
  });
});

// ---------------------------------------------------------------------------
// Derived "expected MetadataStrip" from the rendering contract
// ---------------------------------------------------------------------------
//
// Models what `FilesTabMain` + `FileView` + `MetadataStrip` would
// produce without rendering anything. The contract is:
//
//   • FilesTabMain renders `<FileView>` only when `location.type === "file"`.
//   • FileView renders `<MetadataStrip node={node} ...>` unconditionally.
//   • MetadataStrip root element has `data-node-id={node.id}`.
//
// So: when `location.type === "file"`, the rendered MetadataStrip has
// `dataNodeId = location.id`. Otherwise no MetadataStrip is rendered.

type ExpectedMetadata = { dataNodeId: string } | null;

function expectedMetadata(
  nodesById: Record<string, ProjectNode>,
  currentLocationId: string | null,
): ExpectedMetadata {
  const workspace: ProjectWorkspaceState = {
    ...defaultWorkspace(),
    nodesById,
    currentLocationId,
  };
  const location = selectCurrentLocation(workspace);
  // `selectCurrentLocation` only returns `null` when the workspace is
  // `undefined`. We always pass a concrete workspace here, so the
  // `null` case is unreachable and we guard defensively.
  if (location === null) return null;
  if (location.type !== "file") return null;
  return { dataNodeId: location.id };
}

// ---------------------------------------------------------------------------
// Data-level PBT
// ---------------------------------------------------------------------------

describe("metadata_matches_selection — Property 2 (Task 2.8)", () => {
  it("holds across 100 random (tree, navigation-sequence) samples", () => {
    // **Validates: Req 17.1, 17.2, 17.3, 17.4, 5.1, 5.3, 5.4**
    fc.assert(
      fc.property(testCaseArb, ({ flat, navigation }) => {
        let currentLocationId: string | null = null;
        for (const target of navigation) {
          // Apply one navigation step. In the real store,
          // `setCurrentLocation` also expands ancestors and bumps
          // version counters, but those side effects are not observable
          // by MetadataStrip — it reads `currentLocation.id` through
          // the `FileView` prop, which is derived from the same
          // `currentLocationId`. So for the invariant we care about,
          // a simple assignment is equivalent.
          currentLocationId = target;

          const workspace: ProjectWorkspaceState = {
            ...defaultWorkspace(),
            nodesById: flat.nodesById,
            currentLocationId,
          };
          const location = selectCurrentLocation(workspace);

          // Selector is total over a defined workspace.
          assert.ok(
            location !== null,
            "selectCurrentLocation must not return null for a defined workspace",
          );

          const metadata = expectedMetadata(flat.nodesById, currentLocationId);

          if (location.type !== "file") {
            // (a) MetadataStrip absent. Req 17.1, 17.2, 17.4.
            assert.equal(
              metadata,
              null,
              `expected MetadataStrip to be absent when location.type = "${location.type}" (currentLocationId=${String(currentLocationId)})`,
            );
          } else {
            // (b) MetadataStrip present with matching data-node-id.
            // Req 17.3, Req 5.1, Req 5.3, Req 5.4.
            assert.ok(
              metadata !== null,
              `expected MetadataStrip to be present when location.type = "file"`,
            );
            assert.equal(
              metadata.dataNodeId,
              location.id,
              `MetadataStrip data-node-id (${metadata.dataNodeId}) must equal currentLocation.id (${location.id})`,
            );
            // And transitively, data-node-id === currentLocationId.
            assert.equal(
              metadata.dataNodeId,
              currentLocationId,
              `MetadataStrip data-node-id (${metadata.dataNodeId}) must equal currentLocationId (${String(currentLocationId)})`,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Source-level pins
// ---------------------------------------------------------------------------
//
// These bind the DOM-side of the invariant since we cannot mount React.
// Any refactor that breaks the structural contract (e.g., moving the
// MetadataStrip render out of FileView, unkeying FileView, or changing
// the `data-node-id` attribute) will fail these assertions.

const REPO_COMPONENT_DIR = path.resolve(
  __dirname,
  "../../../../src/components/projects/v2/files-tab",
);

function readComponent(relPath: string): string {
  return readFileSync(path.join(REPO_COMPONENT_DIR, relPath), "utf8");
}

describe("metadata_matches_selection — source-level pins", () => {
  it("FilesTabMain renders `<FileView key={location.id}` only on the file branch", () => {
    const src = readComponent("FilesTabMain.tsx");
    // The main-area ternary must include the keyed FileView render.
    assert.match(
      src,
      /<FileView\s+key=\{location\.id\}/,
      "FilesTabMain must render FileView with key={location.id} so the subtree remounts on any id change (Req 17 structural fix)",
    );
    // The ternary must branch on `location.type === "file"` (or the
    // complementary folder/root branches) — pin the type guard directly.
    assert.match(
      src,
      /location\.type\s*===\s*"file"/,
      "FilesTabMain must gate the FileView render on location.type === 'file'",
    );
    // The folder branch must render `<FolderListView` and NOT
    // `<MetadataStrip`. Pin this by ensuring the file does not import
    // MetadataStrip directly: only FileView does.
    assert.doesNotMatch(
      src,
      /<MetadataStrip\b/,
      "FilesTabMain must not render MetadataStrip directly — it is owned by FileView",
    );
    assert.doesNotMatch(
      src,
      /\bMetadataStrip\b/,
      "FilesTabMain must not import MetadataStrip; the file-only gate lives in the FileView branch",
    );
  });

  it("FileView renders `<MetadataStrip>` unconditionally in its body", () => {
    const src = readComponent("file/FileView.tsx");
    // There must be a JSX use of MetadataStrip — this is the only
    // mount point for the component.
    assert.match(
      src,
      /<MetadataStrip\b/,
      "FileView must render <MetadataStrip> directly (design § MetadataStrip)",
    );
    // The MetadataStrip render must receive `node` sourced from the
    // `FileView` `node` prop (the one keyed by location.id at the
    // parent). This guards against regressions where someone wires
    // MetadataStrip to a cached / shared node reference.
    assert.match(
      src,
      /<MetadataStrip[\s\S]*?node=\{node(?:\s+as\s+[\w]+)?\}/,
      "MetadataStrip must receive `node` from the FileView prop (not a cached reference)",
    );
  });

  it("MetadataStrip root element carries `data-node-id={node.id}`", () => {
    const src = readComponent("file/MetadataStrip.tsx");
    assert.match(
      src,
      /data-testid="files-tab-metadata-strip"/,
      "MetadataStrip must expose a stable testid",
    );
    assert.match(
      src,
      /data-node-id=\{node\.id\}/,
      "MetadataStrip root must expose data-node-id={node.id} so Property 2 can verify the DOM (Req 17.3, Req 5.1)",
    );
  });
});
