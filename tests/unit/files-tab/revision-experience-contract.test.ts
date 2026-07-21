import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("Files tab revision experience", () => {
  it("keeps one closeable inspector and restores focus to Actions", () => {
    const fileView = source("src/components/projects/v2/files-tab/file/FileView.tsx");
    const header = source("src/components/projects/v2/files-tab/file/FileInspectorPanelHeader.tsx");

    assert.match(fileView, /type FileInspectorPanel = "linked_tasks" \| "version_history" \| null/);
    assert.match(fileView, /setActiveInspectorPanel/);
    assert.doesNotMatch(fileView, /setIsLinkedTasksPanelOpen/);
    assert.doesNotMatch(fileView, /setIsVersionHistoryPanelOpen/);
    assert.match(fileView, /actionsTriggerRef\.current\?\.focus\(\)/);
    assert.match(header, /event\.key !== "Escape"/);
    assert.match(header, /aria-label=\{closeLabel\}/);
  });

  it("never offers Compare on the active version", () => {
    const history = source("src/components/projects/v2/files-tab/file/FileVersionHistoryPanel.tsx");
    assert.match(history, /onCompareClick && !isCurrent/);
    assert.match(history, /Compare with active/);
  });

  it("uses the canonical revision transaction from browser and extension paths", () => {
    const service = source("src/lib/files/apply-file-revision.ts");
    const versions = source("src/app/actions/files/versions.ts");
    const inlineRoute = source("src/app/api/v1/extension/file/route.ts");
    const largeRoute = source("src/app/api/v1/extension/file-upload/route.ts");

    assert.match(service, /input\.mode === "new_revision"/);
    assert.match(service, /FOR UPDATE/);
    assert.match(service, /assertOwnedFileLease/);
    assert.match(service, /fencingToken/);
    assert.match(service, /versionIncremented/);
    assert.match(service, /max\(fileVersions\.version\)/);
    assert.match(service, /nextFileRevisionNumber/);
    assert.match(versions, /applyFileRevision/);
    assert.match(versions, /mode: "new_revision"/);
    assert.match(versions, /restoredFrom: targetVersion/);
    assert.match(inlineRoute, /applyFileRevision/);
    assert.match(largeRoute, /applyFileRevision/);
    assert.match(largeRoute, /afterMutationTx/);
  });

  it("does not return raw database query details to extension users", () => {
    const inlineRoute = source("src/app/api/v1/extension/file/route.ts");
    const largeRoute = source("src/app/api/v1/extension/file-upload/route.ts");

    for (const route of [inlineRoute, largeRoute]) {
      assert.match(route, /Failed to save file revision\. Refresh the file and try again\./);
      assert.doesNotMatch(route, /jsonError\(\s*error instanceof Error \? error\.message/);
    }
  });

  it("sends active browser edits through immutable upload intents", () => {
    const viewer = source("src/components/projects/v2/files-tab/file/TextViewer.tsx");
    const actions = source("src/components/projects/v2/files-tab/file/FileActionsBar.tsx");
    const fileView = source("src/components/projects/v2/files-tab/file/FileView.tsx");

    for (const implementation of [viewer, actions, fileView]) {
      assert.match(implementation, /active_revision/);
      assert.doesNotMatch(implementation, /storage\s*\.from\("project-files"\)\s*\.update/);
    }
  });

  it("reconciles version, timestamp, bytes, and uploader as one realtime snapshot", () => {
    const nodes = source("src/app/actions/files/nodes.ts");
    const channel = source("src/lib/realtime/project-files-channel.ts");
    const root = source("src/components/projects/v2/files-tab/FilesTabRoot.tsx");

    assert.match(nodes, /pn\.current_version = fv\.version/);
    assert.match(channel, /event: '\*'[\s\S]*table: 'file_versions'/);
    assert.match(channel, /eventType !== 'INSERT'[\s\S]*eventType !== 'UPDATE'[\s\S]*eventType !== 'DELETE'/);
    assert.match(root, /pendingVersionNodeIds/);
    assert.match(root, /getNodeMetadataBatch\(projectId, nodeIds\)/);
    assert.match(root, /upsertNodes\(projectId, result\.data\.nodes\)/);
    assert.doesNotMatch(root, /onFileVersionChange:[\s\S]{0,160}patchNodeVersion/);
  });
});
