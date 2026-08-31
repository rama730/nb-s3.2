import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(`src/components/projects/v2/files-tab/${path}`, "utf8");

test("collection navigation lives in the sidebar, not a second project header", () => {
  const sidebar = read("FilesTabSidebar.tsx"), workspace = read("FilesWorkspaceViews.tsx");
  assert.match(sidebar, /aria-label="File collections"/);
  assert.match(sidebar, /Back to Files/);
  assert.match(sidebar, /workspaceView\.showCollections/);
  assert.match(sidebar, /workspaceView\.selectView/);
  assert.doesNotMatch(workspace, /<nav/);
  for (const collection of ["project", "tasks", "deliverables", "recent", "starred", "trash"]) assert.ok(workspace.includes(`id: "${collection}"`));
});

test("row actions are shared across project, task and saved collections; selection is opt-in", () => {
  const folder = read("folder/FolderListView.tsx"), row = read("folder/FolderListRow.tsx");
  assert.match(folder, /setSelectionMode\] = React\.useState\(false\)/);
  assert.match(folder, /Actions for \$\{node\.name\}/);
  assert.match(folder, /renderMenu\(node\)/);
  assert.doesNotMatch(row, /function arePropsEqual/);
  assert.match(row, /canEdit && onSelectionChange/);
  for (const path of ["TaskFilesCollection.tsx", "SavedFilesCollection.tsx"]) assert.match(read(path), /<FolderListView/);
  assert.doesNotMatch(folder, />\s*Refresh\s*</);
});

test("collection return retains search and scroll and asks before discarding edits", () => {
  const workspace = read("FilesWorkspaceViews.tsx");
  assert.match(workspace, /filesGroupQuery/);
  assert.match(workspace, /scrollOffsets/);
  assert.match(workspace, /dirtyFileId/);
  assert.match(workspace, /Discard unsaved changes/);
  assert.match(read("folder/FolderListView.tsx"), /scrollOffsets.current.get\(scrollKey\)/);
});

test("Trash has mandatory per-item destructive confirmation and failure-safe reconciliation", () => {
  const trash = read("TrashFilesCollection.tsx");
  assert.match(trash, /getPermanentDeleteImpact/);
  assert.match(trash, /deletion\.fingerprint/);
  assert.match(trash, /autoCloseOnConfirm=\{false\}/);
  assert.match(trash, /response.status === "pending"/);
  assert.match(trash, /canManageFiles/);
  assert.match(trash, /permanentDeleteRoot/);
});

test("task unlink never substitutes global file deletion", () => {
  const task = read("TaskFilesCollection.tsx");
  assert.match(task, /Remove file from this task/);
  assert.match(task, /unlinkNodeFromTask\(taskId, unlinkTarget.id\)/);
  assert.doesNotMatch(task, /await (trashNode|deleteNode)\(/);
});

test("small-screen inspectors use the shared focus-contained dialog", () => {
  assert.match(read("file/FileInspectorContainer.tsx"), /presentation="right-drawer"/);
  assert.match(read("navigation/GitHubSyncDrawer.tsx"), /FileInspectorContainer/);
  assert.match(read("file/FileView.tsx"), /FileInspectorContainer/);
  assert.doesNotMatch(read("../preview/AssetPreview.tsx"), /docs\.google\.com\/gview/);
});
