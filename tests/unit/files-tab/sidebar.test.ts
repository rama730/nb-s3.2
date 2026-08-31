// Task 3.1 acceptance test — `FilesTabSidebar`.
//
// Verifies (per tasks.md § 3.1):
//   (i)   Fixed width 280px when visible; 0px when
//         `ui.sidebarCollapsed === true` (Req 2.5–2.7, 15.14).
//   (ii)  Collapse toggle flips `ui.sidebarCollapsed` via the store
//         action shared with the existing sidebar (Req 2.4–2.5).
//   (iii) Inline search applies ancestor retention — every ancestor of a
//         matching node stays visible (Req 2.2).
//   (iv)  Absence of multi-select checkboxes (Q1 drop) and resize handle
//         (Req 15.14).
//
// jsdom is not installed in this repo. Following the pattern established
// in `tests/unit/files-tab/url-sync-deep-link.test.ts` and
// `tests/unit/files-tab/use-folder-contents.test.ts`, we test the
// observable contracts two ways:
//
//   * Behaviours encoded as pure helpers are exercised directly
//     (ancestor-retention filter, width constant, store action wiring).
//   * Structural guarantees that can only be observed in the rendered
//     JSX are asserted against the source file as a text contract —
//     the same approach the head-contract tests use to enforce
//     cross-file invariants without mounting React.
//
// Requirements: Req 1.1, Req 1.7, Req 2.1–2.10, Req 15.14–15.18.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { ProjectNode } from "@/lib/db/schema";
import {
  computeVisibleIdsForSearch,
  FILES_TAB_SIDEBAR_SEARCH_DEBOUNCE_MS,
  FILES_TAB_SIDEBAR_WIDTH_PX,
} from "@/components/projects/v2/files-tab/sidebarSearch";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { defaultWorkspace } from "@/stores/files/types";

// ─── Fixture builders ────────────────────────────────────────────────

function makeFolder(id: string, name: string, parentId: string | null): ProjectNode {
  return {
    id,
    projectId: "proj-1",
    parentId,
    path: "/",
    type: "folder",
    name,
    s3Key: null,
    size: 0,
    mimeType: null,
    currentVersion: 1,
    metadata: {},
    gitHash: null,
    createdBy: null,
    deletedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  } as unknown as ProjectNode;
}

function makeFile(id: string, name: string, parentId: string | null): ProjectNode {
  return {
    id,
    projectId: "proj-1",
    parentId,
    path: "/",
    type: "file",
    name,
    s3Key: `s3/${id}`,
    size: 100,
    mimeType: "text/plain",
    currentVersion: 1,
    metadata: {},
    gitHash: null,
    createdBy: null,
    deletedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  } as unknown as ProjectNode;
}

function buildTree(nodes: ProjectNode[]): Record<string, ProjectNode> {
  const out: Record<string, ProjectNode> = {};
  for (const n of nodes) out[n.id] = n;
  return out;
}

// ─── Fixed width constant (Req 2.6, Req 15.14) ──────────────────────

describe("FilesTabSidebar — fixed width constant (Req 2.6, Req 15.14)", () => {
  it("exposes the 280px width as a named export so runtime + tests never drift", () => {
    assert.equal(
      FILES_TAB_SIDEBAR_WIDTH_PX,
      280,
      "Req 2.6 mandates a 280px fixed width for the Files_Tab sidebar",
    );
  });
});

// ─── Ancestor retention under search (Req 2.2) ──────────────────────

describe("FilesTabSidebar / computeVisibleIdsForSearch — ancestor retention (Req 2.2)", () => {
  it("returns null for an empty query so the caller skips filtering (Req 2.3)", () => {
    const nodes = buildTree([makeFolder("root", "root", null)]);
    assert.equal(computeVisibleIdsForSearch(nodes, ""), null);
    assert.equal(computeVisibleIdsForSearch(nodes, "   "), null);
  });

  it("returns the matching node plus every ancestor in its parent chain", () => {
    // Tree: root/src/components/Button.tsx
    //       root/README.md
    const nodes = buildTree([
      makeFolder("root", "root", null),
      makeFolder("src", "src", "root"),
      makeFolder("components", "components", "src"),
      makeFile("button", "Button.tsx", "components"),
      makeFile("readme", "README.md", "root"),
    ]);

    const visible = computeVisibleIdsForSearch(nodes, "button");
    assert.ok(visible, "search with a non-empty query returns a Set, not null");
    assert.deepEqual(
      [...visible].sort(),
      ["button", "components", "root", "src"].sort(),
      "matching file + every ancestor folder remain visible; Doc stays hidden",
    );
    assert.equal(
      visible.has("readme"),
      false,
      "unrelated sibling must not leak into the visible set",
    );
  });

  it("matches multiple disjoint subtrees and unions their ancestor chains", () => {
    // Tree:
    //   root/foo/bar/target.txt
    //   root/other/target.md
    //   root/decoy/ignore.txt
    const nodes = buildTree([
      makeFolder("root", "root", null),
      makeFolder("foo", "foo", "root"),
      makeFolder("bar", "bar", "foo"),
      makeFile("t1", "target.txt", "bar"),
      makeFolder("other", "other", "root"),
      makeFile("t2", "target.md", "other"),
      makeFolder("decoy", "decoy", "root"),
      makeFile("ignore", "ignore.txt", "decoy"),
    ]);

    const visible = computeVisibleIdsForSearch(nodes, "target");
    assert.ok(visible);
    // Both match paths + common ancestor `root` are retained.
    assert.deepEqual(
      [...visible].sort(),
      ["bar", "foo", "other", "root", "t1", "t2"].sort(),
    );
    // The unrelated subtree is excluded entirely.
    assert.equal(visible.has("decoy"), false);
    assert.equal(visible.has("ignore"), false);
  });

  it("applies case-insensitive substring match (Req 2.2)", () => {
    const nodes = buildTree([
      makeFolder("root", "root", null),
      makeFile("id1", "ReadMe.MD", "root"),
    ]);

    for (const query of ["readme", "Readme", "adMe"]) {
      const visible = computeVisibleIdsForSearch(nodes, query);
      assert.ok(visible);
      assert.equal(
        visible.has("id1"),
        true,
        `query '${query}' should match 'ReadMe.MD' (Req 2.2)`,
      );
    }
  });

  it("returns an empty set when the query matches nothing (no ancestors to retain)", () => {
    const nodes = buildTree([
      makeFolder("root", "root", null),
      makeFile("readme", "README.md", "root"),
    ]);

    const visible = computeVisibleIdsForSearch(nodes, "totally-absent");
    assert.ok(visible);
    assert.equal(visible.size, 0);
  });

  it("does not loop forever on a malformed cyclic parentId graph (safety guard)", () => {
    // Construct a cycle: a → b → a. The filter must terminate instead of
    // walking forever. Real `ProjectNode` data should never contain this,
    // but the sidebar must not crash if the cache is corrupted.
    const nodes: Record<string, ProjectNode> = buildTree([
      makeFolder("a", "a-matches", "b"),
      makeFolder("b", "b", "a"),
    ]);

    const visible = computeVisibleIdsForSearch(nodes, "matches");
    assert.ok(visible, "returns a Set even under cycle conditions");
    // `a` matches by name; `b` is captured as its parent on the first
    // hop, and the walk halts because `b`'s parent (`a`) is already
    // in the visible set.
    assert.deepEqual([...visible].sort(), ["a", "b"]);
  });
});

// ─── Collapse toggle wiring (Req 2.4–2.5) ───────────────────────────

describe("FilesTabSidebar — collapse toggle store action (Req 2.4, 2.5)", () => {
  it("`toggleSidebar` flips `ui.sidebarCollapsed` per project", () => {
    // The sidebar wires its collapse button straight to the store's
    // `toggleSidebar` action (see FilesTabSidebar header row). This test
    // asserts the contract from the store side so the component's
    // click handler has a guaranteed counterpart.
    const projectId = "proj-toggle-test";

    // Reset the slice for this project.
    useFilesWorkspaceStore.setState((state) => ({
      byProjectId: {
        ...state.byProjectId,
        [projectId]: defaultWorkspace(),
      },
    }));

    const initial =
      useFilesWorkspaceStore.getState().byProjectId[projectId]!.ui
        .sidebarCollapsed;
    assert.equal(initial, false, "defaults to expanded");

    useFilesWorkspaceStore.getState().toggleSidebar(projectId);
    const afterFirst =
      useFilesWorkspaceStore.getState().byProjectId[projectId]!.ui
        .sidebarCollapsed;
    assert.equal(afterFirst, true, "first toggle collapses the sidebar");

    useFilesWorkspaceStore.getState().toggleSidebar(projectId);
    const afterSecond =
      useFilesWorkspaceStore.getState().byProjectId[projectId]!.ui
        .sidebarCollapsed;
    assert.equal(afterSecond, false, "second toggle re-expands the sidebar");
  });
});

// ─── Source-level structural contracts ──────────────────────────────
//
// Without jsdom we cannot render the component and query the DOM for
// `<input type="checkbox">` or a resize handle. Instead we apply the
// same approach used by `tests/unit/head-contract-script.test.ts`: read
// the source file as text and assert that forbidden constructs never
// appear, while required constructs do appear. This catches regressions
// in every PR that touches the sidebar file because the path is pinned.

const SIDEBAR_SOURCE = readFileSync(
  path.resolve(
    __dirname,
    "../../../src/components/projects/v2/files-tab/FilesTabSidebar.tsx",
  ),
  "utf8",
);

describe("FilesTabSidebar — structural contracts (source-level)", () => {
  it("renders a <input type=\"search\"> for inline search (Req 2.2)", () => {
    // The search input is a text input, NOT a checkbox (Q1 drop).
    assert.match(
      SIDEBAR_SOURCE,
      /type="search"/,
      "inline search input must be declared with type=\"search\"",
    );
  });

  it("does NOT render a resize handle (Req 15.14)", () => {
    // A resize handle would be implemented as a draggable divider —
    // typically via `onMouseDown`/`onPointerDown` directly on the sidebar
    // container, a cursor-ew-resize class, or a width setter wired into
    // a drag gesture. None of these should appear.
    assert.doesNotMatch(
      SIDEBAR_SOURCE,
      /setSidebarWidth\s*\(/,
      "the v3 sidebar must not call setSidebarWidth (Req 15.14)",
    );
    assert.doesNotMatch(
      SIDEBAR_SOURCE,
      /cursor-ew-resize/,
      "no ew-resize cursor means no drag-to-resize affordance",
    );
    assert.doesNotMatch(
      SIDEBAR_SOURCE,
      /data-resize-handle/,
      "no resize-handle data attribute",
    );
  });

  it("does NOT render multi-select checkboxes (Q1 drop, Req 15.15)", () => {
    // Multi-select is gone in v3. The tree renderer's checkbox column is
    // keyed off `mode === "select"` + non-empty `selectedNodeIds`. The
    // sidebar must hard-wire `mode: "default"` + an empty
    // `selectedNodeIds` so the column never renders.
    assert.match(
      SIDEBAR_SOURCE,
      /mode:\s*"default"/,
      "tree context must force mode=\"default\" to suppress checkboxes",
    );
    assert.match(
      SIDEBAR_SOURCE,
      /effectiveSelectedNodeIds:\s*EMPTY_ARRAY/,
      "effectiveSelectedNodeIds must be empty so no checkbox column is drawn",
    );
    // The sidebar source must not raise mode="select" or ferry the store's
    // `selectedNodeIds` into the tree context — that would re-enable the
    // multi-select checkbox column.
    assert.doesNotMatch(
      SIDEBAR_SOURCE,
      /mode:\s*["']select["']/,
      "no code path in the sidebar should construct mode=\"select\"",
    );
  });

  it("does NOT toggle any removed sidebar surfaces (Req 15.15–15.18)", () => {
    // The v3 sidebar must not wire a toolbar that toggles OutlinePanel,
    // SourceControlPanel, ExplorerInsightsHost, ExplorerCommandPalette,
    // or saved-views UI. Import-level absence is the tightest contract.
    const forbiddenImports = [
      "OutlinePanel",
      "SourceControlPanel",
      "ExplorerInsightsHost",
      "ExplorerCommandPalette",
      "saveCurrentView",
      "applySavedView",
      "deleteSavedView",
    ];
    for (const name of forbiddenImports) {
      assert.doesNotMatch(
        SIDEBAR_SOURCE,
        new RegExp(`\\b${name}\\b`),
        `${name} must NOT be referenced by the v3 sidebar (Req 15.15–15.18)`,
      );
    }
  });

  it("wires the collapse toggle button to `toggleSidebar(projectId)`", () => {
    assert.match(
      SIDEBAR_SOURCE,
      /toggleSidebar\(projectId\)/,
      "collapse button must dispatch toggleSidebar(projectId)",
    );
    assert.match(
      SIDEBAR_SOURCE,
      /PanelLeftClose/,
      "design mandates the PanelLeftClose icon",
    );
  });

  it("routes row clicks through `useNavigateTo` — the single write path", () => {
    assert.match(
      SIDEBAR_SOURCE,
      /useNavigateTo\(projectId\)/,
      "the sidebar must call useNavigateTo(projectId) exactly once",
    );
    assert.match(
      SIDEBAR_SOURCE,
      /navigateTo\(node\.id\)/,
      "row clicks must dispatch navigateTo(node.id) per Req 2.8/2.10",
    );
  });

  it("declares the inline-search debounce at 200ms (Req 2.2 + design.md header row)", () => {
    // The runtime module exports `FILES_TAB_SIDEBAR_SEARCH_DEBOUNCE_MS`
    // so both the component and the test reference the same literal.
    assert.equal(
      FILES_TAB_SIDEBAR_SEARCH_DEBOUNCE_MS,
      200,
      "the 200ms search debounce is required by the design header row spec",
    );
    assert.match(
      SIDEBAR_SOURCE,
      /FILES_TAB_SIDEBAR_SEARCH_DEBOUNCE_MS/,
      "sidebar must wire the inline input's setTimeout to the shared debounce constant",
    );
  });

  it("applies `width: 280` (via FILES_TAB_SIDEBAR_WIDTH_PX) when visible and `width: 0` when collapsed", () => {
    // Two distinct <aside style={{ width: ... }}> branches: one uses the
    // named constant, the other literal 0.
    assert.match(
      SIDEBAR_SOURCE,
      /style=\{\{\s*width:\s*FILES_TAB_SIDEBAR_WIDTH_PX\s*\}\}/,
      "expanded aside must use the 280px constant",
    );
    assert.match(
      SIDEBAR_SOURCE,
      /style=\{\{\s*width:\s*0\s*\}\}/,
      "collapsed aside must render a 0-width container",
    );
  });
});
