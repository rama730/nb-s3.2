import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file: string) =>
  readFileSync(`src/components/projects/v2/files-tab/${file}`, "utf8");

test("one fixed-height workspace header owns sidebar reopen and action/status slots", () => {
  const header = read("FilesWorkspaceHeader.tsx");
  assert.equal(header.match(/<header\b/g)?.length, 1);
  assert.match(header, /h-12 min-h-12/);
  assert.match(header, /files-tab-sidebar-expand/);
  assert.match(header, /ref=\{setStatus\}/);
  assert.match(header, /ref=\{setActions\}/);
  assert.match(read("FilesTabMain.tsx"), /<FilesWorkspaceHeader/);
  assert.doesNotMatch(
    read("FilesTabMain.tsx"),
    /<header|PanelLeftOpen|Search project files/,
  );
});

test("controls share a client-only portal without pulling server actions into leaf components", () => {
  const slot = read("FilesHeaderSlot.tsx");
  assert.match(slot, /createPortal/);
  assert.doesNotMatch(slot, /@\/app\/actions|FilesWorkspaceHeader/);
  for (const file of ["file/MetadataStrip.tsx", "file/TextViewer.tsx"]) {
    assert.match(read(file), /FilesHeaderSlot/);
    assert.doesNotMatch(read(file), /from .*FilesWorkspaceHeader/);
  }
});

test("search is on demand and applying it cannot leave the previous query clickable", () => {
  const header = read("FilesWorkspaceHeader.tsx"),
    folder = read("folder/FolderListView.tsx");
  assert.match(header, /<QuickOpenDialog/);
  assert.match(header, /includeFolders/);
  assert.match(header, /Search results/);
  assert.match(header, /Clear search:/);
  assert.match(folder, /const search = workspace\?\.query \?\? ""/);
  assert.doesNotMatch(folder, /setTimeout\(.*setSearch|<input/);
  assert.doesNotMatch(
    read("FilesTabSidebar.tsx"),
    /<input|Find in project tree/,
  );
});

test("all collections reuse the menu; task-specific controls stay contextual", () => {
  for (const file of [
    "folder/FolderListView.tsx",
    "TaskFilesCollection.tsx",
    "TrashFilesCollection.tsx",
  ]) {
    assert.match(read(file), /<FilesWorkspaceMenu/);
  }
  assert.match(read("SavedFilesCollection.tsx"), /<FolderListView/);
  const folder = read("folder/FolderListView.tsx");
  assert.match(folder, /!collection && !search && canEditCurrentFolder/);
  assert.match(folder, /<DropdownMenuRadioGroup[^>]*aria-label="Sort files"/);
  assert.doesNotMatch(folder, />\s*Refresh\s*</);
  const task = read("TaskFilesCollection.tsx");
  assert.match(task, /menuItems: taskMenuItems/);
  assert.match(task, /workspace.fileRole/);
});

test("task title and role restore cannot leak into a different navigation scope", () => {
  const workspace = read("FilesWorkspaceViews.tsx");
  assert.match(workspace, /taskHeading.id === taskId/);
  assert.match(workspace, /nextView === "tasks" &&\s+nextTask/);
  assert.match(workspace, /\["tasks", "deliverables"\].includes\(nextView\)/);
  assert.match(workspace, /dirtyFileId/);
});

test("file previews have no second metadata/action strip, with accessible menu and details", () => {
  assert.match(read("file/MetadataStrip.tsx"), /"contents"/);
  assert.match(read("file/MetadataStrip.tsx"), /className="sr-only"/);
  assert.doesNotMatch(read("file/MetadataStrip.tsx"), /TaskLinkPopover/);
  const actions = read("file/FileActionsBar.tsx");
  assert.match(actions, /Actions for \$\{fileName/);
  assert.match(actions, /setInspector\(current => current === "details"/);
  assert.match(read("file/TextViewer.tsx"), /<FilesHeaderSlot slot="status">/);
});

test("folder search navigation clears its filter and dialogs do not stack focus locks", () => {
  assert.match(read("hooks/useNavigateTo.ts"), /FILES_NAVIGATED_EVENT/);
  assert.match(read("FilesWorkspaceViews.tsx"), /detail\.isFolder/);
  assert.doesNotMatch(read("quick-open/QuickOpenDialog.tsx"), /fresh.type === "folder"\) onApplyQuery/);
  assert.match(read("FilesWorkspaceHeader.tsx"), /modal=\{false\}/);
  assert.match(read("FilesWorkspaceHeader.tsx"), /pendingSurface.current/);
  assert.match(read("FilesTabRoot.tsx"), /!quickOpenOpenRef.current &&\s+target\?\.closest/);
});
