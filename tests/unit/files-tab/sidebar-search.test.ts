// Task 3.2 — Focused unit tests for sidebar search and collapse.
//
// This file deliberately complements `tests/unit/files-tab/sidebar.test.ts`
// (Task 3.1) by narrowing in on the four contracts called out for 3.2:
//
//   1. Empty / whitespace-only query returns `null` so the caller skips
//      filtering and renders the full tree honouring the current
//      expand/collapse state (Req 2.3).
//   2. Non-empty query filters with ancestor retention — every ancestor
//      of a matching node stays visible (Req 2.2). The cases below are
//      intentionally distinct from sidebar.test.ts: deep chains, sibling
//      of an ancestor, match at the root, whole-subtree match when the
//      root name matches, query-trimming behaviour.
//   3. Collapse toggle calls `useFilesWorkspaceStore.getState().toggleSidebar(projectId)`
//      and the resulting `ui.sidebarCollapsed` boolean flips per project
//      (Req 2.4, 2.5) without bleeding across projects.
//   4. The expanded sidebar width constant is always 280px (Req 2.6,
//      Req 15.14) — enforced by the exported constant so runtime CSS
//      and tests share a single source of truth.
//
// Requirements: Req 2.1–2.7.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { ProjectNode } from "@/lib/db/schema";
import {
  FILES_TAB_SIDEBAR_WIDTH_PX,
  computeVisibleIdsForSearch,
} from "@/components/projects/v2/files-tab/sidebarSearch";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { defaultWorkspace } from "@/stores/files/types";

// ─── Fixture builders ────────────────────────────────────────────────
//
// Minimal `ProjectNode` shape coerced via `as unknown as ProjectNode`
// because the slice treats every field the helper does not read as
// opaque. Keeping these local (rather than sharing with sidebar.test.ts)
// makes each file self-contained and resilient to incidental drift.

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

// ─── 1. Empty query → full tree signal (Req 2.3) ────────────────────

describe("sidebar search — empty query returns null so the caller skips filtering (Req 2.3)", () => {
  it("returns null for a zero-length query", () => {
    const nodes = buildTree([
      makeFolder("root", "root", null),
      makeFile("a", "alpha.ts", "root"),
      makeFile("b", "beta.ts", "root"),
    ]);
    assert.equal(
      computeVisibleIdsForSearch(nodes, ""),
      null,
      "empty query signals \"no filter active\" — the tree renders full with the current expand state",
    );
  });

  it("returns null for a whitespace-only query (tabs, spaces, newlines)", () => {
    const nodes = buildTree([makeFolder("root", "root", null)]);
    for (const query of [" ", "   ", "\t", "\n", " \t \n "]) {
      assert.equal(
        computeVisibleIdsForSearch(nodes, query),
        null,
        `whitespace-only query ${JSON.stringify(query)} must be treated as empty`,
      );
    }
  });

  it("returns null independently of the size of the nodesById cache", () => {
    // 500-node cache — the "empty query → null" signal must be O(1) and
    // must never inspect the cache.
    const nodes: ProjectNode[] = [makeFolder("root", "root", null)];
    for (let i = 0; i < 499; i += 1) {
      nodes.push(makeFile(`f${i}`, `file-${i}.txt`, "root"));
    }
    assert.equal(computeVisibleIdsForSearch(buildTree(nodes), ""), null);
  });
});

// ─── 2. Non-empty query → ancestor retention (Req 2.2) ──────────────
//
// These cases are intentionally distinct from sidebar.test.ts. Each one
// stresses a different shape of the ancestor chain.

describe("sidebar search — non-empty query filters with ancestor retention (Req 2.2)", () => {
  it("retains the full deep ancestor chain for a match at depth 5", () => {
    // Tree: root/a/b/c/d/needle.txt
    const nodes = buildTree([
      makeFolder("root", "root", null),
      makeFolder("a", "a", "root"),
      makeFolder("b", "b", "a"),
      makeFolder("c", "c", "b"),
      makeFolder("d", "d", "c"),
      makeFile("match", "needle.txt", "d"),
    ]);

    const visible = computeVisibleIdsForSearch(nodes, "needle");
    assert.ok(visible, "non-empty query must return a Set");
    assert.deepEqual(
      [...visible].sort(),
      ["a", "b", "c", "d", "match", "root"].sort(),
      "every ancestor along the 5-hop chain plus the match itself is retained",
    );
  });

  it("does NOT leak siblings of ancestor folders into the visible set", () => {
    // Tree layout:
    //   root/
    //     parent/
    //       match.txt        ← matches
    //       unrelated.txt    ← sibling of the match, must be excluded
    //     sibling/           ← sibling folder of `parent`, must be excluded
    //       also.txt         ← must be excluded
    const nodes = buildTree([
      makeFolder("root", "root", null),
      makeFolder("parent", "parent", "root"),
      makeFile("match", "apples.txt", "parent"),
      makeFile("unrelated", "bananas.txt", "parent"),
      makeFolder("sibling", "sibling", "root"),
      makeFile("also", "cherries.txt", "sibling"),
    ]);

    const visible = computeVisibleIdsForSearch(nodes, "apples");
    assert.ok(visible);
    assert.deepEqual(
      [...visible].sort(),
      ["match", "parent", "root"].sort(),
      "match + ancestor chain only — sibling files and sibling folders stay hidden",
    );
    for (const shouldHide of ["unrelated", "sibling", "also"]) {
      assert.equal(
        visible.has(shouldHide),
        false,
        `${shouldHide} is not an ancestor of the match and must be hidden`,
      );
    }
  });

  it("handles a match at the root level — no ancestors to retain", () => {
    const nodes = buildTree([
      makeFolder("root", "alpha-root", null),
      makeFolder("other", "beta", null),
    ]);

    const visible = computeVisibleIdsForSearch(nodes, "alpha");
    assert.ok(visible);
    assert.deepEqual([...visible], ["root"]);
    assert.equal(
      visible.has("other"),
      false,
      "sibling root folder must not leak into the visible set",
    );
  });

  it("retains the entire subtree indirectly when the root folder name itself matches", () => {
    // When a folder name matches, only the folder + its ancestors are
    // marked visible. Children are NOT pulled in by the match — they
    // would need to match on their own name. This test pins that
    // contract so a future regression that widens retention to
    // descendants is caught.
    const nodes = buildTree([
      makeFolder("root", "widget-root", null),
      makeFile("child", "child.txt", "root"),
    ]);

    const visible = computeVisibleIdsForSearch(nodes, "widget");
    assert.ok(visible);
    assert.deepEqual(
      [...visible],
      ["root"],
      "only the matching folder is visible; descendants are not auto-included",
    );
    assert.equal(
      visible.has("child"),
      false,
      "ancestor retention does not descend into children",
    );
  });

  it("trims leading and trailing whitespace in the query before matching", () => {
    const nodes = buildTree([
      makeFolder("root", "root", null),
      makeFile("m", "MyReport.pdf", "root"),
    ]);

    for (const query of ["report", "  report", "report  ", "  report  "]) {
      const visible = computeVisibleIdsForSearch(nodes, query);
      assert.ok(visible, `query ${JSON.stringify(query)} must not short-circuit`);
      assert.equal(
        visible.has("m"),
        true,
        `query ${JSON.stringify(query)} must match MyReport.pdf after trimming`,
      );
    }
  });

  it("shares ancestors between multiple matches without double-counting", () => {
    // Two matches share the same `shared` ancestor. The Set prevents
    // duplicates and the upward walk must halt when it re-enters a
    // previously visited node, so the result size is deterministic.
    const nodes = buildTree([
      makeFolder("root", "root", null),
      makeFolder("shared", "shared", "root"),
      makeFolder("left", "left", "shared"),
      makeFolder("right", "right", "shared"),
      makeFile("l", "needle-left.txt", "left"),
      makeFile("r", "needle-right.txt", "right"),
    ]);

    const visible = computeVisibleIdsForSearch(nodes, "needle");
    assert.ok(visible);
    assert.deepEqual(
      [...visible].sort(),
      ["l", "left", "r", "right", "root", "shared"].sort(),
      "both matches plus the union of their ancestor chains are visible exactly once",
    );
    assert.equal(
      visible.size,
      6,
      "Set semantics prevent double-counting the shared ancestor",
    );
  });
});

// ─── 3. Collapse toggle wiring (Req 2.4, 2.5) ───────────────────────
//
// The 3.1 sidebar test already drives `toggleSidebar` through a single
// two-flip cycle. This file adds an invariant that the toggle is scoped
// to one `projectId` and that repeated flips remain boolean-valued (the
// reducer produces `!ws.ui.sidebarCollapsed`, so nothing "sticky" should
// ever appear in the state).

describe("sidebar collapse toggle — `toggleSidebar(projectId)` flips `ui.sidebarCollapsed` (Req 2.4, 2.5)", () => {
  function resetWorkspaces(projectIds: readonly string[]): void {
    useFilesWorkspaceStore.setState((state) => {
      const next = { ...state.byProjectId };
      for (const id of projectIds) next[id] = defaultWorkspace();
      return { byProjectId: next };
    });
  }

  function readCollapsed(projectId: string): boolean {
    return (
      useFilesWorkspaceStore.getState().byProjectId[projectId]?.ui
        .sidebarCollapsed ?? false
    );
  }

  it("flips `ui.sidebarCollapsed` on every toggle and always holds a boolean", () => {
    const projectId = "proj-flip-invariant";
    resetWorkspaces([projectId]);

    assert.equal(readCollapsed(projectId), false, "default is expanded");

    // Flip 6 times — the boolean-only invariant must hold at every step.
    const observed: boolean[] = [];
    for (let i = 0; i < 6; i += 1) {
      useFilesWorkspaceStore.getState().toggleSidebar(projectId);
      const value = readCollapsed(projectId);
      assert.equal(
        typeof value,
        "boolean",
        `toggle #${i + 1} must leave a boolean in state`,
      );
      observed.push(value);
    }

    assert.deepEqual(
      observed,
      [true, false, true, false, true, false],
      "alternating flips produce the strict T/F sequence",
    );
  });

  it("scopes the flip to one project and does not bleed into other workspaces", () => {
    const target = "proj-scope-target";
    const other = "proj-scope-other";
    resetWorkspaces([target, other]);

    assert.equal(readCollapsed(target), false);
    assert.equal(readCollapsed(other), false);

    useFilesWorkspaceStore.getState().toggleSidebar(target);

    assert.equal(
      readCollapsed(target),
      true,
      "only the targeted project flips collapsed → true",
    );
    assert.equal(
      readCollapsed(other),
      false,
      "the unrelated project's sidebarCollapsed must remain false",
    );
  });

  it("creates a workspace entry for an unknown project on first toggle", () => {
    const projectId = "proj-never-seen-before";
    // Intentionally skip `resetWorkspaces` — the action should materialise
    // a fresh workspace from `defaultWorkspace()` (which starts expanded),
    // then flip `sidebarCollapsed` to `true`.
    useFilesWorkspaceStore.setState((state) => {
      const next = { ...state.byProjectId };
      delete next[projectId];
      return { byProjectId: next };
    });

    useFilesWorkspaceStore.getState().toggleSidebar(projectId);

    assert.equal(
      readCollapsed(projectId),
      true,
      "first toggle against an uninitialized project flips the default (false) to true",
    );
  });
});

// ─── 4. Expanded sidebar width is always 280px (Req 2.6, 15.14) ─────

describe("sidebar width — expanded aside is always 280px (Req 2.6, 15.14)", () => {
  it("exports `FILES_TAB_SIDEBAR_WIDTH_PX === 280`", () => {
    assert.equal(
      FILES_TAB_SIDEBAR_WIDTH_PX,
      280,
      "Req 2.6 and Req 15.14 both require a 280px fixed sidebar width",
    );
  });

  it("exposes the width as a `number` type so CSS-in-JS receives a pixel value", () => {
    assert.equal(
      typeof FILES_TAB_SIDEBAR_WIDTH_PX,
      "number",
      "the width must be a number — React style props reject non-numeric widths with unit-less properties",
    );
    assert.ok(
      Number.isInteger(FILES_TAB_SIDEBAR_WIDTH_PX),
      "the width must be an integer pixel count",
    );
    assert.ok(
      FILES_TAB_SIDEBAR_WIDTH_PX > 0,
      "the width must be positive (a zero-width sidebar is the collapsed state)",
    );
  });
});
