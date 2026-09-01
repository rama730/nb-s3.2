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
    assert.match(SRC, /\{\s*canEdit,\s*canManageFiles\s*\}\s*=\s*useFilesTabRole\(\)/);
  });

  it("uses the prescribed wrapper classes (Req 1.7 full-width main)", () => {
    // `flex-1 flex flex-col min-w-0 h-full` — design § FilesTabMain.
    assert.match(SRC, /flex-1 flex flex-col min-w-0 h-full/);
  });

  it("always renders the shared location header around the body", () => {
    assert.match(SRC, /<FilesWorkspaceHeader\s+projectId=\{projectId\}\s+location=\{location\}/);
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

  it("imports the shared header and real folder/file surfaces", () => {
    assert.match(SRC, /from\s+"\.\/FilesWorkspaceHeader"/);
    assert.match(SRC, /from\s+"\.\/folder\/FolderListView"/);
    assert.match(SRC, /from\s+"\.\/file\/FileView"/);
  });

  it("keeps surface disagreement coverage in navigation helper tests, not runtime warnings", () => {
    assert.doesNotMatch(SRC, /ancestorChain\(/);
    assert.doesNotMatch(SRC, /tree ⇄ breadcrumb disagreement|console\.warn\("\[files-tab\]/);
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
