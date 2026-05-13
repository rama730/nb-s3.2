// Task 4.2 acceptance test — `BreadcrumbBar` rendering contracts.
//
// Covers Req 3.1–3.6 by exercising the two pure helpers exported from
// `BreadcrumbBar.tsx` directly, and by pinning the click handler to a
// source-level contract (no DOM is available — the test runner is
// node:test + tsx, the pattern established by `sidebar.test.ts`).
//
// The pure helpers (`deriveBreadcrumbSegments`, `layoutBreadcrumb`) are the
// single source of truth for what ends up on screen. The React component is
// a thin renderer on top of them:
//   * segment.kind drives JSX selection (folder/root → <button>, file → <span>)
//   * layout.kind drives the inline vs truncated branch
//   * every <button> registers `onClick={() => onNavigate(...)}` which ends
//     up calling `navigateTo` passed in from `useNavigateTo(projectId)`
//
// Cases (tasks.md § 4.2):
//   1. Root-only (location === null → just the synthetic "root" segment)
//   2. 2-segment folder (root + folder at project root)
//   3. 5-segment folder — no truncation (segments.length === 5 ≤ 6)
//   4. 7-segment folder — truncation fires (segments.length === 7 > 6)
//   5. File leaf is bold + non-clickable (segment.kind === "file")
//   6. Ellipsis dropdown lists exactly the hidden slice (segments.slice(1, -4))
//   7. Click fires `navigateTo` — source-level grep for the handler wiring
//
// Requirements: Req 3.1–3.6.
//
// ─── Module-load dance ───────────────────────────────────────────────
//
// `BreadcrumbBar.tsx` transitively imports `@/app/actions/files`, which
// loads `@/lib/db` at module time — and that triggers Zod env validation
// for `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, etc. `npm run test:unit`
// does not load `.env.local`, so a direct `import` would crash with a
// "Environment validation failed" error before any assertion ran.
//
// We sidestep this by stubbing the required env vars inside a `before`
// hook and then dynamically importing the module. The helpers we care
// about are pure — they do not touch the stubbed values — so the tests
// still exercise real production code.

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

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

type BreadcrumbLayout = {
  kind: "inline" | "truncated";
  visible: BreadcrumbSegment[];
  hidden: BreadcrumbSegment[];
};

let deriveBreadcrumbSegments: (
  location: CurrentLocation | null,
  chain: ReadonlyArray<{ id: string; name: string; type: "folder" | "file" }>,
) => BreadcrumbSegment[];
let layoutBreadcrumb: (segments: BreadcrumbSegment[]) => BreadcrumbLayout;
let BREADCRUMB_ROOT_SEGMENT_ID: string;

before(async () => {
  // Any non-empty values for the schema fields that require .min(1) or
  // .url(). The helpers under test never touch these, but Zod runs at
  // module-load time inside `@/lib/db` and must succeed for the import
  // to complete.
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";

  const mod = await import(
    "@/components/projects/v2/files-tab/breadcrumb/BreadcrumbBar"
  );
  deriveBreadcrumbSegments = mod.deriveBreadcrumbSegments;
  layoutBreadcrumb = mod.layoutBreadcrumb;
  BREADCRUMB_ROOT_SEGMENT_ID = mod.BREADCRUMB_ROOT_SEGMENT_ID;
});

// ─── Fixture builders ────────────────────────────────────────────────

type NodeInit = {
  id: string;
  name: string;
  parentId: string | null;
  type?: "folder" | "file";
};

/** Minimal ProjectNode satisfying the fields `ancestorChain` touches. */
function makeNode(init: NodeInit): ProjectNode {
  return {
    id: init.id,
    projectId: "proj-1",
    parentId: init.parentId,
    path: "/",
    type: init.type ?? "folder",
    name: init.name,
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
  } as unknown as ProjectNode;
}

function buildTree(inits: NodeInit[]): Record<string, ProjectNode> {
  const out: Record<string, ProjectNode> = {};
  for (const init of inits) out[init.id] = makeNode(init);
  return out;
}

/**
 * Build a linear folder chain of the requested depth starting under the
 * project root. Returns `(nodesById, leafId)` so tests can resolve the
 * leaf via `ancestorChain`. Segment 0 is the project-root-level folder
 * `f0`, segment 1 is `f1` nested inside, etc.
 */
function buildLinearFolders(depth: number): {
  nodesById: Record<string, ProjectNode>;
  leafId: string;
} {
  assert.ok(depth > 0, "depth must be positive");
  const inits: NodeInit[] = [];
  for (let i = 0; i < depth; i += 1) {
    inits.push({
      id: `f${i}`,
      name: `folder-${i}`,
      parentId: i === 0 ? null : `f${i - 1}`,
      type: "folder",
    });
  }
  return { nodesById: buildTree(inits), leafId: `f${depth - 1}` };
}

function folderLocation(node: ProjectNode): CurrentLocation {
  return { type: "folder", id: node.id, node };
}

function fileLocation(node: ProjectNode): CurrentLocation {
  return { type: "file", id: node.id, node };
}

// ─── Case 1 — root-only (Req 3.1, Req 3.2) ──────────────────────────

describe("BreadcrumbBar — root-only location (Req 3.1, 3.2)", () => {
  it("renders exactly the synthetic root segment when location is null", () => {
    const segments = deriveBreadcrumbSegments(null, []);
    assert.equal(segments.length, 1, "only the root segment appears");
    assert.equal(segments[0]!.kind, "root");
    assert.equal(segments[0]!.id, null);
    assert.equal(
      segments[0]!.name,
      "root",
      "the root segment carries a non-empty display label",
    );
  });

  it("renders exactly the synthetic root segment when location is {type: root}", () => {
    const segments = deriveBreadcrumbSegments({ type: "root" }, []);
    assert.equal(segments.length, 1);
    assert.equal(segments[0]!.kind, "root");
  });

  it("lays out the single root segment inline (below the 6-segment budget)", () => {
    const segments = deriveBreadcrumbSegments(null, []);
    const layout = layoutBreadcrumb(segments);
    assert.equal(layout.kind, "inline");
    assert.deepEqual(layout.visible, segments);
    assert.deepEqual(layout.hidden, []);
  });

  it("exposes BREADCRUMB_ROOT_SEGMENT_ID as the data-attribute marker", () => {
    // The component renders the root button with this literal so DOM
    // queries (and Property 1's PBT) can find it without special-casing
    // null. Contract-pin it here.
    assert.equal(BREADCRUMB_ROOT_SEGMENT_ID, "__root__");
  });
});

// ─── Case 2 — 2-segment folder breadcrumb (Req 3.2) ─────────────────

describe("BreadcrumbBar — 2-segment folder (Req 3.2)", () => {
  it("renders [root, folder] for a root-level folder", () => {
    const { nodesById, leafId } = buildLinearFolders(1);
    const leaf = nodesById[leafId]!;
    const chain = ancestorChain(nodesById, leafId);

    const segments = deriveBreadcrumbSegments(folderLocation(leaf), chain);
    assert.equal(segments.length, 2);
    assert.deepEqual(
      segments.map((s) => s.kind),
      ["root", "folder"],
    );
    assert.equal(segments[1]!.id, "f0");
    assert.equal(segments[1]!.name, "folder-0");
  });

  it("lays the 2-segment breadcrumb out inline (no ellipsis needed)", () => {
    const { nodesById, leafId } = buildLinearFolders(1);
    const leaf = nodesById[leafId]!;
    const chain = ancestorChain(nodesById, leafId);
    const segments = deriveBreadcrumbSegments(folderLocation(leaf), chain);
    const layout = layoutBreadcrumb(segments);

    assert.equal(layout.kind, "inline");
    assert.equal(layout.visible.length, 2);
    assert.equal(layout.hidden.length, 0);
  });
});

// ─── Case 3 — 5-segment folder, no truncation (Req 3.2, Req 3.6) ────

describe("BreadcrumbBar — 5-segment folder, no truncation (Req 3.6)", () => {
  it("renders root + 4 folders inline when total segments == 5", () => {
    const { nodesById, leafId } = buildLinearFolders(4);
    const leaf = nodesById[leafId]!;
    const chain = ancestorChain(nodesById, leafId);

    const segments = deriveBreadcrumbSegments(folderLocation(leaf), chain);
    // root + f0..f3 → 5 entries
    assert.equal(segments.length, 5);
    assert.deepEqual(segments.map((s) => s.kind), [
      "root",
      "folder",
      "folder",
      "folder",
      "folder",
    ]);
    assert.deepEqual(
      segments.slice(1).map((s) => s.id),
      ["f0", "f1", "f2", "f3"],
    );
  });

  it("layoutBreadcrumb keeps the 5-segment breadcrumb inline", () => {
    const { nodesById, leafId } = buildLinearFolders(4);
    const leaf = nodesById[leafId]!;
    const chain = ancestorChain(nodesById, leafId);
    const layout = layoutBreadcrumb(
      deriveBreadcrumbSegments(folderLocation(leaf), chain),
    );
    assert.equal(layout.kind, "inline");
    assert.equal(layout.visible.length, 5);
    assert.equal(layout.hidden.length, 0);
  });

  it("layoutBreadcrumb keeps exactly 6 segments inline (boundary)", () => {
    // Req 3.6 triggers only when `segments.length > 6`. Pin the boundary.
    const { nodesById, leafId } = buildLinearFolders(5); // root + 5 folders = 6
    const leaf = nodesById[leafId]!;
    const chain = ancestorChain(nodesById, leafId);
    const segments = deriveBreadcrumbSegments(folderLocation(leaf), chain);
    assert.equal(segments.length, 6);
    const layout = layoutBreadcrumb(segments);
    assert.equal(layout.kind, "inline", "6 segments is still inline");
    assert.equal(layout.hidden.length, 0);
  });
});

// ─── Case 4 — 7-segment folder, truncation fires (Req 3.6) ──────────

describe("BreadcrumbBar — 7-segment folder, truncation (Req 3.6)", () => {
  it("flips to truncated layout when segments.length > 6", () => {
    const { nodesById, leafId } = buildLinearFolders(6); // root + 6 folders = 7
    const leaf = nodesById[leafId]!;
    const chain = ancestorChain(nodesById, leafId);

    const segments = deriveBreadcrumbSegments(folderLocation(leaf), chain);
    assert.equal(segments.length, 7, "root + 6 folders = 7 total segments");

    const layout = layoutBreadcrumb(segments);
    assert.equal(layout.kind, "truncated");
    // Req 3.6 mandates: first segment + ellipsis + last 4 segments visible.
    // The ellipsis itself isn't in `visible` — it's rendered by the
    // component between `visible[0]` and `visible.slice(1)`. So the
    // visible array contains 5 segments (1 + 4).
    assert.equal(layout.visible.length, 5);
    assert.equal(
      layout.visible[0]!.kind,
      "root",
      "the first visible segment is the root per Req 3.6",
    );
    assert.deepEqual(
      layout.visible.slice(1).map((s) => s.id),
      ["f2", "f3", "f4", "f5"],
      "the last 4 visible segments are the deepest folders (Req 3.6)",
    );
  });

  it("the hidden slice contains exactly segments.slice(1, -4) (Req 3.6)", () => {
    const { nodesById, leafId } = buildLinearFolders(6);
    const leaf = nodesById[leafId]!;
    const chain = ancestorChain(nodesById, leafId);
    const segments = deriveBreadcrumbSegments(folderLocation(leaf), chain);
    const layout = layoutBreadcrumb(segments);

    assert.equal(layout.kind, "truncated");
    // With 7 segments, slice(1, -4) === segments.slice(1, 3) === [f0, f1].
    assert.equal(layout.hidden.length, 2);
    assert.deepEqual(
      layout.hidden.map((s) => s.id),
      ["f0", "f1"],
      "the ellipsis dropdown holds f0 and f1 (the intermediate folders)",
    );
    assert.ok(
      layout.hidden.every((s) => s.kind === "folder"),
      "hidden segments are always folders — root is visible[0] and files can only appear as the terminal segment",
    );
  });

  it("scales to deeper trees — visible and hidden partition segments disjointly", () => {
    const { nodesById, leafId } = buildLinearFolders(9); // root + 9 folders = 10
    const leaf = nodesById[leafId]!;
    const chain = ancestorChain(nodesById, leafId);
    const segments = deriveBreadcrumbSegments(folderLocation(leaf), chain);

    const layout = layoutBreadcrumb(segments);
    assert.equal(layout.kind, "truncated");
    assert.equal(layout.visible.length + layout.hidden.length, 10);
    // Round-trip: merging visible[0] + hidden + visible.slice(1) must
    // reproduce the original segment order.
    const rebuilt = [
      layout.visible[0]!,
      ...layout.hidden,
      ...layout.visible.slice(1),
    ];
    assert.deepEqual(
      rebuilt.map((s) => s.id),
      segments.map((s) => s.id),
      "visible+hidden partition reproduces the original segment order",
    );
  });
});

// ─── Case 5 — File leaf is bold + non-clickable (Req 3.3) ───────────

describe("BreadcrumbBar — file leaf (Req 3.3)", () => {
  it("derives the file as the terminal segment with kind=\"file\"", () => {
    // Tree: root/src/components/Button.tsx
    const nodesById = buildTree([
      { id: "src", name: "src", parentId: null, type: "folder" },
      { id: "components", name: "components", parentId: "src", type: "folder" },
      { id: "button", name: "Button.tsx", parentId: "components", type: "file" },
    ]);
    const file = nodesById["button"]!;
    const chain = ancestorChain(nodesById, "button");

    const segments = deriveBreadcrumbSegments(fileLocation(file), chain);
    assert.equal(segments.length, 4, "root + src + components + file");
    const terminal = segments.at(-1)!;
    assert.equal(terminal.kind, "file", "file is the terminal segment kind");
    assert.equal(terminal.id, "button");
    assert.equal(terminal.name, "Button.tsx");
  });

  it("ancestor folders before the file remain kind=\"folder\" (clickable)", () => {
    const nodesById = buildTree([
      { id: "src", name: "src", parentId: null, type: "folder" },
      { id: "components", name: "components", parentId: "src", type: "folder" },
      { id: "button", name: "Button.tsx", parentId: "components", type: "file" },
    ]);
    const file = nodesById["button"]!;
    const chain = ancestorChain(nodesById, "button");
    const segments = deriveBreadcrumbSegments(fileLocation(file), chain);

    const middle = segments.slice(1, -1);
    assert.ok(
      middle.every((s) => s.kind === "folder"),
      "every segment between root and the file leaf is a clickable folder",
    );
  });
});

// ─── Case 7 — Source-level pin: click fires `navigateTo` (Req 3.4, 3.5) ─

const BREADCRUMB_SOURCE = readFileSync(
  path.resolve(
    __dirname,
    "../../../src/components/projects/v2/files-tab/breadcrumb/BreadcrumbBar.tsx",
  ),
  "utf8",
);

describe("BreadcrumbBar — click-fires-navigateTo source contract (Req 3.4, 3.5)", () => {
  it("builds the click handler through `useNavigateTo(projectId)` (single write path)", () => {
    assert.match(
      BREADCRUMB_SOURCE,
      /useNavigateTo\(projectId\)/,
      "the breadcrumb must obtain the navigate callback via useNavigateTo per design.md",
    );
  });

  it("wires folder/root buttons through `onClick={() => onNavigate(...)}`", () => {
    // The folder/root button branch in `SegmentContent` registers:
    //   onClick={() => onNavigate(isRoot ? null : segment.id)}
    // Pin that handler pattern. `onNavigate` is the prop drilled down
    // from the top-level `navigateTo` callback.
    assert.match(
      BREADCRUMB_SOURCE,
      /onClick=\{\(\)\s*=>\s*onNavigate\(isRoot\s*\?\s*null\s*:\s*segment\.id\)\}/,
      "folder/root segments must register an onClick that invokes onNavigate with the segment id (or null for root)",
    );
  });

  it("forwards the top-level `navigateTo` callback into every segment via `onNavigate`", () => {
    // At least one renderer must read `onNavigate={navigateTo}` so the
    // buttons inside `SegmentContent` actually call the hook's callback.
    assert.match(
      BREADCRUMB_SOURCE,
      /onNavigate=\{navigateTo\}/,
      "the top-level renderer must pass navigateTo as onNavigate",
    );
  });

  it("the ellipsis dropdown invokes `onNavigate(targetId)` when a hidden segment is clicked", () => {
    // EllipsisButton renders DropdownMenuItems. Each item's onClick must
    // call `onNavigate(targetId)` for clickable segments. Without this the
    // ellipsis dropdown would be inert.
    assert.match(
      BREADCRUMB_SOURCE,
      /onNavigate\(targetId\)/,
      "the ellipsis dropdown items must dispatch onNavigate(targetId)",
    );
  });

  it("the file-segment branch renders a non-clickable <span> (Req 3.3)", () => {
    // The `segment.kind === "file"` branch returns a <span> — never a
    // <button>, never an onClick. Pin the structural contract at source
    // level; the rendering distinction is what makes Req 3.3 observable.
    assert.match(
      BREADCRUMB_SOURCE,
      /if\s*\(\s*segment\.kind\s*===\s*"file"\s*\)/,
      "SegmentContent must branch on segment.kind === 'file' before emitting a span",
    );
    assert.match(
      BREADCRUMB_SOURCE,
      /font-semibold/,
      "the file segment must carry the bold font class (Req 3.3 — file leaf bold)",
    );
    // Belt-and-braces: the body of the file branch must not register an
    // onClick. We validate this by scanning the slice of the file that
    // begins with the file-branch guard and ends before the next renderer
    // function declaration.
    const fileBranchStart = BREADCRUMB_SOURCE.indexOf(
      `if (segment.kind === "file")`,
    );
    assert.ok(fileBranchStart >= 0, "file branch guard must be present");
    const fileBranchEnd = BREADCRUMB_SOURCE.indexOf(
      "const isRoot",
      fileBranchStart,
    );
    assert.ok(
      fileBranchEnd > fileBranchStart,
      "file branch must be closed before the root/folder branch begins",
    );
    const fileBranchSource = BREADCRUMB_SOURCE.slice(
      fileBranchStart,
      fileBranchEnd,
    );
    assert.doesNotMatch(
      fileBranchSource,
      /onClick/,
      "the file segment branch must not register any onClick handler (Req 3.3 — file leaf non-clickable)",
    );
  });
});

// ─── Bonus — segment data-attribute pins for PBT DOM queries ────────
//
// Property 1 (tasks.md § 2.7) reads `[data-breadcrumb-segment-id]` to prove
// tree ⇄ breadcrumb sync. Pin the attribute wiring here so the PBT can rely
// on it without re-verifying the source.

describe("BreadcrumbBar — data-breadcrumb-segment-id attribute wiring", () => {
  it("clickable folder buttons carry their node id as the data-attribute value", () => {
    assert.match(
      BREADCRUMB_SOURCE,
      /data-breadcrumb-segment-id=\{dataId\}/,
      "SegmentContent must emit data-breadcrumb-segment-id for Req 6.5 PBT queries",
    );
    assert.match(
      BREADCRUMB_SOURCE,
      /const\s+dataId\s*=\s*isRoot\s*\?\s*BREADCRUMB_ROOT_SEGMENT_ID\s*:\s*segment\.id/,
      "the root button uses the exported literal; folders use their own id",
    );
  });

  it("the ellipsis button carries the sentinel `__ellipsis__`", () => {
    assert.match(
      BREADCRUMB_SOURCE,
      /data-breadcrumb-segment-id="__ellipsis__"/,
      "the ellipsis trigger must be discoverable via a stable sentinel",
    );
  });
});
