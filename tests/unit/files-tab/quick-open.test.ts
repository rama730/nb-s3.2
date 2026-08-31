// Task 7.2 acceptance test — `QuickOpenDialog` keyboard + error paths.
//
// Covers every acceptance criterion of Req 9 (Quick Open):
//   9.1 ⌘P / Ctrl+P opens when closed, closes when already open
//       (close path lives in FilesTabRoot — asserted source-level).
//   9.2 Empty query → up to 20 Recents (most-recent first); empty-state
//       indicator when Recents is empty (source-level + ranker returns
//       [] for the empty-query branch).
//   9.3 Non-empty query (1–256 chars) → fuzzy rank by name + path,
//       up to 50 results; no-results indicator when empty.
//   9.4 ArrowDown / ArrowUp wrap (via modulo) + scroll focused into view.
//   9.5 Enter / click → navigateTo(file.id) + close.
//   9.6 Selected-node-gone → inline dialog error, dialog stays open,
//       `currentLocation` unchanged (cache re-read at commit time).
//   9.7 Escape closes + discards input, `currentLocation` unchanged.
//
// jsdom is not installed in this repo (see the recurring "jsdom is not
// installed" note in `tests/unit/files-tab/*.test.ts`, e.g. `sidebar.test.ts`
// and `file-view.test.ts`). Following the established pattern, we test
// the observable contracts two ways:
//
//   * The pure helpers exported from `QuickOpenDialog.tsx`
//     (`buildNodePathMap`, `rankFuzzyResults`) are invoked directly —
//     they embody the entire fuzzy ranking contract of Req 9.3 and the
//     50-result cap.
//   * The behavioural contracts that only show up in the React component
//     (Escape discards input, ArrowDown/Up modulo-wrap, cache re-read at
//     commit time for the "node gone" error, 20-Recents cap, Enter →
//     navigateTo+close) are asserted against the source file as a text
//     contract — the same approach used by sidebar.test.ts and
//     breadcrumb-render.test.ts.
//
// Requirements: Req 9.1–9.7.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { ProjectNode } from "@/lib/db/schema";
import {
  buildNodePathMap,
  rankFuzzyResults,
} from "@/components/projects/v2/files-tab/quick-open/QuickOpenDialog";

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

function buildNodes(nodes: ProjectNode[]): Record<string, ProjectNode> {
  const out: Record<string, ProjectNode> = {};
  for (const n of nodes) out[n.id] = n;
  return out;
}

// ─── buildNodePathMap (pure helper) ──────────────────────────────────

describe("buildNodePathMap — path joining", () => {
  it("returns the node's own name for a single root node", () => {
    const nodes = buildNodes([makeFolder("root", "root", null)]);
    const paths = buildNodePathMap(nodes);
    assert.equal(paths.get("root"), "root");
    assert.equal(paths.size, 1);
  });

  it("joins ancestors with '/' for a nested path", () => {
    // root/src/components/Button.tsx
    const nodes = buildNodes([
      makeFolder("root", "root", null),
      makeFolder("src", "src", "root"),
      makeFolder("comp", "components", "src"),
      makeFile("btn", "Button.tsx", "comp"),
    ]);
    const paths = buildNodePathMap(nodes);
    assert.equal(paths.get("root"), "root");
    assert.equal(paths.get("src"), "root/src");
    assert.equal(paths.get("comp"), "root/src/components");
    assert.equal(paths.get("btn"), "root/src/components/Button.tsx");
  });

  it("gracefully falls back to the node's own name when its parent is orphaned", () => {
    // `orphan` has parentId pointing at a node that does not exist in
    // the cache. The builder must not crash and must produce *some*
    // stable string for the node so the fuzzy ranker can still scan it.
    const nodes = buildNodes([
      makeFile("orphan", "Stray.tsx", "missing-parent-id"),
    ]);
    const paths = buildNodePathMap(nodes);
    // `missing-parent-id` resolves to `""` (node not in cache), so the
    // path for the orphan is just its own name. This mirrors the legacy
    // `nodePathById` resilience contract and keeps fuzzy search working
    // during concurrent cache evictions.
    assert.equal(paths.get("orphan"), "Stray.tsx");
  });

  it("builds paths for every node in the cache, not just leaves", () => {
    const nodes = buildNodes([
      makeFolder("root", "root", null),
      makeFile("a", "a.txt", "root"),
      makeFile("b", "b.txt", "root"),
    ]);
    const paths = buildNodePathMap(nodes);
    assert.equal(paths.size, 3);
    assert.equal(paths.get("a"), "root/a.txt");
    assert.equal(paths.get("b"), "root/b.txt");
  });
});

// ─── rankFuzzyResults — empty query (Req 9.3 / 9.2 boundary) ────────

describe("rankFuzzyResults — empty query (Req 9.2 / 9.3)", () => {
  it("returns [] when the query is empty — Recents path is the caller's job", () => {
    // The dialog renders Recents (Req 9.2) directly from the store; it
    // only calls `rankFuzzyResults` with a non-empty query. Empty input
    // into the ranker therefore MUST return [] — any other behaviour
    // would collide with the Recents branch.
    const nodes = buildNodes([
      makeFolder("root", "root", null),
      makeFile("a", "README.md", "root"),
    ]);
    const paths = buildNodePathMap(nodes);
    const fileNodes = Object.values(nodes).filter((n) => n.type === "file");
    assert.deepEqual(rankFuzzyResults(fileNodes, paths, ""), []);
  });
});

// ─── rankFuzzyResults — ordered scoring tiers (Req 9.3) ─────────────

describe("rankFuzzyResults — scoring order (Req 9.3)", () => {
  // Scoring contract (from QuickOpenDialog.tsx):
  //   exact name match: +500
  //   name startsWith : +300
  //   name includes   : +180
  //   path includes   : +120
  //
  // Scores accumulate. The key property is the STRICT ordering across
  // the four tiers: any file whose name equals the query must rank
  // above any file whose name starts with (but does not equal) the
  // query, which in turn ranks above any file whose name merely
  // includes the query, which in turn ranks above any file matched
  // only through its path.

  it("exact name match ranks strictly above startsWith-only match", () => {
    // Query "foo". "foo" is an exact name match; "foobar" is a
    // startsWith match but not exact.
    const nodes = buildNodes([
      makeFolder("root", "root", null),
      makeFile("exact", "foo", "root"),
      makeFile("starts", "foobar", "root"),
    ]);
    const paths = buildNodePathMap(nodes);
    const fileNodes = Object.values(nodes).filter((n) => n.type === "file");
    const results = rankFuzzyResults(fileNodes, paths, "foo");
    assert.equal(results.length, 2);
    assert.equal(results[0]!.id, "exact", "exact name match must sort first");
    assert.equal(results[1]!.id, "starts", "startsWith match must sort after exact");
  });

  it("startsWith match ranks strictly above includes-only match", () => {
    // Query "foo". "foobar" starts-with; "zfoobar" only includes.
    const nodes = buildNodes([
      makeFolder("root", "root", null),
      makeFile("starts", "foobar.ts", "root"),
      makeFile("includes", "zfoobar.ts", "root"),
    ]);
    const paths = buildNodePathMap(nodes);
    const fileNodes = Object.values(nodes).filter((n) => n.type === "file");
    const results = rankFuzzyResults(fileNodes, paths, "foo");
    assert.equal(results.length, 2);
    assert.equal(results[0]!.id, "starts");
    assert.equal(results[1]!.id, "includes");
  });

  it("name-includes match ranks strictly above path-only match", () => {
    // Query "foo".
    // "zfoobar.ts" at root         — name includes (+180) + path includes (+120) = 300
    // "unrelated.ts" under a/foo/  — name does NOT include (+0) + path includes (+120) = 120
    const nodes = buildNodes([
      makeFolder("root", "root", null),
      makeFolder("a", "a", "root"),
      makeFolder("foo", "foo", "a"),
      makeFile("nameHit", "zfoobar.ts", "root"),
      makeFile("pathHit", "unrelated.ts", "foo"),
    ]);
    const paths = buildNodePathMap(nodes);
    const fileNodes = Object.values(nodes).filter((n) => n.type === "file");
    const results = rankFuzzyResults(fileNodes, paths, "foo");
    assert.equal(results.length, 2);
    assert.equal(results[0]!.id, "nameHit", "name-includes outranks path-only");
    assert.equal(results[1]!.id, "pathHit");
  });

  it("full four-tier ordering: exact > startsWith > includes > path-only", () => {
    // Query "foo".
    //   exact    — name "foo"                     (path "root/foo")
    //   starts   — name "foobar.ts"               (path "root/foobar.ts")
    //   includes — name "zfoobar.ts"              (path "root/zfoobar.ts")
    //   pathOnly — name "unrelated.ts" under /foo (path "root/foo/unrelated.ts")
    const nodes = buildNodes([
      makeFolder("root", "root", null),
      makeFolder("foo", "foo", "root"),
      makeFile("exact", "foo", "root"),
      makeFile("starts", "foobar.ts", "root"),
      makeFile("includes", "zfoobar.ts", "root"),
      makeFile("pathOnly", "unrelated.ts", "foo"),
    ]);
    const paths = buildNodePathMap(nodes);
    const fileNodes = Object.values(nodes).filter((n) => n.type === "file");
    const results = rankFuzzyResults(fileNodes, paths, "foo");
    assert.deepEqual(
      results.map((n) => n.id),
      ["exact", "starts", "includes", "pathOnly"],
      "four-tier ordering must be stable across all fuzzy hits",
    );
  });

  it("drops files that score zero (no name OR path match)", () => {
    const nodes = buildNodes([
      makeFolder("root", "root", null),
      makeFile("hit", "foo.ts", "root"),
      makeFile("miss", "bar.ts", "root"),
    ]);
    const paths = buildNodePathMap(nodes);
    const fileNodes = Object.values(nodes).filter((n) => n.type === "file");
    const results = rankFuzzyResults(fileNodes, paths, "foo");
    assert.equal(results.length, 1);
    assert.equal(results[0]!.id, "hit");
  });

  it("matches case-insensitively against both name and path (Req 9.3)", () => {
    // The helper assumes the caller has lower-cased the query; the
    // component lower-cases inside its `useMemo`. We mirror that in the
    // call here.
    const nodes = buildNodes([
      makeFolder("root", "root", null),
      makeFile("f", "ReadMe.MD", "root"),
    ]);
    const paths = buildNodePathMap(nodes);
    const fileNodes = Object.values(nodes).filter((n) => n.type === "file");
    const results = rankFuzzyResults(fileNodes, paths, "readme");
    assert.equal(results.length, 1);
    assert.equal(results[0]!.id, "f");
  });
});

// ─── rankFuzzyResults — 50-result cap (Req 9.3) ─────────────────────

describe("rankFuzzyResults — 50-result cap (Req 9.3)", () => {
  it("truncates to at most 50 results when 100 files all match", () => {
    const nodes: ProjectNode[] = [makeFolder("root", "root", null)];
    // Generate 100 files that all match the query "foo".
    for (let i = 0; i < 100; i += 1) {
      nodes.push(makeFile(`f-${i}`, `foo-${i.toString().padStart(3, "0")}.ts`, "root"));
    }
    const nodesById = buildNodes(nodes);
    const paths = buildNodePathMap(nodesById);
    const fileNodes = Object.values(nodesById).filter((n) => n.type === "file");
    const results = rankFuzzyResults(fileNodes, paths, "foo");
    assert.equal(
      results.length,
      50,
      "Req 9.3 requires the ranker to emit at most 50 results",
    );
    // The slice preserves the score-then-name order, so the first 50
    // file names sort below the second 50 (deterministic cap).
    const resultNames = results.map((n) => n.name);
    const sortedNames = [...resultNames].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(
      resultNames,
      sortedNames,
      "the 50-slice must be the lowest 50 names (name-asc tie-break)",
    );
  });

  it("honours a caller-supplied limit override", () => {
    const nodes: ProjectNode[] = [makeFolder("root", "root", null)];
    for (let i = 0; i < 10; i += 1) {
      nodes.push(makeFile(`f-${i}`, `foo-${i}.ts`, "root"));
    }
    const nodesById = buildNodes(nodes);
    const paths = buildNodePathMap(nodesById);
    const fileNodes = Object.values(nodesById).filter((n) => n.type === "file");
    const results = rankFuzzyResults(fileNodes, paths, "foo", 3);
    assert.equal(results.length, 3);
  });
});

// ─── Source-level structural contracts ──────────────────────────────

const DIALOG_SOURCE = readFileSync(
  path.resolve(
    __dirname,
    "../../../src/components/projects/v2/files-tab/quick-open/QuickOpenDialog.tsx",
  ),
  "utf8",
);

const ROOT_SOURCE = readFileSync(
  path.resolve(
    __dirname,
    "../../../src/components/projects/v2/files-tab/FilesTabRoot.tsx",
  ),
  "utf8",
);

// 9.1 — ⌘P / Ctrl+P toggle is wired in FilesTabRoot (extraction point
// per tasks.md § 7.1 design notes).

describe("QuickOpen — ⌘P / Ctrl+P toggle (Req 9.1, source-level)", () => {
  it("FilesTabRoot registers a window 'keydown' listener", () => {
    assert.match(
      ROOT_SOURCE,
      /window\.addEventListener\("keydown",\s*onKeyDown\)/,
      "FilesTabRoot must register a global keydown listener",
    );
    assert.match(
      ROOT_SOURCE,
      /window\.removeEventListener\("keydown",\s*onKeyDown\)/,
      "the listener must be cleaned up on unmount",
    );
  });

  it("accepts both ⌘ (metaKey) and Ctrl (ctrlKey) as the toggle modifier", () => {
    assert.match(
      ROOT_SOURCE,
      /e\.metaKey\s*\|\|\s*e\.ctrlKey/,
      "toggle must fire on both ⌘ (macOS) and Ctrl (non-macOS) per Req 9.1",
    );
  });

  it("matches the 'p' key case-insensitively", () => {
    assert.match(
      ROOT_SOURCE,
      /e\.key\.toLowerCase\(\)\s*!==\s*"p"/,
      "toggle must recognise the 'p' key regardless of Shift / CapsLock",
    );
  });

  it("toggles: open when closed, close-and-discard-input when already open", () => {
    // The handler branches on the ref-cached open state and flips it.
    // `handleQuickOpenChange(false)` closes + discards input per Req 9.7.
    assert.match(
      ROOT_SOURCE,
      /const\s+wasOpen\s*=\s*quickOpenOpenRef\.current/,
      "handler must read the freshest open state via ref",
    );
    assert.match(
      ROOT_SOURCE,
      /if\s*\(wasOpen\)\s*\{\s*handleQuickOpenChange\(false\)/,
      "when already open, handler must close via handleQuickOpenChange(false)",
    );
    // When closed, we reset query first (so reopening always starts from
    // a clean slate) then set open=true.
    assert.match(
      ROOT_SOURCE,
      /setQuickOpenQuery\(""\)[\s\S]*?setQuickOpenOpen\(true\)/,
      "when closed, handler must clear the query and open the dialog",
    );
  });

  it("handleQuickOpenChange(false) discards the search input", () => {
    // The wrapper explicitly clears the input on close, which is what
    // the ⌘P-while-open close path + Escape path + backdrop click all
    // converge on.
    assert.match(
      ROOT_SOURCE,
      /if\s*\(!next\)\s*setQuickOpenQuery\(""\)/,
      "closing the dialog must reset the controlled query",
    );
  });
});

// 9.2 — 20-recent cap.

describe("QuickOpen — 20-Recents cap (Req 9.2, source-level)", () => {
  it("declares MAX_RECENTS = 20 at module scope", () => {
    assert.match(
      DIALOG_SOURCE,
      /const\s+MAX_RECENTS\s*=\s*20\s*;/,
      "the Recents cap must be the literal 20 mandated by Req 9.2",
    );
  });

  it("bounds the authoritative recent metadata read to 20 IDs", () => {
    assert.match(DIALOG_SOURCE, /recents\.slice\(0, MAX_RECENTS\)/);
    assert.match(DIALOG_SOURCE, /getNodeMetadataBatch\(projectId, recentIds\)/);
  });
  it("excludes deleted files and folders from authorized results", () => {
    assert.match(DIALOG_SOURCE, /nodes\.filter\(node => node\.type === "file" && !node\.deletedAt\)/);
    assert.doesNotMatch(DIALOG_SOURCE, /rankFuzzyResults\(fileNodes/);
  });

  it("renders the empty-Recents indicator when Recents is empty", () => {
    assert.match(
      DIALOG_SOURCE,
      /data-testid="files-tab-quick-open-empty-recents"/,
      "Req 9.2 mandates an empty-state indicator when Recents is empty",
    );
  });
});

// 9.3 — 50-result cap.

describe("QuickOpen — 50-result cap (Req 9.3, source-level)", () => {
  it("declares MAX_RESULTS = 50 at module scope", () => {
    assert.match(
      DIALOG_SOURCE,
      /const\s+MAX_RESULTS\s*=\s*50\s*;/,
      "the fuzzy-result cap must be the literal 50 mandated by Req 9.3",
    );
  });

  it("pages authoritative search in batches of 50 instead of silently truncating", () => {
    assert.match(DIALOG_SOURCE, /getProjectNodes\(projectId, null, rawQuery, MAX_RESULTS, pageParam\)/);
    assert.match(DIALOG_SOURCE, /getNextPageParam: page => page.nextCursor/);
    assert.match(DIALOG_SOURCE, /search.fetchNextPage\(\)/);
  });

  it("declares a 200ms debounce for the fuzzy search (Req 9.3)", () => {
    assert.match(
      DIALOG_SOURCE,
      /const\s+DEBOUNCE_MS\s*=\s*200\s*;/,
      "Req 9.3 mandates a 200ms debounce window on keystrokes",
    );
    assert.match(
      DIALOG_SOURCE,
      /window\.setTimeout\(\(\)\s*=>\s*setDebouncedQuery\(query\),\s*DEBOUNCE_MS\)/,
      "the debounce timer must be wired against DEBOUNCE_MS",
    );
  });

  it("enforces the 256-char upper bound on the query (Req 9.3)", () => {
    assert.match(
      DIALOG_SOURCE,
      /const\s+MAX_QUERY_LEN\s*=\s*256\s*;/,
      "the query-length upper bound must be the literal 256 mandated by Req 9.3",
    );
    assert.match(
      DIALOG_SOURCE,
      /maxLength=\{MAX_QUERY_LEN\}/,
      "the input must enforce the 256-char cap at the UI level",
    );
  });

  it("renders the no-results indicator when the ranker returns []", () => {
    assert.match(
      DIALOG_SOURCE,
      /data-testid="files-tab-quick-open-no-results"/,
      "Req 9.3 mandates a no-results indicator for empty fuzzy results",
    );
  });
});

// 9.4 — ArrowDown / ArrowUp wrap via modulo + scrollIntoView.

describe("QuickOpen — ArrowDown / ArrowUp wrap (Req 9.4, source-level)", () => {
  it("ArrowDown wraps from last → first via `(i + 1) % results.length`", () => {
    assert.match(
      DIALOG_SOURCE,
      /e\.key\s*===\s*"ArrowDown"[\s\S]*?setActiveIndex\(\(i\)\s*=>\s*\(i\s*\+\s*1\)\s*%\s*results\.length\)/,
      "ArrowDown must advance with modulo wrap per Req 9.4",
    );
  });

  it("ArrowUp wraps from first → last via `(i - 1 + len) % len`", () => {
    assert.match(
      DIALOG_SOURCE,
      /e\.key\s*===\s*"ArrowUp"[\s\S]*?setActiveIndex\(\(i\)\s*=>\s*\(i\s*-\s*1\s*\+\s*results\.length\)\s*%\s*results\.length\)/,
      "ArrowUp must retreat with modulo wrap per Req 9.4",
    );
  });

  it("scrolls the focused item into view via scrollIntoView({ block: 'nearest' })", () => {
    assert.match(
      DIALOG_SOURCE,
      /el\.scrollIntoView\(\{\s*block:\s*"nearest"\s*\}\)/,
      "Req 9.4 mandates that the focused result be scrolled into view",
    );
  });

  it("does nothing on ArrowDown / ArrowUp when the result list is empty", () => {
    // Without this guard, `i % 0` would be NaN and the focus ring would
    // collapse. Pin the `results.length === 0` early return.
    assert.match(
      DIALOG_SOURCE,
      /e\.key\s*===\s*"ArrowDown"[\s\S]*?if\s*\(results\.length\s*===\s*0\)\s*return/,
      "ArrowDown must no-op when there are no results",
    );
    assert.match(
      DIALOG_SOURCE,
      /e\.key\s*===\s*"ArrowUp"[\s\S]*?if\s*\(results\.length\s*===\s*0\)\s*return/,
      "ArrowUp must no-op when there are no results",
    );
  });
});

// 9.5 — Enter / click → navigateTo + close.

describe("QuickOpen — Enter + click → navigateTo + close (Req 9.5, source-level)", () => {
  it("uses `useNavigateTo` as the single write path", () => {
    // Per design.md § useNavigateTo / only write path — no other module
    // may mutate `currentLocationId`.
    assert.match(
      DIALOG_SOURCE,
      /const\s+navigateTo\s*=\s*useNavigateTo\(projectId\)/,
      "the dialog must obtain navigateTo from the sanctioned hook",
    );
    assert.match(
      DIALOG_SOURCE,
      /navigateTo\(candidate\.id\)/,
      "successful selection must fire navigateTo(candidate.id)",
    );
  });

  it("Enter fires selectByIndex for the currently active row", () => {
    assert.match(
      DIALOG_SOURCE,
      /e\.key\s*===\s*"Enter"[\s\S]*?selectByIndex\(safeActiveIndex\)/,
      "Enter must commit the current focus index via selectByIndex",
    );
  });

  it("Click on a row fires selectByIndex for that row", () => {
    assert.match(
      DIALOG_SOURCE,
      /onClick=\{\(\)\s*=>\s*selectByIndex\(idx\)\}/,
      "row clicks must route through selectByIndex (Req 9.5)",
    );
  });

  it("after navigateTo, the dialog clears the query and closes", () => {
    // Search explicitly for the post-navigateTo commit sequence inside
    // the `selectByIndex` closure.
    assert.match(
      DIALOG_SOURCE,
      /navigateTo\(candidate\.id\)\s*;\s*[\s\S]{0,200}?onQueryChange\(""\)\s*;\s*[\s\S]{0,200}?onOpenChange\(false\)/,
      "successful selection must clear the query AND close the dialog (Req 9.5)",
    );
  });
});

// 9.6 — Selected-node-gone → inline error + dialog stays open.

describe("QuickOpen — selected-node-gone error (Req 9.6, source-level)", () => {
  it("re-reads the cache at commit time via useFilesWorkspaceStore.getState()", () => {
    // The memoized `results` array can outlive the node it points at
    // (concurrent delete / cache eviction between memoization and
    // click). Req 9.6 requires a fresh cache read at commit time so the
    // dialog can detect and surface the disappearance rather than
    // blindly calling navigateTo on a dead id.
    assert.match(
      DIALOG_SOURCE,
      /useFilesWorkspaceStore\s*\.getState\(\)\s*\.byProjectId\[projectId\]\?\.nodesById\[candidate\.id\]/,
      "selectByIndex must re-read the freshest node snapshot before navigating",
    );
  });

  it("displays an inline `missingNodeError` when the fresh lookup fails", () => {
    assert.match(
      DIALOG_SOURCE,
      /if\s*\(!fresh\s*\|\|\s*fresh\.type\s*!==\s*"file"\)\s*\{\s*setMissingNodeError\(/,
      "an absent or folder-typed fresh lookup must trigger setMissingNodeError",
    );
  });

  it("does NOT call navigateTo when the fresh lookup fails (currentLocation unchanged)", () => {
    // Pattern: the setMissingNodeError branch returns before reaching
    // navigateTo. Confirm there is an early `return` inside the
    // `!fresh || fresh.type !== "file"` block.
    assert.match(
      DIALOG_SOURCE,
      /setMissingNodeError\([\s\S]*?\)\s*;\s*return\s*;/,
      "the missing-node branch must early-return to avoid navigateTo",
    );
  });

  it("renders the error as a role='alert' element inside the dialog", () => {
    assert.match(
      DIALOG_SOURCE,
      /role="alert"/,
      "the inline error banner must expose role='alert' for a11y",
    );
    assert.match(
      DIALOG_SOURCE,
      /data-testid="files-tab-quick-open-error"/,
      "the error banner needs a stable test id so E2E can query it",
    );
  });

  it("does NOT close the dialog when the fresh lookup fails", () => {
    // The branch order is: setMissingNodeError(...) then return. There
    // must be no onOpenChange(false) before the return.
    const bodyMatch = DIALOG_SOURCE.match(
      /const\s+fresh[\s\S]*?if\s*\(!fresh[\s\S]*?return\s*;/,
    );
    assert.ok(bodyMatch, "missing-node block must exist");
    assert.doesNotMatch(
      bodyMatch![0],
      /onOpenChange\(false\)/,
      "dialog must stay open on the missing-node branch (Req 9.6)",
    );
  });
});

// 9.7 — Escape closes + discards input, currentLocation unchanged.

describe("QuickOpen — Escape closes + discards input (Req 9.7, source-level)", () => {
  it("Escape preventDefault + close() inside the input keydown handler", () => {
    assert.match(
      DIALOG_SOURCE,
      /e\.key\s*===\s*"Escape"[\s\S]*?e\.preventDefault\(\)\s*;\s*close\(\)/,
      "Escape must preventDefault and close via the close() helper",
    );
  });

  it("close() discards the input via onQueryChange('')", () => {
    // The close() helper funnels every close path (Escape, backdrop
    // click, and — indirectly — the successful-selection path) through
    // the same query reset.
    assert.match(
      DIALOG_SOURCE,
      /const\s+close\s*=\s*useCallback\([\s\S]*?onQueryChange\(""\)/,
      "close() must discard the search input per Req 9.7",
    );
    assert.match(
      DIALOG_SOURCE,
      /const\s+close\s*=\s*useCallback\([\s\S]*?onOpenChange\(false\)/,
      "close() must also request the parent to close the dialog",
    );
    assert.match(
      DIALOG_SOURCE,
      /const\s+close\s*=\s*useCallback\([\s\S]*?setMissingNodeError\(null\)/,
      "close() must clear any stale missing-node error",
    );
  });

  it("close() does NOT call navigateTo — currentLocation is untouched", () => {
    // Extract the `close` callback body and assert it never mutates
    // currentLocation. Req 9.7: "discard the search input, and leave
    // Current_Location unchanged."
    const closeBody = DIALOG_SOURCE.match(
      /const\s+close\s*=\s*useCallback\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[[^\]]*\]\)\s*;/,
    );
    assert.ok(closeBody, "close() callback body must be locatable");
    assert.doesNotMatch(
      closeBody![0],
      /navigateTo/,
      "close() must never call navigateTo (Req 9.7)",
    );
  });

  it("the backdrop click also routes through close() so discards match Escape", () => {
    assert.match(
      DIALOG_SOURCE,
      /onOpenChange=\{value => \{ if \(!value\) close\(\); \}\}/,
      "backdrop clicks must converge on the same close() path as Escape",
    );
  });
});
