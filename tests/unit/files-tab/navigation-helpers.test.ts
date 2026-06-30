// Task 2.1 acceptance test — pure navigation helpers for the Files Tab.
// Covers Req 3.1–3.2, Req 10.1, Req 10.4, Req 20.1 (design.md § URL Contract).
//
// Scope:
//   - ancestorChain: root / intermediate / file / unresolved cases
//   - encodePath: null / root-level / nested / special chars / unresolved
//   - splitEncoded: empty / single / nested / consecutive slashes / malformed escape
//
// The property-based round-trip test for encodePath + splitEncoded lives
// separately in tests/unit/files-tab/properties/url-state-roundtrip.test.ts
// (Task 2.9, Property 3). This file covers the example/edge cases.

import test from "node:test";
import assert from "node:assert/strict";

import type { ProjectNode } from "@/lib/db/schema";
import { ancestorChain } from "@/components/projects/v2/files-tab/navigation";
import { encodePath, splitEncoded } from "@/components/projects/v2/files-tab/url";

// ---------------------------------------------------------------------------
// Test fixture builders
// ---------------------------------------------------------------------------

type NodeInit = {
  id: string;
  name: string;
  parentId: string | null;
  type?: "folder" | "file";
  path?: string;
};

/** Builds a minimal ProjectNode that satisfies the fields the helpers read. */
function node(init: NodeInit): ProjectNode {
  return {
    id: init.id,
    projectId: "proj-1",
    parentId: init.parentId,
    path: init.path ?? "/",
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
  };
}

function buildTree(inits: NodeInit[]): Record<string, ProjectNode> {
  const out: Record<string, ProjectNode> = {};
  for (const init of inits) out[init.id] = node(init);
  return out;
}

// A small project tree used by most cases:
//   (root-level)
//   ├── src/                  id = "src"
//   │   └── components/       id = "components", parent = "src"
//   │       └── Button.tsx    id = "button", parent = "components", type = file
//   └── README.md             id = "readme", parent = null, type = file
const baseTree = buildTree([
  { id: "src", name: "src", parentId: null },
  { id: "components", name: "components", parentId: "src" },
  { id: "button", name: "Button.tsx", parentId: "components", type: "file" },
  { id: "readme", name: "README.md", parentId: null, type: "file" },
]);

// ---------------------------------------------------------------------------
// ancestorChain — Req 3.1–3.2, Req 6.5
// ---------------------------------------------------------------------------

test("ancestorChain: returns [] for null nodeId (root state)", () => {
  assert.deepEqual(ancestorChain(baseTree, null), []);
});

test("ancestorChain: returns [] when nodeId is not in nodesById (unresolved)", () => {
  assert.deepEqual(ancestorChain(baseTree, "does-not-exist"), []);
});

test("ancestorChain: returns [root-level node] when parentId is null", () => {
  const chain = ancestorChain(baseTree, "src");
  assert.deepEqual(chain.map((n) => n.id), ["src"]);
});

test("ancestorChain: returns root-to-node for an intermediate folder", () => {
  const chain = ancestorChain(baseTree, "components");
  assert.deepEqual(chain.map((n) => n.id), ["src", "components"]);
});

test("ancestorChain: returns root-to-file for a leaf file", () => {
  const chain = ancestorChain(baseTree, "button");
  assert.deepEqual(chain.map((n) => n.id), ["src", "components", "button"]);
  assert.equal(chain.at(-1)?.type, "file");
});

test("ancestorChain: terminates on missing ancestor without throwing", () => {
  // Partial tree: "button" exists but "components" parent is absent.
  const partial = buildTree([
    { id: "button", name: "Button.tsx", parentId: "components", type: "file" },
  ]);
  const chain = ancestorChain(partial, "button");
  assert.deepEqual(chain.map((n) => n.id), ["button"]);
});

test("ancestorChain: tolerates a self-referential cycle", () => {
  const cyclic = buildTree([{ id: "loop", name: "loop", parentId: "loop" }]);
  const chain = ancestorChain(cyclic, "loop");
  assert.deepEqual(chain.map((n) => n.id), ["loop"]);
});

// ---------------------------------------------------------------------------
// encodePath — Req 10.1, Req 10.4, Req 20.1 (round-trip)
// ---------------------------------------------------------------------------

test("encodePath: returns empty string for null (root state, no ?path=)", () => {
  assert.equal(encodePath(baseTree, null), "");
});

test("encodePath: returns empty string when nodeId is unresolved", () => {
  assert.equal(encodePath(baseTree, "does-not-exist"), "");
});

test("encodePath: encodes a single root-level segment", () => {
  assert.equal(encodePath(baseTree, "src"), "src");
});

test("encodePath: joins root-to-leaf segments with /", () => {
  assert.equal(encodePath(baseTree, "button"), "src/components/Button.tsx");
});

test("encodePath: URI-encodes segments containing spaces and unicode", () => {
  const tree = buildTree([
    { id: "a", name: "my folder", parentId: null },
    { id: "b", name: "résumé.md", parentId: "a", type: "file" },
  ]);
  // Expected: encodeURIComponent("my folder") === "my%20folder",
  //           encodeURIComponent("résumé.md") === "r%C3%A9sum%C3%A9.md"
  assert.equal(
    encodePath(tree, "b"),
    `${encodeURIComponent("my folder")}/${encodeURIComponent("résumé.md")}`,
  );
});

test("encodePath: URI-encodes a reserved `?` character in a filename", () => {
  const tree = buildTree([
    { id: "q", name: "question?.txt", parentId: null, type: "file" },
  ]);
  assert.equal(encodePath(tree, "q"), encodeURIComponent("question?.txt"));
});

test("encodePath: falls back to materialized path when ancestors are not cached", () => {
  const tree = buildTree([
    {
      id: "security",
      name: "SECURITY.md",
      parentId: "docs",
      type: "file",
      path: "/docs/security/SECURITY.md",
    },
  ]);
  assert.equal(encodePath(tree, "security"), "docs/security/SECURITY.md");
});

// ---------------------------------------------------------------------------
// splitEncoded — Req 10.1, Req 20.1
// ---------------------------------------------------------------------------

test("splitEncoded: returns [] for the empty string", () => {
  assert.deepEqual(splitEncoded(""), []);
});

test("splitEncoded: decodes a single segment", () => {
  assert.deepEqual(splitEncoded("src"), ["src"]);
});

test("splitEncoded: splits a nested path and decodes each segment", () => {
  assert.deepEqual(
    splitEncoded("src/components/Button.tsx"),
    ["src", "components", "Button.tsx"],
  );
});

test("splitEncoded: filters empty segments from leading/trailing/duplicate slashes", () => {
  assert.deepEqual(splitEncoded("/src//components/"), ["src", "components"]);
});

test("splitEncoded: decodeURIComponent is applied per segment", () => {
  assert.deepEqual(
    splitEncoded(`${encodeURIComponent("my folder")}/${encodeURIComponent("résumé.md")}`),
    ["my folder", "résumé.md"],
  );
});

test("splitEncoded: silently drops malformed percent escapes", () => {
  // "%" alone is not a valid percent-escape — decodeURIComponent throws.
  assert.deepEqual(splitEncoded("src/%/components"), ["src", "components"]);
});

// ---------------------------------------------------------------------------
// Round-trip sanity check (one explicit example; Task 2.9 covers the property)
// ---------------------------------------------------------------------------

test("encodePath + splitEncoded round-trip preserves segment order and names", () => {
  const encoded = encodePath(baseTree, "button");
  assert.deepEqual(splitEncoded(encoded), ["src", "components", "Button.tsx"]);
});
