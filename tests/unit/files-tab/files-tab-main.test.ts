// Task 8.2 acceptance test — `FilesTabMain`.
//
// Validates: Req 1.2, Req 1.3, Req 1.5–1.8, Req 6.4, Req 17.1–17.4.
//
// jsdom is not installed in this repo. Following the pattern used by
// `tests/unit/files-tab/sidebar.test.ts` and
// `tests/unit/files-tab/file-view.test.ts`, we assert the structural
// contract against the source file as a text contract. Render-time
// behaviours are exercised by Property 2 (Task 2.8) once the rendering
// shell lands.
//
// Contracts asserted here:
//   * Conditional render: root/folder → `FolderListView`; file → `FileView`
//     with `key={location.id}` (Req 1.2, 1.3, 1.5, 17.2, 17.4).
//   * Wrapper uses the prescribed classes
//     (`flex-1 flex flex-col min-w-0 h-full`) so sidebar collapse
//     produces a main area at full width (Req 1.7).
//   * Dev-only surface-disagreement assertion (Req 6.4): present,
//     gated on `process.env.NODE_ENV !== "production"`, warns when the
//     breadcrumb terminal id disagrees with the tree highlight id.
//   * Req 1.8 error indicator is rendered when `currentLocationId` is
//     set but unresolved.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Source-level text contract
// ---------------------------------------------------------------------------

const SRC = readFileSync(
  path.resolve(
    __dirname,
    "../../../src/components/projects/v2/files-tab/FilesTabMain.tsx",
  ),
  "utf8",
);

describe("FilesTabMain — structural contract (Req 1.2, 1.3, 1.5-1.8)", () => {
  it("subscribes to `useCurrentLocation(projectId)` as the read path", () => {
    assert.match(SRC, /useCurrentLocation\(projectId\)/);
  });

  it("reads `canEdit` from `useFilesTabRole()` (design § FilesTabRoot)", () => {
    assert.match(SRC, /useFilesTabRole\(\)/);
    // The destructured `canEdit` is referenced explicitly.
    assert.match(SRC, /\{\s*canEdit\s*\}\s*=\s*useFilesTabRole\(\)/);
  });

  it("uses the prescribed wrapper classes (Req 1.7 full-width main)", () => {
    // `flex-1 flex flex-col min-w-0 h-full` — design § FilesTabMain.
    assert.match(SRC, /flex-1 flex flex-col min-w-0 h-full/);
  });

  it("always renders BreadcrumbBar above the body", () => {
    assert.match(SRC, /<BreadcrumbBar\s+projectId=\{projectId\}\s+location=\{location\}/);
  });

  it("folder branch: location null | root | folder → <FolderListView ...> (Req 1.3)", () => {
    assert.match(SRC, /<FolderListView/);
    // Passes `folderId` conditionally (null at root, id when folder).
    assert.match(
      SRC,
      /folderId=\{[\s\S]*?location\.type\s*===\s*"folder"\s*\?\s*location\.id\s*:\s*null[\s\S]*?\}/,
    );
  });

  it("file branch: <FileView key={location.id} ...> (Req 1.5, 17.2, 17.4)", () => {
    // The `key={location.id}` is the structural fix for Req 17 —
    // remounting on every id change guarantees a fresh MetadataStrip.
    assert.match(SRC, /<FileView\s+key=\{location\.id\}/);
  });

  it("imports the real surfaces (BreadcrumbBar, FolderListView, FileView, ancestorChain)", () => {
    assert.match(SRC, /from\s+"\.\/breadcrumb\/BreadcrumbBar"/);
    assert.match(SRC, /from\s+"\.\/folder\/FolderListView"/);
    assert.match(SRC, /from\s+"\.\/file\/FileView"/);
    assert.match(SRC, /from\s+"\.\/navigation"/);
    assert.match(SRC, /\bancestorChain\b/);
  });
});

describe("FilesTabMain — dev-mode surface-disagreement assertion (Req 6.4)", () => {
  it("runs only in development (`process.env.NODE_ENV !== \"production\"`)", () => {
    // Either guard form is acceptable; we check both common spellings.
    const guarded =
      /process\.env\.NODE_ENV\s*===\s*"production"/.test(SRC) ||
      /process\.env\.NODE_ENV\s*!==\s*"production"/.test(SRC);
    assert.ok(
      guarded,
      "expected a NODE_ENV production guard around the Req 6.4 assertion",
    );
  });

  it("compares `ancestorChain(...).at(-1)?.id` to the tree-highlight id", () => {
    // Exact shape spelled out in the task description. The call may be
    // split across a local `chain` binding + `.at(-1)` dereference, which
    // is more readable — accept either the one-liner or the bound form.
    assert.match(SRC, /ancestorChain\(/);
    assert.match(SRC, /\.at\(-1\)\?\.id/);
  });

  it("emits a `console.warn` on mismatch (per Req 6.4)", () => {
    assert.match(SRC, /console\.warn\(/);
    // Mention of "disagreement" in the warning so grepping logs is easy.
    assert.match(SRC, /disagreement/);
  });

  it("runs the assertion inside a React.useEffect (Rules-of-Hooks-safe)", () => {
    assert.match(SRC, /React\.useEffect\(/);
  });
});

describe("FilesTabMain — Req 1.8 unresolved-location error indicator", () => {
  it("renders an inline error surface when currentLocationId is set but unresolved", () => {
    // The component renders an alert-role element with a test id we can
    // query from the PBT / role-gate suites.
    assert.match(
      SRC,
      /data-testid="files-tab-main-location-not-found"/,
    );
    assert.match(SRC, /role="alert"/);
  });

  it("reads currentLocationId + nodesById from the store to detect the race", () => {
    assert.match(SRC, /currentLocationId/);
    assert.match(SRC, /nodesById\[currentLocationId\]\s*===\s*undefined/);
  });

  it("does NOT render FolderListView / FileView while unresolved", () => {
    // Check the ternary skips straight to the error indicator when
    // `unresolved` is true; JSX layout may be across multiple lines.
    assert.match(SRC, /unresolved\s*\?\s*\([\s\S]*?<LocationNotFound\s*\/>/);
  });
});
